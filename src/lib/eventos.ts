import "server-only";
import type { Db } from "@/lib/db";

export type TipoEvento =
  | "cadastro" | "entrada" | "pre_avaliacao" | "aprovacao" | "contraproposta" | "recusa" | "vitrine" | "queda"
  | "visualizacao" | "favorito" | "desfavorito" | "busca_sem_resultado" | "busca"
  | "reserva" | "pagamento" | "retirada" | "desistencia" | "reserva_expirada" | "venda"
  | "repasse" | "devolucao" | "estorno" | "doacao" | "vencimento" | "aviso_dono" | "aceite_termo"
  | "config_alterada" | "etiqueta_impressa" | "login";

/** Toda ação vira um evento com data/hora, usuário e item. Os relatórios saem daqui. */
export async function registrarEvento(
  db: Db,
  tipo: TipoEvento,
  e: { perfilId?: string | null; itemId?: string | null; dados?: Record<string, unknown>; ip?: string | null } = {},
) {
  await db.query("insert into eventos (tipo, perfil_id, item_id, dados, ip) values ($1, $2, $3, $4, $5)", [
    tipo,
    e.perfilId ?? null,
    e.itemId ?? null,
    JSON.stringify(e.dados ?? {}),
    e.ip ?? null,
  ]);
}

/** Aviso na caixa do app (registro oficial) + envio por WhatsApp quando o usuário permite. */
export async function avisar(
  db: Db,
  perfilId: string,
  a: { tipo: string; titulo: string; corpo: string; itemId?: string | null; link?: string | null },
) {
  await db.query("insert into avisos (perfil_id, tipo, titulo, corpo, item_id, link) values ($1,$2,$3,$4,$5,$6)", [
    perfilId,
    a.tipo,
    a.titulo,
    a.corpo,
    a.itemId ?? null,
    a.link ?? null,
  ]);
}
