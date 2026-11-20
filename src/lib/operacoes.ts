/**
 * Operações de domínio que mexem em várias tabelas de uma vez.
 * Todas recebem uma transação aberta (`db`) e a configuração vigente.
 * Sem "server-only" de propósito: são testadas contra um Postgres real (PGlite) em tests/.
 */
import type { Db } from "@/lib/db";
import {
  type Config,
  type MetodoPagamento,
  type Modalidade,
  brl,
  calcularSinal,
  dataLocal,
  dividirVenda,
  fimPrazoTroca,
  gerarCodigoRetirada,
  prazoRetirada,
  prazosFinais,
  previsaoPagamento,
  situacaoPreco,
  somarHoras,
} from "@/lib/rules";

type Linha = Record<string, unknown>;
const q = async <T = Linha>(db: Db, sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
const ev = (db: Db, tipo: string, perfilId: string | null, itemId: string | null, dados: object = {}) =>
  db.query("insert into eventos (tipo, perfil_id, item_id, dados) values ($1,$2,$3,$4)", [tipo, perfilId, itemId, JSON.stringify(dados)]);
const aviso = (db: Db, perfilId: string, tipo: string, titulo: string, corpo: string, itemId: string | null, link?: string) =>
  db.query("insert into avisos (perfil_id, tipo, titulo, corpo, item_id, link) values ($1,$2,$3,$4,$5,$6)", [
    perfilId, tipo, titulo, corpo, itemId, link ?? null,
  ]);
const dataBR = (d: Date) => dataLocal(d).split("-").reverse().join("/");

/** Preço que vale agora: o menor entre o gravado e o calculado (caso o cron do dia ainda não tenha rodado). */
export function precoVigente(
  cfg: Config,
  it: { preco_atual: number; preco_inicial: number; preco_minimo: number; entrada_vitrine_em: Date | null },
  agora: Date,
) {
  if (!it.entrada_vitrine_em) return it.preco_atual;
  const s = situacaoPreco(cfg, { precoInicial: it.preco_inicial, precoMinimo: it.preco_minimo, entradaVitrine: new Date(it.entrada_vitrine_em) }, agora);
  return Math.min(it.preco_atual, s.precoHoje);
}

export class ErroRegra extends Error {}

// ---------------------------------------------------------------------------
// Entrada na vitrine (aprovação presencial)
// ---------------------------------------------------------------------------
export async function colocarNaVitrine(
  db: Db,
  cfg: Config,
  p: { itemId: string; avaliadorId: string; precoInicial: number; precoMinimo: number },
  agora: Date,
) {
  const [item] = await q<{ id: string; dono_id: string; titulo: string; prefixo: string; codigo: string | null; status: string }>(
    db,
    `select i.id, i.dono_id, i.titulo, i.codigo, i.status, c.prefixo from itens i join categorias c on c.id = i.categoria_id
     where i.id = $1 for update of i`,
    [p.itemId],
  );
  if (!item) throw new ErroRegra("Item não encontrado");
  if (!["aguardando_entrega", "pre_avaliacao"].includes(item.status)) throw new ErroRegra("Item não está aguardando entrada");
  const { vence, doacao } = prazosFinais(cfg, { precoInicial: p.precoInicial, precoMinimo: p.precoMinimo, entradaVitrine: agora });
  const codigo = item.codigo ?? (await q<{ c: string }>(db, "select app.proximo_codigo($1) c", [item.prefixo]))[0].c;
  await db.query(
    `update itens set codigo = $2, status = 'vitrine', preco_inicial = $3, preco_minimo = $4, preco_atual = $3,
       etapa_queda = 0, entrada_vitrine_em = $5, vence_em = $6, doacao_em = $7, no_minimo_em = null where id = $1`,
    [p.itemId, codigo, p.precoInicial, p.precoMinimo, agora, vence, doacao],
  );
  await db.query("insert into historico_precos (item_id, etapa, preco, motivo, criado_em) values ($1, 0, $2, 'entrada', $3)", [
    p.itemId, p.precoInicial, agora,
  ]);
  await ev(db, "entrada", p.avaliadorId, p.itemId, { codigo, preco_inicial: p.precoInicial, preco_minimo: p.precoMinimo });
  await ev(db, "vitrine", p.avaliadorId, p.itemId);
  await aviso(db, item.dono_id, "aprovacao", "Seu item está na vitrine!",
    `${item.titulo} (${codigo}) entrou na vitrine por ${brl(p.precoInicial)}. O preço só baixa até o mínimo de ${brl(p.precoMinimo)}.`,
    p.itemId, "/conta");
  return { codigo };
}

// ---------------------------------------------------------------------------
// Queda automática de preço + prazo vencido + doação (cron diário)
// ---------------------------------------------------------------------------
export async function aplicarQuedas(db: Db, cfg: Config, agora: Date) {
  const itens = await q<{
    id: string; dono_id: string; titulo: string; codigo: string; status: string;
    preco_inicial: number; preco_minimo: number; preco_atual: number; etapa_queda: number;
    entrada_vitrine_em: Date; no_minimo_em: Date | null;
  }>(
    db,
    `select id, dono_id, titulo, codigo, status, preco_inicial, preco_minimo, preco_atual, etapa_queda, entrada_vitrine_em, no_minimo_em
     from itens where status in ('vitrine', 'reservado', 'vencido') and entrada_vitrine_em is not null
     for update skip locked`,
  );
  const r = { quedas: 0, vencidos: 0, doados: 0 };

  for (const it of itens) {
    const base = { precoInicial: it.preco_inicial, precoMinimo: it.preco_minimo, entradaVitrine: new Date(it.entrada_vitrine_em) };
    const s = situacaoPreco(cfg, base, agora);

    if (s.etapa > it.etapa_queda) {
      const caiu = s.precoHoje < it.preco_atual;
      await db.query(
        `update itens set etapa_queda = $2, preco_atual = least(preco_atual, $3),
           no_minimo_em = case when $4 and no_minimo_em is null then $5 else no_minimo_em end where id = $1`,
        [it.id, s.etapa, s.precoHoje, s.noMinimo, agora],
      );
      if (caiu) {
        await db.query("insert into historico_precos (item_id, etapa, preco, motivo, criado_em) values ($1,$2,$3,'queda',$4)", [
          it.id, s.etapa, s.precoHoje, agora,
        ]);
        await ev(db, "queda", null, it.id, { de: it.preco_atual, para: s.precoHoje, etapa: s.etapa });
        r.quedas++;
      }
    }

    const { vence, doacao } = prazosFinais(cfg, base);
    if (it.status === "vitrine" && agora >= vence) {
      await db.query("update itens set status = 'vencido' where id = $1", [it.id]);
      await ev(db, "vencimento", null, it.id);
      await ev(db, "aviso_dono", null, it.id, { motivo: "prazo_vencido" });
      await aviso(db, it.dono_id, "fim_prazo", "Prazo do seu item terminou",
        `${it.titulo} (${it.codigo}) ficou no preço mínimo sem vender. Você pode retirar na loja até ${dataBR(doacao)}; depois disso ele será doado.`,
        it.id, "/conta");
      r.vencidos++;
    } else if (it.status === "vencido" && agora >= doacao) {
      await db.query("update itens set status = 'doado' where id = $1", [it.id]);
      await ev(db, "doacao", null, it.id);
      await aviso(db, it.dono_id, "doacao", "Item encaminhado para doação",
        `${it.titulo} (${it.codigo}) não foi retirado no prazo e foi encaminhado para doação, conforme o contrato.`, it.id);
      r.doados++;
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Reserva
// ---------------------------------------------------------------------------
export async function prepararReserva(
  db: Db,
  cfg: Config,
  p: { itemId: string; clienteId: string; aceiteId: string | null },
  agora: Date,
) {
  const [item] = await q<{ id: string; dono_id: string; status: string; preco_atual: number; preco_inicial: number; preco_minimo: number; entrada_vitrine_em: Date | null; tem_defeito: boolean; titulo: string; codigo: string }>(
    db, "select id, dono_id, status, preco_atual, preco_inicial, preco_minimo, entrada_vitrine_em, tem_defeito, titulo, codigo from itens where id = $1 for update", [p.itemId],
  );
  if (!item || item.status !== "vitrine") throw new ErroRegra("Este item não está mais disponível.");
  if (item.dono_id === p.clienteId) throw new ErroRegra("Você não pode reservar o próprio item.");
  if (item.tem_defeito && !p.aceiteId) throw new ErroRegra("É preciso aceitar o item no estado descrito.");

  item.preco_atual = precoVigente(cfg, item, agora);
  const sinal = calcularSinal(cfg, item.preco_atual);
  const expira = somarHoras(agora, cfg.pix_expira_minutos / 60);
  const [pag] = await q<{ id: string }>(
    db,
    `insert into pagamentos (finalidade, metodo, valor, pagador_id, expira_em) values ('sinal', 'pix', $1, $2, $3) returning id`,
    [sinal.valor, p.clienteId, expira],
  );
  const [res] = await q<{ id: string }>(
    db,
    `insert into reservas (item_id, cliente_id, preco_travado, sinal, sinal_pct, codigo_retirada, pagamento_id, aceite_id, expira_pagamento_em)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [item.id, p.clienteId, item.preco_atual, sinal.valor, sinal.pct, gerarCodigoRetirada(), pag.id, p.aceiteId, expira],
  );
  await db.query("update itens set status = 'reservado' where id = $1", [item.id]);
  await ev(db, "reserva", p.clienteId, item.id, { reserva_id: res.id, sinal: sinal.valor, preco: item.preco_atual });
  return { reservaId: res.id, pagamentoId: pag.id, sinal: sinal.valor, expira, item };
}

/** Webhook confirmou o Pix do sinal (idempotente). */
export async function confirmarPagamento(db: Db, cfg: Config, pagamentoId: string, aprovadoEm: Date, agora: Date) {
  const [pag] = await q<{ id: string; status: string; finalidade: string }>(
    db, "select id, status, finalidade from pagamentos where id = $1 for update", [pagamentoId],
  );
  if (!pag) throw new ErroRegra("Pagamento não encontrado");
  if (pag.status === "aprovado") return { jaConfirmado: true };
  await db.query("update pagamentos set status = 'aprovado', aprovado_em = $2 where id = $1", [pagamentoId, aprovadoEm]);

  if (pag.finalidade === "sinal") {
    const [res] = await q<{ id: string; item_id: string; cliente_id: string; status: string; codigo_retirada: string }>(
      db, "select id, item_id, cliente_id, status, codigo_retirada from reservas where pagamento_id = $1 for update", [pagamentoId],
    );
    if (!res) return { jaConfirmado: false };
    if (res.status !== "aguardando_pagamento") {
      // Pix chegou depois de a reserva expirar: registra para devolução manual
      await ev(db, "pagamento", res.cliente_id, res.item_id, { pagamento_id: pagamentoId, atrasado: true });
      return { jaConfirmado: false, atrasado: true };
    }
    const ate = prazoRetirada(cfg, agora);
    await db.query("update reservas set status = 'paga', paga_em = $2, retirar_ate = $3 where id = $1", [res.id, agora, ate]);
    await ev(db, "pagamento", res.cliente_id, res.item_id, { pagamento_id: pagamentoId, finalidade: "sinal" });
    await aviso(db, res.cliente_id, "reserva", "Reserva confirmada",
      `Pagamento do sinal recebido. Retire na loja até ${dataBR(ate)} com o código ${res.codigo_retirada}.`, res.item_id, `/conta/reservas`);
  }
  return { jaConfirmado: false };
}

/** Cron: Pix não pago no prazo → cancela; reserva paga e não retirada em 48h → sinal retido, item volta. */
export async function expirarReservas(db: Db, agora: Date) {
  const naoPagas = await q<{ id: string; item_id: string; cliente_id: string; pagamento_id: string }>(
    db,
    `update reservas set status = 'cancelada', encerrada_em = $1
     where status = 'aguardando_pagamento' and expira_pagamento_em < $1 returning id, item_id, cliente_id, pagamento_id`,
    [agora],
  );
  for (const r of naoPagas) {
    await db.query("update pagamentos set status = 'expirado' where id = $1 and status = 'pendente'", [r.pagamento_id]);
    await db.query("update itens set status = 'vitrine' where id = $1 and status = 'reservado'", [r.item_id]);
    await ev(db, "desistencia", r.cliente_id, r.item_id, { motivo: "pix_nao_pago", reserva_id: r.id });
  }
  const naoRetiradas = await q<{ id: string; item_id: string; cliente_id: string; sinal: number }>(
    db,
    `update reservas set status = 'expirada', encerrada_em = $1
     where status = 'paga' and retirar_ate < $1 returning id, item_id, cliente_id, sinal`,
    [agora],
  );
  for (const r of naoRetiradas) {
    await db.query("update itens set status = 'vitrine' where id = $1 and status = 'reservado'", [r.item_id]);
    await ev(db, "reserva_expirada", r.cliente_id, r.item_id, { reserva_id: r.id, sinal_retido: r.sinal });
    await aviso(db, r.cliente_id, "reserva", "Reserva expirada",
      `O prazo de retirada terminou. Conforme as regras, o sinal de ${brl(r.sinal)} ficou retido e o item voltou para a vitrine.`, r.item_id);
  }
  return { canceladas: naoPagas.length, expiradas: naoRetiradas.length };
}

// ---------------------------------------------------------------------------
// Caixa: venda no balcão ou retirada de reserva
// ---------------------------------------------------------------------------
export interface PagamentoCaixa {
  metodo: MetodoPagamento;
  valor: number;
  /** pagamento Pix já aprovado via gateway (caixa gera Pix dinâmico) */
  pagamentoId?: string;
}

export async function registrarVenda(
  db: Db,
  cfg: Config,
  p: { itemId: string; atendenteId: string; compradorId?: string | null; reservaId?: string | null; pagamentos: PagamentoCaixa[] },
  agora: Date,
) {
  const [item] = await q<{
    id: string; dono_id: string; titulo: string; codigo: string; status: string; preco_atual: number;
    preco_inicial: number; preco_minimo: number; entrada_vitrine_em: Date | null; etapa_queda: number; modalidade_repasse: Modalidade;
  }>(db, "select * from itens where id = $1 for update", [p.itemId]);
  if (!item) throw new ErroRegra("Item não encontrado");

  let valorTotal = precoVigente(cfg, item, agora);
  let sinal = 0;
  let compradorId = p.compradorId ?? null;
  let sinalPagamentoId: string | null = null;

  if (p.reservaId) {
    const [res] = await q<{ id: string; item_id: string; status: string; preco_travado: number; sinal: number; cliente_id: string; pagamento_id: string; retirar_ate: Date }>(
      db, "select * from reservas where id = $1 for update", [p.reservaId],
    );
    if (!res || res.item_id !== item.id) throw new ErroRegra("Reserva não corresponde ao item");
    if (res.status !== "paga") throw new ErroRegra("Reserva não está paga");
    if (agora > new Date(res.retirar_ate)) throw new ErroRegra("Prazo de retirada vencido — sinal retido");
    valorTotal = res.preco_travado;
    sinal = res.sinal;
    compradorId = res.cliente_id;
    sinalPagamentoId = res.pagamento_id;
  } else if (item.status !== "vitrine") {
    throw new ErroRegra(item.status === "reservado" ? "Item reservado: use a retirada com código" : "Item não está à venda");
  }

  const restante = valorTotal - sinal;
  const pago = p.pagamentos.reduce((s, x) => s + x.valor, 0);
  if (pago !== restante) throw new ErroRegra(`Valor recebido (${brl(pago)}) diferente do restante (${brl(restante)})`);

  // crédito na loja: precisa de comprador identificado e saldo
  const usoCredito = p.pagamentos.filter((x) => x.metodo === "credito_loja").reduce((s, x) => s + x.valor, 0);
  if (usoCredito > 0) {
    if (!compradorId) throw new ErroRegra("Para pagar com crédito, identifique o cliente");
    const [{ saldo }] = await q<{ saldo: number }>(db, "select coalesce(sum(valor),0)::bigint saldo from creditos where perfil_id = $1", [compradorId]);
    if (Number(saldo) < usoCredito) throw new ErroRegra("Saldo de crédito insuficiente");
  }

  const [venda] = await q<{ id: string }>(
    db,
    `insert into vendas (item_id, comprador_id, reserva_id, atendente_id, valor_total, sinal_abatido, etapa_queda, preco_inicial, troca_ate, criado_em)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [item.id, compradorId, p.reservaId ?? null, p.atendenteId, valorTotal, sinal, item.etapa_queda, item.preco_inicial, fimPrazoTroca(cfg, agora), agora],
  );

  const metodosVenda: { metodo: MetodoPagamento; valor: number; recebidoEm: Date | null }[] = [];
  if (sinalPagamentoId) {
    await db.query("insert into venda_pagamentos (venda_id, pagamento_id) values ($1,$2)", [venda.id, sinalPagamentoId]);
    metodosVenda.push({ metodo: "pix", valor: sinal, recebidoEm: agora });
  }
  for (const pg of p.pagamentos) {
    let id = pg.pagamentoId;
    if (id) {
      const [ok] = await q<{ status: string; valor: number }>(db, "select status, valor from pagamentos where id = $1", [id]);
      if (!ok || ok.status !== "aprovado" || ok.valor !== pg.valor) throw new ErroRegra("Pix do caixa ainda não confirmado");
    } else {
      // cartão: liquidação do crédito fica pendente (recebido_em preenchido na conciliação)
      const recebido = pg.metodo === "cartao_credito" ? null : agora;
      [{ id }] = await q<{ id: string }>(
        db,
        `insert into pagamentos (finalidade, metodo, valor, status, pagador_id, gateway, aprovado_em, recebido_em)
         values ('venda', $1, $2, 'aprovado', $3, 'balcao', $4, $5) returning id`,
        [pg.metodo, pg.valor, compradorId, agora, recebido],
      );
    }
    await db.query("insert into venda_pagamentos (venda_id, pagamento_id) values ($1,$2)", [venda.id, id]);
    metodosVenda.push({ metodo: pg.metodo, valor: pg.valor, recebidoEm: pg.metodo === "cartao_credito" ? null : agora });
    if (pg.metodo === "credito_loja") {
      await db.query("insert into creditos (perfil_id, valor, origem, ref_id, criado_por) values ($1, $2, 'compra', $3, $4)", [
        compradorId, -pg.valor, venda.id, p.atendenteId,
      ]);
    }
  }

  const div = dividirVenda(cfg, valorTotal, item.modalidade_repasse);
  const previsao = previsaoPagamento(cfg, { vendidaEm: agora, pagamentos: metodosVenda }, agora);
  await db.query(
    `insert into repasses (venda_id, dono_id, modalidade, valor_venda, pct_dono, valor, previsto_para) values ($1,$2,$3,$4,$5,$6,$7)`,
    [venda.id, item.dono_id, div.modalidade, valorTotal, div.pctDono, div.valorDono, previsao ? dataLocal(previsao) : null],
  );

  await db.query("update itens set status = 'vendido', vendido_em = $2 where id = $1", [item.id, agora]);
  if (p.reservaId) {
    await db.query("update reservas set status = 'retirada', encerrada_em = $2 where id = $1", [p.reservaId, agora]);
    await ev(db, "retirada", p.atendenteId, item.id, { reserva_id: p.reservaId });
  }
  await ev(db, "venda", p.atendenteId, item.id, {
    venda_id: venda.id, valor: valorTotal, etapa: item.etapa_queda, metodos: metodosVenda.map((m) => m.metodo),
    comissao_loja: div.valorLoja,
  });
  await aviso(db, item.dono_id, "venda", "Seu item foi vendido! 🎉",
    `${item.titulo} (${item.codigo}) foi vendido por ${brl(valorTotal)}. Você vai receber ${brl(div.valorDono)} ${div.modalidade === "pix" ? "por Pix" : "em crédito na loja"}${previsao ? `, previsto para ${dataBR(previsao)}` : ""}.`,
    item.id, "/conta");

  return { vendaId: venda.id, valorTotal, sinal, repasse: div.valorDono };
}
