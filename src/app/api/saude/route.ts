import { comoServico, comoUsuario, uma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Verificação de saúde: diz se as variáveis existem e se o banco responde (sem expor valores). */
export async function GET() {
  const env = Object.fromEntries(
    ["DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "CRON_SECRET", "PAYMENT_GATEWAY", "MODO_TESTE"].map((k) => [k, !!process.env[k]]),
  );
  const res: Record<string, unknown> = { env, versao: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null };
  try {
    res.banco = await comoServico((db) => uma<{ itens: number }>(db, "select count(*)::int itens from itens"));
  } catch (e) {
    res.banco = { erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  try {
    res.rls = await comoUsuario({ perfilId: null, papel: "anon" }, (db) => uma<{ vitrine: number }>(db, "select count(*)::int vitrine from itens"));
  } catch (e) {
    res.rls = { erro: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
