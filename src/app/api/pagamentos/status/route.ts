import { obterSessao } from "@/lib/sessao";
import { comoUsuario, uma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A tela do Pix consulta aqui a cada poucos segundos (RLS: só o pagador ou a equipe veem). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("id obrigatório", { status: 400 });
  const { ctx } = await obterSessao();
  if (!ctx.perfilId) return new Response("login necessário", { status: 401 });
  const pag = await comoUsuario(ctx, (db) =>
    uma<{ status: string }>(db, "select status from pagamentos where id = $1", [id]),
  );
  if (!pag) return new Response("não encontrado", { status: 404 });
  return Response.json({ status: pag.status });
}
