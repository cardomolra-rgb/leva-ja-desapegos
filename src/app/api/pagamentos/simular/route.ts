import { comoServico, uma } from "@/lib/db";
import { pixSimulado } from "@/lib/ambiente";
import { aprovarMock } from "@/lib/pagamentos/mock";
import { sincronizarPagamento } from "@/lib/confirmacao";

export const dynamic = "force-dynamic";

/** Só em desenvolvimento/preview com o gateway mock: simula o cliente pagando o Pix. */
export async function POST(req: Request) {
  if (!pixSimulado()) {
    return new Response("indisponível", { status: 404 });
  }
  const { pagamentoId } = (await req.json()) as { pagamentoId: string };
  const pag = await comoServico((db) =>
    uma<{ gateway_id: string; valor: number }>(db, "select gateway_id, valor from pagamentos where id = $1", [pagamentoId]),
  );
  if (!pag) return new Response("não encontrado", { status: 404 });
  aprovarMock(pag.gateway_id, pag.valor, pagamentoId);
  return Response.json(await sincronizarPagamento(pag.gateway_id));
}
