"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { comoServico, comoUsuario, uma } from "@/lib/db";
import { exigirEquipe } from "@/lib/sessao";
import { lerConfig, mesclar } from "@/lib/config-loja";
import { avisar, registrarEvento } from "@/lib/eventos";
import { salvarArquivo } from "@/lib/storage";
import { gateway } from "@/lib/pagamentos";
import { ErroRegra, colocarNaVitrine, expirarReservas, registrarVenda, type PagamentoCaixa } from "@/lib/operacoes";
import { ESTADOS, brl, calcularTeto, minimoMaximo, paraCentavos, validarConfig, type Config, type Estado } from "@/lib/rules";
import { uuidValido } from "@/lib/consultas";

export type EstadoAcao = { erro?: string; ok?: string } | undefined;

// ---------------------------------------------------------------------------
// Pré-avaliação (pela foto, antes de o dono levar o item)
// ---------------------------------------------------------------------------
export async function decidirPreAvaliacao(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const { perfil, ctx } = await exigirEquipe();
  const itemId = String(form.get("itemId"));
  const decisao = String(form.get("decisao")) as "aprovado" | "contraproposta" | "recusado";
  const motivo = String(form.get("motivo") ?? "").trim();
  const preco = paraCentavos(String(form.get("preco") ?? ""));
  if (!uuidValido(itemId) || !["aprovado", "contraproposta", "recusado"].includes(decisao)) return { erro: "Dados inválidos" };
  if (decisao === "recusado" && !motivo) return { erro: "Informe o motivo da recusa." };
  if (decisao === "contraproposta" && !(preco > 0)) return { erro: "Informe o preço proposto." };

  const r = await comoUsuario(ctx, async (db) => {
    const it = await uma<{ dono_id: string; titulo: string; status: string; teto: number }>(
      db, "select dono_id, titulo, status, teto from itens where id = $1 for update", [itemId],
    );
    if (!it || it.status !== "pre_avaliacao") return "Item não está em pré-avaliação.";
    if (decisao === "contraproposta" && preco > it.teto) return `Preço acima do teto (${brl(it.teto)}).`;
    const novoStatus = { aprovado: "aguardando_entrega", contraproposta: "contraproposta", recusado: "recusado" }[decisao];
    await db.query("update itens set status = $2, preco_proposto_loja = $3, motivo_recusa = $4 where id = $1", [
      itemId, novoStatus, decisao === "contraproposta" ? preco : null, decisao === "recusado" ? motivo : null,
    ]);
    await db.query(
      "insert into avaliacoes (item_id, avaliador_id, etapa, decisao, preco_proposto, motivo) values ($1,$2,'pre',$3,$4,$5)",
      [itemId, perfil.id, decisao, decisao === "contraproposta" ? preco : null, motivo || null],
    );
    await registrarEvento(db, decisao === "aprovado" ? "aprovacao" : decisao === "recusado" ? "recusa" : "contraproposta", {
      perfilId: perfil.id, itemId, dados: { etapa: "pre", preco, motivo },
    });
    const msg = {
      aprovado: { t: "Pré-avaliação aprovada ✅", c: `${it.titulo} foi aprovado. Leve o item à loja no horário de funcionamento para a avaliação final.` },
      contraproposta: { t: "A loja propôs outro preço", c: `Para ${it.titulo} a loja propõe ${brl(preco)}. Aceite ou recuse em Minha conta.` },
      recusado: { t: "Item não aceito", c: `${it.titulo} não foi aceito. Motivo: ${motivo}` },
    }[decisao];
    await avisar(db, it.dono_id, { tipo: "aprovacao", titulo: msg.t, corpo: msg.c, itemId, link: "/conta" });
    return null;
  });
  if (r) return { erro: r };
  revalidatePath("/gestao/entrada");
  redirect("/gestao/entrada");
}

