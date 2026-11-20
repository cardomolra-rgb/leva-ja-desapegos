import Link from "next/link";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, uma, varias } from "@/lib/db";
import { brl } from "@/lib/formato";

export const metadata = { title: "Painel" };

type Params = Promise<{ dias?: string }>;

export default async function Painel({ searchParams }: { searchParams: Params }) {
  const { dias: d } = await searchParams;
  const dias = [7, 30, 90].includes(Number(d)) ? Number(d) : 30;
  const { perfil, ctx } = await exigirEquipe();
  const gestor = perfil.papel === "gestor";

  const dados = await comoUsuario(ctx, async (db) => {
    const alertas = await uma<{ pre: number; entregar: number; reservas_hoje: number; vencidos: number; pix_atrasado: number }>(
      db,
      `select (select count(*) from itens where status = 'pre_avaliacao')::int pre,
              (select count(*) from itens where status = 'aguardando_entrega')::int entregar,
              (select count(*) from reservas where status = 'paga' and retirar_ate < now() + interval '12 hours')::int reservas_hoje,
              (select count(*) from itens where status = 'vencido')::int vencidos,
              (select count(*) from pagamentos p join reservas r on r.pagamento_id = p.id
                 where p.status = 'aprovado' and r.status in ('cancelada','expirada') and p.aprovado_em > r.encerrada_em)::int pix_atrasado`,
    );
    const cheias = await varias<{ nome: string; ocupados: number; limite_itens: number }>(
      db, "select nome, ocupados::int, limite_itens from ocupacao_categorias where ativa and ocupados >= limite_itens * 0.9",
    );
    if (!gestor) return { alertas, cheias };

    const k = await uma<{ fat: number; vendas: number; ticket: number; giro: number; comissao: number; retidos: number }>(
      db,
      `select coalesce(sum(v.valor_total),0)::bigint fat, count(*)::int vendas, coalesce(avg(v.valor_total),0)::bigint ticket,
              coalesce(avg(extract(epoch from v.criado_em - i.entrada_vitrine_em) / 86400), 0)::numeric(6,1) giro,
              coalesce(sum(v.valor_total - rp.valor),0)::bigint comissao,
              (select coalesce(sum(sinal),0) from reservas where status = 'expirada' and encerrada_em > now() - make_interval(days => $1))::bigint retidos
       from vendas v join itens i on i.id = v.item_id left join repasses rp on rp.venda_id = v.id
       where v.status = 'concluida' and v.criado_em > now() - make_interval(days => $1)`,
      [dias],
    );
    const fluxo = await uma<{ entradas: number; saidas_sem_venda: number }>(
      db,
      `select count(*) filter (where tipo = 'entrada')::int entradas,
              count(*) filter (where tipo in ('doacao','devolucao'))::int saidas_sem_venda
       from eventos where criado_em > now() - make_interval(days => $1)`,
      [dias],
    );
    const porDia = await varias<{ dia: string; total: number; n: number }>(
      db,
      `select to_char(date_trunc('day', criado_em at time zone 'America/Araguaina'), 'DD/MM') dia, sum(valor_total)::bigint total, count(*)::int n
       from vendas where status = 'concluida' and criado_em > now() - make_interval(days => least($1, 30))
       group by 1, date_trunc('day', criado_em at time zone 'America/Araguaina') order by date_trunc('day', criado_em at time zone 'America/Araguaina')`,
      [dias],
    );
    const porCategoria = await varias<{ nome: string; vendas: number; fat: number; estoque: number; giro: number | null }>(
      db,
      `select c.nome, count(v.id)::int vendas, coalesce(sum(v.valor_total),0)::bigint fat,
              (select count(*) from itens x where x.categoria_id = c.id and x.status in ('vitrine','reservado'))::int estoque,
              avg(extract(epoch from v.criado_em - i.entrada_vitrine_em) / 86400)::numeric(6,1) giro
       from categorias c left join itens i on i.categoria_id = c.id
       left join vendas v on v.item_id = i.id and v.status = 'concluida' and v.criado_em > now() - make_interval(days => $1)
       where c.ativa group by c.id order by fat desc`,
      [dias],
    );
    const porEtapa = await varias<{ etapa: number; n: number }>(
      db,
      `select etapa_queda etapa, count(*)::int n from vendas where status = 'concluida' and criado_em > now() - make_interval(days => $1)
       group by 1 order by 1`,
      [dias],
    );
    return { alertas, cheias, k, fluxo, porDia, porCategoria, porEtapa };
  });

  const a = dados.alertas!;
  const listaAlertas = [
    a.pre && { t: `${a.pre} pré-avaliação(ões) aguardando`, href: "/gestao/entrada" },
    a.entregar && { t: `${a.entregar} item(ns) aprovados aguardando entrega`, href: "/gestao/entrada" },
    a.reservas_hoje && { t: `${a.reservas_hoje} reserva(s) vencem em até 12 h`, href: "/gestao/estoque?f=reservado" },
    a.vencidos && { t: `${a.vencidos} item(ns) com prazo vencido`, href: "/gestao/estoque?f=vencido" },
    a.pix_atrasado && { t: `${a.pix_atrasado} Pix pago após a reserva expirar — devolver`, href: "/gestao/estoque" },
    ...dados.cheias.map((c) => ({ t: `${c.nome}: ${c.ocupados}/${c.limite_itens} (quase cheia)`, href: "/gestao/estoque" })),
  ].filter(Boolean) as { t: string; href: string }[];

  return (
    <div className="pilha">
      <div className="linha entre">
        <h1>Painel</h1>
        {gestor && (
          <div className="chips">
            {[7, 30, 90].map((n) => <Link key={n} className={`chip ${dias === n ? "ativo" : ""}`} href={`/gestao?dias=${n}`}>{n}d</Link>)}
          </div>
        )}
      </div>

      <section className="cartao pilha">
        <h2>Alertas</h2>
        {listaAlertas.length ? listaAlertas.map((l, i) => (
          <Link key={i} href={l.href} className="alerta" style={{ display: "block", textDecoration: "none" }}>⚠ {l.t}</Link>
        )) : <p className="ok">Tudo em dia.</p>}
      </section>

      {gestor && "k" in dados && dados.k && (() => {
        const k = dados.k;
        const f = dados.fluxo!;
        const taxa = k.vendas + f.saidas_sem_venda > 0 ? Math.round((k.vendas / (k.vendas + f.saidas_sem_venda)) * 100) : 0;
        const maxDia = Math.max(1, ...dados.porDia!.map((x) => x.total));
        const totalEtapas = Math.max(1, dados.porEtapa!.reduce((s, x) => s + x.n, 0));
        return (
          <>
            <div className="kpis">
              <div className="kpi"><div className="rotulo">Faturamento</div><div className="valor">{brl(k.fat)}</div></div>
              <div className="kpi"><div className="rotulo">Comissão</div><div className="valor">{brl(k.comissao)}</div></div>
              <div className="kpi"><div className="rotulo">Lucro estimado*</div><div className="valor">{brl(k.comissao + k.retidos)}</div></div>
              <div className="kpi"><div className="rotulo">Ticket médio</div><div className="valor">{brl(k.ticket)}</div></div>
              <div className="kpi"><div className="rotulo">Giro médio</div><div className="valor">{Number(k.giro).toFixed(1)} dias</div></div>
              <div className="kpi"><div className="rotulo">Taxa de venda</div><div className="valor">{taxa}%</div></div>
              <div className="kpi"><div className="rotulo">Vendas</div><div className="valor">{k.vendas}</div></div>
              <div className="kpi"><div className="rotulo">Entradas × saídas</div><div className="valor">{f.entradas} × {k.vendas + f.saidas_sem_venda}</div></div>
            </div>
            <p className="mudo pequeno">*Comissão + sinais retidos, antes de despesas fixas e taxas do gateway.</p>

            <section className="cartao pilha">
              <h2>Vendas por dia</h2>
              {dados.porDia!.length ? (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
                  {dados.porDia!.map((x) => (
                    <div key={x.dia} title={`${x.dia}: ${brl(x.total)} (${x.n})`} style={{ flex: 1, display: "grid", gap: 2, alignContent: "end", textAlign: "center" }}>
                      <div style={{ height: `${(x.total / maxDia) * 100}px`, background: "var(--laranja)", borderRadius: 4 }} />
                      <span className="pequeno mudo">{x.dia.slice(0, 2)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="mudo">Sem vendas no período.</p>}
            </section>

            <section className="cartao pilha">
              <h2>Por categoria</h2>
              <div className="rolagem"><table className="tabela">
                <thead><tr><th>Categoria</th><th>Vendas</th><th>Faturamento</th><th>Giro</th><th>Estoque</th></tr></thead>
                <tbody>{dados.porCategoria!.map((c) => (
                  <tr key={c.nome}><td>{c.nome}</td><td>{c.vendas}</td><td>{brl(c.fat)}</td><td>{c.giro ? `${Number(c.giro).toFixed(0)}d` : "—"}</td><td>{c.estoque}</td></tr>
                ))}</tbody>
              </table></div>
            </section>

            <section className="cartao pilha">
              <h2>Em que etapa os itens vendem</h2>
              {dados.porEtapa!.map((e) => (
                <div key={e.etapa} className="pilha" style={{ gap: 2 }}>
                  <div className="linha entre pequeno"><span>{e.etapa === 0 ? "Preço cheio" : `Após ${e.etapa}ª queda`}</span><span>{e.n} ({Math.round((e.n / totalEtapas) * 100)}%)</span></div>
                  <div className="barra"><i style={{ width: `${(e.n / totalEtapas) * 100}%` }} /></div>
                </div>
              ))}
              {!dados.porEtapa!.length && <p className="mudo">Sem vendas no período.</p>}
            </section>
          </>
        );
      })()}
    </div>
  );
}
