import Link from "next/link";
import { brl, data } from "@/lib/formato";
import type { ItemVitrine } from "@/lib/consultas";
import type { SituacaoPreco } from "@/lib/rules";

export function ItemCard({ item, situacao }: { item: ItemVitrine; situacao: SituacaoPreco }) {
  const reservado = item.status === "reservado";
  return (
    <Link href={`/item/${item.id}`} className="item-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="foto" src={item.foto ?? "/icons/icon-512.png"} alt={item.titulo} loading="lazy" />
      <div className="corpo">
        <div className="linha" style={{ gap: 4 }}>
          {reservado && <span className="selo escuro">Reservado</span>}
          {item.selos.includes("testado") && <span className="selo">Testado</span>}
          {item.selos.includes("conferido") && <span className="selo">Conferido</span>}
          {item.tem_defeito && <span className="selo defeito">Defeito</span>}
        </div>
        <span className="nome">{item.titulo}</span>
        <span>
          <span className="preco">{brl(situacao.precoHoje)}</span>{" "}
          {situacao.precoHoje < item.preco_inicial && <span className="riscado">{brl(item.preco_inicial)}</span>}
        </span>
        {situacao.proximaQueda ? (
          <span className="baixa">
            ↓ {brl(situacao.proximaQueda.preco)} em {data(situacao.proximaQueda.data)}
          </span>
        ) : (
          <span className="baixa">Preço mínimo</span>
        )}
      </div>
    </Link>
  );
}
