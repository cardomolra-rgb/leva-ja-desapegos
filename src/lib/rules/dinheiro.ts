import type { Arredondamento } from "./config";

/** Arredonda centavos para um múltiplo de `passo` (ex.: 500 = R$ 5). */
export function arredondar(centavos: number, passo: number, modo: Arredondamento = "baixo"): number {
  if (passo <= 1) return Math.round(centavos);
  const q = centavos / passo;
  const n = modo === "baixo" ? Math.floor(q + 1e-9) : modo === "cima" ? Math.ceil(q - 1e-9) : Math.round(q);
  return n * passo;
}

/** Multiplica centavos por uma fração e arredonda para o centavo (meio para cima). */
export function pctDe(centavos: number, pct: number): number {
  return Math.round(centavos * pct + 1e-9);
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function brl(centavos: number): string {
  return fmt.format(centavos / 100).replace(/ /g, " ");
}

/** "120,50" | "120.50" | "120" → 12050 centavos. Retorna NaN se inválido. */
export function paraCentavos(valor: string | number): number {
  if (typeof valor === "number") return Math.round(valor * 100);
  const limpo = valor.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return NaN;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
