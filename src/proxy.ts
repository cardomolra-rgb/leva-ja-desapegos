import { auth } from "@/lib/auth/server";

/**
 * Exige login nas áreas privadas. Catálogo, ficha e início são públicos.
 * Papel (Gestor/Atendente) é conferido nas próprias páginas e no banco (RLS).
 */
export default auth.middleware({ loginUrl: "/entrar" });

export const config = {
  matcher: ["/conta/:path*", "/vender/:path*", "/reservar/:path*", "/reserva/:path*", "/gestao/:path*"],
};
