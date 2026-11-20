import { FUSO } from "@/lib/rules/tempo";

export { brl } from "@/lib/rules/dinheiro";

export function data(d: Date | string | null | undefined, comHora = false): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    ...(comHora ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(d));
}

export function dataExtenso(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "short" }).format(new Date(d));
}

export function cpfMascara(cpf: string | null) {
  if (!cpf) return "—";
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

export const DEFEITOS_ATALHOS: Record<string, string> = {
  risco: "Risco",
  mancha: "Mancha",
  falta_peca: "Falta peça",
  desgaste: "Desgaste",
  trinca: "Trinca",
  furo: "Furo",
};

export const STATUS_ITEM: Record<string, string> = {
  pre_avaliacao: "Em pré-avaliação",
  contraproposta: "Loja propôs outro preço",
  aguardando_entrega: "Aprovado — leve à loja",
  recusado: "Recusado",
  vitrine: "Na vitrine",
  reservado: "Reservado",
  vendido: "Vendido",
  vencido: "Prazo vencido — retire na loja",
  doado: "Doado",
  devolvido_dono: "Devolvido",
  cancelado: "Cancelado",
};
