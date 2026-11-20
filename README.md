# Leva Já Desapegos — sistema (Fase 1 / MVP)

> **Leva Já. O preço só baixa.**

Um único projeto Next.js (PWA instalável, mobile-first) com duas áreas ligadas ao mesmo banco Neon:

| Área | Caminho | Quem usa |
|---|---|---|
| Site/app do cliente | `/`, `/catalogo`, `/item/[id]`, `/reserva/[id]`, `/vender`, `/conta` | clientes e donos de itens |
| App de gestão | `/gestao/*` (painel, entrada, caixa, estoque, regras) | Gestor e Atendente |

Instale no celular pelo navegador: "Adicionar à tela inicial". O atalho do app já traz "Caixa" e "Entrada".

---

## O que está pronto na Fase 1

- **Modelo de dados + migrações** (`db/migrations`): itens, fotos, histórico de preço, avaliações, reservas, pagamentos, vendas, repasses, crédito (livro-razão), avisos, termos/aceites, eventos (somente inserção), configuração versionada.
- **Row Level Security**: cliente só vê os próprios dados; visitante só vê a vitrine; atendente não vê repasses nem altera configurações; cliente não muda papel, CPF nem chave Pix (troca só presencial).
- **Autenticação** com Neon Auth + cadastro completo: CPF (com dígito verificador), código por WhatsApp/SMS, foto do documento e selfie em armazenamento privado com prazo de retenção.
- **Catálogo** com categorias, busca, filtros, preço de hoje, original riscado, data/valor da próxima queda, selos Testado/Conferido e aviso de defeito. Busca sem resultado vira evento (demanda não atendida).
- **Ficha do item** com fotos, estado, medidas, linha do tempo do preço e defeitos; com defeito, o botão de reservar só libera após "Li e aceito o item no estado descrito" (aceite gravado com data/hora, IP, aparelho, versão do termo + PDF).
- **Reserva com Pix**: sinal 10%/15%, Pix dinâmico, confirmação automática pelo webhook, código de retirada, expiração em 48 h com sinal retido.
- **Quero vender**: fotos, categoria, estado, preço do novo, teto calculado ao vivo (bloqueia acima), mínimo (≤ 70%), atalhos de defeito, simulação Pix × crédito, agendamento da entrega, contrato de consignação. Categoria cheia não aceita pré-avaliação.
- **Entrada e avaliação**: fila com teto; pré-avaliação (aprovar / propor preço / recusar com motivo); avaliação presencial com câmera (fotos padronizadas por ângulo), estado confirmado (teto recalculado), defeitos, selos, nº de série e checklist obrigatório por categoria.
- **Etiqueta térmica 50×30 mm**: QR + código curto (ex.: CAS-4012) + nome, sem preço.
- **Queda automática** (cron diário): queda de 10% do inicial a cada 14 dias, arredondada de R$ 5 em R$ 5, até o mínimo; prazo vencido no mínimo → aviso ao dono → +7 dias → doação.
- **Caixa**: leitura do QR pela câmera mostrando a foto para conferência, cobrança em Pix (dinâmico), cartão, crédito na loja (por CPF, com saldo) ou dinheiro, pagamento misto, retirada de reserva com desconto do sinal. Gera o repasse com data prevista.
- **Painel básico**: faturamento, comissão, lucro estimado, giro médio, taxa de venda, ticket médio, vendas por dia, desempenho por categoria, etapa em que vendem, entradas × saídas e alertas.
- **Regras configuráveis no painel** (nada fixo no código): régua por categoria/estado, mínimo, queda, comissão (com faixa pronta e desligada), valor mínimo, reserva, prazos, dia do lote, categorias ativas e limites. Cada alteração vira uma nova versão com histórico.
- **Camada de pagamento isolada** (`src/lib/pagamentos`): adaptador Mercado Pago (Pix, webhook com assinatura, devolução) + gateway de teste. Trocar para Asaas = escrever um adaptador.

## Testes

```bash
npm test
```

61 testes, sem precisar do Neon:

- `tests/regras.test.ts` — régua, queda (incluindo fuso de Araguaína e arredondamento), comissão (inclusive por faixa), reserva, repasse (prazo de troca, cartão, lote de terça) e estorno.
- `tests/banco.test.ts` — aplica as migrações num Postgres real embutido (PGlite) e testa RLS e restrições.
- `tests/operacoes.test.ts` — fluxos completos: entrada → queda → reserva → Pix → retirada → repasse; Pix não pago; sinal retido; prazo vencido e doação; crédito na loja.
- `tests/pdf.test.ts` — comprovante de aceite em PDF.

---

## Deploy (Neon + Vercel)

