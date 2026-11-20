import type { Config } from "./config";

export type Modalidade = "pix" | "credito";

export interface Divisao {
  valorVenda: number;
  modalidade: Modalidade;
  pctDono: number;
  valorDono: number;
  valorLoja: number;
}

/** % da loja para um valor de venda, considerando a comissão por faixa quando ligada. */
export function pctLoja(cfg: Config, valorVenda: number): number {
  const f = cfg.comissao.por_faixa;
  if (!f.ativo) return cfg.comissao.loja_pct;
  const faixa = f.faixas.find((x) => x.ate_centavos === null || valorVenda <= x.ate_centavos);
  return faixa ? faixa.loja_pct : cfg.comissao.loja_pct;
}

/** % do dono conforme a modalidade de repasse. */
export function pctDono(cfg: Config, valorVenda: number, modalidade: Modalidade): number {
  if (cfg.comissao.por_faixa.ativo) {
    const base = 1 - pctLoja(cfg, valorVenda);
    return modalidade === "credito" ? Math.min(1, base + cfg.comissao.por_faixa.bonus_credito_pct) : base;
  }
  return modalidade === "credito" ? cfg.comissao.dono_credito_pct : cfg.comissao.dono_pix_pct;
}

/**
 * Divide uma venda entre dono e loja. O dono recebe arredondado para baixo
 * (centavo), a diferença fica com a loja — a soma sempre fecha com o valor da venda.
 */
export function dividirVenda(cfg: Config, valorVenda: number, modalidade: Modalidade): Divisao {
  const pct = pctDono(cfg, valorVenda, modalidade);
  const valorDono = Math.floor(valorVenda * pct + 1e-9);
  return { valorVenda, modalidade, pctDono: pct, valorDono, valorLoja: valorVenda - valorDono };
}

/** Simulação mostrada no "Quero vender": quanto o dono recebe no preço pedido e no mínimo. */
export function simularRecebimento(cfg: Config, precoPedido: number, precoMinimo: number) {
  return {
    pix: {
      noPedido: dividirVenda(cfg, precoPedido, "pix").valorDono,
      noMinimo: dividirVenda(cfg, precoMinimo, "pix").valorDono,
    },
    credito: {
      noPedido: dividirVenda(cfg, precoPedido, "credito").valorDono,
      noMinimo: dividirVenda(cfg, precoMinimo, "credito").valorDono,
    },
  };
}
