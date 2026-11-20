"use server";
import { redirect } from "next/navigation";
import { modoTeste } from "@/lib/ambiente";
import { revalidatePath } from "next/cache";
import { createHash, randomInt } from "node:crypto";
import { auth } from "@/lib/auth/server";
import { comoServico, comoUsuario, uma } from "@/lib/db";
import { exigirLogin, origemRequisicao } from "@/lib/sessao";
import { registrarEvento } from "@/lib/eventos";
import { salvarArquivo } from "@/lib/storage";
import { enviarCodigo } from "@/lib/mensagens";

export type EstadoConta = { erro?: string; ok?: string } | undefined;

type ErroAuth = { message?: string; status?: number; code?: string } | null | undefined;

/** Traduz os erros do Neon Auth para mensagens úteis (e registra o original no log da Vercel). */
function mensagemAuth(e: ErroAuth, padrao: string): string {
  console.warn("[auth]", e?.status, e?.code, e?.message);
  const m = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (m.includes("origin")) return `Abra o sistema pelo endereço oficial (${process.env.NEXT_PUBLIC_APP_URL ?? "leva-ja-desapegos.vercel.app"}) e tente de novo.`;
  if (m.includes("already") || m.includes("exist")) return "Já existe uma conta com este e-mail. Use Entrar.";
  if (m.includes("password") && (m.includes("short") || m.includes("weak"))) return "Senha fraca: use pelo menos 8 caracteres.";
  if (m.includes("network") || e?.status === 502) return "Serviço de login indisponível agora. Tente em instantes.";
  return padrao;
}

const destinoSeguro = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "/");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

export async function entrar(_: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { error } = await auth.signIn.email({
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    password: String(form.get("senha") ?? ""),
  });
  if (error) return { erro: mensagemAuth(error, "E-mail ou senha incorretos.") };
  redirect(destinoSeguro(form.get("voltar")));
}

export async function cadastrar(_: EstadoConta, form: FormData): Promise<EstadoConta> {
  const senha = String(form.get("senha") ?? "");
  if (senha.length < 8) return { erro: "A senha precisa ter pelo menos 8 caracteres." };
  const { error } = await auth.signUp.email({
    name: String(form.get("nome") ?? "").trim().slice(0, 80),
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    password: senha,
  });
  if (error) return { erro: mensagemAuth(error, `Não foi possível criar a conta (${error.message ?? "erro desconhecido"}).`) };
  redirect(`/conta/cadastro?voltar=${encodeURIComponent(destinoSeguro(form.get("voltar")))}`);
}

export async function sair() {
  await auth.signOut();
  redirect("/");
}

