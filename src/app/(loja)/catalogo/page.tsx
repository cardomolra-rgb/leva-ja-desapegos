import Link from "next/link";
import { after } from "next/server";
import { obterSessao } from "@/lib/sessao";
import { categorias, listarVitrine, type FiltrosCatalogo } from "@/lib/consultas";
import { lerConfig } from "@/lib/config-loja";
import { comoUsuario } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { ESTADOS, ESTADO_ROTULO, paraCentavos, situacaoPreco, type Estado } from "@/lib/rules";
import { ItemCard } from "@/components/ItemCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catálogo" };

type Params = Promise<Record<string, string | undefined>>;

export default async function Catalogo({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const { ctx } = await obterSessao();
  const filtros: FiltrosCatalogo = {
    categoria: sp.cat || undefined,
    busca: sp.q?.trim().slice(0, 80) || undefined,
    ordem: (["recentes", "menor", "maior", "baixando"].includes(sp.ordem ?? "") ? sp.ordem : "recentes") as FiltrosCatalogo["ordem"],
    precoMax: sp.max ? paraCentavos(sp.max) || undefined : undefined,
    semDefeito: sp.sd === "1",
    estado: ESTADOS.includes(sp.estado as Estado) ? (sp.estado as Estado) : undefined,
  };
  const [cfg, cats, itens] = await Promise.all([
    lerConfig(),
    comoUsuario(ctx, (db) => categorias(db)),
    listarVitrine(ctx, filtros),
  ]);

  if (filtros.busca) {
    // "busca sem resultado" alimenta o relatório de demanda não atendida — gravado depois da resposta
    const termo = filtros.busca, categoria = filtros.categoria ?? null, resultados = itens.length;
    after(() =>
      comoUsuario(ctx, (db) =>
        registrarEvento(db, resultados ? "busca" : "busca_sem_resultado", { perfilId: ctx.perfilId, dados: { termo, categoria, resultados } }),
      ).catch(console.error),
    );
  }

  const agora = new Date();
  const link = (mudar: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const tudo = { cat: sp.cat, q: sp.q, ordem: sp.ordem, max: sp.max, sd: sp.sd, estado: sp.estado, ...mudar };
    for (const [k, v] of Object.entries(tudo)) if (v) p.set(k, v);
    return `/catalogo?${p}`;
  };

  return (
    <div className="pilha">
      <h1>Catálogo</h1>
      <form className="linha" action="/catalogo">
        {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
        <input name="q" defaultValue={sp.q} placeholder="Buscar: panela, jaqueta, furadeira…" style={{ flex: 1, minWidth: 180 }} aria-label="Buscar" />
        <button className="botao peq" type="submit">Buscar</button>
      </form>

      <div className="chips" role="list">
        <Link className={`chip ${!sp.cat ? "ativo" : ""}`} href={link({ cat: undefined })}>Tudo</Link>
        {cats.map((c) => (
          <Link key={c.slug} className={`chip ${sp.cat === c.slug ? "ativo" : ""}`} href={link({ cat: c.slug })}>{c.nome}</Link>
        ))}
      </div>

      <details className="cartao">
        <summary><strong>Filtros e ordem</strong></summary>
        <form className="pilha" action="/catalogo" style={{ marginTop: 12 }}>
          {sp.cat && <input type="hidden" name="cat" value={sp.cat} />}
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <div className="grade-2">
            <label>Ordenar
              <select name="ordem" defaultValue={filtros.ordem}>
                <option value="recentes">Mais recentes</option>
                <option value="menor">Menor preço</option>
                <option value="maior">Maior preço</option>
                <option value="baixando">Mais baixados</option>
              </select>
            </label>
            <label>Até (R$)
              <input name="max" inputMode="decimal" defaultValue={sp.max} placeholder="ex.: 100" />
            </label>
          </div>
          <label>Estado
            <select name="estado" defaultValue={sp.estado ?? ""}>
              <option value="">Qualquer</option>
              {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_ROTULO[e]}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" name="sd" value="1" defaultChecked={filtros.semDefeito} /> Esconder itens com defeito</label>
          <button className="botao escuro" type="submit">Aplicar</button>
        </form>
      </details>

      {itens.length ? (
        <div className="grade">
          {itens.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              situacao={situacaoPreco(cfg, { precoInicial: i.preco_inicial, precoMinimo: i.preco_minimo, entradaVitrine: new Date(i.entrada_vitrine_em) }, agora)}
            />
          ))}
        </div>
      ) : (
        <div className="cartao areia centro pilha">
          <p><strong>Nada por aqui ainda.</strong></p>
          <p className="mudo">Registramos sua busca para saber o que está faltando na loja.</p>
          <Link className="botao contorno" href="/catalogo">Ver tudo</Link>
        </div>
      )}
    </div>
  );
}
