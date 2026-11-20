/**
 * Fluxos completos contra um Postgres real (PGlite): entrada → queda → reserva → Pix → retirada → repasse,
 * reserva expirada, prazo vencido e doação.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_PADRAO as cfg } from "@/lib/rules";
import type { Db } from "@/lib/db";
import {
  ErroRegra,
  aplicarQuedas,
  colocarNaVitrine,
  confirmarPagamento,
  expirarReservas,
  prepararReserva,
  registrarVenda,
} from "@/lib/operacoes";

const local = (s: string) => new Date(`${s}-03:00`);
const DONO = "11111111-1111-1111-1111-111111111111";
const CLIENTE = "22222222-2222-2222-2222-222222222222";
const ATENDENTE = "33333333-3333-3333-3333-333333333333";
const ITEM = "aaaaaaaa-0000-0000-0000-000000000001";

let pg: PGlite;
let db: Db;
const um = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pg.query<T>(sql, p)).rows[0];

beforeEach(async () => {
  pg = new PGlite();
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(path.join(dir, f), "utf8"));
  await pg.query(
    `insert into perfis (id, auth_user_id, nome, cpf, papel) values
     ($1,'a1','Dono','11111111111','cliente'), ($2,'a2','Cliente','22222222222','cliente'), ($3,'a3','Atendente','33333333333','atendente')`,
    [DONO, CLIENTE, ATENDENTE],
  );
  await pg.query(
    `insert into itens (id, dono_id, categoria_id, titulo, estado, preco_novo, teto, preco_inicial, preco_minimo, preco_atual, status, modalidade_repasse)
     values ($1, $2, 2, 'Luminária de piso', 'usado_bom', 50000, 20000, 10000, 7000, 10000, 'aguardando_entrega', 'pix')`,
    [ITEM, DONO],
  );
  db = pg as unknown as Db;
}, 60000);

const entrada = local("2026-11-02T10:00:00");
const naVitrine = () => colocarNaVitrine(db, cfg, { itemId: ITEM, avaliadorId: ATENDENTE, precoInicial: 10000, precoMinimo: 7000 }, entrada);

describe("entrada e queda", () => {
  it("gera código curto, histórico e aviso ao dono", async () => {
    const { codigo } = await naVitrine();
    expect(codigo).toBe("CAS-4001");
    expect(await um("select status, preco_atual from itens")).toEqual({ status: "vitrine", preco_atual: 10000 });
    expect((await um<{ n: number }>("select count(*)::int n from avisos where perfil_id = $1", [DONO])).n).toBe(1);
  });

  it("cron de queda baixa o preço uma única vez por etapa", async () => {
    await naVitrine();
    expect(await aplicarQuedas(db, cfg, local("2026-11-10T06:00:00"))).toMatchObject({ quedas: 0 });
    expect(await aplicarQuedas(db, cfg, local("2026-11-16T06:00:00"))).toMatchObject({ quedas: 1 });
    expect(await aplicarQuedas(db, cfg, local("2026-11-16T06:30:00"))).toMatchObject({ quedas: 0 }); // idempotente
    expect(await um("select preco_atual, etapa_queda from itens")).toEqual({ preco_atual: 9000, etapa_queda: 1 });
    // cron parado vários dias: pula direto para a etapa certa
    await aplicarQuedas(db, cfg, local("2026-12-20T06:00:00"));
    const it = await um<{ preco_atual: number; no_minimo_em: Date | null }>("select preco_atual, no_minimo_em from itens");
    expect(it.preco_atual).toBe(7000);
    expect(it.no_minimo_em).not.toBeNull();
    const h = await pg.query<{ preco: number }>("select preco from historico_precos order by id");
    expect(h.rows.map((r) => r.preco)).toEqual([10000, 9000, 7000]);
  });

  it("prazo vencido no mínimo avisa o dono e depois de 7 dias vai para doação", async () => {
    await naVitrine();
    expect(await aplicarQuedas(db, cfg, local("2026-12-28T06:00:00"))).toMatchObject({ vencidos: 1 });
    expect((await um<{ status: string }>("select status from itens")).status).toBe("vencido");
    expect(await aplicarQuedas(db, cfg, local("2027-01-03T06:00:00"))).toMatchObject({ doados: 0 });
    expect(await aplicarQuedas(db, cfg, local("2027-01-04T06:00:00"))).toMatchObject({ doados: 1 });
    expect((await um<{ status: string }>("select status from itens")).status).toBe("doado");
  });
});

describe("reserva, Pix e retirada", () => {
  it("fluxo completo com sinal descontado e repasse de 60%", async () => {
    await naVitrine();
    await aplicarQuedas(db, cfg, local("2026-11-16T06:00:00")); // R$ 90
    const r = await prepararReserva(db, cfg, { itemId: ITEM, clienteId: CLIENTE, aceiteId: null }, local("2026-11-17T10:00:00"));
    expect(r.sinal).toBe(900);
    expect((await um<{ status: string }>("select status from itens")).status).toBe("reservado");

    // não deixa reservar de novo
    await expect(prepararReserva(db, cfg, { itemId: ITEM, clienteId: DONO, aceiteId: null }, local("2026-11-17T10:01:00"))).rejects.toThrow(ErroRegra);

    await confirmarPagamento(db, cfg, r.pagamentoId, local("2026-11-17T10:05:00"), local("2026-11-17T10:05:00"));
    const again = await confirmarPagamento(db, cfg, r.pagamentoId, local("2026-11-17T10:05:00"), local("2026-11-17T10:06:00"));
    expect(again.jaConfirmado).toBe(true); // webhook repetido não duplica

    // queda depois da reserva não muda o preço travado
    await aplicarQuedas(db, cfg, local("2026-11-30T06:00:00"));

    // caixa recebe o restante (R$ 81) em débito
    await expect(
      registrarVenda(db, cfg, { itemId: ITEM, atendenteId: ATENDENTE, reservaId: r.reservaId, pagamentos: [{ metodo: "cartao_debito", valor: 8000 }] }, local("2026-11-18T15:00:00")),
    ).rejects.toThrow(/diferente/);
    const v = await registrarVenda(
      db, cfg,
      { itemId: ITEM, atendenteId: ATENDENTE, reservaId: r.reservaId, pagamentos: [{ metodo: "cartao_debito", valor: 8100 }] },
      local("2026-11-18T15:00:00"),
    );
    expect(v).toMatchObject({ valorTotal: 9000, sinal: 900, repasse: 5400 });
    const rep = await um<{ valor: number; status: string; previsto_para: Date }>("select valor, status, previsto_para from repasses");
    expect(rep.valor).toBe(5400);
    expect(rep.status).toBe("aguardando");
    // venda 18/11 → troca até 25/11 → lote de terça 01/12
    expect(new Date(rep.previsto_para).toISOString().slice(0, 10)).toBe("2026-12-01");
    expect((await um<{ status: string }>("select status from reservas")).status).toBe("retirada");
    expect((await um<{ status: string }>("select status from itens")).status).toBe("vendido");
  });

  it("item com defeito exige o aceite", async () => {
    await naVitrine();
    await pg.query("update itens set tem_defeito = true, defeitos = '{risco}'");
    await expect(prepararReserva(db, cfg, { itemId: ITEM, clienteId: CLIENTE, aceiteId: null }, local("2026-11-03T10:00:00"))).rejects.toThrow(/aceitar/);
  });

  it("Pix não pago em 30 min cancela e o item volta para a vitrine", async () => {
    await naVitrine();
    await prepararReserva(db, cfg, { itemId: ITEM, clienteId: CLIENTE, aceiteId: null }, local("2026-11-03T10:00:00"));
    expect(await expirarReservas(db, local("2026-11-03T10:20:00"))).toEqual({ canceladas: 0, expiradas: 0 });
    expect(await expirarReservas(db, local("2026-11-03T10:31:00"))).toEqual({ canceladas: 1, expiradas: 0 });
    expect((await um<{ status: string }>("select status from itens")).status).toBe("vitrine");
  });

  it("não retirou em 48h: sinal retido e item volta", async () => {
    await naVitrine();
    const r = await prepararReserva(db, cfg, { itemId: ITEM, clienteId: CLIENTE, aceiteId: null }, local("2026-11-03T10:00:00"));
    await confirmarPagamento(db, cfg, r.pagamentoId, local("2026-11-03T10:02:00"), local("2026-11-03T10:02:00"));
    expect(await expirarReservas(db, local("2026-11-05T10:03:00"))).toEqual({ canceladas: 0, expiradas: 1 });
    expect((await um<{ status: string }>("select status from itens")).status).toBe("vitrine");
    const e = await um<{ dados: { sinal_retido: number } }>("select dados from eventos where tipo = 'reserva_expirada'");
    expect(e.dados.sinal_retido).toBe(1000);
  });
});

describe("caixa", () => {
  it("venda no balcão com crédito na loja exige saldo", async () => {
    await naVitrine();
    await expect(
      registrarVenda(db, cfg, { itemId: ITEM, atendenteId: ATENDENTE, compradorId: CLIENTE, pagamentos: [{ metodo: "credito_loja", valor: 10000 }] }, local("2026-11-03T10:00:00")),
    ).rejects.toThrow(/insuficiente/);
    await pg.query("insert into creditos (perfil_id, valor, origem) values ($1, 4000, 'repasse')", [CLIENTE]);
    await registrarVenda(
      db, cfg,
      { itemId: ITEM, atendenteId: ATENDENTE, compradorId: CLIENTE, pagamentos: [{ metodo: "credito_loja", valor: 4000 }, { metodo: "cartao_credito", valor: 6000 }] },
      local("2026-11-03T10:00:00"),
    );
    expect((await um<{ s: number }>("select sum(valor)::int s from creditos where perfil_id = $1", [CLIENTE])).s).toBe(0);
    // cartão de crédito sem liquidação → repasse sem data prevista
    expect((await um<{ previsto_para: Date | null }>("select previsto_para from repasses")).previsto_para).toBeNull();
  });

  it("item reservado não sai no balcão sem o código", async () => {
    await naVitrine();
    await prepararReserva(db, cfg, { itemId: ITEM, clienteId: CLIENTE, aceiteId: null }, local("2026-11-03T10:00:00"));
    await expect(
      registrarVenda(db, cfg, { itemId: ITEM, atendenteId: ATENDENTE, pagamentos: [{ metodo: "pix", valor: 10000 }] }, local("2026-11-03T11:00:00")),
    ).rejects.toThrow(/reservado/);
  });
});
