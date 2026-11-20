"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { comoServico, comoUsuario, uma } from "@/lib/db";
import { exigirCadastroCompleto, exigirLogin, origemRequisicao } from "@/lib/sessao";
import { lerConfig } from "@/lib/config-loja";
import { registrarEvento } from "@/lib/eventos";
import { ErroRegra, expirarReservas, prepararReserva } from "@/lib/operacoes";
import { gateway } from "@/lib/pagamentos";
import { uuidValido } from "@/lib/consultas";

export async function alternarFavorito(itemId: string) {
  const { ctx } = await exigirLogin(`/entrar?voltar=/item/${itemId}`);
  if (!uuidValido(itemId)) return;
  await comoUsuario(ctx, async (db) => {
    const r = await db.query("delete from favoritos where perfil_id = $1 and item_id = $2", [ctx.perfilId, itemId]);
    if (r.rowCount) {
      await registrarEvento(db, "desfavorito", { perfilId: ctx.perfilId, itemId });
    } else {
      await db.query("insert into favoritos (perfil_id, item_id) values ($1, $2)", [ctx.perfilId, itemId]);
      await registrarEvento(db, "favorito", { perfilId: ctx.perfilId, itemId });
    }
  });
  revalidatePath(`/item/${itemId}`);
}

export type EstadoForm = { erro?: string } | undefined;

/** Reserva com sinal Pix: cria a reserva (trava o item), gera o Pix dinâmico e leva para a tela de pagamento. */
export async function reservar(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const itemId = String(form.get("itemId") ?? "");
  if (!uuidValido(itemId)) return { erro: "Item inválido" };
  const { perfil, ctx } = await exigirCadastroCompleto(`/item/${itemId}`);
  const origem = await origemRequisicao();
  const agora = new Date();
  const aceitou = form.get("aceite") === "on";

  let reserva: Awaited<ReturnType<typeof prepararReserva>>;
  try {
    reserva = await comoServico(async (db) => {
      const cfg = await lerConfig(db);
      await expirarReservas(db, agora); // libera reservas vencidas mesmo se o cron ainda não passou
      const item = await uma<{ tem_defeito: boolean }>(db, "select tem_defeito from itens where id = $1", [itemId]);
      let aceiteId: string | null = null;
      if (item?.tem_defeito) {
        if (!aceitou) throw new ErroRegra("Marque “Li e aceito o item no estado descrito” para reservar.");
        const termo = await uma<{ id: number; versao: string }>(
          db, "select id, versao from termos where tipo = 'item_com_defeito' order by publicado_em desc limit 1",
        );
        const a = await uma<{ id: string }>(
          db,
          "insert into aceites (perfil_id, termo_id, item_id, ip, aparelho) values ($1,$2,$3,$4,$5) returning id",
          [perfil.id, termo!.id, itemId, origem.ip, origem.aparelho],
        );
        aceiteId = a!.id;
        await registrarEvento(db, "aceite_termo", {
          perfilId: perfil.id, itemId, ip: origem.ip, dados: { termo: "item_com_defeito", versao: termo!.versao },
        });
      }
      return prepararReserva(db, cfg, { itemId, clienteId: perfil.id, aceiteId }, agora);
    });
  } catch (e) {
    if (e instanceof ErroRegra) return { erro: e.message };
    throw e;
  }

  try {
    const gw = gateway();
    const pix = await gw.criarPix({
      valor: reserva.sinal,
      descricao: `Sinal reserva ${reserva.item.codigo} - Leva Já`,
      referencia: reserva.pagamentoId,
      expiraEm: reserva.expira,
      pagador: { nome: perfil.nome, email: perfil.email, cpf: perfil.cpf },
    });
    await comoServico((db) =>
      db.query(
        "update pagamentos set gateway = $2, gateway_id = $3, pix_copia_cola = $4, pix_qr_base64 = $5, expira_em = $6 where id = $1",
        [reserva.pagamentoId, gw.nome, pix.gatewayId, pix.copiaCola, pix.qrBase64, pix.expiraEm],
      ),
    );
  } catch (e) {
    console.error("falha ao gerar Pix", e);
    // desfaz a trava do item para não prender a vitrine
    await comoServico(async (db) => {
      await db.query("update reservas set status = 'cancelada', encerrada_em = now() where id = $1", [reserva.reservaId]);
      await db.query("update pagamentos set status = 'recusado' where id = $1", [reserva.pagamentoId]);
      await db.query("update itens set status = 'vitrine' where id = $1 and status = 'reservado'", [itemId]);
    });
    return { erro: "Não conseguimos gerar o Pix agora. Tente de novo em instantes." };
  }
  void ctx;
  redirect(`/reserva/${reserva.reservaId}`);
}
