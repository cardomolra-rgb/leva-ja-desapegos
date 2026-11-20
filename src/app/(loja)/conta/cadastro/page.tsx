import { redirect } from "next/navigation";
import { exigirLogin, cadastroCompleto } from "@/lib/sessao";
import { FormSimples } from "@/components/FormSimples";
import { InputImagem } from "@/components/InputImagem";
import { confirmarCodigo, enviarDocumentos, salvarDadosEnviarCodigo } from "@/app/acoes/conta";

export const dynamic = "force-dynamic";
export const metadata = { title: "Completar cadastro" };

export default async function CompletarCadastro({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar = "/conta" } = await searchParams;
  const { perfil } = await exigirLogin();
  if (cadastroCompleto(perfil)) redirect(voltar.startsWith("/") ? voltar : "/conta");
  const telOk = !!perfil.telefone_verificado_em;

  return (
    <div className="pilha" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Completar cadastro</h1>
      <p className="mudo">Necessário para vender e reservar. Seus documentos ficam em armazenamento privado e só a equipe da loja pode ver.</p>

      <section className="cartao pilha">
        <h2>1. CPF e celular {telOk && <span className="selo">✓</span>}</h2>
        {telOk ? (
          <p className="ok">Telefone confirmado.</p>
        ) : (
          <>
            <FormSimples acao={salvarDadosEnviarCodigo} botao="Enviar código" classeBotao="botao bloco escuro">
              <label>CPF<input name="cpf" inputMode="numeric" defaultValue={perfil.cpf ?? ""} required placeholder="000.000.000-00" /></label>
              <label>Celular com DDD<input name="telefone" inputMode="tel" defaultValue={perfil.telefone ?? ""} required placeholder="63 99999-9999" /></label>
              <div className="chips">
                <label className="chip"><input type="radio" name="canal" value="whatsapp" defaultChecked />WhatsApp</label>
                <label className="chip"><input type="radio" name="canal" value="sms" />SMS</label>
              </div>
              <p className="mudo pequeno">Seus repasses em Pix vão sempre para a chave do seu CPF.</p>
            </FormSimples>
            <FormSimples acao={confirmarCodigo} botao="Confirmar código">
              <label>Código recebido<input name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></label>
            </FormSimples>
          </>
        )}
      </section>

      <section className="cartao pilha" aria-disabled={!telOk} style={{ opacity: telOk ? 1 : 0.5 }}>
        <h2>2. Documento e selfie</h2>
        {telOk && (
          <FormSimples acao={enviarDocumentos} botao="Concluir cadastro">
            <input type="hidden" name="voltar" value={voltar} />
            <label>Foto do documento (RG ou CNH)<InputImagem name="documento" accept="image/*,application/pdf" capture="environment" required /></label>
            <label>Selfie segurando o documento<InputImagem name="selfie" accept="image/*" capture="user" required /></label>
            <label className="check">
              <input type="checkbox" name="privacidade" required />
              <span>Li e aceito os <a href="/termos/uso" target="_blank">termos de uso</a> e a <a href="/termos/privacidade" target="_blank">política de privacidade</a>.</span>
            </label>
          </FormSimples>
        )}
      </section>
    </div>
  );
}
