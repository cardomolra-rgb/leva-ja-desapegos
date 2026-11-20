import "server-only";
import { Pool, neonConfig, types, type PoolClient } from "@neondatabase/serverless";

// bigint (centavos) e numeric (percentuais) chegam como número, não string
types.setTypeParser(20, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v));

/**
 * Acesso ao Neon. Duas portas de entrada:
 *  - comoUsuario(): transação com RLS ligado (perfil + papel do usuário logado).
 *  - comoServico(): sem RLS — só para cron, webhook de pagamento e ações já autorizadas no servidor.
 * As credenciais ficam só no servidor (variáveis de ambiente da Vercel).
 */

if (typeof WebSocket === "undefined") {
  // Node < 22 (dev local antigo)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neonConfig.webSocketConstructor = require("ws");
}

// Desenvolvimento local sem Neon (Postgres local atrás de um proxy WebSocket). Nunca use em produção.
if (process.env.NEON_WS_PROXY_LOCAL && process.env.VERCEL_ENV !== "production") {
  neonConfig.wsProxy = () => process.env.NEON_WS_PROXY_LOCAL!;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}

export type Papel ="anon" | "cliente" | "atendente" | "gestor";
export interface Contexto {
  perfilId: string | null;
  papel: Papel;
}
export type Db = PoolClient;

function novoPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  return new Pool({ connectionString: url });
}

async function emTransacao<T>(prep: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  // Em ambiente serverless o Pool é criado e encerrado por requisição (recomendação do Neon)
  const pool = novoPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await prep(client);
    const r = await fn(client);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

export function comoUsuario<T>(ctx: Contexto, fn: (db: Db) => Promise<T>): Promise<T> {
  return emTransacao(async (c) => {
    await c.query("select set_config('app.perfil_id', $1, true), set_config('app.papel', $2, true)", [
      ctx.perfilId ?? "",
      ctx.papel,
    ]);
    await c.query("set local role app_rls");
  }, fn);
}

export function comoServico<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return emTransacao(async () => {}, fn);
}

/** Atalho: primeira linha ou null. */
export async function uma<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params);
  return (r.rows[0] as T) ?? null;
}

export async function varias<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params);
  return r.rows as T[];
}
