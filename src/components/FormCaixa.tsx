"use client";
import { useActionState, useEffect, useState } from "react";
import { finalizarVenda, gerarPixCaixa, type EstadoCaixa } from "@/app/acoes/gestao";
import { brl, paraCentavos } from "@/lib/rules";

const METODOS: [string, string][] = [
  ["pix", "Pix"], ["cartao_credito", "Crédito"], ["cartao_debito", "Débito"], ["credito_loja", "Crédito na loja"], ["dinheiro", "Dinheiro"],
];

/** Cobrança no caixa: um ou mais meios, Pix dinâmico com confirmação automática, crédito da loja por CPF. */
export function FormCaixa({ itemId, reservaId, restante, simulavel }: { itemId: string; reservaId: string | null; restante: number; simulavel: boolean }) {
  const [estado, acao, enviando] = useActionState(finalizarVenda, undefined);
  const [valores, setValores] = useState<Record<string, string>>({ pix: "", cartao_credito: "", cartao_debito: "", credito_loja: "", dinheiro: "" });
  const [pix, setPix] = useState<EstadoCaixa>(undefined);
  const [pixPago, setPixPago] = useState(false);

  const soma = Object.values(valores).reduce((s, v) => s + (paraCentavos(v) || 0), 0);
  const falta = restante - soma;
  const valorPix = paraCentavos(valores.pix) || 0;

  useEffect(() => {
    if (!pix?.pix || pixPago) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/pagamentos/status?id=${pix.pix!.pagamentoId}`, { cache: "no-store" });
      if (r.ok && (await r.json()).status === "aprovado") setPixPago(true);
    }, 3000);
    return () => clearInterval(t);
  }, [pix, pixPago]);

  const preencher = (m: string) => setValores((v) => ({ ...Object.fromEntries(Object.keys(v).map((k) => [k, ""])), [m]: (restante / 100).toFixed(2).replace(".", ",") }));

  return (
    <form action={acao} className="pilha">
      <input type="hidden" name="itemId" value={itemId} />
      {reservaId && <input type="hidden" name="reservaId" value={reservaId} />}
      {pix?.pix && <input type="hidden" name="pixPagamentoId" value={pix.pix.pagamentoId} />}

      <div className="chips">
        {METODOS.map(([m, r]) => <button key={m} type="button" className="chip" onClick={() => { preencher(m); setPix(undefined); setPixPago(false); }}>{r} total</button>)}
      </div>

      {METODOS.map(([m, r]) => (
        <label key={m} className="linha" style={{ gridTemplateColumns: "1fr", flexWrap: "nowrap" }}>
          <span style={{ width: 130 }}>{r}</span>
          <input
            name={`valor_${m}`} inputMode="decimal" value={valores[m]} placeholder="0,00"
            disabled={m === "pix" && !!pix?.pix}
            onChange={(e) => setValores((v) => ({ ...v, [m]: e.target.value }))}
          />
        </label>
      ))}
      {pix?.pix && <input type="hidden" name="valor_pix" value={valores.pix} />}

      {(paraCentavos(valores.credito_loja) || 0) > 0 && (
        <label>CPF do cliente (para usar o crédito)<input name="cpfComprador" inputMode="numeric" required /></label>
      )}

      <p className={falta === 0 ? "ok" : "erro"}>{falta === 0 ? "Valor fechado ✓" : falta > 0 ? `Faltam ${brl(falta)}` : `Passou ${brl(-falta)}`}</p>

      {valorPix > 0 && !pix?.pix && (
        <button type="button" className="botao bloco verde" onClick={async () => setPix(await gerarPixCaixa(itemId, valorPix))}>
          Gerar Pix de {brl(valorPix)}
        </button>
      )}
      {pix?.pix && (
        <div className="cartao centro pilha">
          {pix.pix.qrBase64 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${pix.pix.qrBase64}`} alt="QR Pix" style={{ width: 220, margin: "0 auto" }} />
          )}
          <p className={pixPago ? "ok" : "mudo"}>{pixPago ? "Pix confirmado ✓" : "Aguardando pagamento do Pix…"}</p>
          {simulavel && !pixPago && (
            <button type="button" className="botao contorno peq" onClick={() => fetch("/api/pagamentos/simular", { method: "POST", body: JSON.stringify({ pagamentoId: pix.pix!.pagamentoId }) })}>
              (teste) Simular pagamento
            </button>
          )}
        </div>
      )}

      {estado?.erro && <p className="erro" role="alert">{estado.erro}</p>}
      <button className="botao bloco" type="submit" disabled={falta !== 0 || enviando || (valorPix > 0 && !pixPago)}>
        {enviando ? "Registrando…" : reservaId ? "Confirmar retirada" : "Finalizar venda"}
      </button>
    </form>
  );
}
