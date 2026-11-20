import Link from "next/link";
import { NavBaixo } from "@/components/Nav";
import { obterSessao } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function LayoutLoja({ children }: { children: React.ReactNode }) {
  const { perfil } = await obterSessao();
  return (
    <>
      <header className="topo">
        <div className="container">
          <Link href="/" aria-label="Leva Já Desapegos — início">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/horizontal.svg" alt="Leva Já Desapegos" />
          </Link>
          {perfil && perfil.papel !== "cliente" ? (
            <Link className="botao escuro peq" href="/gestao">Gestão</Link>
          ) : perfil ? null : (
            <Link className="botao contorno peq" href="/entrar">Entrar</Link>
          )}
        </div>
      </header>
      <main className="container">{children}</main>
      <NavBaixo
        abas={[
          { href: "/", rotulo: "Início", icone: "🏠" },
          { href: "/catalogo", rotulo: "Comprar", icone: "🛍️" },
          { href: "/vender", rotulo: "Vender", icone: "🏷️" },
          { href: "/conta", rotulo: "Conta", icone: "👤" },
        ]}
      />
    </>
  );
}
