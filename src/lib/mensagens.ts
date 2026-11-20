import "server-only";

/**
 * Envio de mensagens de mão única (código de verificação e avisos).
 * Fase 1: código por WhatsApp (modelo de autenticação) ou registro no log em desenvolvimento.
 * Fase 2: modelos de aviso (aprovação, venda, repasse, reserva, fim de prazo, desejo encontrado).
 */
export async function enviarCodigo(telefone: string, codigo: string): Promise<void> {
  const provedor = process.env.MESSAGING_PROVIDER ?? "console";
  if (provedor === "console") {
    console.info(`[código de verificação] ${telefone}: ${codigo}`);
    return;
  }
  if (provedor === "whatsapp") {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `55${telefone.replace(/^55/, "")}`,
        type: "template",
        template: {
          name: "codigo_verificacao",
          language: { code: "pt_BR" },
          components: [
            { type: "body", parameters: [{ type: "text", text: codigo }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: codigo }] },
          ],
        },
      }),
    });
    if (!r.ok) throw new Error(`WhatsApp: ${r.status} ${await r.text()}`);
    return;
  }
  throw new Error(`Provedor de mensagens desconhecido: ${provedor}`);
}
