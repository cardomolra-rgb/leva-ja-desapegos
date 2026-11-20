import "server-only";

/**
 * Envio do código de verificação do celular (mão única).
 *
 * SMS — SMS_PROVIDER:
 *   - "twilio": TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (número Twilio, ex.: +15551234567)
 *   - "zenvia": ZENVIA_API_TOKEN, ZENVIA_FROM (remetente cadastrado na Zenvia)
 *   - "infobip": INFOBIP_API_KEY, INFOBIP_BASE_URL (ex.: https://xxxxx.api.infobip.com), INFOBIP_FROM
 * WhatsApp — WHATSAPP_PROVIDER:
 *   - "infobip": INFOBIP_API_KEY, INFOBIP_BASE_URL, INFOBIP_WHATSAPP_FROM (número remetente),
 *     INFOBIP_WHATSAPP_TEMPLATE (modelo aprovado; o código vai no 1º campo) e INFOBIP_WHATSAPP_LANG
 *   - "meta" (padrão): WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID (WhatsApp Business Cloud API,
 *     com o modelo de autenticação "codigo_verificacao" aprovado pela Meta).
 *
 * Sem nenhum provedor configurado, o código vai só para o log (desenvolvimento) e,
 * com MODO_TESTE=1, aparece na tela.
 */
export type Canal = "sms" | "whatsapp";

const e164 = (tel: string) => `+55${tel.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}`;
const texto = (codigo: string) => `Leva Já: seu código de verificação é ${codigo}. Vale por 10 minutos. Não compartilhe.`;

export function smsConfigurado() {
  const p = process.env.SMS_PROVIDER;
  if (p === "twilio") return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  if (p === "zenvia") return !!(process.env.ZENVIA_API_TOKEN && process.env.ZENVIA_FROM);
  if (p === "infobip") return !!(process.env.INFOBIP_API_KEY && process.env.INFOBIP_BASE_URL);
  return false;
}

const infobipBase = () =>
  (process.env.INFOBIP_BASE_URL ?? "").replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");

export function whatsappConfigurado() {
  if (process.env.WHATSAPP_PROVIDER === "infobip")
    return !!(process.env.INFOBIP_API_KEY && process.env.INFOBIP_BASE_URL && process.env.INFOBIP_WHATSAPP_FROM && process.env.INFOBIP_WHATSAPP_TEMPLATE);
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Algum provedor real atende este canal (diretamente ou como alternativa)? */
export function envioReal(canal: Canal) {
  return canal === "whatsapp" ? whatsappConfigurado() || smsConfigurado() : smsConfigurado() || whatsappConfigurado();
}

async function enviarSms(telefone: string, codigo: string) {
  const para = e164(telefone);
  if (process.env.SMS_PROVIDER === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: para, From: process.env.TWILIO_FROM!, Body: texto(codigo) }),
    });
    if (!r.ok) throw new Error(`Twilio: ${r.status} ${await r.text()}`);
    return;
  }
  if (process.env.SMS_PROVIDER === "zenvia") {
    const r = await fetch("https://api.zenvia.com/v2/channels/sms/messages", {
      method: "POST",
      headers: { "X-API-TOKEN": process.env.ZENVIA_API_TOKEN!, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ZENVIA_FROM,
        to: para.replace("+", ""),
        contents: [{ type: "text", text: texto(codigo) }],
      }),
    });
    if (!r.ok) throw new Error(`Zenvia: ${r.status} ${await r.text()}`);
    return;
  }
  if (process.env.SMS_PROVIDER === "infobip") {
    // Infobip SMS API v2 ("text/advanced"), autenticação "App <chave>"
    const r = await fetch(`${infobipBase()}/sms/2/text/advanced`, {
      method: "POST",
      headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        messages: [{ from: process.env.INFOBIP_FROM || "LevaJa", destinations: [{ to: para.replace("+", "") }], text: texto(codigo) }],
      }),
    });
    if (!r.ok) throw new Error(`Infobip: ${r.status} ${await r.text()}`);
    return;
  }
  throw new Error("SMS_PROVIDER não configurado");
}

async function enviarWhatsapp(telefone: string, codigo: string) {
  if (process.env.WHATSAPP_PROVIDER === "infobip") {
    // Infobip WhatsApp: mensagem por modelo aprovado, com o código no primeiro campo do corpo
    const r = await fetch(`${infobipBase()}/whatsapp/1/message/template`, {
      method: "POST",
      headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        messages: [
          {
            from: process.env.INFOBIP_WHATSAPP_FROM,
            to: e164(telefone).replace("+", ""),
            content: {
              templateName: process.env.INFOBIP_WHATSAPP_TEMPLATE,
              templateData: { body: { placeholders: [codigo] } },
              language: process.env.INFOBIP_WHATSAPP_LANG || "pt_BR",
            },
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Infobip WhatsApp: ${r.status} ${await r.text()}`);
    return;
  }
  const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: e164(telefone).replace("+", ""),
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
}

/** Envia pelo canal escolhido; se ele não estiver configurado, usa o outro. Retorna o canal usado. */
export async function enviarCodigo(telefone: string, codigo: string, canal: Canal = "sms"): Promise<Canal | "log"> {
  const ordem: Canal[] = canal === "whatsapp" ? ["whatsapp", "sms"] : ["sms", "whatsapp"];
  for (const c of ordem) {
    if (c === "sms" && smsConfigurado()) {
      await enviarSms(telefone, codigo);
      return "sms";
    }
    if (c === "whatsapp" && whatsappConfigurado()) {
      await enviarWhatsapp(telefone, codigo);
      return "whatsapp";
    }
  }
  console.info(`[código de verificação] ${telefone}: ${codigo}`);
  return "log";
}
