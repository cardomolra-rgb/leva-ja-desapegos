import { notFound } from "next/navigation";
import Link from "next/link";
import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, uma, varias } from "@/lib/db";
import { lerConfig } from "@/lib/config-loja";
import { uuidValido } from "@/lib/consultas";
import { urlAssinada } from "@/lib/storage";
import { brl, cpfMascara, data, DEFEITOS_ATALHOS, STATUS_ITEM } from "@/lib/formato";
import { ESTADO_ROTULO, simularRecebimento, type Estado } from "@/lib/rules";
import { FormSimples } from "@/components/FormSimples";
import { FormEntrada } from "@/components/FormEntrada";
import { decidirPreAvaliacao, recusarPresencial } from "@/app/acoes/gestao";

export default async function AvaliarItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidValido(id)) notFound();
  const [{ ctx }, cfg] = await Promise.all([exigirEquipe(), lerConfig()]);
  const r = await comoUsuario(ctx, async (db) => {
    const item = await uma<{
      id: string; titulo: string; descricao: string | null; marca: string | null; medidas: string | null; status: string; estado: Estado;
      preco_novo: number; teto: number; preco_inicial: number; preco_minimo: number; tem_defeito: boolean; defeitos: string[];
      defeito_obs: string | null; modalidade_repasse: string; slug: string; categoria: string; checklist: string[];
      dono: string; dono_cpf: string | null; dono_itens: number; criado_em: Date; entrega_agendada_em: Date | null;
    }>(
      db,
      `select i.*, c.slug, c.nome categoria, c.checklist, p.nome dono, p.cpf dono_cpf,
              (select count(*) from itens x where x.dono_id = i.dono_id and x.status in ('vitrine','reservado'))::int dono_itens
       from itens i join categorias c on c.id = i.categoria_id join perfis p on p.id = i.dono_id where i.id = $1`,
      [id],
    );
    const fotos = await varias<{ path: string }>(db, "select path from item_fotos where item_id = $1 order by ordem", [id]);
    return item ? { item, fotos: await Promise.all(fotos.map((f) => urlAssinada(f.path))) } : null;
  });
  if (!r) notFound();
  const { item, fotos } = r;
  const sim = simularRecebimento(cfg, item.preco_inicial, item.preco_minimo);

  return (
    <div className="pilha">
      <Link href="/gestao/entrada" className="mudo">← Fila de entrada</Link>
      <h1>{item.titulo}</h1>
      <div className="linha"><span className="selo claro">{STATUS_ITEM[item.status]}</span><span className="selo claro">{item.categoria}</span></div>

      <div className="galeria">
        {fotos.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={u} alt={`Foto ${i + 1} enviada pelo dono`} />
        ))}
      </div>

      <section className="cartao pilha">
        <table className="tabela"><tbody>
          <tr><th>Dono</th><td>{item.dono} · CPF {cpfMascara(item.dono_cpf)} · {item.dono_itens} item(ns) na vitrine</td></tr>
          <tr><th>Estado informado</th><td>{ESTADO_ROTULO[item.estado]}</td></tr>
          <tr><th>Preço do novo</th><td>{brl(item.preco_novo)}</td></tr>
          <tr><th>Teto calculado</th><td><strong>{brl(item.teto)}</strong></td></tr>
          <tr><th>Pedido / mínimo</th><td>{brl(item.preco_inicial)} / {brl(item.preco_minimo)}</td></tr>
          <tr><th>Repasse</th><td>{item.modalidade_repasse === "pix" ? `Pix: ${brl(sim.pix.noPedido)}–${brl(sim.pix.noMinimo)}` : `Crédito: ${brl(sim.credito.noPedido)}–${brl(sim.credito.noMinimo)}`}</td></tr>
          {item.marca && <tr><th>Marca</th><td>{item.marca}</td></tr>}
          {item.medidas && <tr><th>Medidas</th><td>{item.medidas}</td></tr>}
          {item.entrega_agendada_em && <tr><th>Entrega</th><td>{data(item.entrega_agendada_em, true)}</td></tr>}
        </tbody></table>
        {item.descricao && <p>{item.descricao}</p>}
        {item.tem_defeito && (
          <div className="alerta">Defeitos informados: {item.defeitos.map((d) => DEFEITOS_ATALHOS[d] ?? d).join(", ")} {item.defeito_obs && `— ${item.defeito_obs}`}</div>
        )}
      </section>

      {item.status === "pre_avaliacao" && (
        <section className="cartao pilha">
          <h2>Decisão da pré-avaliação</h2>
          <FormSimples acao={decidirPreAvaliacao} botao="Confirmar decisão" classeBotao="botao bloco escuro">
            <input type="hidden" name="itemId" value={item.id} />
            <div className="chips">
              <label className="chip"><input type="radio" name="decisao" value="aprovado" defaultChecked />Aprovar</label>
              <label className="chip"><input type="radio" name="decisao" value="contraproposta" />Propor outro preço</label>
              <label className="chip"><input type="radio" name="decisao" value="recusado" />Recusar</label>
            </div>
            <label>Preço proposto (se propor)<input name="preco" inputMode="decimal" placeholder={`até ${brl(item.teto)}`} /></label>
            <label>Motivo (obrigatório para recusar)
              <select name="motivo" defaultValue="">
                <option value="">—</option>
                <option>Categoria fora do perfil da loja</option>
                <option>Estado abaixo do aceito</option>
                <option>Fotos insuficientes</option>
                <option>Item sem procura / estoque alto</option>
                <option>Item proibido ou sem procedência</option>
              </select>
            </label>
          </FormSimples>
        </section>
      )}

      {(item.status === "aguardando_entrega" || item.status === "pre_avaliacao") && (
        <>
          <h2>Avaliação presencial</h2>
          <FormEntrada
            cfg={cfg}
            checklist={item.checklist}
            item={{
              id: item.id, categoria: item.slug, estado: item.estado, precoNovo: item.preco_novo, precoInicial: item.preco_inicial,
              precoMinimo: item.preco_minimo, defeitos: item.defeitos, defeitoObs: item.defeito_obs,
            }}
          />
          <details className="cartao">
            <summary><strong>Recusar na avaliação presencial</strong></summary>
            <FormSimples acao={recusarPresencial} botao="Recusar e devolver ao dono" classeBotao="botao bloco perigo">
              <input type="hidden" name="itemId" value={item.id} />
              <label>Motivo<input name="motivo" required /></label>
            </FormSimples>
          </details>
        </>
      )}
    </div>
  );
}
