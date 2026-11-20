import { exigirCadastroCompleto } from "@/lib/sessao";
import { lerConfig } from "@/lib/config-loja";
import { comoServico, varias } from "@/lib/db";
import { FormVender } from "@/components/FormVender";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quero vender" };

export default async function Vender() {
  await exigirCadastroCompleto("/vender");
  const [cfg, cats] = await Promise.all([
    lerConfig(),
    comoServico((db) =>
      varias<{ slug: string; nome: string; limite_itens: number; ocupados: number; em_analise: number }>(
        db,
        `select o.slug, o.nome, o.limite_itens, o.ocupados::int, o.em_analise::int
         from ocupacao_categorias o join categorias c on c.id = o.id where o.ativa order by c.ordem`,
      ),
    ),
  ]);
  return (
    <div className="pilha">
      <h1>Quero vender</h1>
      <p className="mudo">Você manda as fotos, a loja faz a pré-avaliação e você leva o item. Sem chat: tudo por aqui.</p>
      <FormVender
        cfg={cfg}
        categorias={cats.map((c) => ({ slug: c.slug, nome: c.nome, cheia: c.ocupados + c.em_analise >= c.limite_itens }))}
      />
    </div>
  );
}
