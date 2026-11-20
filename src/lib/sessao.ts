import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { comoServico, uma, type Contexto, type Papel } from "@/lib/db";

export interface Perfil {
  id: string;
  nome: string;
  email: string | null;
  cpf: string | null;
  telefone: string | null;
  papel: Exclude<Papel, "anon">;
  telefone_verificado_em: string | null;
  identidade_verificada_em: string | null;
  doc_foto_path: string | null;
  selfie_path: string | null;
  chave_pix: string | null;
  prefs_aviso: { whatsapp: boolean; app: boolean };
}

export interface Sessao {
  perfil: Perfil | null;
  ctx: Contexto;
}

/** Sessão da requisição (com cache por requisição). Cria o perfil no primeiro acesso. */
export const obterSessao = cache(async (): Promise<Sessao> => {
  let usuario: { id: string; email?: string | null; name?: string | null } | null = null;
  try {
    const { data } = await auth.getSession();
    usuario = data?.user ?? null;
  } catch (e) {
    // erros internos do Next (renderização dinâmica, redirect) precisam subir
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.warn("auth indisponível", e);
    usuario = null;
  }
  if (!usuario) return { perfil: null, ctx: { perfilId: null, papel: "anon" } };

  const perfil = await comoServico(async (db) => {
    const existente = await uma<Perfil>(db, "select * from perfis where auth_user_id = $1", [usuario.id]);
    if (existente) return existente;
    const gestores = (process.env.GESTORES_INICIAIS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const papel = usuario.email && gestores.includes(usuario.email.toLowerCase()) ? "gestor" : "cliente";
    const novo = await uma<Perfil>(
      db,
      `insert into perfis (auth_user_id, nome, email, papel) values ($1, $2, $3, $4)
       on conflict (auth_user_id) do update set email = excluded.email returning *`,
      [usuario.id, usuario.name || usuario.email || "Cliente", usuario.email ?? null, papel],
    );
    await db.query("insert into eventos (tipo, perfil_id) values ('cadastro', $1)", [novo!.id]);
    return novo!;
  });

  return { perfil, ctx: { perfilId: perfil.id, papel: perfil.papel } };
});

export async function exigirLogin(destino = "/entrar"): Promise<Sessao & { perfil: Perfil }> {
  const s = await obterSessao();
  if (!s.perfil) redirect(destino);
  return s as Sessao & { perfil: Perfil };
}

/** Cadastro completo: CPF, documento, selfie e telefone verificado (exigido para vender e reservar). */
export function cadastroCompleto(p: Perfil): boolean {
  return !!(p.cpf && p.telefone_verificado_em && p.doc_foto_path && p.selfie_path);
}

export async function exigirCadastroCompleto(voltarPara: string) {
  const s = await exigirLogin(`/entrar?voltar=${encodeURIComponent(voltarPara)}`);
  if (!cadastroCompleto(s.perfil)) redirect(`/conta/cadastro?voltar=${encodeURIComponent(voltarPara)}`);
  return s;
}

export async function exigirEquipe(somenteGestor = false) {
  const s = await exigirLogin("/entrar?voltar=/gestao");
  const ok = somenteGestor ? s.perfil.papel === "gestor" : s.perfil.papel !== "cliente";
  if (!ok) redirect(somenteGestor ? "/gestao" : "/");
  return s;
}

/** IP e aparelho para registro de aceites e eventos. */
export async function origemRequisicao() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip, aparelho: h.get("user-agent")?.slice(0, 400) ?? null };
}
