import { createHmac, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type { GatewayPagamento, StatusGateway } from "./tipos";

/**
 * Gateway de desenvolvimento: gera um Pix de mentira e guarda o status em memória.
 * O botão "Simular pagamento" (só fora de produção) chama o webhook assinado.
 * Em produção, o sistema recusa usar este gateway.
 */
const memoria = new Map<string, { status: StatusGateway; valor: number; referencia: string; aprovadoEm: Date | null }>();
const segredo = () => process.env.CRON_SECRET ?? "mock";

export function assinaturaMock(gatewayId: string) {
  return createHmac("sha256", segredo()).update(gatewayId).digest("hex");
}

export function aprovarMock(gatewayId: string, valor: number, referencia: string) {
  memoria.set(gatewayId, { status: "aprovado", valor, referencia, aprovadoEm: new Date() });
}

export const gatewayMock: GatewayPagamento = {
  nome: "mock",
  async criarPix({ valor, referencia, expiraEm }) {
    const gatewayId = `mock_${randomUUID()}`;
    memoria.set(gatewayId, { status: "pendente", valor, referencia, aprovadoEm: null });
    const copiaCola = `00020126580014BR.GOV.BCB.PIX0136${gatewayId.slice(5, 41)}5204000053039865406${(valor / 100).toFixed(2)}5802BR5913LEVA JA TESTE6006PALMAS62070503***6304ABCD`;
    const png = await QRCode.toDataURL(copiaCola, { margin: 1, width: 320 });
    return { gatewayId, copiaCola, qrBase64: png.split(",")[1], expiraEm };
  },
  async consultar(gatewayId) {
    const m = memoria.get(gatewayId);
    // sem memória (outra instância serverless): confia no webhook assinado que já chegou
    return {
      gatewayId,
      status: m?.status ?? "aprovado",
      valor: m?.valor ?? 0,
      referencia: m?.referencia ?? null,
      aprovadoEm: m?.aprovadoEm ?? new Date(),
    };
  },
  async devolverPix(gatewayId) {
    const m = memoria.get(gatewayId);
    if (m) m.status = "estornado";
    return { devolucaoId: `mock_dev_${randomUUID()}` };
  },
  async lerWebhook(req, corpo) {
    const { gatewayId } = JSON.parse(corpo || "{}") as { gatewayId?: string };
    if (!gatewayId) return null;
    if (req.headers.get("x-mock-signature") !== assinaturaMock(gatewayId)) return null;
    return { gatewayId };
  },
};
