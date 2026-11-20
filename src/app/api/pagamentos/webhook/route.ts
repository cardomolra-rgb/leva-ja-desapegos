import { gateway } from "@/lib/pagamentos";
import { sincronizarPagamento } from "@/lib/confirmacao";

export const dynamic = "force-dynamic";

/** Webhook de confirmação do gateway (Pix). Responde 200 rápido; o status vem da reconsulta. */
export async function POST(req: Request) {
  const corpo = await req.text();
  const notif = await gateway().lerWebhook(req, corpo);
  if (!notif) return new Response("ignorado", { status: 200 });
  try {
    const r = await sincronizarPagamento(notif.gatewayId);
    return Response.json(r);
  } catch (e) {
    console.error("webhook pagamento", e);
    return new Response("erro", { status: 500 }); // o gateway tenta de novo
  }
}
