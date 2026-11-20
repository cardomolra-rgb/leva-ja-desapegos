import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO as cfg,
  type Config,
  arredondar,
  avaliarEstorno,
  calcularSinal,
  calcularTeto,
  dividirVenda,
  etapaAtual,
  etapaDoMinimo,
  fimPrazoTroca,
  liberacaoRepasse,
  paraCentavos,
  precoNaEtapa,
  prazosFinais,
  previsaoPagamento,
  proximoLote,
  simularRecebimento,
  situacaoPreco,
  situacaoRetirada,
  validarConfig,
  validarProposta,
  gerarCodigoRetirada,
  dataLocal,
} from "@/lib/rules";

/** Data no fuso da loja (UTC−3). */
const local = (s: string) => new Date(`${s}-03:00`);
const clone = (c: Config): Config => JSON.parse(JSON.stringify(c));

describe("dinheiro", () => {
  it("arredonda de R$ 5 em R$ 5", () => {
    expect(arredondar(19960, 500)).toBe(19500);
    expect(arredondar(19960, 500, "proximo")).toBe(20000);
    expect(arredondar(19960, 500, "cima")).toBe(20000);
    expect(arredondar(20000, 500, "cima")).toBe(20000);
  });
  it("converte texto em centavos", () => {
    expect(paraCentavos("120,50")).toBe(12050);
    expect(paraCentavos("R$ 1.299,90")).toBe(129990);
    expect(paraCentavos("80")).toBe(8000);
    expect(paraCentavos("abc")).toBeNaN();
  });
});

describe("régua de teto", () => {
  it("preço do novo × % da categoria/estado, arredondado para baixo em R$ 5", () => {
    // Casa e Decoração, usado bom = 40% de R$ 499,00 = R$ 199,60 → R$ 195
    expect(calcularTeto(cfg, "casa-decoracao", "usado_bom", 49900)).toBe(19500);
    // Moda, novo = 50% de R$ 200 = R$ 100
    expect(calcularTeto(cfg, "moda", "novo", 20000)).toBe(10000);
  });
  it("muda conforme a configuração (nada fixo no código)", () => {
    const c = clone(cfg);
    c.regua.moda.novo = 0.8;
    expect(calcularTeto(c, "moda", "novo", 20000)).toBe(16000);
  });
  it("falha para categoria sem régua", () => {
    expect(() => calcularTeto(cfg, "inexistente", "novo", 1000)).toThrow();
  });
  it("bloqueia preço pedido acima do teto e mínimo acima de 70%", () => {
    const r = validarProposta(cfg, {
      categoria: "casa-decoracao",
      estado: "usado_bom",
      precoNovo: 49900,
      precoPedido: 20000,
      precoMinimo: 15000,
    });
    expect(r.ok).toBe(false);
    expect(r.teto).toBe(19500);
    expect(r.erros.map((e) => e.campo).sort()).toEqual(["precoMinimo", "precoPedido"]);
  });
  it("aceita proposta dentro das regras", () => {
    const r = validarProposta(cfg, {
      categoria: "casa-decoracao",
      estado: "usado_bom",
      precoNovo: 49900,
      precoPedido: 19500,
      precoMinimo: 13650, // exatamente 70%
    });
    expect(r.ok).toBe(true);
  });
  it("itens abaixo de R$ 25 só em lote", () => {
    const r = validarProposta(cfg, {
      categoria: "moda",
      estado: "novo",
      precoNovo: 4000,
      precoPedido: 2000,
      precoMinimo: 1400,
    });
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.mensagem.includes("lote"))).toBe(true);
  });
});

