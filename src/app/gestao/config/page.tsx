import { exigirEquipe } from "@/lib/sessao";
import { comoUsuario, varias } from "@/lib/db";
import { lerConfig } from "@/lib/config-loja";
import { ESTADOS, ESTADO_ROTULO } from "@/lib/rules";
import { brl, data } from "@/lib/formato";
import { FormSimples } from "@/components/FormSimples";
import { salvarConfiguracoes } from "@/app/acoes/gestao";

export const metadata = { title: "Regras e configurações" };

const p = (n: number) => String(Math.round(n * 10000) / 100).replace(".", ",");
const r = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default async function Configuracoes() {
  const { ctx } = await exigirEquipe(true); // atendente não acessa
  const cfg = await lerConfig();
  const { cats, historico } = await comoUsuario(ctx, async (db) => ({
    cats: await varias<{ id: number; slug: string; nome: string; ativa: boolean; limite_itens: number }>(db, "select id, slug, nome, ativa, limite_itens from categorias order by ordem"),
    historico: await varias<{ id: number; criado_em: Date; motivo: string | null; nome: string | null }>(
      db, "select c.id, c.criado_em, c.motivo, p.nome from configuracoes c left join perfis p on p.id = c.criado_por order by c.id desc limit 10",
    ),
  }));
  const nomeCat = Object.fromEntries(cats.map((c) => [c.slug, c.nome]));

  return (
    <div className="pilha">
      <h1>Regras da loja</h1>
      <p className="mudo">Tudo aqui é configurável. Cada alteração cria uma nova versão (histórico abaixo) e vale para novos cálculos.</p>
      <FormSimples acao={salvarConfiguracoes} botao="Salvar nova versão das regras">
        <section className="cartao pilha">
          <h2>Categorias</h2>
          <div className="rolagem"><table className="tabela">
            <thead><tr><th>Categoria</th><th>Ativa</th><th>Limite de itens</th></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.id}>
                <td>{c.nome}</td>
                <td><input type="checkbox" name={`cat_ativa_${c.id}`} defaultChecked={c.ativa} aria-label={`${c.nome} ativa`} /></td>
                <td><input name={`cat_limite_${c.id}`} inputMode="numeric" defaultValue={c.limite_itens} style={{ maxWidth: 100 }} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>

        <section className="cartao pilha">
          <h2>Régua de teto (% do preço do novo)</h2>
          <div className="rolagem"><table className="tabela">
            <thead><tr><th>Categoria</th>{ESTADOS.map((e) => <th key={e}>{ESTADO_ROTULO[e]}</th>)}</tr></thead>
            <tbody>{Object.entries(cfg.regua).map(([slug, v]) => (
              <tr key={slug}>
                <td>{nomeCat[slug] ?? slug}</td>
                {ESTADOS.map((e) => (
                  <td key={e}><input name={`regua_${slug}_${e}`} inputMode="decimal" defaultValue={p(v[e])} style={{ maxWidth: 70 }} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table></div>
          <label>Mínimo pode ser no máximo (% do inicial)<input name="minimo_max_pct" inputMode="decimal" defaultValue={p(cfg.minimo_max_pct)} /></label>
          <label>Valor mínimo por item (R$)<input name="valor_minimo" inputMode="decimal" defaultValue={r(cfg.valor_minimo_item_centavos)} /></label>
        </section>

        <section className="cartao pilha">
          <h2>Queda automática</h2>
          <div className="grade-2">
            <label>A cada (dias)<input name="intervalo_dias" inputMode="numeric" defaultValue={cfg.queda.intervalo_dias} /></label>
            <label>Cai (% do inicial)<input name="queda_pct" inputMode="decimal" defaultValue={p(cfg.queda.pct_do_inicial)} /></label>
          </div>
          <label>Arredondar de (R$)<input name="arredondamento" inputMode="decimal" defaultValue={r(cfg.queda.arredondamento_centavos)} /></label>
        </section>

        <section className="cartao pilha">
          <h2>Comissão</h2>
          <div className="grade-2">
            <label>Loja fica com (%)<input name="loja_pct" inputMode="decimal" defaultValue={p(cfg.comissao.loja_pct)} /></label>
            <label>Dono em crédito (%)<input name="dono_credito_pct" inputMode="decimal" defaultValue={p(cfg.comissao.dono_credito_pct)} /></label>
          </div>
          <p className="mudo pequeno">Dono em Pix = 100% − comissão da loja ({p(cfg.comissao.dono_pix_pct)}% hoje).</p>
          <label className="check"><input type="checkbox" name="faixa_ativa" defaultChecked={cfg.comissao.por_faixa.ativo} /> Ligar comissão por faixa de preço</label>
          <p className="mudo pequeno">
            Faixas: {cfg.comissao.por_faixa.faixas.map((f) => `${f.ate_centavos ? `até ${brl(f.ate_centavos)}` : "acima"} → loja ${p(f.loja_pct)}%`).join(" · ")} (crédito +{p(cfg.comissao.por_faixa.bonus_credito_pct)}%)
          </p>
        </section>

        <section className="cartao pilha">
          <h2>Reserva</h2>
          <div className="grade-2">
            <label>Sinal (%)<input name="sinal_pct" inputMode="decimal" defaultValue={p(cfg.reserva.sinal_pct)} /></label>
            <label>Sinal acima do limite (%)<input name="sinal_pct_alto" inputMode="decimal" defaultValue={p(cfg.reserva.sinal_pct_alto)} /></label>
            <label>Limite (R$)<input name="limite_alto" inputMode="decimal" defaultValue={r(cfg.reserva.limite_alto_centavos)} /></label>
            <label>Prazo de retirada (h)<input name="prazo_retirada_horas" inputMode="numeric" defaultValue={cfg.reserva.prazo_retirada_horas} /></label>
          </div>
        </section>

        <section className="cartao pilha">
          <h2>Prazos e repasse</h2>
          <div className="grade-2">
            <label>Prazo de troca (dias)<input name="prazo_troca_dias" inputMode="numeric" defaultValue={cfg.repasse.prazo_troca_dias} /></label>
            <label>Dia do lote
              <select name="dia_semana_lote" defaultValue={cfg.repasse.dia_semana_lote}>{DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </label>
            <label>Dias no mínimo até vencer<input name="dias_no_minimo" inputMode="numeric" defaultValue={cfg.prazo_final.dias_no_minimo} /></label>
            <label>Dias de aviso até doação<input name="dias_aviso" inputMode="numeric" defaultValue={cfg.prazo_final.dias_aviso} /></label>
          </div>
        </section>

        <label>Motivo da alteração<input name="motivo" placeholder="ex.: ajuste de régua de Moda" /></label>
      </FormSimples>

      <section className="cartao pilha">
        <h2>Histórico de versões</h2>
        {historico.map((h) => (
          <div key={h.id} className="linha entre pequeno"><span>v{h.id} — {h.motivo ?? ""}</span><span className="mudo">{h.nome ?? "sistema"} · {data(h.criado_em, true)}</span></div>
        ))}
      </section>
    </div>
  );
}