// ---------------------------------------------------------------------------
// Avaliação presencial → vitrine → etiqueta
// ---------------------------------------------------------------------------
export async function darEntrada(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const { perfil, ctx } = await exigirEquipe();
  const itemId = String(form.get("itemId"));
  if (!uuidValido(itemId)) return { erro: "Item inválido" };
  const estado = String(form.get("estado")) as Estado;
  if (!ESTADOS.includes(estado)) return { erro: "Confirme o estado." };
  const precoInicial = paraCentavos(String(form.get("precoInicial") ?? ""));
  const precoMinimo = paraCentavos(String(form.get("precoMinimo") ?? ""));
  const defeitos = form.getAll("defeitos").map(String);
  const defeitoObs = String(form.get("defeitoObs") ?? "").trim() || null;
  const selos = form.getAll("selos").map(String).filter((s) => ["testado", "conferido"].includes(s));
  const numeroSerie = String(form.get("numeroSerie") ?? "").trim() || null;
  // cada input de câmera vem pareado com seu ângulo; descarta os ângulos sem foto
  const angulosBrutos = form.getAll("angulos").map(String);
  const pares = form.getAll("fotos")
    .map((f, i) => ({ f: f as FormDataEntryValue | File, angulo: (angulosBrutos[i] ?? null) as string | null }))
    .filter((x): x is { f: File; angulo: string | null } => x.f instanceof File && x.f.size > 0);
  const fotos = pares.map((x) => x.f);
  const angulos = pares.map((x) => x.angulo);

  const cfg = await lerConfig();
  const item = await comoUsuario(ctx, (db) =>
    uma<{ status: string; preco_novo: number; slug: string; checklist: string[]; dono_id: string }>(
      db, "select i.status, i.preco_novo, c.slug, c.checklist, i.dono_id from itens i join categorias c on c.id = i.categoria_id where i.id = $1", [itemId],
    ),
  );
  if (!item) return { erro: "Item não encontrado" };
  if (!["aguardando_entrega", "pre_avaliacao"].includes(item.status)) return { erro: "Item não está aguardando entrada." };

  // checklist obrigatório por categoria
  const marcados = new Set(form.getAll("checklist").map(String));
  const faltando = item.checklist.filter((c) => !marcados.has(c));
  if (faltando.length) return { erro: `Checklist incompleto: ${faltando.join(", ")}` };
  if (fotos.length < 3) return { erro: "Tire as fotos padronizadas (mínimo 3)." };

  const teto = calcularTeto(cfg, item.slug, estado, item.preco_novo);
  if (precoInicial > teto) return { erro: `Preço acima do teto para o estado confirmado (${brl(teto)}).` };
  if (precoInicial < cfg.valor_minimo_item_centavos) return { erro: `Abaixo de ${brl(cfg.valor_minimo_item_centavos)}: só em lote.` };
  if (precoMinimo > minimoMaximo(cfg, precoInicial) || precoMinimo < cfg.valor_minimo_item_centavos)
    return { erro: `Mínimo deve ficar entre ${brl(cfg.valor_minimo_item_centavos)} e ${brl(minimoMaximo(cfg, precoInicial))}.` };

  const caminhos = await Promise.all(fotos.map((f) => salvarArquivo("itens", item.dono_id, f)));

  try {
    await comoUsuario(ctx, async (db) => {
      await db.query(
        `update itens set estado_confirmado = $2, teto = $3, tem_defeito = $4, defeitos = $5, defeito_obs = $6, selos = $7, numero_serie = $8
         where id = $1`,
        [itemId, estado, teto, defeitos.length > 0 || !!defeitoObs, defeitos, defeitoObs, selos, numeroSerie],
      );
      for (const [i, path] of caminhos.entries()) {
        await db.query("insert into item_fotos (item_id, path, origem, angulo, ordem) values ($1,$2,'loja',$3,$4)", [itemId, path, angulos[i] ?? null, i]);
      }
      await db.query(
        "insert into avaliacoes (item_id, avaliador_id, etapa, estado_confirmado, checklist, decisao) values ($1,$2,'presencial',$3,$4,'aprovado')",
        [itemId, perfil.id, estado, JSON.stringify(Object.fromEntries(item.checklist.map((c) => [c, true])))],
      );
      await colocarNaVitrine(db, cfg, { itemId, avaliadorId: perfil.id, precoInicial, precoMinimo }, new Date());
    });
  } catch (e) {
    if (e instanceof ErroRegra) return { erro: e.message };
    throw e;
  }
  redirect(`/gestao/etiqueta/${itemId}?nova=1`);
}

export async function recusarPresencial(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const { perfil, ctx } = await exigirEquipe();
  const itemId = String(form.get("itemId"));
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!motivo) return { erro: "Informe o motivo." };
  await comoUsuario(ctx, async (db) => {
    const it = await uma<{ dono_id: string; titulo: string }>(db, "select dono_id, titulo from itens where id = $1", [itemId]);
    await db.query("update itens set status = 'recusado', motivo_recusa = $2 where id = $1", [itemId, motivo]);
    await db.query("insert into avaliacoes (item_id, avaliador_id, etapa, decisao, motivo) values ($1,$2,'presencial','recusado',$3)", [itemId, perfil.id, motivo]);
    await registrarEvento(db, "recusa", { perfilId: perfil.id, itemId, dados: { etapa: "presencial", motivo } });
    if (it) await avisar(db, it.dono_id, { tipo: "aprovacao", titulo: "Item não aceito na avaliação", corpo: `${it.titulo}: ${motivo}. Retire o item no balcão.`, itemId });
  });
  redirect("/gestao/entrada");
}

