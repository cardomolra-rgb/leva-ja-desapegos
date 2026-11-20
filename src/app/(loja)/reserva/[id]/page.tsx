import { notFound } from "next/navigation";
import { pixSimulado } from "@/lib/ambiente";
import Link from "next/link";
import { exigirLogin } from "@/lib/sessao";
import { comoUsuario, uma } from "@/lib/db";
import { uuidValido } from "@/lib/consultas";
import { brl, data } from "@/lib/formato";
import { PixPagamento } from "@/components/PixPagamento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reserva" };

export default async function Reserva({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidValido(id)) notFound();
  const { ctx } = await exigirLogin(`/entrar?voltar=/reserva/${id}`);
  const r = await comoUsuario(ctx, (db) =>
    uma<{
      status: string; preco_travado: number; sinal: number; codigo_retirada: string; retirar_ate: Date | null;
      titulo: string; codigo: string; item_id: string; pagamento_id: string; pix_copia_cola: string | null;
      pix_qr_base64: string | null; expira_em: Date | null; pag_status: string;
    }>(
      db,
      `select r.status, r.preco_travado, r.sinal, r.codigo_retirada, r.retirar_ate, i.titulo, i.codigo, i.id item_id,
              p.id pagamento_id, p.pix_copia_cola, p.pix_qr_base64, p.expira_em, p.status pag_status
       from reservas r join itens i on i.id = r.item_id join pagamentos p on p.id = r.pagamento_id
       where r.id = $1 and r.cliente_id = $2`,
      [id, ctx.perfilId],
    ),
  );
  if (!r) notFound();

  return (
    <div className="pilha">
      <h1>Reserva</h1>
      <div className="cartao">
        <strong>{r.titulo}</strong> <span className="mudo">({r.codigo})</span>
        <div className="linha entre" style={{ marginTop: 8 }}>
          <span>Preço travado</span><strong>{brl(r.preco_travado)}</strong>
        </div>
        <div className="linha entre">
          <span>Sinal (agora, por Pix)</span><strong>{brl(r.sinal)}</strong>
        </div>
        <div className="linha entre">
          <span>Na retirada</span><strong>{brl(r.preco_travado - r.sinal)}</strong>
        </div>
      </div>

      {r.status === "aguardando_pagamento" && r.pix_copia_cola && (
        <PixPagamento
          pagamentoId={r.pagamento_id}
          copiaCola={r.pix_copia_cola}
          qrBase64={r.pix_qr_base64}
          expiraEm={(r.expira_em ?? new Date()).toISOString()}
          simulavel={pixSimulado()}
        />
      )}

      {r.status === "paga" && (
        <div className="sucesso centro pilha">
          <p><strong>Reserva confirmada! 🎉</strong></p>
          <p>Mostre este código no caixa:</p>
          <p className="codigo-grande">{r.codigo_retirada}</p>
          <p>Retire até <strong>{data(r.retirar_ate, true)}</strong>.</p>
        </div>
      )}
      {r.status === "retirada" && <p className="sucesso">Item retirado. Aproveite! 🧡</p>}
      {(r.status === "cancelada" || r.status === "expirada") && (
        <p className="alerta">
          {r.status === "cancelada" ? "O Pix não foi pago a tempo e a reserva foi cancelada." : "O prazo de retirada terminou. O sinal ficou retido, conforme as regras."}
        </p>
      )}
      <Link href={`/item/${r.item_id}`} className="mudo">← Ver o item</Link>
    </div>
  );
}
