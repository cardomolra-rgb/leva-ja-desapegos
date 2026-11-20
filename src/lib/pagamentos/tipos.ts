/**
 * Camada de pagamento isolada. O resto do sistema só conhece esta interface;
 * trocar de gateway (Mercado Pago → Asaas, etc.) = escrever outro adaptador.
 */

export interface PixCriado {
  gatewayId: string;
  copiaCola: string;
  qrBase64: string | null; // imagem PNG em base64 (sem prefixo data:)
  expiraEm: Date;
}

export type StatusGateway = "pendente" | "aprovado" | "recusado" | "expirado" | "estornado";

export interface ConsultaPagamento {
  gatewayId: string;
  status: StatusGateway;
  valor: number; // centavos
  referencia: string | null; // nosso pagamentos.id
  aprovadoEm: Date | null;
}

export interface NotificacaoWebhook {
  /** id do pagamento no gateway — SEMPRE reconsultar o status pelo `consultar` */
  gatewayId: string;
}

export interface GatewayPagamento {
  readonly nome: string;
  criarPix(p: {
    valor: number;
    descricao: string;
    referencia: string;
    expiraEm: Date;
    pagador: { nome: string; email: string | null; cpf: string | null };
  }): Promise<PixCriado>;
  consultar(gatewayId: string): Promise<ConsultaPagamento>;
  /** devolução total (valor omitido) ou parcial do Pix */
  devolverPix(gatewayId: string, valor?: number): Promise<{ devolucaoId: string }>;
  /** valida assinatura/origem; retorna null se inválido ou não for de pagamento */
  lerWebhook(req: Request, corpo: string): Promise<NotificacaoWebhook | null>;
  /** Fase 2: transferências em lote para os donos */
  transferirPix?(itens: { chavePix: string; valor: number; referencia: string }[]): Promise<{ referencia: string; ok: boolean; id?: string; erro?: string }[]>;
}