export async function registrarImpressao(itemId: string) {
  const { perfil, ctx } = await exigirEquipe();
  await comoUsuario(ctx, (db) => registrarEvento(db, "etiqueta_impressa", { perfilId: perfil.id, itemId }));
}

// ---------------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------------
export async function avisarDono(itemId: string) {
  const { perfil, ctx } = await exigirEquipe();
  await comoUsuario(ctx, async (db) => {
    const it = await uma<{ dono_id: string; titulo: string; codigo: string; status: string; doacao_em: Date | null }>(
      db, "select dono_id, titulo, codigo, status, doacao_em from itens where id = $1", [itemId],
    );
    if (!it) return;
    const corpo = it.status === "vencido"
      ? `${it.titulo} (${it.codigo}) está com o prazo vencido. Retire na loja${it.doacao_em ? ` até ${new Date(it.doacao_em).toLocaleDateString("pt-BR", { timeZone: "America/Araguaina" })}` : ""}, senão será doado.`
      : `Atualização sobre ${it.titulo} (${it.codigo}). Confira em Minha conta.`;
    await avisar(db, it.dono_id, { tipo: "fim_prazo", titulo: "Aviso da loja sobre seu item", corpo, itemId, link: "/conta" });
    await registrarEvento(db, "aviso_dono", { perfilId: perfil.id, itemId, dados: { manual: true } });
  });
  revalidatePath("/gestao/estoque");
}

export async function devolverAoDono(itemId: string) {
  const { perfil, ctx } = await exigirEquipe();
  await comoUsuario(ctx, async (db) => {
    await db.query("update itens set status = 'devolvido_dono' where id = $1 and status in ('vitrine','vencido')", [itemId]);
    await registrarEvento(db, "devolucao", { perfilId: perfil.id, itemId, dados: { para: "dono" } });
  });
  revalidatePath("/gestao/estoque");
}

// ---------------------------------------------------------------------------
// Caixa
// ---------------------------------------------------------------------------
export type EstadoCaixa = { erro?: string; ok?: string; pix?: { pagamentoId: string; copiaCola: string; qrBase64: string | null; valor: number } } | undefined;

/** Gera Pix dinâmico no caixa para o valor restante. */
export async function gerarPixCaixa(itemId: string, valor: number): Promise<EstadoCaixa> {
  const { perfil } = await exigirEquipe();
  const cfg = await lerConfig();
  const pag = await comoServico((db) =>
    uma<{ id: string }>(
      db,
      "insert into pagamentos (finalidade, metodo, valor, expira_em) values ('venda','pix',$1, now() + ($2 || ' minutes')::interval) returning id",
      [valor, String(cfg.pix_expira_minutos)],
    ),
  );
  const gw = gateway();
  const pix = await gw.criarPix({
    valor,
    descricao: `Compra Leva Já`,
    referencia: pag!.id,
    expiraEm: new Date(Date.now() + cfg.pix_expira_minutos * 60000),
    pagador: { nome: "Cliente balcão", email: null, cpf: null },
  });
  await comoServico((db) =>
    db.query("update pagamentos set gateway = $2, gateway_id = $3, pix_copia_cola = $4, pix_qr_base64 = $5 where id = $1", [
      pag!.id, gw.nome, pix.gatewayId, pix.copiaCola, pix.qrBase64,
    ]),
  );
  void perfil;
  void itemId;
  return { pix: { pagamentoId: pag!.id, copiaCola: pix.copiaCola, qrBase64: pix.qrBase64, valor } };
}

export async function finalizarVenda(_: EstadoCaixa, form: FormData): Promise<EstadoCaixa> {
  const { perfil, ctx } = await exigirEquipe();
  const itemId = String(form.get("itemId"));
  const reservaId = String(form.get("reservaId") ?? "") || null;
  const cpfComprador = String(form.get("cpfComprador") ?? "").replace(/\D/g, "") || null;
  const pagamentos: PagamentoCaixa[] = [];
  for (const metodo of ["pix", "cartao_credito", "cartao_debito", "credito_loja", "dinheiro"] as const) {
    const v = paraCentavos(String(form.get(`valor_${metodo}`) ?? ""));
    if (v > 0) pagamentos.push({ metodo, valor: v, pagamentoId: metodo === "pix" ? String(form.get("pixPagamentoId") ?? "") || undefined : undefined });
  }
  if (!pagamentos.length) return { erro: "Informe a forma de pagamento." };
  if (pagamentos.some((p) => p.metodo === "pix" && !p.pagamentoId)) return { erro: "Gere o Pix e aguarde a confirmação." };

  try {
    await comoUsuario(ctx, async (db) => {
      const cfg = await lerConfig(db);
      let compradorId: string | null = null;
      if (cpfComprador) {
        compradorId = (await uma<{ id: string }>(db, "select id from perfis where cpf = $1", [cpfComprador]))?.id ?? null;
        if (!compradorId) throw new ErroRegra("CPF do comprador não cadastrado.");
      }
      await registrarVenda(db, cfg, { itemId, atendenteId: perfil.id, reservaId, compradorId, pagamentos }, new Date());
    });
  } catch (e) {
    if (e instanceof ErroRegra) return { erro: e.message };
    throw e;
  }
  revalidatePath("/gestao/caixa");
  redirect(`/gestao/caixa?vendido=${itemId}`);
}

