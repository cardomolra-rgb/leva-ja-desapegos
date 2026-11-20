import Link from "next/link";
import { NavBaixo } from "@/components/Nav";
import { exigirEquipe } from "@/lib/sessao";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Gestão", template: "%s · Gestão Leva Já" } };

export default async function LayoutGestao({ children }: { children: React.ReactNode }) {
  const { perfil } = await exigirEquipe();
  const gestor = perfil.papel === "gestor";
  return (
    <>
      <header className="topo gestao nao-imprimir">
        <div className="container">
          <Link href="/gestao" className="titulo" style={{ textDecoration: "none", fontSize: "1.1rem" }}>
            Leva Já <span style={{ color: "var(--laranja-luz)" }}>Gestão</span>
          </Link>
          <span className="pequeno">{perfil.nome.split(" ")[0]} · {gestor ? "Gestor" : "Atendente"}</span>
        </div>
      </header>
      <main className="container">{children}</main>
      <NavBaixo
        gestao
        abas={[
          { href: "/gestao", rotulo: "Painel", icone: "📊" },
          { href: "/gestao/entrada", rotulo: "Entrada", icone: "📥" },
          { href: "/gestao/caixa", rotulo: "Caixa", icone: "💳" },
          { href: "/gestao/estoque", rotulo: "Estoque", icone: "📦" },
          ...(gestor ? [{ href: "/gestao/config", rotulo: "Regras", icone: "⚙️" }] : []),
        ]}
      />
    </>
  );
}