describe("queda automática", () => {
  const item = { precoInicial: 10000, precoMinimo: 7000, entradaVitrine: local("2026-11-02T10:00:00") };

  it("cai 10% do inicial a cada 14 dias até o mínimo", () => {
    expect(precoNaEtapa(cfg, item, 0)).toBe(10000);
    expect(precoNaEtapa(cfg, item, 1)).toBe(9000);
    expect(precoNaEtapa(cfg, item, 2)).toBe(8000);
    expect(precoNaEtapa(cfg, item, 3)).toBe(7000);
    expect(precoNaEtapa(cfg, item, 4)).toBe(7000);
    expect(etapaDoMinimo(cfg, item)).toBe(3);
  });

  it("arredonda cada queda de R$ 5 em R$ 5 para baixo", () => {
    const i = { precoInicial: 13700, precoMinimo: 9500 };
    expect(precoNaEtapa(cfg, i, 1)).toBe(12000); // 123,30 → 120
    expect(precoNaEtapa(cfg, i, 2)).toBe(10500); // 109,60 → 105
    expect(precoNaEtapa(cfg, i, 3)).toBe(9500); // 95,90 → 95
  });

  it("nunca fica abaixo do mínimo, mesmo com o arredondamento", () => {
    const i = { precoInicial: 10000, precoMinimo: 6800 };
    expect(precoNaEtapa(cfg, i, 3)).toBe(7000);
    expect(precoNaEtapa(cfg, i, 4)).toBe(6800);
  });

  it("conta os dias pelo calendário da loja (America/Araguaina)", () => {
    const tarde = { ...item, entradaVitrine: local("2026-11-02T23:30:00") };
    expect(etapaAtual(cfg, tarde, local("2026-11-15T23:59:00"))).toBe(0);
    expect(etapaAtual(cfg, tarde, local("2026-11-16T00:01:00"))).toBe(1);
  });

  it("mostra preço de hoje, próxima queda e linha do tempo", () => {
    const s = situacaoPreco(cfg, item, local("2026-11-20T12:00:00"));
    expect(s.etapa).toBe(1);
    expect(s.precoHoje).toBe(9000);
    expect(s.proximaQueda?.preco).toBe(8000);
    expect(dataLocal(s.proximaQueda!.data)).toBe("2026-11-30");
    expect(s.linhaDoTempo.map((l) => l.preco)).toEqual([10000, 9000, 8000, 7000]);
    expect(s.noMinimo).toBe(false);
  });

  it("no mínimo não há próxima queda", () => {
    const s = situacaoPreco(cfg, item, local("2026-12-20T12:00:00"));
    expect(s.noMinimo).toBe(true);
    expect(s.proximaQueda).toBeNull();
  });

  it("intervalo e percentual vêm da configuração", () => {
    const c = clone(cfg);
    c.queda.intervalo_dias = 7;
    c.queda.pct_do_inicial = 0.05;
    expect(etapaAtual(c, item, local("2026-11-16T10:00:00"))).toBe(2);
    expect(precoNaEtapa(c, item, 2)).toBe(9000);
  });

  it("prazo vencido no mínimo: aviso e depois doação (+7 dias)", () => {
    const p = prazosFinais(cfg, item);
    // mínimo em 42 dias (14/12) + 14 dias parado = 28/12; doação 7 dias depois = 04/01
    expect(dataLocal(p.vence)).toBe("2026-12-28");
    expect(dataLocal(p.doacao)).toBe("2027-01-04");
  });
});

describe("comissão", () => {
  it("loja 40%; dono 60% em Pix ou 70% em crédito", () => {
    expect(dividirVenda(cfg, 10000, "pix")).toMatchObject({ valorDono: 6000, valorLoja: 4000 });
    expect(dividirVenda(cfg, 10000, "credito")).toMatchObject({ valorDono: 7000, valorLoja: 3000 });
  });
  it("centavos quebrados: dono arredonda para baixo e a soma fecha", () => {
    const d = dividirVenda(cfg, 9999, "pix");
    expect(d.valorDono).toBe(5999);
    expect(d.valorDono + d.valorLoja).toBe(9999);
  });
  it("comissão por faixa fica desligada por padrão e funciona quando ligada", () => {
    const c = clone(cfg);
    c.comissao.por_faixa.ativo = true;
    expect(dividirVenda(c, 8000, "pix").valorDono).toBe(4400); // loja 45%
    expect(dividirVenda(c, 8000, "credito").valorDono).toBe(5200); // +10%
    expect(dividirVenda(c, 100000, "pix").valorDono).toBe(70000); // loja 30%
    expect(dividirVenda(cfg, 8000, "pix").valorDono).toBe(4800); // padrão continua 60%
  });
  it("simulação do valor a receber", () => {
    expect(simularRecebimento(cfg, 19500, 13650)).toEqual({
      pix: { noPedido: 11700, noMinimo: 8190 },
      credito: { noPedido: 13650, noMinimo: 9555 },
    });
  });
});

