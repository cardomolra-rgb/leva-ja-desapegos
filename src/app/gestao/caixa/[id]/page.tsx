import { notFound } from "next/navigation";
import { pixSimulado } from "@/lib/ambiente";
import Link from "next/link";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, uma } from "@/lib/db";
import { lerConfig } from "@/lib/config-loja";
import { uuidValido } from "@/lib/consultas";
import { urlAssinada } from "@/lib/storage";
import { precoVigente } from "@/lib/operacoes";
import { brl, data, DEFEITOS_ATALHOS, STATUS_ITEM } from "@/lib/formato";
import { FormCaixa } from "@/components/FormCaixa";

export const metadata = { title: "Cobrar" };

export default async function CobrarItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidValido(id)) notFound();
  const { ctx } = await exigirEquipe();
  const cfg = await lerConfig();
  const r = await comoUsuario(ctx, async (db) => {
    const item = await uma<{
      id: string; codigo: string; titulo: string; status: string; preco_atual: number; preco_inicial: number; preco_minimo: number;
      entrada_vitrine_em: Date | null; tem_defeito: boolean; defeitos: string[]; defeito_obs: string | null; numero_serie: string | null; foto: string | null;
    }>(
      db,
      `select i.*, (select path from item_fotos f where f.item_id = i.id order by (origem = 'loja') desc, ordem limit 1) foto from itens i where i.id = $1`,
      [id],
    );
    const reserva = await uma<{ id: string; preco_travado: number; sinal: number; codigo_retirada: string; retirar_ate: Date; cliente: string }>(
      db,
      `select r.id, r.preco_travado, r.sinal, r.codigo_retirada, r.retirar_ate, p.nome cliente
       from reservas r join perfis p on p.id = r.cliente_id where r.item_id = $1 and r.status = 'paga'`,
      [id],
    );
    return item ? { item, reserva, foto: item.foto ? await urlAssinada(item.foto, 600) : null } : null;
  });
  if (!r) notFound();
  const { item, reserva, foto } = r;
  const preco = reserva ? reserva.preco_travado : precoVigente(cfg, item, new Date());
  const restante = reserva ? reserva.preco_travado - reserva.sinal : preco;
  const vendavel = item.status === "vitrine" || (item.status === "reservado" && reserva);

  return (
    <div className="pilha" style={{ maxWidth: 520, margin: "0 auto" }}>
      <Link href="/gestao/caixa" className="mudo">← Caixa</Link>
      <div className="cartao pilha">
        <p className="mudo pequeno">Confira se a foto é do item no balcão:</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={foto ?? "/icons/icon-512.png"} alt={item.titulo} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 12 }} />
        <h1 style={{ marginTop: 8 }}>{item.titulo}</h1>
        <div className="linha entre"><span className="mudo">{item.codigo}</span><span className="selo claro">{STATUS_ITEM[item.status]}</span></div>
        {item.numero_serie && <p className="pequeno">Nº de série: <strong>{item.numero_serie}</strong></p>}
        {item.tem_defeito && <p className="alerta pequeno">Defeito: {item.defeitos.map((d) => DEFEITOS_ATALHOS[d] ?? d).join(", ")} {item.defeito_obs}</p>}
      </div>

      {reserva && (
        <div className="cartao areia pilha">
          <strong>Reserva de {reserva.cliente}</strong>
          <div className="linha entre"><span>Código</span><span className="codigo-grande" style={{ fontSize: "1.2rem" }}>{reserva.codigo_retirada}</span></div>
          <div className="linha entre"><span>Preço travado</span><span>{brl(reserva.preco_travado)}</span></div>
          <div className="linha entre"><span>Sinal pago (desconta)</span><span>− {brl(reserva.sinal)}</span></div>
          <div className="linha entre pequeno mudo"><span>Retirar até</span><span>{data(reserva.retirar_ate, true)}</span></div>
        </div>
      )}

      <div className="cartao centro">
        <p className="mudo">{reserva ? "A receber" : "Preço de hoje"}</p>
        <p className="preco grande">{brl(restante)}</p>
      </div>

      {vendavel ? (
        <FormCaixa
          itemId={item.id}
          reservaId={reserva?.id ?? null}
          restante={restante}
          simulavel={pixSimulado()}
        />
      ) : (
        <p className="alerta">Este item não está disponível para venda ({STATUS_ITEM[item.status]}).</p>
      )}
    </div>
  );
}