/** Busca por QR/código curto (CAS-4012) ou código de retirada da reserva (6 letras). */
export async function buscarNoCaixa(form: FormData) {
  await exigirEquipe();
  const termo = String(form.get("codigo") ?? "").trim().toUpperCase();
  const r = await comoServico(async (db) => {
    await expirarReservas(db, new Date());
    if (/^[A-Z]{3}-\d+$/.test(termo)) return uma<{ id: string }>(db, "select id from itens where codigo = $1", [termo]);
    if (/^[A-Z0-9]{6}$/.test(termo))
      return uma<{ id: string }>(db, "select item_id id from reservas where codigo_retirada = $1 and status = 'paga'", [termo]);
    return null;
  });
  redirect(r ? `/gestao/caixa/${r.id}` : `/gestao/caixa?nao=${encodeURIComponent(termo)}`);
}

// ---------------------------------------------------------------------------
// Configurações (somente Gestor)
// ---------------------------------------------------------------------------
export async function salvarConfiguracoes(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const { perfil, ctx } = await exigirEquipe(true);
  const atual = await lerConfig();
  const pct = (n: string) => Number(String(form.get(n) ?? "").replace(",", ".")) / 100;
  const num = (n: string) => Number(String(form.get(n) ?? "").replace(",", "."));
  const dinheiro = (n: string) => paraCentavos(String(form.get(n) ?? ""));

  const regua: Config["regua"] = {};
  for (const cat of Object.keys(atual.regua)) {
    regua[cat] = Object.fromEntries(ESTADOS.map((e) => [e, pct(`regua_${cat}_${e}`)])) as Record<Estado, number>;
  }
  const lojaPct = pct("loja_pct");
  const nova: Config = mesclar({
    ...atual,
    regua,
    minimo_max_pct: pct("minimo_max_pct"),
    queda: { ...atual.queda, intervalo_dias: num("intervalo_dias"), pct_do_inicial: pct("queda_pct"), arredondamento_centavos: dinheiro("arredondamento") },
    comissao: {
      ...atual.comissao,
      loja_pct: lojaPct,
      dono_pix_pct: Math.round((1 - lojaPct) * 10000) / 10000,
      dono_credito_pct: pct("dono_credito_pct"),
      por_faixa: { ...atual.comissao.por_faixa, ativo: form.get("faixa_ativa") === "on" },
    },
    valor_minimo_item_centavos: dinheiro("valor_minimo"),
    reserva: {
      sinal_pct: pct("sinal_pct"),
      sinal_pct_alto: pct("sinal_pct_alto"),
      limite_alto_centavos: dinheiro("limite_alto"),
      prazo_retirada_horas: num("prazo_retirada_horas"),
    },
    repasse: { ...atual.repasse, prazo_troca_dias: num("prazo_troca_dias"), dia_semana_lote: num("dia_semana_lote") },
    prazo_final: { dias_no_minimo: num("dias_no_minimo"), dias_aviso: num("dias_aviso") },
  });
  const erros = validarConfig(nova);
  if (erros.length) return { erro: erros.join(" · ") };

  await comoUsuario(ctx, async (db) => {
    await db.query("update configuracoes set ativa = false where ativa");
    await db.query("insert into configuracoes (dados, ativa, motivo, criado_por) values ($1, true, $2, $3)", [
      JSON.stringify(nova), String(form.get("motivo") ?? "").slice(0, 200) || "Ajuste no painel", perfil.id,
    ]);
    // categorias: ativa e limite
    const cats = await db.query("select id from categorias");
    for (const { id } of cats.rows as { id: number }[]) {
      await db.query("update categorias set ativa = $2, limite_itens = $3 where id = $1", [
        id, form.get(`cat_ativa_${id}`) === "on", Math.max(0, num(`cat_limite_${id}`) || 0),
      ]);
    }
    await registrarEvento(db, "config_alterada", { perfilId: perfil.id, dados: { motivo: form.get("motivo") } });
  });
  revalidatePath("/", "layout");
  return { ok: "Configurações salvas. Valem a partir de agora (itens já na vitrine seguem o preço inicial/mínimo combinados)." };
}
