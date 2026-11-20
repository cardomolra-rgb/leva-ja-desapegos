import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { obterSessao } from "@/lib/sessao";
import { obterItem, uuidValido } from "@/lib/consultas";
import { lerConfig } from "@/lib/config-loja";
import { comoUsuario } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { ESTADO_ROTULO, brl, calcularSinal, situacaoPreco } from "@/lib/rules";
import { DEFEITOS_ATALHOS, data, dataExtenso } from "@/lib/formato";
import { FormReserva } from "@/components/FormReserva";
import { alternarFavorito } from "@/app/acoes/loja";

export const dynamic = "force-dynamic";

export default async function FichaItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidValido(id)) notFound();
  const [{ ctx, perfil }, cfg] = await Promise.all([obterSessao(), lerConfig()]);
  const r = await obterItem(ctx, id);
  if (!r) notFound(); // o RLS já esconde itens fora da vitrine de quem não é dono nem equipe
  const { item, fotos, favorito } = r;

  // registra a visualização depois de responder: não atrasa a abertura da ficha
  after(() => comoUsuario(ctx, (db) => registrarEvento(db, "visualizacao", { perfilId: ctx.perfilId, itemId: id })).catch(console.error));

  const agora = new Date();
  const s = item.entrada_vitrine_em
    ? situacaoPreco(cfg, { precoInicial: item.preco_inicial, precoMinimo: item.preco_minimo, entradaVitrine: new Date(item.entrada_vitrine_em) }, agora)
    : null;
  const preco = s ? Math.min(s.precoHoje, item.preco_atual) : item.preco_atual;
  const sinal = calcularSinal(cfg, preco);
  const estado = item.estado_confirmado ?? item.estado;
  const favoritar = alternarFavorito.bind(null, id);

  return (
    <article className="pilha">
      <div className="galeria">
        {(fotos.length ? fotos : [{ url: "/icons/icon-512.png", angulo: null }]).map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={f.url} alt={`${item.titulo}${f.angulo ? ` — ${f.angulo}` : ""}`} />
        ))}
      </div>

      <div className="linha" style={{ gap: 6 }}>
        <span className="selo claro">{item.categoria_nome}</span>
        <span className="selo claro">{ESTADO_ROTULO[estado]}</span>
        {item.selos.includes("testado") && <span className="selo">✓ Testado</span>}
        {item.selos.includes("conferido") && <span className="selo">✓ Conferido</span>}
        {item.status === "reservado" && <span className="selo escuro">Reservado</span>}
      </div>

      <div className="linha entre" style={{ alignItems: "flex-start" }}>
        <h1 style={{ flex: 1 }}>{item.titulo}</h1>
        {perfil && (
          <form action={favoritar}>
            <button className="botao contorno peq" aria-pressed={favorito} title="Favoritar e receber aviso de queda">
              {favorito ? "♥ Favorito" : "♡ Favoritar"}
            </button>
          </form>
        )}
      </div>
      <p className="mudo pequeno">Código {item.codigo}</p>

      <div className="cartao">
        <div className="linha" style={{ alignItems: "baseline" }}>
          <span className="preco grande">{brl(preco)}</span>
          {preco < item.preco_inicial && <span className="riscado">{brl(item.preco_inicial)}</span>}
        </div>
        {s?.proximaQueda ? (
          <p className="baixa">Baixa para {brl(s.proximaQueda.preco)} em {dataExtenso(s.proximaQueda.data)}</p>
        ) : (
          <p className="baixa">Este é o preço mínimo.</p>
        )}
      </div>

      {item.tem_defeito && (
        <div className="alerta">
          <strong>⚠ Atenção: item com defeito</strong>
          <div className="chips" style={{ marginTop: 6 }}>
            {item.defeitos.map((d) => <span key={d} className="selo defeito">{DEFEITOS_ATALHOS[d] ?? d}</span>)}
          </div>
          {item.defeito_obs && <p style={{ marginBottom: 0 }}>{item.defeito_obs}</p>}
        </div>
      )}

      {item.status === "vitrine" && item.dono_id !== ctx.perfilId && (
        <FormReserva itemId={id} temDefeito={item.tem_defeito} sinal={brl(sinal.valor)} prazoHoras={cfg.reserva.prazo_retirada_horas} logado={!!perfil} />
      )}
      {item.status === "reservado" && <p className="cartao areia">Este item está reservado. Se não for retirado no prazo, volta para a vitrine.</p>}

      <section className="cartao pilha">
        <h2>Detalhes</h2>
        {item.descricao && <p style={{ whiteSpace: "pre-line" }}>{item.descricao}</p>}
        <table className="tabela">
          <tbody>
            <tr><th>Estado</th><td>{ESTADO_ROTULO[estado]}</td></tr>
            {item.marca && <tr><th>Marca</th><td>{item.marca}</td></tr>}
            {item.medidas && <tr><th>Medidas</th><td>{item.medidas}</td></tr>}
            <tr><th>Retirada</th><td>Somente na loja</td></tr>
          </tbody>
        </table>
      </section>

      {s && (
        <section className="cartao pilha">
          <h2>Linha do tempo do preço</h2>
          <ol className="tempo">
            {s.linhaDoTempo.map((l) => {
              const classe = l.etapa === s.etapa || (s.noMinimo && l.preco === item.preco_minimo) ? "agora" : l.data <= agora ? "passou" : "";
              return (
                <li key={l.etapa} className={classe}>
                  <span>{l.etapa === 0 ? "Entrada" : data(l.data)}</span>
                  <span>{brl(l.preco)}</span>
                </li>
              );
            })}
          </ol>
          <p className="mudo pequeno">O preço cai {Math.round(cfg.queda.pct_do_inicial * 100)}% a cada {cfg.queda.intervalo_dias} dias até o mínimo. Sem negociação.</p>
        </section>
      )}

      <Link href="/catalogo" className="mudo">← Voltar ao catálogo</Link>
    </article>
  );
}
