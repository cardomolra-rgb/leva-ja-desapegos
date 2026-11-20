import { type Config, type Estado, ESTADOS } from "./config";
import { arredondar, brl } from "./dinheiro";


/** Teto (preço máximo de venda) = preço do novo × % da categoria/estado, arredondado para baixo. */
export function calcularTeto(cfg: Config, categoria: string, estado: Estado, precoNovo: number): number {
  const tabela = cfg.regua[categoria];
  if (!tabela) throw new Error(`Categoria sem régua configurada: ${categoria}`);
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  if (!(precoNovo > 0)) return 0;
  return arredondar(precoNovo * tabela[estado], cfg.regua_arredondamento_centavos, "baixo");
}

/** Maior mínimo permitido para um preço inicial (ex.: 70% do inicial). */
export function minimoMaximo(cfg: Config, precoInicial: number): number {
  return Math.floor(precoInicial * cfg.minimo_max_pct + 1e-9);
}

export interface PropostaPreco {
  categoria: string;
  estado: Estado;
  precoNovo: number;
  precoPedido: number;
  precoMinimo: number;
}

export interface ResultadoValidacao {
  ok: boolean;
  teto: number;
  minimoMaximo: number;
  erros: { campo: keyof PropostaPreco; mensagem: string }[];
}

/** Valida o formulário "Quero vender" e a avaliação na loja. */
export function validarProposta(cfg: Config, p: PropostaPreco): ResultadoValidacao {
  const erros: ResultadoValidacao["erros"] = [];
  const teto = p.precoNovo > 0 ? calcularTeto(cfg, p.categoria, p.estado, p.precoNovo) : 0;
  const minMax = minimoMaximo(cfg, p.precoPedido);
  const piso = cfg.valor_minimo_item_centavos;

  if (!(p.precoNovo > 0)) erros.push({ campo: "precoNovo", mensagem: "Informe o preço do item novo." });
  if (p.precoPedido > teto)
    erros.push({ campo: "precoPedido", mensagem: `O preço pedido passa do teto de ${brl(teto)}.` });
  if (p.precoPedido < piso)
    erros.push({
      campo: "precoPedido",
      mensagem: `Itens abaixo de ${brl(piso)} só entram em lote.`,
    });
  if (p.precoMinimo > minMax)
    erros.push({
      campo: "precoMinimo",
      mensagem: `O mínimo pode ser no máximo ${brl(minMax)} (${Math.round(cfg.minimo_max_pct * 100)}% do pedido).`,
    });
  if (p.precoMinimo < piso)
    erros.push({ campo: "precoMinimo", mensagem: `O mínimo não pode ser menor que ${brl(piso)}.` });
  if (p.precoMinimo <= 0) erros.push({ campo: "precoMinimo", mensagem: "Informe o preço mínimo." });

  return { ok: erros.length === 0, teto, minimoMaximo: minMax, erros };
}
