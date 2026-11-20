import { cronAutorizado } from "@/lib/cron";
import { comoServico } from "@/lib/db";
import { expirarReservas } from "@/lib/operacoes";

export const dynamic = "force-dynamic";

/** A cada 15 min (plano Pro da Vercel): Pix de sinal não pago e reservas não retiradas em 48h. */
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return new Response("não autorizado", { status: 401 });
  const r = await comoServico((db) => expirarReservas(db, new Date()));
  return Response.json({ ok: true, ...r });
}
