import type { Config } from "./config";
import { arredondar } from "./dinheiro";
import { diasEntre, inicioDoDiaLocal } from "./tempo";

export interface ItemPreco {
  precoInicial: number;
  precoMinimo: number;
  /** quando o item entrou na vitrine (começa a contar a queda) */
  entradaVitrine: Date;
}

/** Preço depois de `etapa` quedas (etapa 0 = preço inicial). */
export function precoNaEtapa(cfg: Config, item: Omit<ItemPreco, "entradaVitrine">, etapa: number): number {
  if (etapa <= 0) return item.precoInicial;
  const bruto = item.precoInicial - etapa * item.precoInicial * cfg.queda.pct_do_inicial;
  const arred = arredondar(bruto, cfg.queda.arredondamento_centavos, cfg.queda.arredondamento);
  // nunca abaixo do mínimo e nunca acima do inicial (o preço só baixa)
  return Math.min(item.precoInicial, Math.max(item.precoMinimo, arred));
}

/** Número de quedas já ocorridas na data `agora`. */
export function etapaAtual(cfg: Config, item: ItemPreco, agora: Date): number {
  const dias = diasEntre(item.entradaVitrine, agora);
  if (dias < 0) return 0;
  return Math.floor(dias / cfg.queda.intervalo_dias);
}

/** Última etapa útil: a partir dela o preço já está no mínimo. */
export function etapaDoMinimo(cfg: Config, item: Omit<ItemPreco, "entradaVitrine">): number {
  if (item.precoMinimo >= item.precoInicial) return 0;
  let e = 0;
  while (precoNaEtapa(cfg, item, e) > item.precoMinimo) {
    e++;
    if (e > 1000) break; // proteção contra configuração absurda
  }
  return e;
}

export interface SituacaoPreco {
  etapa: number;
  precoHoje: number;
  noMinimo: boolean;
  /** quando chega ao mínimo (data de início do dia local) */
  dataMinimo: Date;
  proximaQueda: { data: Date; preco: number } | null;
  /** linha do tempo completa: cada etapa com a data em que começa */
  linhaDoTempo: { etapa: number; data: Date; preco: number }[];
}

export function situacaoPreco(cfg: Config, item: ItemPreco, agora: Date): SituacaoPreco {
  const etapa = etapaAtual(cfg, item, agora);
  const ultima = etapaDoMinimo(cfg, item);
  const dataDaEtapa = (e: number) => inicioDoDiaLocal(item.entradaVitrine, e * cfg.queda.intervalo_dias);
  const precoHoje = precoNaEtapa(cfg, item, etapa);
  const noMinimo = precoHoje <= item.precoMinimo;

  const linhaDoTempo = [];
  for (let e = 0; e <= ultima; e++) {
    const preco = precoNaEtapa(cfg, item, e);
    if (e > 0 && preco === precoNaEtapa(cfg, item, e - 1)) continue;
    linhaDoTempo.push({ etapa: e, data: e === 0 ? item.entradaVitrine : dataDaEtapa(e), preco });
  }

  let proximaQueda: SituacaoPreco["proximaQueda"] = null;
  if (!noMinimo) {
    for (let e = etapa + 1; e <= ultima; e++) {
      const p = precoNaEtapa(cfg, item, e);
      if (p < precoHoje) {
        proximaQueda = { data: dataDaEtapa(e), preco: p };
        break;
      }
    }
  }

  return { etapa, precoHoje, noMinimo, dataMinimo: dataDaEtapa(ultima), proximaQueda, linhaDoTempo };
}

/**
 * Prazo final: depois de `dias_no_minimo` dias parado no mínimo o prazo vence
 * (aviso ao dono) e, após `dias_aviso`, o item vai para doação.
 */
export function prazosFinais(cfg: Config, item: ItemPreco) {
  const ultima = etapaDoMinimo(cfg, item);
  const diasAteMinimo = ultima * cfg.queda.intervalo_dias;
  const vence = inicioDoDiaLocal(item.entradaVitrine, diasAteMinimo + cfg.prazo_final.dias_no_minimo);
  const doacao = inicioDoDiaLocal(
    item.entradaVitrine,
    diasAteMinimo + cfg.prazo_final.dias_no_minimo + cfg.prazo_final.dias_aviso,
  );
  return { vence, doacao };
}
