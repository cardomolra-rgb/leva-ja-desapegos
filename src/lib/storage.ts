import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { comoServico } from "@/lib/db";

/**
 * Armazenamento PRIVADO (Neon Object Storage ou qualquer S3 compatível).
 * Nada é público: o navegador recebe URLs assinadas de curta duração.
 *  - fotos de itens: URL de leitura de 1 h
 *  - documentos e selfies: só a equipe, URL de 5 min
 */
let cliente: S3Client | null = null;
function s3() {
  if (!cliente) {
    cliente = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return cliente;
}
const bucket = () => process.env.S3_BUCKET ?? "levaja-privado";

/** Sem S3 configurado (ambiente de testes), os arquivos ficam na tabela `arquivos` do próprio banco. */
const usarBanco = () => !process.env.S3_ACCESS_KEY_ID;

async function gravar(chave: string, corpo: Uint8Array, tipo: string) {
  if (usarBanco()) {
    await comoServico((db) =>
      db.query("insert into arquivos (chave, tipo, dados) values ($1, $2, $3)", [chave, tipo, Buffer.from(corpo)]),
    );
    return;
  }
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: chave, Body: corpo, ContentType: tipo }));
}

const segredoUrl = () => process.env.NEON_AUTH_COOKIE_SECRET ?? "dev";
const assinar = (chave: string, exp: number) => createHmac("sha256", segredoUrl()).update(`${chave}:${exp}`).digest("hex");

/** Valida a URL assinada servida por /api/arquivo (modo banco). */
export function assinaturaValida(chave: string, exp: number, sig: string) {
  if (!chave || !(exp > Date.now() / 1000)) return false;
  const a = Buffer.from(assinar(chave, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Pasta = "itens" | "documentos" | "selfies" | "termos";

const TIPOS_OK = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 12 * 1024 * 1024;

export async function salvarArquivo(pasta: Pasta, dono: string, arquivo: File): Promise<string> {
  if (!TIPOS_OK.includes(arquivo.type)) throw new Error("Formato de arquivo não aceito");
  if (arquivo.size > MAX_BYTES) throw new Error("Arquivo maior que 12 MB");
  const ext = arquivo.type.split("/")[1].replace("jpeg", "jpg");
  const chave = `${pasta}/${dono}/${randomUUID()}.${ext}`;
  await gravar(chave, new Uint8Array(await arquivo.arrayBuffer()), arquivo.type);
  return chave;
}

export async function salvarBytes(pasta: Pasta, dono: string, bytes: Uint8Array, tipo: string, ext: string) {
  const chave = `${pasta}/${dono}/${randomUUID()}.${ext}`;
  await gravar(chave, bytes, tipo);
  return chave;
}

export async function urlAssinada(chave: string, segundos = 3600): Promise<string> {
  if (usarBanco()) {
    const exp = Math.floor(Date.now() / 1000) + segundos;
    return `/api/arquivo?k=${encodeURIComponent(chave)}&e=${exp}&s=${assinar(chave, exp)}`;
  }
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: chave }), { expiresIn: segundos });
}
