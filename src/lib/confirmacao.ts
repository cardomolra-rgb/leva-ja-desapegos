import "server-only";
import { comoServico, uma } from "@/lib/db";
import { lerConfig } from "@/lib/config-loja";
import { confirmarPagamento } from "@/lib/operacoes";
import { gateway } from "@/lib/pagamentos";

/**
 * Reconsulta o pagamento no gateway (nunca confia só no corpo do webhook)
 * e, se aprovado, confirma no banco. Idempotente.
 */
export async function sincronizarPagamento(gatewayId: string) {
  const gw = gateway();
  const consulta = await gw.consultar(gatewayId);
  return comoServico(async (db) => {
    const pag = await uma<{ id: string; valor: number; status: string }>(
      db,
      "select id, valor, status from pagamentos where gateway = $1 and gateway_id = $2",
      [gw.nome, gatewayId],
    );
    if (!pag) return { ok: false, motivo: "pagamento desconhecido" };
    if (consulta.status === "aprovado") {
      if (consulta.valor && consulta.valor !== pag.valor) {
        await db.query("update pagamentos set payload = $2 where id = $1", [pag.id, JSON.stringify({ divergencia: consulta })]);
        return { ok: false, motivo: "valor divergente" };
      }
      const cfg = await lerConfig(db);
      await confirmarPagamento(db, cfg, pag.id, consulta.aprovadoEm ?? new Date(), new Date());
      return { ok: true, status: "aprovado" };
    }
    if (consulta.status !== "pendente" && pag.status === "pendente") {
      await db.query("update pagamentos set status = $2 where id = $1", [pag.id, consulta.status]);
    }
    return { ok: true, status: consulta.status };
  });
}
