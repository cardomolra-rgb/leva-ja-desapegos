import Link from "next/link";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, varias } from "@/lib/db";
import { assinarFotos } from "@/lib/consultas";
import { brl, data } from "@/lib/formato";
import { ESTADO_ROTULO, type Estado } from "@/lib/rules";

export const metadata = { title: "Entrada" };

export default async function Entrada() {
  const { ctx } = await exigirEquipe();
  const itens = await comoUsuario(ctx, async (db) =>
    assinarFotos(
      await varias<{ id: string; titulo: string; status: string; estado: Estado; teto: number; preco_inicial: number; preco_minimo: number; categoria: string; dono: string; entrega_agendada_em: Date | null; criado_em: Date; tem_defeito: boolean; foto: string | null }>(
        db,
        `select i.id, i.titulo, i.status, i.estado, i.teto, i.preco_inicial, i.preco_minimo, c.nome categoria, p.nome dono,
                i.entrega_agendada_em, i.criado_em, i.tem_defeito,
                (select path from item_fotos f where f.item_id = i.id order by ordem limit 1) foto
         from itens i join categorias c on c.id = i.categoria_id join perfis p on p.id = i.dono_id
         where i.status in ('pre_avaliacao', 'aguardando_entrega', 'contraproposta')
         order by i.status = 'aguardando_entrega' desc, coalesce(i.entrega_agendada_em, i.criado_em)`,
      ),
    ),
  );
  const grupos = [
    { titulo: "Para dar entrada (dono traz o item)", s: "aguardando_entrega" },
    { titulo: "Pré-avaliação pela foto", s: "pre_avaliacao" },
    { titulo: "Aguardando resposta do dono", s: "contraproposta" },
  ];
  return (
    <div className="pilha">
      <h1>Entrada</h1>
      {grupos.map((g) => {
        const lista = itens.filter((i) => i.status === g.s);
        return (
          <section key={g.s} className="pilha">
            <h2>{g.titulo} <span className="mudo">({lista.length})</span></h2>
            {lista.length ? lista.map((i) => (
              <Link key={i.id} href={`/gestao/entrada/${i.id}`} className="cartao linha" style={{ textDecoration: "none", flexWrap: "nowrap" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.foto ?? "/icons/icon-192.png"} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{i.titulo}</strong>
                  <div className="mudo pequeno">{i.categoria} · {ESTADO_ROTULO[i.estado]} · {i.dono}</div>
                  <div className="pequeno">Pedido {brl(i.preco_inicial)} · teto <strong>{brl(i.teto)}</strong> · mín. {brl(i.preco_minimo)}</div>
                  {i.entrega_agendada_em && <div className="pequeno">📅 Entrega {data(i.entrega_agendada_em, true)}</div>}
                </div>
                {i.tem_defeito && <span className="selo defeito">Defeito</span>}
              </Link>
            )) : <p className="mudo">Nada aqui.</p>}
          </section>
        );
      })}
    </div>
  );
}
