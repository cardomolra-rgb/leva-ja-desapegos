import "server-only";
import { comoUsuario, varias, uma, type Contexto, type Db } from "@/lib/db";
import { urlAssinada } from "@/lib/storage";
import type { Estado } from "@/lib/rules";

export interface Categoria {
  id: number;
  slug: string;
  nome: string;
  prefixo: string;
  ativa: boolean;
  limite_itens: number;
  checklist: string[];
}

export interface ItemVitrine {
  id: string;
  codigo: string;
  titulo: string;
  descricao: string | null;
  marca: string | null;
  medidas: string | null;
  estado: Estado;
  estado_confirmado: Estado | null;
  categoria_slug: string;
  categoria_nome: string;
  preco_inicial: number;
  preco_minimo: number;
  preco_atual: number;
  etapa_queda: number;
  entrada_vitrine_em: Date;
  tem_defeito: boolean;
  defeitos: string[];
  defeito_obs: string | null;
  selos: string[];
  status: string;
  dono_id: string;
  foto: string | null;
}

export async function categorias(db: Db, somenteAtivas = true) {
  return varias<Categoria>(db, `select * from categorias ${somenteAtivas ? "where ativa" : ""} order by ordem`);
}

export async function assinarFotos<T extends { foto: string | null }>(itens: T[]): Promise<T[]> {
  return Promise.all(itens.map(async (i) => ({ ...i, foto: i.foto ? await urlAssinada(i.foto) : null })));
}

export interface FiltrosCatalogo {
  categoria?: string;
  busca?: string;
  ordem?: "recentes" | "menor" | "maior" | "baixando";
  precoMax?: number;
  semDefeito?: boolean;
  estado?: Estado;
}

const SELECT_ITEM = `
  select i.id, i.codigo, i.titulo, i.descricao, i.marca, i.medidas, i.estado, i.estado_confirmado,
         c.slug categoria_slug, c.nome categoria_nome, i.preco_inicial, i.preco_minimo, i.preco_atual, i.etapa_queda,
         i.entrada_vitrine_em, i.tem_defeito, i.defeitos, i.defeito_obs, i.selos, i.status, i.dono_id,
         (select f.path from item_fotos f where f.item_id = i.id order by (f.origem = 'loja') desc, f.ordem limit 1) foto
  from itens i join categorias c on c.id = i.categoria_id`;

export async function listarVitrine(ctx: Contexto, f: FiltrosCatalogo, limite = 60) {
  return comoUsuario(ctx, async (db) => {
    const cond = ["i.status in ('vitrine','reservado')"];
    const p: unknown[] = [];
    if (f.categoria) { p.push(f.categoria); cond.push(`c.slug = $${p.length}`); }
    if (f.busca) {
      p.push(f.busca);
      cond.push(`(to_tsvector('portuguese', i.titulo || ' ' || coalesce(i.descricao,'') || ' ' || coalesce(i.marca,'')) @@ plainto_tsquery('portuguese', $${p.length}) or i.titulo ilike '%' || $${p.length} || '%' or i.codigo ilike $${p.length})`);
    }
    if (f.precoMax) { p.push(f.precoMax); cond.push(`i.preco_atual <= $${p.length}`); }
    if (f.semDefeito) cond.push("not i.tem_defeito");
    if (f.estado) { p.push(f.estado); cond.push(`coalesce(i.estado_confirmado, i.estado) = $${p.length}`); }
    const ordem = {
      recentes: "i.entrada_vitrine_em desc",
      menor: "i.preco_atual asc",
      maior: "i.preco_atual desc",
      baixando: "(i.preco_atual::float / i.preco_inicial) asc, i.entrada_vitrine_em asc",
    }[f.ordem ?? "recentes"];
    p.push(limite);
    const itens = await varias<ItemVitrine>(
      db,
      `${SELECT_ITEM} where ${cond.join(" and ")} order by (i.status = 'reservado'), ${ordem} limit $${p.length}`,
      p,
    );
    return assinarFotos(itens);
  });
}

export async function obterItem(ctx: Contexto, id: string) {
  return comoUsuario(ctx, async (db) => {
    const item = await uma<ItemVitrine>(db, `${SELECT_ITEM} where i.id = $1`, [id]);
    if (!item) return null;
    const fotos = await varias<{ path: string; angulo: string | null }>(
      db, "select path, angulo from item_fotos where item_id = $1 order by (origem = 'loja') desc, ordem", [id],
    );
    const favorito = ctx.perfilId
      ? !!(await uma(db, "select 1 from favoritos where perfil_id = $1 and item_id = $2", [ctx.perfilId, id]))
      : false;
    return {
      item,
      fotos: await Promise.all(fotos.map(async (f) => ({ url: await urlAssinada(f.path), angulo: f.angulo }))),
      favorito,
    };
  });
}

export function uuidValido(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
