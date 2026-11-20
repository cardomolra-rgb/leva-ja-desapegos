import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { RegistrarSW } from "@/components/RegistrarSW";
import { modoTeste } from "@/lib/ambiente";

// Fontes da marca hospedadas no próprio app (OFL) — sem requisição ao Google
const titulo = localFont({
  src: [{ path: "./fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800" }],
  variable: "--font-titulo",
  display: "swap",
});
const texto = localFont({
  src: [
    { path: "./fonts/nunito-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/nunito-sans-latin-700-normal.woff2", weight: "700" },
    { path: "./fonts/nunito-sans-latin-800-normal.woff2", weight: "800" },
  ],
  variable: "--font-texto",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Leva Já Desapegos — O preço só baixa", template: "%s · Leva Já" },
  description: "Loja de desapegos em consignação. Leva Já. O preço só baixa.",
  manifest: "/manifest.webmanifest",
  applicationName: "Leva Já",
  appleWebApp: { capable: true, title: "Leva Já", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#C2440F",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${titulo.variable} ${texto.variable}`}>
      <body>
        {modoTeste() && (
          <div className="nao-imprimir" style={{ background: "#1F2A24", color: "#F27A45", textAlign: "center", fontSize: 12, fontWeight: 800, padding: "4px 8px" }}>
            AMBIENTE DE TESTES · Pix simulado, nada é cobrado
          </div>
        )}
        {children}
        <RegistrarSW />
      </body>
    </html>
  );
}
