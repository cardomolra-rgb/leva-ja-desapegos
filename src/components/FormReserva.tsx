"use client";
import { useActionState, useState } from "react";
import { reservar } from "@/app/acoes/loja";

export function FormReserva({ itemId, temDefeito, sinal, prazoHoras, logado }: {
  itemId: string; temDefeito: boolean; sinal: string; prazoHoras: number; logado: boolean;
}) {
  const [estado, acao, enviando] = useActionState(reservar, undefined);
  const [aceite, setAceite] = useState(false);
  const bloqueado = temDefeito && !aceite;

  return (
    <form action={acao} className="pilha">
      <input type="hidden" name="itemId" value={itemId} />
      {temDefeito && (
        <label className="check alerta">
          <input type="checkbox" name="aceite" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
          <span><strong>Li e aceito o item no estado descrito</strong>, inclusive os defeitos informados acima.</span>
        </label>
      )}
      <button className="botao bloco" type="submit" disabled={bloqueado || enviando} aria-disabled={bloqueado}>
        {enviando ? "Gerando Pix…" : `Reservar com sinal de ${sinal}`}
      </button>
      <p className="mudo pequeno centro">
        O sinal é descontado na retirada. Se não retirar em {prazoHoras}h, o sinal fica retido e o item volta para a vitrine.
        {!logado && " Você vai precisar entrar na sua conta."}
      </p>
      {estado?.erro && <p className="erro" role="alert">{estado.erro}</p>}
    </form>
  );
}
