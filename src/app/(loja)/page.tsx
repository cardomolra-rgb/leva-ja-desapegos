import Link from "next/link";
import { obterSessao } from "@/lib/sessao";
import { listarVitrine } from "@/lib/consultas";
import { lerConfig } from "@/lib/config-loja";
import { situacaoPreco, somarDias } from "@/lib/rules";
import { ItemCard } from "@/components/ItemCard";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const [{ ctx }, cfg] = await Promise.all([obterSessao(), lerConfig()]);
  const itens = await listarVitrine(ctx, { ordem: "recentes" }, 120);
  const agora = new Date();
  const limite = somarDias(agora, 3);
  const comSituacao = itens
    .filter((i) => i.status === "vitrine")
    .map((i) => ({
      item: i,
      s: situacaoPreco(cfg, { precoInicial: i.preco_inicial, precoMinimo: i.preco_minimo, entradaVitrine: new Date(i.entrada_vitrine_em) }, agora),
    }));
  const baixamLogo = comSituacao
    .filter((x) => x.s.proximaQueda && x.s.proximaQueda.data <= limite)
    .sort((a, b) => a.s.proximaQueda!.data.getTime() - b.s.proximaQueda!.data.getTime())
    .slice(0, 8);
  const novidades = comSituacao.slice(0, 8);

  return (
    <div className="pilha">
      <section className="heroi">
        <h1>
          Leva Já.<br />
          <span className="destaque">O preço só baixa.</span>
        </h1>
        <p>Desapegos conferidos, com preço que cai sozinho a cada {cfg.queda.intervalo_dias} dias. Sem chat, sem pechincha: viu, reservou, retirou.</p>
        <div className="grade-2" style={{ marginTop: 16 }}>
          <Link className="botao bloco" href="/catalogo">Quero comprar</Link>
          <Link className="botao bloco verde" href="/vender">Quero vender</Link>
        </div>
      </section>

      <div className="linha" style={{ justifyContent: "space-around", textAlign: "center" }}>
        <span className="mudo pequeno">💸 Econômico</span>
        <span className="mudo pequeno">🔒 Seguro</span>
        <span className="mudo pequeno">👌 Prático</span>
        <span className="mudo pequeno">⚡ Ágil</span>
      </div>

      {baixamLogo.length > 0 && (
        <section className="pilha">
          <div className="linha entre">
            <h2>Baixam em breve</h2>
            <Link href="/catalogo?ordem=baixando" className="mudo">ver tudo</Link>
          </div>
          <div className="grade">
            {baixamLogo.map(({ item, s }) => <ItemCard key={item.id} item={item} situacao={s} />)}
          </div>
        </section>
      )}

      <section className="pilha">
        <div className="linha entre">
          <h2>Chegaram agora</h2>
          <Link href="/catalogo" className="mudo">catálogo</Link>
        </div>
        {novidades.length ? (
          <div className="grade">
            {novidades.map(({ item, s }) => <ItemCard key={item.id} item={item} situacao={s} />)}
          </div>
        ) : (
          <p className="mudo">A vitrine está sendo montada. Volte em breve!</p>
        )}
      </section>
    </div>
  );
}
