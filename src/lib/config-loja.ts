import "server-only";
import { type Config, CONFIG_PADRAO } from "@/lib/rules";
import { comoServico, uma, type Db } from "@/lib/db";

/** Lê a configuração ativa do banco. Campos novos ausentes caem no padrão (merge raso por seção). */
export async function lerConfig(db?: Db): Promise<Config> {
  const ler = async (d: Db) => uma<{ dados: Partial<Config> }>(d, "select dados from configuracoes where ativa limit 1");
  const linha = db ? await ler(db) : await comoServico(ler);
  return mesclar(linha?.dados ?? {});
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
