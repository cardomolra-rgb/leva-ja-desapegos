import Link from "next/link";
import { FormSimples } from "@/components/FormSimples";
import { cadastrar } from "@/app/acoes/conta";

export const metadata = { title: "Criar conta" };

export default async function Cadastrar({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar = "/conta" } = await searchParams;
  return (
    <div className="pilha" style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1>Criar conta</h1>
      <p className="mudo">Depois vamos pedir CPF, documento, selfie e um código no seu celular. É o que deixa a loja segura para todo mundo.</p>
      <FormSimples acao={cadastrar} botao="Criar conta">
        <input type="hidden" name="voltar" value={voltar} />
        <label>Nome completo<input name="nome" autoComplete="name" required /></label>
        <label>E-mail<input type="email" name="email" autoComplete="email" required /></label>
        <label>Senha (mín. 8)<input type="password" name="senha" autoComplete="new-password" minLength={8} required /></label>
      </FormSimples>
      <p className="centro">Já tem conta? <Link href={`/entrar?voltar=${encodeURIComponent(voltar)}`}><strong>Entrar</strong></Link></p>
    </div>
  );
}
