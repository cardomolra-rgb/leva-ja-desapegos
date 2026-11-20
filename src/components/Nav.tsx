"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Aba = { href: string; rotulo: string; icone: string };

export function NavBaixo({ abas, gestao = false }: { abas: Aba[]; gestao?: boolean }) {
  const caminho = usePathname();
  const ativa = (href: string) => (href === "/" || href === "/gestao" ? caminho === href : caminho.startsWith(href));
  return (
    <nav className={`nav-baixo nao-imprimir ${gestao ? "gestao" : ""}`} aria-label="Navegação principal">
      {abas.map((a) => (
        <Link key={a.href} href={a.href} aria-current={ativa(a.href) ? "page" : undefined}>
          <span aria-hidden>{a.icone}</span>
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}
