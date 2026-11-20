import { cronAutorizado } from "@/lib/cron";
import { comoServico } from "@/lib/db";
import { lerConfig } from "@/lib/config-loja";
import { aplicarQuedas, expirarReservas } from "@/lib/operacoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Diário às 03:05 (horário de Araguaína): queda de preço, prazo vencido no mínimo e doação. */
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return new Response("não autorizado", { status: 401 });
  const agora = new Date();
  const r = await comoServico(async (db) => {
    const cfg = await lerConfig(db);
    const reservas = await expirarReservas(db, agora);
    const quedas = await aplicarQuedas(db, cfg, agora);
    return { ...quedas, ...reservas };
  });
  return Response.json({ ok: true, em: agora.toISOString(), ...r });
}
