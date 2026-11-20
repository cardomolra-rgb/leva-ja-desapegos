#!/usr/bin/env node
/**
 * Aplica as migrações de db/migrations em ordem, cada uma numa transação.
 * Uso:
 *   DATABASE_URL_UNPOOLED=... node db/migrate.mjs           # aplica pendentes
 *   DATABASE_URL_UNPOOLED=... node db/migrate.mjs --status  # só lista
 *
 * Fluxo recomendado no Neon: rode primeiro no branch "dev"; depois de testar,
 * crie um branch de backup do "main" (ou snapshot) e rode no "main".
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL_UNPOOLED (ou DATABASE_URL).");
  process.exit(1);
}
const soStatus = process.argv.includes("--status");

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    nome text primary key, checksum text not null, aplicada_em timestamptz not null default now())`);
  const { rows } = await client.query("select nome, checksum from schema_migrations");
  const aplicadas = new Map(rows.map((r) => [r.nome, r.checksum]));
  const arquivos = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const nome of arquivos) {
    const sql = await readFile(path.join(dir, nome), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
    if (aplicadas.has(nome)) {
      const aviso = aplicadas.get(nome) !== checksum ? "  ⚠ arquivo mudou depois de aplicado!" : "";
      console.log(`✓ ${nome}${aviso}`);
      continue;
    }
    if (soStatus) {
      console.log(`… ${nome} (pendente)`);
      continue;
    }
    process.stdout.write(`→ aplicando ${nome} ... `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (nome, checksum) values ($1, $2)", [nome, checksum]);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      console.log("FALHOU");
      throw e;
    }
  }
} finally {
  client.release();
  await pool.end();
}