describe("reserva", () => {
  it("sinal de 10%, ou 15% acima de R$ 300", () => {
    expect(calcularSinal(cfg, 20000)).toEqual({ pct: 0.1, valor: 2000 });
    expect(calcularSinal(cfg, 30000)).toEqual({ pct: 0.1, valor: 3000 });
    expect(calcularSinal(cfg, 30001).pct).toBe(0.15);
    expect(calcularSinal(cfg, 45000).valor).toBe(6750);
  });
  it("sinal descontado na retirada dentro de 48h", () => {
    const r = { precoTravado: 20000, sinal: 2000, pagaEm: local("2026-11-10T10:00:00") };
    expect(situacaoRetirada(cfg, r, local("2026-11-12T09:59:00"))).toEqual({ podeRetirar: true, restante: 18000 });
  });
  it("depois de 48h o sinal fica retido", () => {
    const r = { precoTravado: 20000, sinal: 2000, pagaEm: local("2026-11-10T10:00:00") };
    expect(situacaoRetirada(cfg, r, local("2026-11-12T10:01:00"))).toEqual({
      podeRetirar: false,
      motivo: "expirada",
      sinalRetido: 2000,
    });
  });
  it("código de retirada tem 6 caracteres legíveis", () => {
    const c = gerarCodigoRetirada();
    expect(c).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{6}$/);
  });
});

describe("repasse", () => {
  const vendidaEm = local("2026-11-03T15:00:00"); // terça

  it("liberado só depois do prazo de troca de 7 dias", () => {
    const v = { vendidaEm, pagamentos: [{ metodo: "pix" as const, valor: 10000 }] };
    expect(dataLocal(fimPrazoTroca(cfg, vendidaEm))).toBe("2026-11-11");
    expect(liberacaoRepasse(cfg, v, local("2026-11-10T23:00:00")).liberado).toBe(false);
    expect(liberacaoRepasse(cfg, v, local("2026-11-11T08:00:00")).liberado).toBe(true);
  });

  it("no cartão de crédito só depois do recebimento", () => {
    const v = {
      vendidaEm,
      pagamentos: [{ metodo: "cartao_credito" as const, valor: 10000, recebidoEm: local("2026-12-03T10:00:00") }],
    };
    const antes = liberacaoRepasse(cfg, v, local("2026-11-20T10:00:00"));
    expect(antes).toMatchObject({ liberado: false, motivo: "aguardando_cartao" });
    const depois = liberacaoRepasse(cfg, v, local("2026-12-04T10:00:00"));
    expect(depois.liberado).toBe(true);
    // previsão: próximo lote de terça depois do recebimento (03/12 é quinta → 08/12)
    expect(dataLocal(previsaoPagamento(cfg, v, local("2026-11-20T10:00:00"))!)).toBe("2026-12-08");
  });

  it("cartão sem data de recebimento segura o repasse", () => {
    const v = { vendidaEm, pagamentos: [{ metodo: "cartao_credito" as const, valor: 10000, recebidoEm: null }] };
    expect(liberacaoRepasse(cfg, v, local("2026-12-30T10:00:00")).liberado).toBe(false);
  });

  it("estorno ou troca em aberto bloqueiam", () => {
    const base = { vendidaEm, pagamentos: [{ metodo: "pix" as const, valor: 1 }] };
    expect(liberacaoRepasse(cfg, { ...base, estornada: true }, local("2026-12-30T10:00:00")).liberado).toBe(false);
    expect(liberacaoRepasse(cfg, { ...base, trocaEmAberto: true }, local("2026-12-30T10:00:00")).liberado).toBe(false);
  });

  it("lote semanal às terças", () => {
    expect(dataLocal(proximoLote(cfg, local("2026-11-11T08:00:00")))).toBe("2026-11-17"); // quarta → terça
    expect(dataLocal(proximoLote(cfg, local("2026-11-17T08:00:00")))).toBe("2026-11-17"); // terça → hoje
    const c = clone(cfg);
    c.repasse.dia_semana_lote = 5; // sexta
    expect(dataLocal(proximoLote(c, local("2026-11-11T08:00:00")))).toBe("2026-11-13");
  });
});

