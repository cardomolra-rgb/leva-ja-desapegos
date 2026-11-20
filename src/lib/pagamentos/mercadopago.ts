import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConsultaPagamento, GatewayPagamento, StatusGateway } from "./tipos";

const API = "https://api.mercadopago.com";

function token() {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!t) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado");
  return t;
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown, idempotencia?: string): Promise<T> {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(idempotencia ? { "X-Idempotency-Key": idempotencia } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Mercado Pago ${metodo} ${caminho}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

const mapa: Record<string, StatusGateway> = {
  pending: "pendente",
  in_process: "pendente",
  authorized: "pendente",
  approved: "aprovado",
  rejected: "recusado",
  cancelled: "expirado",
  refunded: "estornado",
  charged_back: "estornado",
};

interface MpPagamento {
  id: number;
  status: string;
  transaction_amount: number;
  external_reference: string | null;
  date_approved: string | null;
  date_of_expiration?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
}

export const mercadoPago: GatewayPagamento = {
  nome: "mercadopago",

  async criarPix({ valor, descricao, referencia, expiraEm, pagador }) {
    const [primeiro, ...resto] = pagador.nome.split(" ");
    const p = await chamar<MpPagamento>(
      "POST",
      "/v1/payments",
      {
        transaction_amount: valor / 100,
        description: descricao,
        payment_method_id: "pix",
        external_reference: referencia,
        date_of_expiration: expiraEm.toISOString().replace("Z", "-00:00"),
        notification_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/pagamentos/webhook`,
        payer: {
          email: pagador.email ?? "cliente@levaja.com.br",
          first_name: primeiro,
          last_name: resto.join(" ") || undefined,
          identification: pagador.cpf ? { type: "CPF", number: pagador.cpf } : undefined,
        },
      },
      referencia, // idempotência: o mesmo pagamento nunca é criado duas vezes
    );
    const td = p.point_of_interaction?.transaction_data;
    if (!td?.qr_code) throw new Error("Mercado Pago não retornou o código Pix");
    return {
      gatewayId: String(p.id),
      copiaCola: td.qr_code,
      qrBase64: td.qr_code_base64 ?? null,
      expiraEm: p.date_of_expiration ? new Date(p.date_of_expiration) : expiraEm,
    };
  },

  async consultar(gatewayId): Promise<ConsultaPagamento> {
    const p = await chamar<MpPagamento>("GET", `/v1/payments/${encodeURIComponent(gatewayId)}`);
    return {
      gatewayId: String(p.id),
      status: mapa[p.status] ?? "pendente",
      valor: Math.round(p.transaction_amount * 100),
      referencia: p.external_reference,
      aprovadoEm: p.date_approved ? new Date(p.date_approved) : null,
    };
  },

  async devolverPix(gatewayId, valor) {
    const r = await chamar<{ id: number }>(
      "POST",
      `/v1/payments/${encodeURIComponent(gatewayId)}/refunds`,
      valor ? { amount: valor / 100 } : {},
      `refund-${gatewayId}-${valor ?? "total"}`,
    );
    return { devolucaoId: String(r.id) };
  },

  /**
   * Webhook do Mercado Pago: valida o cabeçalho x-signature (HMAC-SHA256 do manifesto
   * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;") com o segredo do painel.
   */
  async lerWebhook(req, corpo) {
    const url = new URL(req.url);
    let dados: { type?: string; data?: { id?: string | number } } = {};
    try {
      dados = JSON.parse(corpo || "{}");
    } catch {
      /* corpo vazio */
    }
    const tipo = dados.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
    const id = String(dados.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
    if (tipo !== "payment" || !id) return null;

    const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!segredo) throw new Error("MERCADOPAGO_WEBHOOK_SECRET não configurado");
    const assinatura = req.headers.get("x-signature") ?? "";
    const requestId = req.headers.get("x-request-id") ?? "";
    const partes = Object.fromEntries(assinatura.split(",").map((p) => p.trim().split("=") as [string, string]));
    if (!partes.ts || !partes.v1) return null;
    const idManifesto = /^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id;
    const manifesto = `id:${idManifesto};request-id:${requestId};ts:${partes.ts};`;
    const esperado = createHmac("sha256", segredo).update(manifesto).digest("hex");
    const a = Buffer.from(esperado);
    const b = Buffer.from(partes.v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { gatewayId: id };
  },
};
