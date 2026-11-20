import Link from "next/link";
import { FormSimples } from "@/components/FormSimples";
import { entrar } from "@/app/acoes/conta";

export const metadata = { title: "Entrar" };

export default async function Entrar({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar = "/conta" } = await searchParams;
  return (
    <div className="pilha" style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1>Entrar</h1>
      <FormSimples acao={entrar} botao="Entrar">
        <input type="hidden" name="voltar" value={voltar} />
        <label>E-mail<input type="email" name="email" autoComplete="email" required /></label>
        <label>Senha<input type="password" name="senha" autoComplete="current-password" required /></label>
      </FormSimples>
      <p className="centro">Ainda não tem conta? <Link href={`/cadastrar?voltar=${encodeURIComponent(voltar)}`}><strong>Criar conta</strong></Link></p>
    </div>
  );
}