describe("estorno", () => {
  const venda = {
    vendidaEm: local("2026-11-03T15:00:00"),
    pagamentos: [
      { id: "p1", metodo: "pix" as const, valor: 2000 },
      { id: "p2", metodo: "cartao_credito" as const, valor: 8000 },
    ],
    repassePago: false,
    numeroSerieEntrada: null,
  };

  it("dentro do prazo devolve cada pagamento pelo mesmo meio", () => {
    const r = avaliarEstorno(cfg, venda, { motivo: "arrependimento" }, local("2026-11-05T10:00:00"));
    expect(r.permitido).toBe(true);
    if (r.permitido) {
      expect(r.total).toBe(10000);
      expect(r.devolucoes.map((d) => d.via)).toEqual(["pix", "cartao"]);
      expect(r.itemVoltaParaVitrine).toBe(true);
    }
  });
  it("defeito não informado: devolve, mas o item não volta para a vitrine", () => {
    const r = avaliarEstorno(cfg, venda, { motivo: "defeito_nao_informado" }, local("2026-11-05T10:00:00"));
    expect(r.permitido && r.itemVoltaParaVitrine).toBe(false);
    expect(r.permitido).toBe(true);
  });
  it("fora do prazo de troca é negado", () => {
    const r = avaliarEstorno(cfg, venda, { motivo: "arrependimento" }, local("2026-11-11T00:01:00"));
    expect(r.permitido).toBe(false);
  });
  it("defeito declarado e aceito não dá direito a devolução", () => {
    const r = avaliarEstorno(cfg, venda, { motivo: "defeito_declarado" }, local("2026-11-04T10:00:00"));
    expect(r.permitido).toBe(false);
  });
  it("repasse já pago bloqueia", () => {
    const r = avaliarEstorno(cfg, { ...venda, repassePago: true }, { motivo: "arrependimento" }, local("2026-11-04T10:00:00"));
    expect(r.permitido).toBe(false);
  });
  it("número de série diferente bloqueia e gera alerta", () => {
    const r = avaliarEstorno(
      cfg,
      { ...venda, numeroSerieEntrada: "SN-123" },
      { motivo: "arrependimento", numeroSerieDevolvido: "SN-999" },
      local("2026-11-04T10:00:00"),
    );
    expect(r).toMatchObject({ permitido: false, alertaSerie: true });
    const ok = avaliarEstorno(
      cfg,
      { ...venda, numeroSerieEntrada: "SN-123" },
      { motivo: "arrependimento", numeroSerieDevolvido: " sn-123 " },
      local("2026-11-04T10:00:00"),
    );
    expect(ok.permitido).toBe(true);
  });
});

describe("validação da configuração", () => {
  it("padrão é válido", () => {
    expect(validarConfig(cfg)).toEqual([]);
  });
  it("recusa comissão que não fecha 100%", () => {
    const c = clone(cfg);
    c.comissao.loja_pct = 0.5;
    expect(validarConfig(c).length).toBeGreaterThan(0);
  });
});
