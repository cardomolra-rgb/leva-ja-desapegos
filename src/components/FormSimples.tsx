"use client";
import { useActionState } from "react";

type Estado = { erro?: string; ok?: string } | undefined;

/** Formulário genérico ligado a uma server action que devolve {erro|ok}. */
export function FormSimples({ acao, children, botao, classeBotao = "botao bloco" }: {
  acao: (e: Estado, f: FormData) => Promise<Estado>;
  children: React.ReactNode;
  botao: string;
  classeBotao?: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, undefined);
  return (
    <form action={enviar} className="pilha">
      {children}
      {estado?.erro && <p className="erro" role="alert">{estado.erro}</p>}
      {estado?.ok && <p className="ok" role="status">{estado.ok}</p>}
      <button className={classeBotao} type="submit" disabled={enviando}>{enviando ? "Aguarde…" : botao}</button>
    </form>
  );
}
