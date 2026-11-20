/**
 * Regras de negócio configuráveis.
 *
 * NADA aqui é fixo em produção: os valores reais ficam na tabela `configuracoes`
 * (uma linha ativa, versionada) e são editados no painel do Gestor.
 * `CONFIG_PADRAO` só é usado para semear o banco e nos testes.
 *
 * Dinheiro sempre em CENTAVOS (inteiros). Percentuais como fração (0.4 = 40%).
 */

export const ESTADOS = ["novo", "seminovo", "usado_bom", "com_marcas"] as const;
export type Estado = (typeof ESTADOS)[number];

export const ESTADO_ROTULO: Record<Estado, string> = {
  novo: "Novo",
  seminovo: "Seminovo",
  usado_bom: "Usado bom",
  com_marcas: "Com marcas",
};

export type Arredondamento = "baixo" | "proximo" | "cima";

export interface FaixaComissao {
  /** limite superior da faixa em centavos (inclusive); null = sem limite */
  ate_centavos: number | null;
  /** fração que fica com a loja nessa faixa */
  loja_pct: number;
}

export interface Config {
  /** % do preço do novo por categoria (slug) e estado */
  regua: Record<string, Record<Estado, number>>;
  /** passo de arredondamento do teto (centavos) */
  regua_arredondamento_centavos: number;
  /** o mínimo pode ser no máximo esta fração do preço inicial */
  minimo_max_pct: number;
  queda: {
    intervalo_dias: number;
    /** quanto cai a cada intervalo, como fração do preço INICIAL */
    pct_do_inicial: number;
    arredondamento_centavos: number;
    arredondamento: Arredondamento;
  };
  comissao: {
    loja_pct: number;
    dono_pix_pct: number;
    dono_credito_pct: number;
    por_faixa: {
      ativo: boolean;
      faixas: FaixaComissao[];
      /** bônus somado ao % do dono quando ele escolhe crédito na loja */
      bonus_credito_pct: number;
    };
  };
  valor_minimo_item_centavos: number;
  reserva: {
    sinal_pct: number;
    sinal_pct_alto: number;
    /** acima deste preço (estritamente) usa sinal_pct_alto */
    limite_alto_centavos: number;
    prazo_retirada_horas: number;
  };
  repasse: {
    prazo_troca_dias: number;
    /** 0 = domingo ... 2 = terça */
    dia_semana_lote: number;
    exige_recebimento_cartao: boolean;
  };
  prazo_final: {
    /** dias parado no preço mínimo até o prazo vencer */
    dias_no_minimo: number;
    /** dias extras após o aviso ao dono antes da doação */
    dias_aviso: number;
  };
  pix_expira_minutos: number;
}

const r = (novo: number, seminovo: number, usado_bom: number, com_marcas: number) => ({
  novo,
  seminovo,
  usado_bom,
  com_marcas,
});

export const CONFIG_PADRAO: Config = {
  regua: {
    moda: r(0.5, 0.4, 0.3, 0.15),
    "casa-decoracao": r(0.6, 0.5, 0.4, 0.25),
    utensilios: r(0.6, 0.5, 0.4, 0.25),
    "ferramentas-manuais": r(0.65, 0.55, 0.45, 0.3),
    "sobras-material": r(0.7, 0.6, 0.5, 0.35),
    eletronicos: r(0.6, 0.5, 0.35, 0.2),
    "ferramentas-eletricas": r(0.6, 0.5, 0.4, 0.25),
  },
  regua_arredondamento_centavos: 500,
  minimo_max_pct: 0.7,
  queda: {
    intervalo_dias: 14,
    pct_do_inicial: 0.1,
    arredondamento_centavos: 500,
    arredondamento: "baixo",
  },
  comissao: {
    loja_pct: 0.4,
    dono_pix_pct: 0.6,
    dono_credito_pct: 0.7,
    por_faixa: {
      ativo: false,
      faixas: [
        { ate_centavos: 10000, loja_pct: 0.45 },
        { ate_centavos: 50000, loja_pct: 0.4 },
        { ate_centavos: null, loja_pct: 0.3 },
      ],
      bonus_credito_pct: 0.1,
    },
  },
  valor_minimo_item_centavos: 2500,
  reserva: {
    sinal_pct: 0.1,
    sinal_pct_alto: 0.15,
    limite_alto_centavos: 30000,
    prazo_retirada_horas: 48,
  },
  repasse: {
    prazo_troca_dias: 7,
    dia_semana_lote: 2,
    exige_recebimento_cartao: true,
  },
  prazo_final: {
    dias_no_minimo: 14,
    dias_aviso: 7,
  },
  pix_expira_minutos: 30,
};

/** Validação mínima para não salvar configuração incoerente pelo painel. */
export function validarConfig(c: Config): string[] {
  const erros: string[] = [];
  const pct = (v: number, nome: string) => {
    if (!(v >= 0 && v <= 1)) erros.push(`${nome} deve estar entre 0% e 100%`);
  };
  for (const [cat, estados] of Object.entries(c.regua)) {
    for (const e of ESTADOS) pct(estados[e], `Régua ${cat}/${e}`);
  }
  pct(c.minimo_max_pct, "Mínimo máximo");
  pct(c.queda.pct_do_inicial, "Queda");
  pct(c.comissao.loja_pct, "Comissão da loja");
  pct(c.comissao.dono_pix_pct, "Repasse Pix");
  pct(c.comissao.dono_credito_pct, "Repasse em crédito");
  if (Math.abs(c.comissao.loja_pct + c.comissao.dono_pix_pct - 1) > 1e-9)
    erros.push("Comissão da loja + repasse Pix deve somar 100%");
  if (c.comissao.dono_credito_pct < c.comissao.dono_pix_pct)
    erros.push("Repasse em crédito não pode ser menor que o repasse em Pix");
  if (c.queda.intervalo_dias < 1) erros.push("Intervalo de queda deve ser de pelo menos 1 dia");
  if (c.queda.arredondamento_centavos < 1) erros.push("Arredondamento da queda inválido");
  if (c.reserva.prazo_retirada_horas < 1) erros.push("Prazo de retirada inválido");
  if (c.repasse.dia_semana_lote < 0 || c.repasse.dia_semana_lote > 6)
    erros.push("Dia do lote deve ser de 0 (domingo) a 6 (sábado)");
  const faixas = c.comissao.por_faixa.faixas;
  faixas.forEach((f, i) => pct(f.loja_pct, `Faixa ${i + 1}`));
  if (faixas.length && faixas[faixas.length - 1].ate_centavos !== null)
    erros.push("A última faixa de comissão deve ser sem limite");
  return erros;
}
