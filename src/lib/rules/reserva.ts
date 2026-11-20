import type { Config } from "./config";
import { pctDe } from "./dinheiro";
import { somarHoras } from "./tempo";

/** Sinal da reserva: 10% (ou 15% acima do limite) do preço do dia. */
export function calcularSinal(cfg: Config, precoHoje: number): { pct: number; valor: number } {
  const pct = precoHoje > cfg.reserva.limite_alto_centavos ? cfg.reserva.sinal_pct_alto : cfg.reserva.sinal_pct;
  return { pct, valor: pctDe(precoHoje, pct) };
}

export function prazoRetirada(cfg: Config, pagoEm: Date): Date {
  return somarHoras(pagoEm, cfg.reserva.prazo_retirada_horas);
}

export interface ReservaParaRetirada {
  precoTravado: number;
  sinal: number;
  pagaEm: Date;
}

export type SituacaoRetirada =
  | { podeRetirar: true; restante: number }
  | { podeRetirar: false; motivo: "expirada"; sinalRetido: number };

/** Na retirada o sinal é descontado; depois do prazo o sinal fica retido e o item volta à vitrine. */
export function situacaoRetirada(cfg: Config, r: ReservaParaRetirada, agora: Date): SituacaoRetirada {
  if (agora.getTime() > prazoRetirada(cfg, r.pagaEm).getTime()) {
    return { podeRetirar: false, motivo: "expirada", sinalRetido: r.sinal };
  }
  return { podeRetirar: true, restante: Math.max(0, r.precoTravado - r.sinal) };
}

/** Código de retirada de 6 caracteres sem letras/dígitos ambíguos. */
export function gerarCodigoRetirada(aleatorio: () => number = Math.random): string {
  const alfabeto = "ACDEFGHJKMNPQRTUVWXY34679";
  let s = "";
  for (let i = 0; i < 6; i++) s += alfabeto[Math.floor(aleatorio() * alfabeto.length)];
  return s;
}
