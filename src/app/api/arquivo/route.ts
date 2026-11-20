import { comoServico, uma } from "@/lib/db";
import { assinaturaValida } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Entrega arquivos guardados no banco (ambiente de testes sem S3), só com URL assinada e dentro da validade. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const chave = u.searchParams.get("k") ?? "";
  const exp = Number(u.searchParams.get("e"));
  const sig = u.searchParams.get("s") ?? "";
  if (!assinaturaValida(chave, exp, sig)) return new Response("link expirado", { status: 403 });
  const arq = await comoServico((db) => uma<{ tipo: string; dados: Buffer }>(db, "select tipo, dados from arquivos where chave = $1", [chave]));
  if (!arq) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(arq.dados), {
    headers: { "Content-Type": arq.tipo, "Cache-Control": "private, max-age=3000" },
  });
}
