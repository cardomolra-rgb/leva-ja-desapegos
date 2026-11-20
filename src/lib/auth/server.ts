import "server-only";
import { createNeonAuth } from "@neon/auth/next/server";

/** Neon Auth (Managed Better Auth): os usuários ficam no próprio Postgres e ramificam junto com os branches. */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? "http://localhost/auth-nao-configurado",
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET ?? "desenvolvimento-desenvolvimento-desenvolvimento",
    sameSite: "lax",
  },
  logLevel: "warn",
});