### 1. Neon
1. Crie o projeto **levaja** na região **São Paulo (aws-sa-east-1)**.
2. Crie o branch **dev** a partir do `main` (o `main` é produção).
3. Ative **Neon Auth** (Managed Better Auth) no projeto e copie o `NEON_AUTH_BASE_URL`. Habilite login por e-mail/senha.
4. Crie um bucket privado no **Object Storage** do Neon (ou use qualquer S3) e gere as chaves.
5. Rode as migrações primeiro no **dev**:
   ```bash
   npm install
   DATABASE_URL_UNPOOLED="<string do branch dev, sem -pooler>" npm run db:migrate
   ```
6. Depois de testar, faça um snapshot/branch de backup do `main` e rode no `main`.

> Backups e restauração: use os snapshots e o *point-in-time restore* do Neon; antes de cada migração em produção crie um branch `backup-AAAAMMDD`.

### 2. Vercel
1. Importe o repositório; framework Next.js; região `gru1` (já em `vercel.json`).
2. Variáveis de ambiente (ver `.env.example`):
   - **Production**: `DATABASE_URL` (main, com `-pooler`), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `S3_*`, `PAYMENT_GATEWAY=mercadopago`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MESSAGING_PROVIDER=whatsapp`, `WHATSAPP_*`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `GESTORES_INICIAIS`.
   - **Preview/Development**: as mesmas, apontando para o branch **dev** e `PAYMENT_GATEWAY=mock`.
3. Crons (em `vercel.json`):
   - `/api/cron/queda-precos` — todo dia 06:05 UTC (03:05 em Araguaína): queda, vencimento, doação e reservas vencidas.
   - `/api/cron/prazos` — a cada 15 min: Pix não pago e reservas não retiradas. **Exige plano Pro**; no Hobby, remova essa linha (as reservas também expiram sozinhas quando alguém tenta reservar ou o caixa busca o item, e no cron diário).
4. Mercado Pago: em *Suas integrações → Webhooks*, cadastre `https://SEU-DOMINIO/api/pagamentos/webhook` (evento "Pagamentos") e copie a assinatura secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
5. WhatsApp Business: aprove o modelo de autenticação `codigo_verificacao` (pt_BR).
6. Primeiro acesso: o e-mail listado em `GESTORES_INICIAIS` vira Gestor ao entrar. Para criar Atendentes, por enquanto: `update perfis set papel = 'atendente' where email = '...'` no SQL Editor do Neon.

### Desenvolvimento local
```bash
cp .env.example .env.local   # aponte para o branch dev; PAYMENT_GATEWAY=mock
npm run dev
```
Com o gateway mock, as telas de Pix mostram o botão "(teste) Simular pagamento".

---

## Antes de abrir ao público (pendências da Fase 1)
- **Textos jurídicos**: os termos semeados estão marcados `[TEXTO JURÍDICO A REVISAR]`. Publique as versões finais inserindo uma nova linha em `termos` (nova versão; os aceites antigos continuam válidos para a versão aceita).
- **Conciliação do cartão de crédito**: preencha `pagamentos.recebido_em` quando a maquininha liquidar (planilha/integração na Fase 2). Sem isso o repasse de vendas no crédito fica "aguardando".
- **Pagamento de repasses**: a Fase 1 gera e mostra os repasses com data prevista; o lote semanal com aprovação em um clique é da Fase 2.
- **Gestão de usuários da equipe** pelo painel (hoje via SQL).
- Testar a impressora térmica real com a página de etiqueta (50×30 mm, margem zero, escala 100%).

## Próximas fases
**Fase 2** — repasses em lote (terça, aprovação com um clique, transferências Pix em lote via `transferirPix` do gateway), trocas/estornos (as regras já estão em `src/lib/rules/estorno.ts` e testadas), avisos por WhatsApp a partir da tabela `avisos`, desejos ("Estou procurando" + aviso de queda dos favoritos), relatório mensal com recomendações "aprovar" (que gravam nova versão em `configuracoes`), alertas de golpe (mesmo CPF com muitos itens de alto valor, divergência caixa × sistema, devolução com nº de série diferente).

**Fase 3** — Instagram automático, IA na pré-avaliação por foto (identificar o item e sugerir o preço do novo), ativação de eletrônicos e ferramentas elétricas (já existem desativadas, com checklist e régua).

## Estrutura
```
db/migrations/        0001 esquema · 0002 RLS · 0003 dados iniciais
db/migrate.mjs        aplica migrações (registro em schema_migrations)
src/lib/rules/        regras de negócio puras (sem banco) — testadas
src/lib/operacoes.ts  operações transacionais (vitrine, queda, reserva, Pix, venda)
src/lib/pagamentos/   camada de pagamento isolada (Mercado Pago, mock)
src/lib/db.ts         comoUsuario (RLS) / comoServico (cron e webhook)
src/app/(loja)/       telas do cliente
src/app/gestao/       telas de gestão
src/app/api/          auth, webhook, crons, status do Pix, PDF de aceite
tests/                testes
```
