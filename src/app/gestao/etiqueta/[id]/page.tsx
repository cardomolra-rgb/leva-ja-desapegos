import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, uma } from "@/lib/db";
import { uuidValido } from "@/lib/consultas";
import { BotaoImprimir } from "@/components/BotaoImprimir";
import { registrarImpressao } from "@/app/acoes/gestao";

export const metadata = { title: "Etiqueta" };

/**
 * Etiqueta térmica 50 × 30 mm: QR code + código curto + nome do item. SEM preço impresso
 * (o preço muda sozinho; o caixa lê o QR e mostra o valor do dia).
 */
export default async function Etiqueta({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nova?: string }> }) {
  const { id } = await params;
  const { nova } = await searchParams;
  if (!uuidValido(id)) notFound();
  const { ctx } = await exigirEquipe();
  const item = await comoUsuario(ctx, (db) => uma<{ codigo: string; titulo: string }>(db, "select codigo, titulo from itens where id = $1", [id]));
  if (!item?.codigo) notFound();
  // o QR carrega só o código curto: funciona offline no leitor e não expõe ids internos
  const svg = await QRCode.toString(item.codigo, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

  return (
    <div className="pilha">
      {nova && <p className="sucesso nao-imprimir">Item na vitrine! Imprima a etiqueta e cole no item.</p>}
      <div className="etiqueta" style={{ margin: "0 auto" }}>
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div style={{ display: "grid", alignContent: "space-between" }}>
          <div className="cod">{item.codigo}</div>
          <div className="nome">{item.titulo}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="selo-et" src="/icons/selo-1cor-etiqueta.svg" alt="Leva Já" />
        </div>
      </div>
      <BotaoImprimir aoImprimir={registrarImpressao.bind(null, id)} />
      <p className="mudo pequeno centro nao-imprimir">Configure a impressora térmica para papel 50 × 30 mm, margens zero, escala 100%.</p>
      <Link href="/gestao/entrada" className="botao contorno bloco nao-imprimir">Próximo item</Link>
    </div>
  );
}
