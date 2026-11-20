"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Mostra o Pix (QR + copia e cola) e acompanha a confirmação automática pelo webhook. */
export function PixPagamento({ pagamentoId, copiaCola, qrBase64, expiraEm, simulavel }: {
  pagamentoId: string; copiaCola: string; qrBase64: string | null; expiraEm: string; simulavel: boolean;
}) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);
  const [resta, setResta] = useState(() => Math.max(0, new Date(expiraEm).getTime() - Date.now()));

  useEffect(() => {
    const t = setInterval(async () => {
      setResta(Math.max(0, new Date(expiraEm).getTime() - Date.now()));
      try {
        const r = await fetch(`/api/pagamentos/status?id=${pagamentoId}`, { cache: "no-store" });
        if (r.ok) {
          const { status } = await r.json();
          if (status !== "pendente") router.refresh();
        }
      } catch {
        /* sem rede: tenta no próximo ciclo */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [pagamentoId, expiraEm, router]);

  const min = Math.floor(resta / 60000);
  const seg = Math.floor((resta % 60000) / 1000).toString().padStart(2, "0");

  return (
    <div className="pilha centro">
      {qrBase64 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/png;base64,${qrBase64}`} alt="QR code do Pix" style={{ width: 240, margin: "0 auto", borderRadius: 12 }} />
      )}
      <button
        className="botao bloco verde"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(copiaCola);
          setCopiado(true);
        }}
      >
        {copiado ? "✓ Código copiado" : "Copiar código Pix"}
      </button>
      <p className="mudo pequeno">Pague em até {min}:{seg}. A confirmação é automática — pode deixar esta tela aberta.</p>
      {simulavel && (
        <button
          className="botao contorno peq"
          type="button"
          onClick={async () => {
            await fetch("/api/pagamentos/simular", { method: "POST", body: JSON.stringify({ pagamentoId }) });
            router.refresh();
          }}
        >
          (teste) Simular pagamento
        </button>
      )}
    </div>
  );
}
