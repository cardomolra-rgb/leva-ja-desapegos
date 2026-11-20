/**
 * Ambiente de testes: liga o Pix simulado e mostra o código de verificação na tela.
 * Só vale com MODO_TESTE=1 explícito (ou fora da produção da Vercel). Nunca ligue na loja real.
 */
export const modoTeste = () => process.env.MODO_TESTE === "1" || process.env.VERCEL_ENV !== "production";

/** Pix simulado disponível (gateway mock + ambiente de testes). */
export const pixSimulado = () => modoTeste() && (process.env.PAYMENT_GATEWAY ?? "mock") === "mock";
