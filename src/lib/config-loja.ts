import "server-only";
import { cache } from "react";
import { type Config, CONFIG_PADRAO } from "@/lib/rules/config";
import { comoServico, uma, type Db } from "@/lib/db";

/**
 * A configuração é a mesma para todos os usuários e muda raramente (só pelo painel do Gestor),
 * então é guardada em memória por 60 s entre requisições e deduplicada dentro de cada requisição.
 * Dentro de uma transação (`db` informado) a leitura é sempre direta, para cálculos de dinheiro.
 */
const TTL_MS = 60_000;
let emMemoria: { cfg: Config; ate: number } | null = null;

async function lerDoBanco(d: Db): Promise<Config> {
  const linha = await uma<{ dados: Partial<Config> }>(d, "select dados from configuracoes where ativa limit 1");
  return mesclar(linha?.dados ?? {});
}

const lerCompartilhada = cache(async (): Promise<Config> => {
  if (emMemoria && emMemoria.ate > Date.now()) return emMemoria.cfg;
  const cfg = await comoServico(lerDoBanco);
  emMemoria = { cfg, ate: Date.now() + TTL_MS };
  return cfg;
});

export async function lerConfig(db?: Db): Promise<Config> {
  return db ? lerDoBanco(db) : lerCompartilhada();
}

/** Chamar depois de salvar uma nova versão das regras. */
export function esquecerConfig() {
  emMemoria = null;
}

export function mesclar(d: Partial<Config>): Config {
  return {
    ...CONFIG_PADRAO,
    ...d,
    regua: { ...CONFIG_PADRAO.regua, ...(d.regua ?? {}) },
    queda: { ...CONFIG_PADRAO.queda, ...(d.queda ?? {}) },
    comissao: {
      ...CONFIG_PADRAO.comissao,
      ...(d.comissao ?? {}),
      por_faixa: { ...CONFIG_PADRAO.comissao.por_faixa, ...(d.comissao?.por_faixa ?? {}) },
    },
    reserva: { ...CONFIG_PADRAO.reserva, ...(d.reserva ?? {}) },
    repasse: { ...CONFIG_PADRAO.repasse, ...(d.repasse ?? {}) },
    prazo_final: { ...CONFIG_PADRAO.prazo_final, ...(d.prazo_final ?? {}) },
  };
}
