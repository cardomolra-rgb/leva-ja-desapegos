import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Leva Já Desapegos",
    short_name: "Leva Já",
    description: "Leva Já. O preço só baixa.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF7F0",
    theme_color: "#C2440F",
    lang: "pt-BR",
    categories: ["shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Gestão — Caixa", url: "/gestao/caixa", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Gestão — Entrada", url: "/gestao/entrada", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Quero vender", url: "/vender", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
