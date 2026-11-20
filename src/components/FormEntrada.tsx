"use client";
import { useActionState, useMemo, useState } from "react";
import { darEntrada } from "@/app/acoes/gestao";
import { InputImagem } from "@/components/InputImagem";
import { type Config, type Estado, ESTADOS, ESTADO_ROTULO, brl, calcularTeto, minimoMaximo, paraCentavos } from "@/lib/rules";

const ANGULOS = ["Frente", "Verso", "Lateral", "Detalhe / etiqueta", "Defeito"];
const DEFEITOS: [string, string][] = [["risco", "Risco"], ["mancha", "Mancha"], ["falta_peca", "Falta peça"], ["desgaste", "Desgaste"], ["trinca", "Trinca"], ["furo", "Furo"]];

/** Avaliação presencial: fotos padronizadas pela câmera, estado, defeito, checklist e preço dentro do teto. */
export function FormEntrada({ cfg, item, checklist }: {
  cfg: Config;
  checklist: string[];
  item: { id: string; categoria: string; estado: Estado; precoNovo: number; precoInicial: number; precoMinimo: number; defeitos: string[]; defeitoObs: string | null };
}) {
  const [estadoForm, acao, enviando] = useActionState(darEntrada, undefined);
  const [estado, setEstado] = useState<Estado>(item.estado);
  const [inicial, setInicial] = useState((item.precoInicial / 100).toFixed(2).replace(".", ","));
  const [minimo, setMinimo] = useState((item.precoMinimo / 100).toFixed(2).replace(".", ","));
  const [fotos, setFotos] = useState<(string | null)[]>(ANGULOS.map(() => null));
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const teto = useMemo(() => calcularTeto(cfg, item.categoria, estado, item.precoNovo), [cfg, item, estado]);
  const pIni = paraCentavos(inicial) || 0;
  const pMin = paraCentavos(minimo) || 0;
  const erroIni = pIni > teto ? `Acima do teto (${brl(teto)})` : pIni < cfg.valor_minimo_item_centavos ? `Mínimo ${brl(cfg.valor_minimo_item_centavos)}` : null;
  const erroMin = pMin > minimoMaximo(cfg, pIni) ? `Máx. ${brl(minimoMaximo(cfg, pIni))}` : null;
  const qtdFotos = fotos.filter(Boolean).length;
  const ok = !erroIni && !erroMin && qtdFotos >= 3 && checklist.every((c) => marcados.has(c));

  return (
    <form action={acao} className="pilha">
      <input type="hidden" name="itemId" value={item.id} />

      <section className="cartao pilha">
        <h2>Fotos padronizadas ({qtdFotos}/3+)</h2>
        <p className="mudo pequeno">Fundo neutro, item centralizado, boa luz. Toque em cada ângulo para abrir a câmera.</p>
        <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
          {ANGULOS.map((a, i) => (
            <label key={a} className="cartao areia centro" style={{ padding: 8, cursor: "pointer" }}>
              {fotos[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fotos[i]!} alt={a} style={{ aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
              ) : (
                <span style={{ fontSize: 28, display: "block", padding: "14px 0" }}>📷</span>
              )}
              <span className="pequeno">{a}</span>
              <InputImagem
                name="fotos" accept="image/*" capture="environment" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFotos((atual) => atual.map((x, j) => (j === i ? (f ? URL.createObjectURL(f) : null) : x)));
                }}
              />
              <input type="hidden" name="angulos" value={a} />
            </label>
          ))}
        </div>
      </section>

      <section className="cartao pilha">
        <h2>Estado confirmado</h2>
        <div className="chips">
          {ESTADOS.map((e) => (
            <label key={e} className="chip"><input type="radio" name="estado" value={e} checked={estado === e} onChange={() => setEstado(e)} />{ESTADO_ROTULO[e]}</label>
          ))}
        </div>
        {estado !== item.estado && <p className="alerta pequeno">O dono informou “{ESTADO_ROTULO[item.estado]}”. O teto foi recalculado.</p>}
      </section>

      <section className="cartao pilha">
        <h2>Defeitos</h2>
        <div className="chips">
          {DEFEITOS.map(([v, r]) => (
            <label key={v} className="chip"><input type="checkbox" name="defeitos" value={v} defaultChecked={item.defeitos.includes(v)} />{r}</label>
          ))}
        </div>
        <label>Observação do defeito<textarea name="defeitoObs" rows={2} defaultValue={item.defeitoObs ?? ""} /></label>
        <div className="chips">
          <label className="chip"><input type="checkbox" name="selos" value="conferido" defaultChecked />✓ Conferido</label>
          <label className="chip"><input type="checkbox" name="selos" value="testado" />✓ Testado</label>
        </div>
        <label>Número de série (se houver)<input name="numeroSerie" /></label>
      </section>

      <section className="cartao pilha">
        <h2>Checklist obrigatório</h2>
        {checklist.map((c) => (
          <label key={c} className="check">
            <input
              type="checkbox" name="checklist" value={c}
              onChange={(e) => setMarcados((s) => { const n = new Set(s); if (e.target.checked) n.add(c); else n.delete(c); return n; })}
            />
            {c}
          </label>
        ))}
      </section>

      <section className="cartao pilha">
        <h2>Preço</h2>
        <p>Teto: <strong>{brl(teto)}</strong></p>
        <div className="grade-2">
          <label>Preço inicial<input name="precoInicial" inputMode="decimal" value={inicial} onChange={(e) => setInicial(e.target.value)} /></label>
          <label>Mínimo<input name="precoMinimo" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} /></label>
        </div>
        {erroIni && <p className="erro">{erroIni}</p>}
        {erroMin && <p className="erro">{erroMin}</p>}
      </section>

      {estadoForm?.erro && <p className="erro" role="alert">{estadoForm.erro}</p>}
      <button className="botao bloco verde" type="submit" disabled={!ok || enviando}>
        {enviando ? "Salvando…" : "Aprovar, pôr na vitrine e imprimir etiqueta"}
      </button>
    </form>
  );
}
