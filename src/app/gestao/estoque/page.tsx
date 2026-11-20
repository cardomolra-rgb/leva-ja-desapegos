import Link from "next/link";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, varias } from "@/lib/db";
import { brl, data, STATUS_ITEM } from "@/lib/formato";
import { avisarDono, devolverAoDono } from "@/app/acoes/gestao";

export const metadata = { title: "Estoque" };

const FILTROS: Record<string, { rotulo: string; where: string }> = {
  vitrine: { rotulo: "Vitrine", where: "i.status = 'vitrine'" },
  reservado: { rotulo: "Reservado", where: "i.status = 'reservado'" },
  minimo: { rotulo: "No mínimo", where: "i.status = 'vitrine' and i.preco_atual <= i.preco_minimo" },
  vencido: { rotulo: "Vencido", where: "i.status = 'vencido'" },
};

export default async function Estoque({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { f = "vitrine", q } = await searchParams;
  const filtro = FILTROS[f] ?? FILTROS.vitrine;
  const { ctx } = await exigirEquipe();
  const { itens, ocupacao } = await comoUsuario(ctx, async (db) => ({
    itens: await varias<{ id: string; codigo: string; titulo: string; status: string; preco_atual: number; preco_minimo: number; categoria: string; dono: string; entrada_vitrine_em: Date; vence_em: Date | null; doacao_em: Date | null; retirar_ate: Date | null }>(
      db,
      `select i.id, i.codigo, i.titulo, i.status, i.preco_atual, i.preco_minimo, c.nome categoria, p.nome dono,
              i.entrada_vitrine_em, i.vence_em, i.doacao_em,
              (select r.retirar_ate from reservas r where r.item_id = i.id and r.status = 'paga') retirar_ate
       from itens i join categorias c on c.id = i.categoria_id join perfis p on p.id = i.dono_id
       where ${filtro.where} ${q ? "and (i.titulo ilike '%' || $1 || '%' or i.codigo ilike $1)" : ""}
       order by i.entrada_vitrine_em limit 300`,
      q ? [q] : [],
    ),
    ocupacao: await varias<{ nome: string; ativa: boolean; ocupados: number; em_analise: number; limite_itens: number }>(
      db, "select nome, ativa, ocupados::int, em_analise::int, limite_itens from ocupacao_categorias order by id",
    ),
  }));

  return (
    <div className="pilha">
      <h1>Estoque</h1>
      <section className="cartao pilha">
        <h2>Ocupação por categoria</h2>
        {ocupacao.filter((o) => o.ativa).map((o) => {
          const pct = o.limite_itens ? Math.min(100, ((o.ocupados + o.em_analise) / o.limite_itens) * 100) : 100;
          return (
            <div key={o.nome} className="pilha" style={{ gap: 2 }}>
              <div className="linha entre pequeno"><span>{o.nome}</span><span>{o.ocupados} + {o.em_analise} em análise / {o.limite_itens}</span></div>
              <div className={`barra ${pct >= 100 ? "cheia" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </section>

      <div className="chips">
        {Object.entries(FILTROS).map(([k, v]) => (
          <Link key={k} href={`/gestao/estoque?f=${k}`} className={`chip ${f === k ? "ativo" : ""}`}>{v.rotulo}</Link>
        ))}
      </div>
      <form className="linha" action="/gestao/estoque">
        <input type="hidden" name="f" value={f} />
        <input name="q" defaultValue={q} placeholder="Nome ou código" style={{ flex: 1 }} />
        <button className="botao peq escuro">Filtrar</button>
      </form>

      <p className="mudo">{itens.length} item(ns)</p>
      {itens.map((i) => (
        <div key={i.id} className="cartao pilha">
          <div className="linha entre">
            <strong>{i.titulo}</strong>
            <span className="mudo pequeno">{i.codigo}</span>
          </div>
          <div className="pequeno mudo">{i.categoria} · {i.dono} · entrou {data(i.entrada_vitrine_em)}</div>
          <div className="linha entre">
            <span className="selo claro">{STATUS_ITEM[i.status]}</span>
            <span>{brl(i.preco_atual)} <span className="mudo pequeno">mín. {brl(i.preco_minimo)}</span></span>
          </div>
          {i.retirar_ate && <div className="pequeno">Retirar até {data(i.retirar_ate, true)}</div>}
          {i.status === "vencido" && i.doacao_em && <div className="pequeno">Doação em {data(i.doacao_em)}</div>}
          {i.status === "vitrine" && i.vence_em && <div className="pequeno mudo">Prazo final {data(i.vence_em)}</div>}
          <div className="linha">
            <form action={avisarDono.bind(null, i.id)}><button className="botao peq contorno">📣 Avisar dono</button></form>
            {(i.status === "vencido" || i.status === "vitrine") && (
              <form action={devolverAoDono.bind(null, i.id)}><button className="botao peq contorno">↩ Dono retirou</button></form>
            )}
            <Link className="botao peq contorno" href={`/gestao/etiqueta/${i.id}`}>🏷 Etiqueta</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
