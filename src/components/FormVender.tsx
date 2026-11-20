"use client";
import { useActionState, useMemo, useState } from "react";
import { enviarPreAvaliacao } from "@/app/acoes/vender";
import { InputImagem } from "@/components/InputImagem";
import { type Config, type Estado, ESTADOS, ESTADO_ROTULO } from "@/lib/rules/config";
import { brl, paraCentavos } from "@/lib/rules/dinheiro";
import { validarProposta } from "@/lib/rules/regua";
import { simularRecebimento } from "@/lib/rules/comissao";

const ATALHOS: [string, string][] = [
  ["risco", "Risco"], ["mancha", "Mancha"], ["falta_peca", "Falta peça"], ["desgaste", "Desgaste"], ["trinca", "Trinca"], ["furo", "Furo"],
];

export function FormVender({ cfg, categorias }: { cfg: Config; categorias: { slug: string; nome: string; cheia: boolean }[] }) {
  const [estadoForm, acao, enviando] = useActionState(enviarPreAvaliacao, undefined);
  const [categoria, setCategoria] = useState(categorias.find((c) => !c.cheia)?.slug ?? "");
  const [estado, setEstado] = useState<Estado>("usado_bom");
  const [novo, setNovo] = useState("");
  const [pedido, setPedido] = useState("");
  const [minimo, setMinimo] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);

  const v = useMemo(() => {
    const precoNovo = paraCentavos(novo) || 0;
    const precoPedido = paraCentavos(pedido) || 0;
    const precoMinimo = paraCentavos(minimo) || 0;
    if (!categoria || !cfg.regua[categoria]) return null;
    const r = validarProposta(cfg, { categoria, estado, precoNovo, precoPedido, precoMinimo });
    const erro = (c: string) => r.erros.find((e) => e.campo === c)?.mensagem;
    return { ...r, precoPedido, precoMinimo, erro, sim: simularRecebimento(cfg, precoPedido, precoMinimo) };
  }, [cfg, categoria, estado, novo, pedido, minimo]);

  const pronto = v?.ok && fotos.length >= 2;

  return (
    <form action={acao} className="pilha">
      <section className="cartao pilha">
        <h2>1. Fotos</h2>
        <p className="mudo pequeno">Frente, verso e detalhes. Se tiver defeito, fotografe o defeito. Mínimo 2, máximo 8.</p>
        <InputImagem
          name="fotos" accept="image/*" capture="environment" multiple required
          onChange={(e) => setFotos(Array.from(e.target.files ?? []).map((f) => URL.createObjectURL(f)))}
        />
        {fotos.length > 0 && (
          <div className="linha">
            {fotos.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u} src={u} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao pilha">
        <h2>2. O item</h2>
        <label>Nome do item<input name="titulo" required maxLength={120} placeholder="Ex.: Panela de pressão 4,5 L" /></label>
        <label>Categoria
          <select name="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} required>
            {categorias.map((c) => (
              <option key={c.slug} value={c.slug} disabled={c.cheia}>{c.nome}{c.cheia ? " (cheia no momento)" : ""}</option>
            ))}
          </select>
        </label>
        <fieldset className="pilha" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend><strong>Estado</strong></legend>
          <div className="chips">
            {ESTADOS.map((e) => (
              <label key={e} className="chip">
                <input type="radio" name="estado" value={e} checked={estado === e} onChange={() => setEstado(e)} />
                {ESTADO_ROTULO[e]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grade-2">
          <label>Marca (opcional)<input name="marca" maxLength={60} /></label>
          <label>Medidas (opcional)<input name="medidas" maxLength={80} placeholder="ex.: 40×30 cm, tam. M" /></label>
        </div>
        <label>Descrição (opcional)<textarea name="descricao" rows={3} maxLength={2000} /></label>
      </section>

      <section className="cartao pilha">
        <h2>3. Defeitos</h2>
        <p className="mudo pequeno">Seja sincero: defeito descrito vende e não volta.</p>
        <div className="chips">
          {ATALHOS.map(([v, r]) => (
            <label key={v} className="chip"><input type="checkbox" name="defeitos" value={v} />{r}</label>
          ))}
        </div>
        <label>Detalhe do defeito<textarea name="defeitoObs" rows={2} maxLength={600} placeholder="Onde fica, tamanho, se afeta o uso…" /></label>
      </section>

      <section className="cartao pilha">
        <h2>4. Preço</h2>
        <label>Quanto custa novo? (R$)
          <input name="precoNovo" inputMode="decimal" required value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="ex.: 299,90" />
        </label>
        {v && v.teto > 0 && (
          <p className="cartao areia">Teto para este item: <strong>{brl(v.teto)}</strong> ({Math.round(cfg.regua[categoria][estado] * 100)}% do novo)</p>
        )}
        <label>Preço pedido (R$)
          <input name="precoPedido" inputMode="decimal" required value={pedido} onChange={(e) => setPedido(e.target.value)} aria-invalid={!!(pedido && v?.erro("precoPedido"))} />
        </label>
        {pedido && v?.erro("precoPedido") && <p className="erro">{v.erro("precoPedido")}</p>}
        <label>Mínimo que aceita (R$)
          <input name="precoMinimo" inputMode="decimal" required value={minimo} onChange={(e) => setMinimo(e.target.value)} aria-invalid={!!(minimo && v?.erro("precoMinimo"))} />
        </label>
        {v && v.precoPedido > 0 && <p className="mudo pequeno">O mínimo pode ser até {brl(v.minimoMaximo)} ({Math.round(cfg.minimo_max_pct * 100)}% do pedido).</p>}
        {minimo && v?.erro("precoMinimo") && <p className="erro">{v.erro("precoMinimo")}</p>}
        <p className="mudo pequeno">
          O preço cai {Math.round(cfg.queda.pct_do_inicial * 100)}% a cada {cfg.queda.intervalo_dias} dias sem vender, até o mínimo.
        </p>
      </section>

      <section className="cartao pilha">
        <h2>5. Como quer receber</h2>
        {v && v.precoPedido > 0 && v.precoMinimo > 0 ? (
          <div className="grade-2">
            <label className="cartao areia check">
              <input type="radio" name="modalidade" value="pix" defaultChecked />
              <span><strong>Pix — {Math.round(cfg.comissao.dono_pix_pct * 100)}%</strong><br />
                {brl(v.sim.pix.noPedido)} no pedido<br /><span className="mudo pequeno">{brl(v.sim.pix.noMinimo)} no mínimo</span></span>
            </label>
            <label className="cartao areia check">
              <input type="radio" name="modalidade" value="credito" />
              <span><strong>Crédito na loja — {Math.round(cfg.comissao.dono_credito_pct * 100)}%</strong><br />
                {brl(v.sim.credito.noPedido)} no pedido<br /><span className="mudo pequeno">{brl(v.sim.credito.noMinimo)} no mínimo</span></span>
            </label>
          </div>
        ) : (
          <p className="mudo">Preencha os preços para ver a simulação.</p>
        )}
        <p className="mudo pequeno">Pix só na chave do seu CPF. Repasse liberado após {cfg.repasse.prazo_troca_dias} dias da venda (prazo de troca), no lote semanal.</p>
      </section>

      <section className="cartao pilha">
        <h2>6. Entrega na loja</h2>
        <label>Quando você pode levar? (opcional)<input type="datetime-local" name="entrega" /></label>
        <label className="check">
          <input type="checkbox" name="termo" required />
          <span>Li e aceito o <a href="/termos/consignacao" target="_blank">contrato de consignação</a>: o preço cai sozinho até o mínimo; vencido o prazo no mínimo, tenho {cfg.prazo_final.dias_aviso} dias para retirar antes da doação.</span>
        </label>
      </section>

      {estadoForm?.erro && <p className="erro" role="alert">{estadoForm.erro}</p>}
      <button className="botao bloco" type="submit" disabled={!pronto || enviando}>
        {enviando ? "Enviando…" : "Enviar para pré-avaliação"}
      </button>
    </form>
  );
}
