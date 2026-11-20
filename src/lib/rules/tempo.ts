/** Datas no fuso da loja (America/Araguaina, UTC−3, sem horário de verão). */
export const FUSO = "America/Araguaina";

const DIA_MS = 86_400_000;

/** "AAAA-MM-DD" da data no fuso da loja. */
export function dataLocal(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function diaJuliano(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(a, m - 1, d) / DIA_MS);
}

/** Dias corridos entre duas datas, contando pelo calendário da loja (meia-noite local). */
export function diasEntre(inicio: Date, fim: Date): number {
  return diaJuliano(dataLocal(fim)) - diaJuliano(dataLocal(inicio));
}

/** Meia-noite local (início do dia) somando `dias` à data local de `d`. Retorna Date em UTC. */
export function inicioDoDiaLocal(d: Date, dias = 0): Date {
  const [a, m, dd] = dataLocal(d).split("-").map(Number);
  // UTC−3 fixo: 00:00 local = 03:00 UTC
  return new Date(Date.UTC(a, m - 1, dd + dias, 3, 0, 0));
}

/** Dia da semana local (0 = domingo). */
export function diaSemanaLocal(d: Date): number {
  const [a, m, dd] = dataLocal(d).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, dd)).getUTCDay();
}

export function somarHoras(d: Date, horas: number): Date {
  return new Date(d.getTime() + horas * 3_600_000);
}

export function somarDias(d: Date, dias: number): Date {
  return new Date(d.getTime() + dias * DIA_MS);
}
