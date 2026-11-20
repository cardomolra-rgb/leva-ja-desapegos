"use client";
import { useEffect, useRef, useState } from "react";

/** Lê o QR da etiqueta pela câmera traseira e envia o código para o formulário de busca do caixa. */
export function LeitorQR({ formId }: { formId: string }) {
  const [ativo, setAtivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const leitor = useRef<{ stop: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelado) return;
      const h = new Html5Qrcode("leitor-qr");
      leitor.current = h;
      try {
        await h.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (texto) => {
            await h.stop().catch(() => {});
            setAtivo(false);
            const form = document.getElementById(formId) as HTMLFormElement | null;
            const campo = form?.querySelector<HTMLInputElement>("input[name=codigo]");
            if (form && campo) {
              campo.value = texto.trim();
              form.requestSubmit();
            }
          },
          () => {},
        );
      } catch {
        setErro("Não foi possível abrir a câmera. Verifique a permissão ou digite o código.");
        setAtivo(false);
      }
    })();
    return () => {
      cancelado = true;
      leitor.current?.stop().catch(() => {});
    };
  }, [ativo, formId]);

  return (
    <div className="pilha">
      <div id="leitor-qr" style={{ width: "100%", maxWidth: 360, margin: "0 auto", borderRadius: 14, overflow: "hidden" }} />
      {!ativo && (
        <button className="botao bloco escuro" type="button" onClick={() => { setErro(null); setAtivo(true); }}>
          📷 Ler QR da etiqueta
        </button>
      )}
      {erro && <p className="erro">{erro}</p>}
    </div>
  );
}
