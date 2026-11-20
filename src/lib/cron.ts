import "server-only";
import { timingSafeEqual } from "node:crypto";

/** A Vercel Cron envia "Authorization: Bearer <CRON_SECRET>". */
export function cronAutorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const recebido = Buffer.from(req.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
