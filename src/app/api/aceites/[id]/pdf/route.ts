import { obterSessao } from "@/lib/sessao";
import { comoUsuario, uma } from "@/lib/db";
import { gerarPdfTexto } from "@/lib/pdf";
import { cpfMascara, data } from "@/lib/formato";
import { uuidValido } from "@/lib/consultas";

export const dynamic = "force-dynamic";

/** Comprovante do aceite em PDF: termo, versão, data/hora, IP e aparelho. RLS: só o próprio usuário ou o gestor. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidValido(id)) return new Response("inválido", { status: 400 });
  const { ctx } = await obterSessao();
  if (!ctx.perfilId) return new Response("login necessário", { status: 401 });
  const a = await comoUsuario(ctx, (db) =>
    uma<{ tipo: string; versao: string; texto: string; aceito_em: Date; ip: string | null; aparelho: string | null; nome: string; cpf: string | null; item: string | null }>(
      db,
      `select t.tipo, t.versao, t.texto, a.aceito_em, host(a.ip) ip, a.aparelho, p.nome, p.cpf,
              (select coalesce(i.codigo, '') || ' ' || i.titulo from itens i where i.id = a.item_id) item
       from aceites a join termos t on t.id = a.termo_id join perfis p on p.id = a.perfil_id where a.id = $1`,
      [id],
    ),
  );
  if (!a) return new Response("não encontrado", { status: 404 });
  const corpo = [
    `Usuário: ${a.nome} — CPF ${cpfMascara(a.cpf)}`,
    `Termo: ${a.tipo} — versão ${a.versao}`,
    a.item ? `Item: ${a.item}` : "",
    `Aceito em: ${data(a.aceito_em, true)} (horário de Araguaína)`,
    `IP: ${a.ip ?? "—"}`,
    `Aparelho: ${a.aparelho ?? "—"}`,
    `Registro: ${id}`,
    "",
    "Texto aceito:",
    a.texto,
  ].filter((l) => l !== null).join("\n");
  const pdf = gerarPdfTexto("Leva Já Desapegos — Comprovante de aceite", corpo);
  return new Response(pdf as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="aceite-${id.slice(0, 8)}.pdf"` },
  });
}
