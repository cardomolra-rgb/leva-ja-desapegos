import { exigirEquipe } from "@/lib/sessao";
import { LeitorQR } from "@/components/LeitorQR";
import { buscarNoCaixa } from "@/app/acoes/gestao";

export const metadata = { title: "Caixa" };

export default async function Caixa({ searchParams }: { searchParams: Promise<{ nao?: string; vendido?: string }> }) {
  const { nao, vendido } = await searchParams;
  await exigirEquipe();
  return (
    <div className="pilha" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Caixa</h1>
      {vendido && <p className="sucesso">Venda registrada! O dono já foi avisado.</p>}
      <LeitorQR formId="busca-caixa" />
      <form id="busca-caixa" action={buscarNoCaixa} className="cartao pilha">
        <label>Código da etiqueta ou código de retirada
          <input name="codigo" required autoCapitalize="characters" placeholder="CAS-4012 ou K7M3QX" style={{ textTransform: "uppercase" }} />
        </label>
        <button className="botao bloco">Buscar</button>
        {nao && <p className="erro">Nada encontrado para “{nao}”.</p>}
      </form>
    </div>
  );
}
