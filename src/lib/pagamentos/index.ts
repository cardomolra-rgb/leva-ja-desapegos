import "server-only";
import { modoTeste } from "@/lib/ambiente";
import type { GatewayPagamento } from "./tipos";
import { mercadoPago } from "./mercadopago";
import { gatewayMock } from "./mock";

export type { GatewayPagamento } from "./tipos";

/** Escolhe o gateway pela variável PAYMENT_GATEWAY. Para trocar de gateway, registre o adaptador aqui. */
export function gateway(): GatewayPagamento {
  const nome = process.env.PAYMENT_GATEWAY ?? "mock";
  if (nome === "mercadopago") return mercadoPago;
  if (nome === "mock") {
    if (!modoTeste()) throw new Error("Gateway mock só pode ser usado com MODO_TESTE=1");
    return gatewayMock;
  }
  throw new Error(`Gateway desconhecido: ${nome}`);
}
