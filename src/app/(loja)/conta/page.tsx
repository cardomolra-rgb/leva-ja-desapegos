import Link from "next/link";
import { exigirLogin, cadastroCompleto } from "@/lib/sessao";
import { comoUsuario, uma, varias } from "@/lib/db";
import { brl, cpfMascara, data, STATUS_ITEM } from "@/lib/formato";
import { marcarAvisosLidos, salvarPreferencias, sair } from "@/app/acoes/conta";
import { responderContraproposta } from "@/app/acoes/vender";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minha conta" };

export default async function Conta({ searchParams }: { searchParams: Promise<{ enviado?: string }> }) {
  const { enviado } = await searchParams;
  const { perfil, ctx } = await exigirLogin();

  const dados = await comoUsuario(ctx, async (db) => ({
    avisos: await varias<{ id: string; titulo: string; corpo: string; criado_em: Date; lido_em: Date | null; link: string | null }>(
      db, "select id, titulo, corpo, criado_em, lido_em, link from avisos where perfil_id = $1 order by criado_em desc limit 20", [ctx.perfilId],
    ),
    itens: await varias<{ id: string; codigo: string | null; titulo: string; status: string; preco_atual: number; preco_minimo: number; preco_proposto_loja: number | null; motivo_recusa: string | null }>(
      db, "select id, codigo, titulo, status, preco_atual, preco_minimo, preco_proposto_loja, motivo_recusa from itens where dono_id = $1 order by criado_em desc", [ctx.perfilId],
    ),
    reservas: await varias<{ id: string; status: string; titulo: string; codigo_retirada: string; retirar_ate: Date | null; sinal: number }>(
      db, `select r.id, r.status, i.titulo, r.codigo_retirada, r.retirar_ate, r.sinal from reservas r join itens i on i.id = r.item_id
           where r.cliente_id = $1 order by r.criado_em desc limit 10`, [ctx.perfilId],
    ),
    repasses: await varias<{ id: string; titulo: string; valor: number; modalidade: string; status: string; previsto_para: Date | null; pago_em: Date | null }>(
      db, `select rp.id, i.titulo, rp.valor, rp.modalidade, rp.status, rp.previsto_para, rp.pago_em from repasses rp
           join vendas v on v.id = rp.venda_id join itens i on i.id = v.item_id where rp.dono_id = $1 order by rp.criado_em desc`, [ctx.perfilId],
    ),
    saldo: (await uma<{ saldo: number }>(db, "select coalesce(sum(valor),0)::bigint saldo from creditos where perfil_id = $1", [ctx.perfilId]))?.saldo ?? 0,
    aceites: await varias<{ id: string; tipo: string; versao: string; aceito_em: Date }>(
      db, "select a.id, t.tipo, t.versao, a.aceito_em from aceites a join termos t on t.id = a.termo_id where a.perfil_id = $1 order by a.aceito_em desc", [ctx.perfilId],
    ),
  }));
  const naoLidos = dados.avisos.filter((a) => !a.lido_em).length;

  return (
    <div className="pilha">
      <div className="linha entre">
        <h1>Olá, {perfil.nome.split(" ")[0]}</h1>
        <form action={sair}><button className="botao contorno peq">Sair</button></form>
      </div>

      {!cadastroCompleto(perfil) && (
        <Link href="/conta/cadastro" className="alerta" style={{ display: "block", textDecoration: "none" }}>
          <strong>Complete seu cadastro</strong> para vender e reservar →
        </Link>
      )}
      {enviado && <p className="sucesso">Recebemos seu item! A loja vai fazer a pré-avaliação e você será avisado aqui.</p>}

      <div className="kpis">
        <div className="kpi"><div className="rotulo">Crédito na loja</div><div className="valor">{brl(dados.saldo)}</div></div>
        <div className="kpi"><div className="rotulo">Itens à venda</div><div className="valor">{dados.itens.filter((i) => i.status === "vitrine" || i.status === "reservado").length}</div></div>
        <div className="kpi"><div className="rotulo">A receber</div><div className="valor">{brl(dados.repasses.filter((r) => r.status !== "pago" && r.status !== "cancelado").reduce((s, r) => s + r.valor, 0))}</div></div>
      </div>

      <section className="cartao pilha" id="avisos">
        <div className="linha entre">
          <h2>Avisos {naoLidos > 0 && <span className="selo laranja">{naoLidos}</span>}</h2>
          {naoLidos > 0 && <form action={marcarAvisosLidos}><button className="botao contorno peq">Marcar lidos</button></form>}
        </div>
        {dados.avisos.length ? dados.avisos.map((a) => (
          <div key={a.id} style={{ borderLeft: `4px solid ${a.lido_em ? "var(--areia)" : "var(--laranja)"}`, paddingLeft: 10 }}>
            <strong>{a.titulo}</strong> <span className="mudo pequeno">{data(a.criado_em, true)}</span>
            <p style={{ margin: "2px 0" }}>{a.corpo}</p>
          </div>
        )) : <p className="mudo">Nenhum aviso.</p>}
      </section>

      <section className="cartao pilha">
        <div className="linha entre"><h2>Meus itens</h2><Link className="botao peq verde" href="/vender">+ Vender</Link></div>
        {dados.itens.length ? dados.itens.map((i) => (
          <div key={i.id} className="pilha" style={{ borderBottom: "1px solid var(--areia)", paddingBottom: 10 }}>
            <div className="linha entre">
              <strong>{i.titulo}</strong>
              <span className="mudo pequeno">{i.codigo ?? ""}</span>
            </div>
            <div className="linha entre">
              <span className="selo claro">{STATUS_ITEM[i.status] ?? i.status}</span>
              {(i.status === "vitrine" || i.status === "reservado") && <span>{brl(i.preco_atual)} <span className="mudo pequeno">mín. {brl(i.preco_minimo)}</span></span>}
            </div>
            {i.status === "recusado" && i.motivo_recusa && <p className="mudo pequeno">Motivo: {i.motivo_recusa}</p>}
            {i.status === "contraproposta" && i.preco_proposto_loja && (
              <div className="alerta pilha">
                <span>A loja propõe vender por <strong>{brl(i.preco_proposto_loja)}</strong>.</span>
                <div className="grade-2">
                  <form action={responderContraproposta.bind(null, i.id, true)}><button className="botao verde bloco peq">Aceitar</button></form>
                  <form action={responderContraproposta.bind(null, i.id, false)}><button className="botao contorno bloco peq">Recusar</button></form>
                </div>
              </div>
            )}
          </div>
        )) : <p className="mudo">Você ainda não colocou nada à venda.</p>}
      </section>

      <section className="cartao pilha">
        <h2>Repasses</h2>
        {dados.repasses.length ? (
          <div className="rolagem"><table className="tabela"><thead><tr><th>Item</th><th>Valor</th><th>Situação</th></tr></thead><tbody>
            {dados.repasses.map((r) => (
              <tr key={r.id}>
                <td>{r.titulo}</td>
                <td>{brl(r.valor)}<br /><span className="mudo pequeno">{r.modalidade === "pix" ? "Pix" : "Crédito"}</span></td>
                <td>{r.status === "pago" ? `Pago ${data(r.pago_em)}` : r.previsto_para ? `Previsto ${data(r.previsto_para)}` : "Aguardando prazo"}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="mudo">Sem repasses ainda.</p>}
        <p className="mudo pequeno">Pix só para a chave do CPF {cpfMascara(perfil.cpf)}. Troca de chave somente na loja.</p>
      </section>

      <section className="cartao pilha">
        <h2>Reservas</h2>
        {dados.reservas.length ? dados.reservas.map((r) => (
          <Link key={r.id} href={`/reserva/${r.id}`} className="linha entre" style={{ textDecoration: "none" }}>
            <span>{r.titulo}</span>
            <span className="selo claro">{{ aguardando_pagamento: "Aguardando Pix", paga: `Retirar: ${r.codigo_retirada}`, retirada: "Retirada", expirada: "Expirada", cancelada: "Cancelada" }[r.status]}</span>
          </Link>
        )) : <p className="mudo">Nenhuma reserva.</p>}
      </section>

      <section className="cartao pilha">
        <h2>Preferências de aviso</h2>
        <form action={salvarPreferencias} className="pilha">
          <label className="check"><input type="checkbox" name="whatsapp" defaultChecked={perfil.prefs_aviso?.whatsapp ?? true} /> Receber avisos também por WhatsApp</label>
          <p className="mudo pequeno">A caixa de avisos do app é o registro oficial e fica sempre ligada.</p>
          <button className="botao contorno peq">Salvar</button>
        </form>
      </section>

      <section className="cartao pilha">
        <h2>Termos aceitos</h2>
        {dados.aceites.map((a) => (
          <div key={a.id} className="linha entre pequeno">
            <span>{a.tipo} v{a.versao} — {data(a.aceito_em, true)}</span>
            <a href={`/api/aceites/${a.id}/pdf`}>PDF</a>
          </div>
        ))}
      </section>
    </div>
  );
}