/** Validação de CPF (dígitos verificadores). */
export async function cpfValido(cpf: string): Promise<boolean> {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

const hash = (c: string) => createHash("sha256").update(c).digest("hex");

/** Passo 1: CPF + telefone → envia código por WhatsApp/SMS. */
export async function salvarDadosEnviarCodigo(_: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { perfil } = await exigirLogin();
  const cpf = String(form.get("cpf") ?? "").replace(/\D/g, "");
  const telefone = String(form.get("telefone") ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const canal = form.get("canal") === "sms" ? "sms" : "whatsapp";
  if (!(await cpfValido(cpf))) return { erro: "CPF inválido." };
  if (!/^\d{10,11}$/.test(telefone)) return { erro: "Telefone com DDD, só números." };

  const res = await comoServico(async (db) => {
    const dono = await uma<{ id: string }>(db, "select id from perfis where cpf = $1 and id <> $2", [cpf, perfil.id]);
    if (dono) return "Este CPF já está cadastrado em outra conta.";
    if (perfil.cpf && perfil.cpf !== cpf) return "O CPF não pode ser alterado. Procure a loja.";
    const recentes = await uma<{ n: number }>(
      db, "select count(*)::int n from codigos_verificacao where perfil_id = $1 and criado_em > now() - interval '15 minutes'", [perfil.id],
    );
    if ((recentes?.n ?? 0) >= 3) return "Muitas tentativas. Aguarde 15 minutos.";
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.query("update perfis set cpf = $2, telefone = $3, chave_pix = coalesce(chave_pix, $2) where id = $1", [perfil.id, cpf, telefone]);
    await db.query(
      "insert into codigos_verificacao (perfil_id, canal, destino, codigo_hash, expira_em) values ($1,$2,$3,$4, now() + interval '10 minutes')",
      [perfil.id, canal, telefone, hash(`${perfil.id}:${codigo}`)],
    );
    if (modoTeste() && (process.env.MESSAGING_PROVIDER ?? "console") === "console") return `TESTE:${codigo}`;
    await enviarCodigo(telefone, codigo);
    return null;
  });
  if (res?.startsWith("TESTE:")) return { ok: `Ambiente de testes — seu código é ${res.slice(6)}` };
  if (res) return { erro: res };
  revalidatePath("/conta/cadastro");
  return { ok: "Código enviado! Confira seu " + (canal === "sms" ? "SMS" : "WhatsApp") + "." };
}

export async function confirmarCodigo(_: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { perfil } = await exigirLogin();
  const codigo = String(form.get("codigo") ?? "").replace(/\D/g, "");
  const r = await comoServico(async (db) => {
    const c = await uma<{ id: string; codigo_hash: string; tentativas: number }>(
      db,
      "select id, codigo_hash, tentativas from codigos_verificacao where perfil_id = $1 and usado_em is null and expira_em > now() order by criado_em desc limit 1",
      [perfil.id],
    );
    if (!c) return "Código expirado. Peça um novo.";
    if (c.tentativas >= 5) return "Muitas tentativas. Peça um novo código.";
    if (c.codigo_hash !== hash(`${perfil.id}:${codigo}`)) {
      await db.query("update codigos_verificacao set tentativas = tentativas + 1 where id = $1", [c.id]);
      return "Código incorreto.";
    }
    await db.query("update codigos_verificacao set usado_em = now() where id = $1", [c.id]);
    await db.query("update perfis set telefone_verificado_em = now() where id = $1", [perfil.id]);
    return null;
  });
  if (r) return { erro: r };
  revalidatePath("/conta/cadastro");
  return { ok: "Telefone confirmado." };
}

/** Passo 2: foto do documento + selfie (armazenamento privado, com prazo de retenção). */
export async function enviarDocumentos(_: EstadoConta, form: FormData): Promise<EstadoConta> {
  const { perfil } = await exigirLogin();
  const doc = form.get("documento");
  const selfie = form.get("selfie");
  if (!(doc instanceof File) || !doc.size || !(selfie instanceof File) || !selfie.size)
    return { erro: "Envie a foto do documento e a selfie." };
  const termoOk = form.get("privacidade") === "on";
  if (!termoOk) return { erro: "É preciso aceitar a política de privacidade." };
  const origem = await origemRequisicao();
  const [docPath, selfiePath] = await Promise.all([
    salvarArquivo("documentos", perfil.id, doc),
    salvarArquivo("selfies", perfil.id, selfie),
  ]);
  await comoServico(async (db) => {
    await db.query(
      "update perfis set doc_foto_path = $2, selfie_path = $3, retencao_documentos_ate = (current_date + interval '5 years')::date where id = $1",
      [perfil.id, docPath, selfiePath],
    );
    for (const tipo of ["uso", "privacidade"]) {
      const t = await uma<{ id: number; versao: string }>(db, "select id, versao from termos where tipo = $1 order by publicado_em desc limit 1", [tipo]);
      await db.query("insert into aceites (perfil_id, termo_id, ip, aparelho) values ($1,$2,$3,$4)", [perfil.id, t!.id, origem.ip, origem.aparelho]);
      await registrarEvento(db, "aceite_termo", { perfilId: perfil.id, ip: origem.ip, dados: { termo: tipo, versao: t!.versao } });
    }
  });
  redirect(destinoSeguro(form.get("voltar")));
}

export async function salvarPreferencias(form: FormData) {
  const { ctx } = await exigirLogin();
  await comoUsuario(ctx, (db) =>
    db.query("update perfis set prefs_aviso = $2 where id = $1", [
      ctx.perfilId,
      JSON.stringify({ whatsapp: form.get("whatsapp") === "on", app: true }),
    ]),
  );
  revalidatePath("/conta");
}

export async function marcarAvisosLidos() {
  const { ctx } = await exigirLogin();
  await comoUsuario(ctx, (db) => db.query("update avisos set lido_em = now() where perfil_id = $1 and lido_em is null", [ctx.perfilId]));
  revalidatePath("/conta");
}
