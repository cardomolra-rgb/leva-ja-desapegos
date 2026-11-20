/**
 * Aplica as migrações num Postgres embutido (PGlite) e testa as políticas de RLS
 * e as restrições do banco. Não precisa de conexão com o Neon.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_PADRAO } from "@/lib/rules";

let db: PGlite;
const ids = {
  dono: "11111111-1111-1111-1111-111111111111",
  outro: "22222222-2222-2222-2222-222222222222",
  atendente: "33333333-3333-3333-3333-333333333333",
  gestor: "44444444-4444-4444-4444-444444444444",
};

/** Executa `sql` como um usuário, igual ao app faz em produção. */
async function como<T = Record<string, unknown>>(perfil: keyof typeof ids | "anon", papel: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('app.perfil_id', $1, true), set_config('app.papel', $2, true)", [
      perfil === "anon" ? "" : ids[perfil],
      papel,
    ]);
    await tx.query("set local role app_rls");
    return (await tx.query<T>(sql, params)).rows;
  });
}

beforeAll(async () => {
  db = new PGlite();
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.query(
    `insert into perfis (id, auth_user_id, nome, cpf, papel) values
      ($1,'a1','Dono','11111111111','cliente'), ($2,'a2','Outro','22222222222','cliente'),
      ($3,'a3','Atendente','33333333333','atendente'), ($4,'a4','Gestor','44444444444','gestor')`,
    [ids.dono, ids.outro, ids.atendente, ids.gestor],
  );
  // um item na vitrine e um em pré-avaliação, ambos do "dono"
  await db.query(`insert into itens (id, dono_id, categoria_id, titulo, estado, preco_novo, teto, preco_inicial, preco_minimo, preco_atual, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001', $1, 1, 'Vestido azul', 'seminovo', 20000, 8000, 8000, 5600, 8000, 'vitrine'),
           ('aaaaaaaa-0000-0000-0000-000000000002', $1, 1, 'Jaqueta', 'usado_bom', 30000, 9000, 9000, 6300, 9000, 'pre_avaliacao')`, [ids.dono]);
  const venda = await db.query<{ id: string }>(`insert into vendas (item_id, valor_total, etapa_queda, preco_inicial, troca_ate)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 8000, 0, 8000, now()) returning id`);
  await db.query(`insert into repasses (venda_id, dono_id, modalidade, valor_venda, pct_dono, valor) values ($1, $2, 'pix', 8000, 0.6, 4800)`, [
    venda.rows[0].id,
    ids.dono,
  ]);
}, 60000);

describe("migrações", () => {
  it("semeiam a configuração igual à CONFIG_PADRAO do código", async () => {
    const r = await db.query<{ dados: unknown }>("select dados from configuracoes where ativa");
    expect(r.rows[0].dados).toEqual(CONFIG_PADRAO);
  });
  it("eletrônicos e ferramentas elétricas existem mas estão desativados", async () => {
    const r = await db.query<{ slug: string; ativa: boolean }>("select slug, ativa from categorias order by ordem");
    expect(r.rows.filter((c) => c.ativa).map((c) => c.slug)).toEqual([
      "moda",
      "casa-decoracao",
      "utensilios",
      "ferramentas-manuais",
      "sobras-material",
    ]);
    expect(r.rows.find((c) => c.slug === "eletronicos")?.ativa).toBe(false);
  });
  it("gera códigos curtos sequenciais", async () => {
    const a = await db.query<{ c: string }>("select app.proximo_codigo('CAS') c");
    const b = await db.query<{ c: string }>("select app.proximo_codigo('CAS') c");
    expect(a.rows[0].c).toBe("CAS-4001");
    expect(b.rows[0].c).toBe("CAS-4002");
  });
  it("banco recusa mínimo acima do inicial", async () => {
    await expect(
      db.query(`insert into itens (dono_id, categoria_id, titulo, estado, preco_novo, teto, preco_inicial, preco_minimo, preco_atual)
        values ($1, 1, 'Teste', 'novo', 100, 100, 100, 200, 100)`, [ids.dono]),
    ).rejects.toThrow();
  });
  it("eventos são somente inserção", async () => {
    await db.query("insert into eventos (tipo) values ('busca')");
    await expect(db.query("delete from eventos")).rejects.toThrow();
  });
});

describe("RLS", () => {
  it("visitante vê só itens da vitrine", async () => {
    const r = await como<{ titulo: string }>("anon", "anon", "select titulo from itens");
    expect(r.map((x) => x.titulo)).toEqual(["Vestido azul"]);
  });
  it("dono vê os próprios itens, inclusive em pré-avaliação", async () => {
    const r = await como("dono", "cliente", "select titulo from itens order by titulo");
    expect(r).toHaveLength(2);
  });
  it("cliente não vê perfil de outro cliente", async () => {
    const r = await como("outro", "cliente", "select id from perfis");
    expect(r.map((x) => x.id)).toEqual([ids.outro]);
  });
  it("cliente não consegue virar gestor nem trocar a chave Pix", async () => {
    await expect(como("dono", "cliente", "update perfis set papel = 'gestor' where id = app.perfil_id()")).rejects.toThrow();
    await expect(
      como("dono", "cliente", "update perfis set chave_pix = cpf where id = app.perfil_id()"),
    ).rejects.toThrow(/presencial/);
  });
  it("cliente não altera item (nem o próprio) diretamente", async () => {
    const r = await como("dono", "cliente", "update itens set preco_atual = preco_minimo returning id");
    expect(r).toHaveLength(0);
  });
  it("repasses: dono vê os seus, outro cliente não, atendente não, gestor sim", async () => {
    expect(await como("dono", "cliente", "select id from repasses")).toHaveLength(1);
    expect(await como("outro", "cliente", "select id from repasses")).toHaveLength(0);
    expect(await como("atendente", "atendente", "select id from repasses")).toHaveLength(0);
    expect(await como("gestor", "gestor", "select id from repasses")).toHaveLength(1);
  });
  it("atendente não altera configurações; gestor altera", async () => {
    await expect(
      como("atendente", "atendente", "insert into configuracoes (dados) values ('{}')"),
    ).rejects.toThrow();
    const r = await como("gestor", "gestor", "insert into configuracoes (dados) values ('{}') returning id");
    expect(r).toHaveLength(1);
  });
  it("eventos: só o gestor lê", async () => {
    expect(await como("atendente", "atendente", "select id from eventos")).toHaveLength(0);
    expect((await como("gestor", "gestor", "select id from eventos")).length).toBeGreaterThan(0);
  });
  it("cliente não insere evento em nome de outro", async () => {
    await expect(
      como("dono", "cliente", "insert into eventos (tipo, perfil_id) values ('favorito', $1)", [ids.outro]),
    ).rejects.toThrow();
  });
});
