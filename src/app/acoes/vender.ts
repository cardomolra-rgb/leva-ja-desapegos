"use server";
import { redirect } from "next/navigation";
import { comoServico, comoUsuario, uma } from "@/lib/db";
import { exigirCadastroCompleto, exigirLogin, origemRequisicao } from "@/lib/sessao";
import { lerConfig } from "@/lib/config-loja";
import { registrarEvento } from "@/lib/eventos";
import { salvarArquivo } from "@/lib/storage";
import { ESTADOS, paraCentavos, validarProposta, type Estado } from "@/lib/rules";
import { uuidValido } from "@/lib/consultas";

export type EstadoVender = { erro?: string; campos?: Record<string, string> } | undefined;

const ATALHOS = ["risco", "mancha", "falta_peca", "desgaste", "trinca", "furo"];

export async function enviarPreAvaliacao(_: EstadoVender, form: FormData): Promise<EstadoVender> {
  const { perfil, ctx } = await exigirCadastroCompleto("/vender");
  const origem = await origemRequisicao();

  const titulo = String(form.get("titulo") ?? "").trim();
  const categoria = String(form.get("categoria") ?? "");
  const estado = String(form.get("estado") ?? "") as Estado;
  const precoNovo = paraCentavos(String(form.get("precoNovo") ?? ""));
  const precoPedido = paraCentavos(String(form.get("precoPedido") ?? ""));
  const precoMinimo = paraCentavos(String(form.get("precoMinimo") ?? ""));
  const modalidade = form.get("modalidade") === "credito" ? "credito" : "pix";
  const defeitos = form.getAll("defeitos").map(String).filter((d) => ATALHOS.includes(d));
  const defeitoObs = String(form.get("defeitoObs") ?? "").trim().slice(0, 600);
  const temDefeito = defeitos.length > 0 || defeitoObs.length > 0;
  const entrega = String(form.get("entrega") ?? "");
  const fotos = form.getAll("fotos").filter((f): f is File => f instanceof File && f.size > 0);

  if (titulo.length < 3) return { erro: "Dê um nome para o item." };
  if (!ESTADOS.includes(estado)) return { erro: "Escolha o estado do item." };
  if (fotos.length < 2) return { erro: "Envie pelo menos 2 fotos (frente e detalhe)." };
  if (fotos.length > 8) return { erro: "No máximo 8 fotos." };
  if (form.get("termo") !== "on") return { erro: "É preciso aceitar o contrato de consignação." };
  const entregaEm = entrega ? new Date(`${entrega}-03:00`) : null;
  if (entregaEm && (isNaN(entregaEm.getTime()) || entregaEm < new Date())) return { erro: "Escolha uma data de entrega futura." };

  const cfg = await lerConfig();
  const cat = await comoServico((db) =>
    uma<{ id: number; ativa: boolean; limite_itens: number; ocupados: number; em_analise: number }>(
      db, "select id, ativa, limite_itens, ocupados::int, em_analise::int from ocupacao_categorias where slug = $1", [categoria],
    ),
  );
  if (!cat || !cat.ativa) return { erro: "Esta categoria não está aceitando itens no momento." };
  // categoria cheia não aceita mais pré-avaliações
  if (cat.ocupados + cat.em_analise >= cat.limite_itens)
    return { erro: "Esta categoria está cheia agora. Tente novamente em alguns dias." };

  const v = validarProposta(cfg, { categoria, estado, precoNovo, precoPedido, precoMinimo });
  if (!v.ok) return { erro: v.erros[0].mensagem, campos: Object.fromEntries(v.erros.map((e) => [e.campo, e.mensagem])) };

  const caminhos = await Promise.all(fotos.map((f) => salvarArquivo("itens", perfil.id, f)));

  const itemId = await comoUsuario(ctx, async (db) => {
    const termo = await uma<{ id: number; versao: string }>(
      db, "select id, versao from termos where tipo = 'consignacao' order by publicado_em desc limit 1",
    );
    const item = await uma<{ id: string }>(
      db,
      `insert into itens (dono_id, categoria_id, titulo, descricao, marca, medidas, estado, preco_novo, teto, preco_inicial,
         preco_minimo, preco_atual, modalidade_repasse, tem_defeito, defeitos, defeito_obs, entrega_agendada_em, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$13,$14,$15,$16,'pre_avaliacao') returning id`,
      [
        perfil.id, cat.id, titulo, String(form.get("descricao") ?? "").trim().slice(0, 2000) || null,
        String(form.get("marca") ?? "").trim() || null, String(form.get("medidas") ?? "").trim() || null,
        estado, precoNovo, v.teto, precoPedido, precoMinimo, modalidade, temDefeito, defeitos, defeitoObs || null, entregaEm,
      ],
    );
    for (const [i, path] of caminhos.entries()) {
      await db.query("insert into item_fotos (item_id, path, origem, ordem) values ($1, $2, 'dono', $3)", [item!.id, path, i]);
    }
    await db.query("insert into aceites (perfil_id, termo_id, item_id, ip, aparelho) values ($1,$2,$3,$4,$5)", [
      perfil.id, termo!.id, item!.id, origem.ip, origem.aparelho,
    ]);
    await registrarEvento(db, "aceite_termo", { perfilId: perfil.id, itemId: item!.id, ip: origem.ip, dados: { termo: "consignacao", versao: termo!.versao } });
    await registrarEvento(db, "pre_avaliacao", { perfilId: perfil.id, itemId: item!.id, dados: { teto: v.teto, preco_pedido: precoPedido } });
    return item!.id;
  });

  redirect(`/conta?enviado=${itemId}`);
}

/** Dono aceita ou recusa a contraproposta da loja. */
export async function responderContraproposta(itemId: string, aceitar: boolean) {
  const { perfil } = await exigirLogin();
  if (!uuidValido(itemId)) return;
  const cfg = await lerConfig();
  await comoServico(async (db) => {
    const it = await uma<{ dono_id: string; status: string; preco_proposto_loja: number; preco_minimo: number }>(
      db, "select dono_id, status, preco_proposto_loja, preco_minimo from itens where id = $1 for update", [itemId],
    );
    if (!it || it.dono_id !== perfil.id || it.status !== "contraproposta") return;
    if (aceitar) {
      const p = it.preco_proposto_loja;
      const minimo = Math.min(it.preco_minimo, Math.floor(p * cfg.minimo_max_pct));
      await db.query(
        "update itens set status = 'aguardando_entrega', preco_inicial = $2, preco_atual = $2, preco_minimo = $3 where id = $1",
        [itemId, p, minimo],
      );
      await registrarEvento(db, "aprovacao", { perfilId: perfil.id, itemId, dados: { contraproposta_aceita: p } });
    } else {
      await db.query("update itens set status = 'cancelado' where id = $1", [itemId]);
      await registrarEvento(db, "desistencia", { perfilId: perfil.id, itemId, dados: { contraproposta_recusada: true } });
    }
  });
  redirect("/conta");
}
