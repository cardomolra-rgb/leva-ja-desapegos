import { notFound } from "next/navigation";
import { comoServico, uma } from "@/lib/db";
import { data } from "@/lib/formato";

export const dynamic = "force-dynamic";

const NOMES: Record<string, string> = {
  uso: "Termos de uso",
  privacidade: "Política de privacidade",
  consignacao: "Contrato de consignação",
  item_com_defeito: "Aceite de item com defeito",
};

export default async function Termo({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  if (!NOMES[tipo]) notFound();
  const t = await comoServico((db) =>
    uma<{ versao: string; texto: string; publicado_em: Date }>(
      db, "select versao, texto, publicado_em from termos where tipo = $1 order by publicado_em desc limit 1", [tipo],
    ),
  );
  if (!t) notFound();
  return (
    <article className="pilha cartao">
      <h1>{NOMES[tipo]}</h1>
      <p className="mudo pequeno">Versão {t.versao} · publicada em {data(t.publicado_em)}</p>
      <p style={{ whiteSpace: "pre-line" }}>{t.texto}</p>
    </article>
  );
}
