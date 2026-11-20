import type { Config } from "./config";
import type { MetodoPagamento } from "./repasse";
import { fimPrazoTroca } from "./repasse";

export type MotivoDevolucao =
  | "defeito_nao_informado"
  | "divergencia_descricao"
  | "defeito_declarado"
  | "arrependimento";

export interface VendaParaEstorno {
  vendidaEm: Date;
  pagamentos: { metodo: MetodoPagamento; valor: number; id: string }[];
  repassePago: boolean;
  /** número de série registrado na entrada (quando houver) */
  numeroSerieEntrada?: string | null;
}

export interface PedidoDevolucao {
  motivo: MotivoDevolucao;
  numeroSerieDevolvido?: string | null;
}

export type ResultadoEstorno =
  | {
      permitido: true;
      total: number;
      /** cada pagamento é devolvido pelo mesmo meio */
      devolucoes: { pagamentoId: string; metodo: MetodoPagamento; valor: number; via: "pix" | "cartao" | "credito_loja" | "dinheiro" }[];
      itemVoltaParaVitrine: boolean;
      alertaSerie: boolean;
    }
  | { permitido: false; motivo: string; alertaSerie: boolean };

type Via = "pix" | "cartao" | "credito_loja" | "dinheiro";
const via = (m: MetodoPagamento): Via =>
  m === "pix" ? "pix" : m === "credito_loja" ? "credito_loja" : m === "dinheiro" ? "dinheiro" : "cartao";

/**
 * Regras de troca/estorno:
 * - só dentro do prazo de troca (7 dias) e antes do repasse ao dono;
 * - defeito declarado e aceito pelo comprador não dá direito a devolução;
 * - número de série diferente do registrado na entrada bloqueia e gera alerta;
 * - cada pagamento volta pelo mesmo meio (Pix→Pix, cartão→estorno, crédito→crédito).
 */
export function avaliarEstorno(cfg: Config, v: VendaParaEstorno, pedido: PedidoDevolucao, agora: Date): ResultadoEstorno {
  const alertaSerie =
    !!v.numeroSerieEntrada &&
    (pedido.numeroSerieDevolvido ?? "").trim().toUpperCase() !== v.numeroSerieEntrada.trim().toUpperCase();

  if (alertaSerie) return { permitido: false, motivo: "Número de série diferente do registrado na entrada.", alertaSerie };
  if (agora >= fimPrazoTroca(cfg, v.vendidaEm))
    return { permitido: false, motivo: "Prazo de troca encerrado.", alertaSerie };
  if (v.repassePago) return { permitido: false, motivo: "Repasse ao dono já foi pago.", alertaSerie };
  if (pedido.motivo === "defeito_declarado")
    return { permitido: false, motivo: "O defeito estava descrito e foi aceito na compra.", alertaSerie };

  const devolucoes = v.pagamentos.map((p) => ({ pagamentoId: p.id, metodo: p.metodo, valor: p.valor, via: via(p.metodo) }));
  return {
    permitido: true,
    total: devolucoes.reduce((s, d) => s + d.valor, 0),
    devolucoes,
    itemVoltaParaVitrine: pedido.motivo === "arrependimento",
    alertaSerie,
  };
}
