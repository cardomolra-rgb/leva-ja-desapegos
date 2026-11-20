import type { Config } from "./config";
import { diaSemanaLocal, inicioDoDiaLocal, somarDias } from "./tempo";

export type MetodoPagamento = "pix" | "cartao_credito" | "cartao_debito" | "credito_loja" | "dinheiro";

export interface PagamentoVenda {
  metodo: MetodoPagamento;
  valor: number;
  /** data em que o dinheiro do cartão de crédito cai na conta (liquidação) */
  recebidoEm?: Date | null;
}

export interface VendaParaRepasse {
  vendidaEm: Date;
  pagamentos: PagamentoVenda[];
  estornada?: boolean;
  trocaEmAberto?: boolean;
}

export type Liberacao =
  | { liberado: true; liberadoEm: Date }
  | { liberado: false; motivo: "prazo_troca" | "aguardando_cartao" | "estornada" | "troca_em_aberto"; previsao?: Date };

/** Fim do prazo de troca (fim do 7º dia local após a venda). */
export function fimPrazoTroca(cfg: Config, vendidaEm: Date): Date {
  return inicioDoDiaLocal(vendidaEm, cfg.repasse.prazo_troca_dias + 1);
}

/**
 * O repasse é liberado depois do prazo de troca e, se houve cartão de crédito,
 * só depois que o valor do cartão foi recebido pela loja.
 */
export function liberacaoRepasse(cfg: Config, v: VendaParaRepasse, agora: Date): Liberacao {
  if (v.estornada) return { liberado: false, motivo: "estornada" };
  if (v.trocaEmAberto) return { liberado: false, motivo: "troca_em_aberto" };
  const fimTroca = fimPrazoTroca(cfg, v.vendidaEm);
  if (agora < fimTroca) return { liberado: false, motivo: "prazo_troca", previsao: fimTroca };

  let liberadoEm = fimTroca;
  if (cfg.repasse.exige_recebimento_cartao) {
    for (const p of v.pagamentos) {
      if (p.metodo !== "cartao_credito") continue;
      if (!p.recebidoEm || p.recebidoEm > agora) {
        return { liberado: false, motivo: "aguardando_cartao", previsao: p.recebidoEm ?? undefined };
      }
      if (p.recebidoEm > liberadoEm) liberadoEm = p.recebidoEm;
    }
  }
  return { liberado: true, liberadoEm };
}

/** Data do próximo lote (terça, por padrão) a partir de `apos` — se hoje é terça, é hoje. */
export function proximoLote(cfg: Config, apos: Date): Date {
  const hoje = diaSemanaLocal(apos);
  const faltam = (cfg.repasse.dia_semana_lote - hoje + 7) % 7;
  return inicioDoDiaLocal(apos, faltam);
}

/** Data prevista de pagamento do repasse (para mostrar ao dono). */
export function previsaoPagamento(cfg: Config, v: VendaParaRepasse, agora: Date): Date | null {
  if (v.estornada || v.trocaEmAberto) return null;
  let base = fimPrazoTroca(cfg, v.vendidaEm);
  if (cfg.repasse.exige_recebimento_cartao) {
    for (const p of v.pagamentos) {
      if (p.metodo !== "cartao_credito") continue;
      if (!p.recebidoEm) return null; // sem data de liquidação ainda
      if (p.recebidoEm > base) base = p.recebidoEm;
    }
  }
  return proximoLote(cfg, base > agora ? base : agora);
}

export { somarDias };
