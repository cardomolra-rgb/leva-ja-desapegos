-- =====================================================================
-- Dados iniciais: categorias da fase 1, configuração padrão e termos v1
-- (a configuração pode ser alterada no painel; isto é só o ponto de partida)
-- =====================================================================

insert into categorias (slug, nome, prefixo, ativa, limite_itens, ordem, checklist) values
  ('moda', 'Moda', 'MOD', true, 300, 1,
   '["Sem cheiro forte", "Zíperes e botões funcionando", "Sem furos ou rasgos não descritos", "Etiqueta de tamanho conferida", "Lavado / limpo"]'),
  ('casa-decoracao', 'Casa e Decoração', 'CAS', true, 200, 2,
   '["Sem trincas ou lascas não descritas", "Limpo", "Medidas conferidas", "Peças completas"]'),
  ('utensilios', 'Utensílios não elétricos', 'UTL', true, 200, 3,
   '["Sem ferrugem", "Tampa e peças completas", "Limpo e sem resíduos", "Antiaderente sem descascar (se houver)"]'),
  ('ferramentas-manuais', 'Ferramentas manuais', 'FER', true, 150, 4,
   '["Sem ferrugem que comprometa o uso", "Cabo firme", "Peças e pontas completas", "Testada"]'),
  ('sobras-material', 'Sobras de material', 'SOB', true, 150, 5,
   '["Quantidade conferida", "Dentro da validade (se houver)", "Embalagem identificada", "Sem umidade"]'),
  ('eletronicos', 'Eletrônicos', 'ELE', false, 100, 6,
   '["Liga e funciona", "Número de série anotado", "Acessórios conferidos", "Dados apagados", "Testado na tomada da loja"]'),
  ('ferramentas-eletricas', 'Ferramentas elétricas', 'FEL', false, 80, 7,
   '["Liga e funciona", "Número de série anotado", "Cabo sem emenda", "Testada"]');

insert into codigos_sequencia (prefixo) select prefixo from categorias;

insert into configuracoes (dados, ativa, motivo) values (
$cfg$
{
  "regua": {
    "moda": {
      "novo": 0.5,
      "seminovo": 0.4,
      "usado_bom": 0.3,
      "com_marcas": 0.15
    },
    "casa-decoracao": {
      "novo": 0.6,
      "seminovo": 0.5,
      "usado_bom": 0.4,
      "com_marcas": 0.25
    },
    "utensilios": {
      "novo": 0.6,
      "seminovo": 0.5,
      "usado_bom": 0.4,
      "com_marcas": 0.25
    },
    "ferramentas-manuais": {
      "novo": 0.65,
      "seminovo": 0.55,
      "usado_bom": 0.45,
      "com_marcas": 0.3
    },
    "sobras-material": {
      "novo": 0.7,
      "seminovo": 0.6,
      "usado_bom": 0.5,
      "com_marcas": 0.35
    },
    "eletronicos": {
      "novo": 0.6,
      "seminovo": 0.5,
      "usado_bom": 0.35,
      "com_marcas": 0.2
    },
    "ferramentas-eletricas": {
      "novo": 0.6,
      "seminovo": 0.5,
      "usado_bom": 0.4,
      "com_marcas": 0.25
    }
  },
  "regua_arredondamento_centavos": 500,
  "minimo_max_pct": 0.7,
  "queda": {
    "intervalo_dias": 14,
    "pct_do_inicial": 0.1,
    "arredondamento_centavos": 500,
    "arredondamento": "baixo"
  },
  "comissao": {
    "loja_pct": 0.4,
    "dono_pix_pct": 0.6,
    "dono_credito_pct": 0.7,
    "por_faixa": {
      "ativo": false,
      "faixas": [
        {
          "ate_centavos": 10000,
          "loja_pct": 0.45
        },
        {
          "ate_centavos": 50000,
          "loja_pct": 0.4
        },
        {
          "ate_centavos": null,
          "loja_pct": 0.3
        }
      ],
      "bonus_credito_pct": 0.1
    }
  },
  "valor_minimo_item_centavos": 2500,
  "reserva": {
    "sinal_pct": 0.1,
    "sinal_pct_alto": 0.15,
    "limite_alto_centavos": 30000,
    "prazo_retirada_horas": 48
  },
  "repasse": {
    "prazo_troca_dias": 7,
    "dia_semana_lote": 2,
    "exige_recebimento_cartao": true
  },
  "prazo_final": {
    "dias_no_minimo": 14,
    "dias_aviso": 7
  },
  "pix_expira_minutos": 30
}
$cfg$::jsonb, true, 'Configuração inicial');

insert into termos (tipo, versao, texto) values
  ('uso', '1.0', 'Termos de uso da Leva Já Desapegos. Venda só com retirada na loja. Não há chat nem negociação de preço: os preços caem automaticamente conforme as regras publicadas. [TEXTO JURÍDICO A REVISAR]'),
  ('privacidade', '1.0', 'Política de privacidade (LGPD). Coletamos CPF, documento e selfie para segurança das transações; ficam em armazenamento privado e são apagados ao fim do prazo de retenção. [TEXTO JURÍDICO A REVISAR]'),
  ('consignacao', '1.0', 'Contrato de consignação. O item fica na loja com preço que cai automaticamente até o mínimo combinado. A loja retém a comissão vigente e repassa o restante após o prazo de troca, por Pix na chave do CPF cadastrado ou em crédito na loja. Vencido o prazo no mínimo, o dono é avisado e tem 7 dias para retirar; depois o item é doado. [TEXTO JURÍDICO A REVISAR]'),
  ('item_com_defeito', '1.0', 'Li e aceito o item no estado descrito, inclusive os defeitos informados na ficha. Defeitos descritos não dão direito a troca.');
