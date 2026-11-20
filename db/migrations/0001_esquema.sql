-- =====================================================================
-- Leva Já Desapegos — Fase 1 (MVP) — esquema principal
-- Dinheiro sempre em centavos (bigint). Datas em timestamptz (exibidas em America/Araguaina).
-- =====================================================================


create schema if not exists app;

-- ---------- Tipos ----------
create type papel_usuario as enum ('cliente', 'atendente', 'gestor');
create type estado_item as enum ('novo', 'seminovo', 'usado_bom', 'com_marcas');
create type status_item as enum (
  'pre_avaliacao',      -- enviado pelo dono no "Quero vender"
  'contraproposta',     -- loja propôs outro preço; aguarda o dono
  'aguardando_entrega', -- aprovado na pré-avaliação; dono vai levar
  'recusado',
  'vitrine',
  'reservado',
  'vendido',
  'vencido',            -- prazo vencido no mínimo; dono avisado
  'doado',
  'devolvido_dono',
  'cancelado'
);
create type modalidade_repasse as enum ('pix', 'credito');
create type metodo_pagamento as enum ('pix', 'cartao_credito', 'cartao_debito', 'credito_loja', 'dinheiro');
create type status_pagamento as enum ('pendente', 'aprovado', 'recusado', 'expirado', 'estornado');
create type status_reserva as enum ('aguardando_pagamento', 'paga', 'retirada', 'expirada', 'cancelada');
create type status_repasse as enum ('aguardando', 'liberado', 'em_lote', 'pago', 'cancelado');

-- ---------- Função utilitária ----------
create or replace function app.tocar_atualizado_em() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------- Pessoas ----------
create table perfis (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            text not null unique,          -- id do usuário no Neon Auth
  nome                    text not null,
  email                   text,
  cpf                     char(11) unique check (cpf ~ '^[0-9]{11}$'),
  telefone                text check (telefone ~ '^[0-9]{10,13}$'),
  papel                   papel_usuario not null default 'cliente',
  doc_foto_path           text,                          -- armazenamento privado
  selfie_path             text,
  telefone_verificado_em  timestamptz,
  identidade_verificada_em timestamptz,
  chave_pix               text,                          -- sempre o CPF (troca só presencial)
  chave_pix_validada_em   timestamptz,
  prefs_aviso             jsonb not null default '{"whatsapp": true, "app": true}',
  retencao_documentos_ate date,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now(),
  constraint chave_pix_e_cpf check (chave_pix is null or chave_pix = cpf)
);
create trigger perfis_atualizado before update on perfis for each row execute function app.tocar_atualizado_em();

create table codigos_verificacao (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references perfis(id) on delete cascade,
  canal       text not null check (canal in ('sms', 'whatsapp')),
  destino     text not null,
  codigo_hash text not null,
  tentativas  int not null default 0,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  criado_em   timestamptz not null default now()
);
create index on codigos_verificacao (perfil_id, criado_em desc);

-- ---------- Configuração (versionada; uma ativa) ----------
create table configuracoes (
  id          bigint generated always as identity primary key,
  dados       jsonb not null,
  ativa       boolean not null default false,
  motivo      text,
  criado_por  uuid references perfis(id),
  criado_em   timestamptz not null default now()
);
create unique index configuracoes_uma_ativa on configuracoes (ativa) where ativa;

create table categorias (
  id            smallint generated always as identity primary key,
  slug          text not null unique,
  nome          text not null,
  prefixo       char(3) not null unique,       -- usado no código curto (ex.: CAS-4012)
  ativa         boolean not null default true,
  limite_itens  int not null default 200 check (limite_itens >= 0),
  checklist     jsonb not null default '[]',   -- itens obrigatórios na avaliação
  ordem         smallint not null default 0
);

create table codigos_sequencia (
  prefixo char(3) primary key,
  ultimo  int not null default 4000
);

-- ---------- Termos e aceites ----------
create table termos (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('uso', 'consignacao', 'privacidade', 'item_com_defeito')),
  versao        text not null,
  texto         text not null,
  publicado_em  timestamptz not null default now(),
  unique (tipo, versao)
);

create table aceites (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references perfis(id),
  termo_id    bigint not null references termos(id),
  item_id     uuid,                        -- para aceite de item com defeito
  aceito_em   timestamptz not null default now(),
  ip          inet,
  aparelho    text,
  pdf_path    text                         -- PDF enviado ao usuário
);
create index on aceites (perfil_id);

-- ---------- Itens ----------
create table itens (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,                              -- CAS-4012 (gerado na aprovação)
  dono_id             uuid not null references perfis(id),
  categoria_id        smallint not null references categorias(id),
  titulo              text not null check (length(titulo) between 3 and 120),
  descricao           text,
  marca               text,
  medidas             text,
  numero_serie        text,
  estado              estado_item not null,                     -- informado pelo dono
  estado_confirmado   estado_item,                              -- confirmado na avaliação
  preco_novo          bigint not null check (preco_novo > 0),
  teto                bigint not null check (teto >= 0),
  preco_inicial       bigint not null check (preco_inicial > 0),
  preco_minimo        bigint not null check (preco_minimo > 0),
  preco_atual         bigint not null,
  preco_proposto_loja bigint,                                   -- contraproposta
  etapa_queda         smallint not null default 0,
  modalidade_repasse  modalidade_repasse not null default 'pix',
  tem_defeito         boolean not null default false,
  defeitos            text[] not null default '{}',             -- atalhos: risco, mancha, falta_peca, desgaste
  defeito_obs         text,
  selos               text[] not null default '{}',             -- testado, conferido
  status              status_item not null default 'pre_avaliacao',
  motivo_recusa       text,
  entrega_agendada_em timestamptz,
  entrada_vitrine_em  timestamptz,
  no_minimo_em        timestamptz,
  vence_em            timestamptz,
  doacao_em           timestamptz,
  vendido_em          timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint minimo_ate_inicial check (preco_minimo <= preco_inicial),
  constraint atual_entre_minimo_e_inicial check (preco_atual between preco_minimo and preco_inicial),
  constraint defeito_com_obs check (not tem_defeito or coalesce(length(defeito_obs), 0) > 0 or cardinality(defeitos) > 0)
);
create trigger itens_atualizado before update on itens for each row execute function app.tocar_atualizado_em();
create index itens_vitrine on itens (categoria_id, preco_atual) where status in ('vitrine', 'reservado');
create index itens_dono on itens (dono_id);
create index itens_status on itens (status);
create index itens_busca on itens using gin (to_tsvector('portuguese', titulo || ' ' || coalesce(descricao, '') || ' ' || coalesce(marca, '')));

create table item_fotos (
  id        uuid primary key default gen_random_uuid(),
  item_id   uuid not null references itens(id) on delete cascade,
  path      text not null,
  origem    text not null check (origem in ('dono', 'loja')),
  angulo    text,                          -- frente, verso, detalhe, defeito, etiqueta...
  ordem     smallint not null default 0,
  criado_em timestamptz not null default now()
);
create index on item_fotos (item_id, ordem);

create table historico_precos (
  id        bigint generated always as identity primary key,
  item_id   uuid not null references itens(id) on delete cascade,
  etapa     smallint not null,
  preco     bigint not null,
  motivo    text not null check (motivo in ('entrada', 'queda', 'ajuste')),
  criado_em timestamptz not null default now()
);
create index on historico_precos (item_id, criado_em);

create table avaliacoes (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references itens(id) on delete cascade,
  avaliador_id      uuid not null references perfis(id),
  etapa             text not null check (etapa in ('pre', 'presencial')),
  estado_confirmado estado_item,
  checklist         jsonb not null default '{}',
  decisao           text not null check (decisao in ('aprovado', 'contraproposta', 'recusado')),
  preco_proposto    bigint,
  motivo            text,
  criado_em         timestamptz not null default now(),
  constraint recusa_com_motivo check (decisao <> 'recusado' or coalesce(length(motivo), 0) > 0),
  constraint contraproposta_com_preco check (decisao <> 'contraproposta' or preco_proposto > 0)
);
create index on avaliacoes (item_id);

create table favoritos (
  perfil_id uuid not null references perfis(id) on delete cascade,
  item_id   uuid not null references itens(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (perfil_id, item_id)
);

-- ---------- Pagamentos, reservas e vendas ----------
create table pagamentos (
  id              uuid primary key default gen_random_uuid(),
  finalidade      text not null check (finalidade in ('sinal', 'venda', 'devolucao')),
  metodo          metodo_pagamento not null,
  valor           bigint not null check (valor > 0),
  status          status_pagamento not null default 'pendente',
  pagador_id      uuid references perfis(id),
  gateway         text,                    -- mock, mercadopago...
  gateway_id      text,
  pix_copia_cola  text,
  pix_qr_base64   text,
  expira_em       timestamptz,
  aprovado_em     timestamptz,
  recebido_em     timestamptz,             -- liquidação (cartão de crédito)
  payload         jsonb,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (gateway, gateway_id)
);
create trigger pagamentos_atualizado before update on pagamentos for each row execute function app.tocar_atualizado_em();

create table reservas (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references itens(id),
  cliente_id       uuid not null references perfis(id),
  preco_travado    bigint not null,
  sinal            bigint not null check (sinal > 0),
  sinal_pct        numeric(5,4) not null,
  status           status_reserva not null default 'aguardando_pagamento',
  codigo_retirada  char(6) not null,
  pagamento_id     uuid references pagamentos(id),
  aceite_id        uuid references aceites(id),     -- "Li e aceito o item no estado descrito"
  paga_em          timestamptz,
  retirar_ate      timestamptz,
  expira_pagamento_em timestamptz not null,
  encerrada_em     timestamptz,
  criado_em        timestamptz not null default now()
);
-- no máximo uma reserva viva por item
create unique index reservas_uma_ativa on reservas (item_id) where status in ('aguardando_pagamento', 'paga');
create index on reservas (cliente_id);
create index on reservas (codigo_retirada) where status = 'paga';

create table vendas (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null unique references itens(id),
  comprador_id    uuid references perfis(id),
  reserva_id      uuid references reservas(id),
  atendente_id    uuid references perfis(id),
  valor_total     bigint not null check (valor_total > 0),
  sinal_abatido   bigint not null default 0,
  etapa_queda     smallint not null,
  preco_inicial   bigint not null,
  troca_ate       timestamptz not null,
  status          text not null default 'concluida' check (status in ('concluida', 'estornada')),
  criado_em       timestamptz not null default now()
);
create index on vendas (criado_em);

create table venda_pagamentos (
  venda_id     uuid not null references vendas(id),
  pagamento_id uuid not null references pagamentos(id),
  primary key (venda_id, pagamento_id)
);

create table repasses (
  id            uuid primary key default gen_random_uuid(),
  venda_id      uuid not null unique references vendas(id),
  dono_id       uuid not null references perfis(id),
  modalidade    modalidade_repasse not null,
  valor_venda   bigint not null,
  pct_dono      numeric(5,4) not null,
  valor         bigint not null check (valor >= 0),
  status        status_repasse not null default 'aguardando',
  liberado_em   timestamptz,
  previsto_para date,
  pago_em       timestamptz,
  criado_em     timestamptz not null default now()
);
create index on repasses (dono_id);
create index on repasses (status);

-- crédito na loja: livro-razão (saldo = soma)
create table creditos (
  id         bigint generated always as identity primary key,
  perfil_id  uuid not null references perfis(id),
  valor      bigint not null check (valor <> 0),
  origem     text not null check (origem in ('repasse', 'compra', 'estorno', 'ajuste')),
  ref_id     uuid,
  criado_por uuid references perfis(id),
  criado_em  timestamptz not null default now()
);
create index on creditos (perfil_id);

create view saldos_credito with (security_invoker = true) as
  select perfil_id, sum(valor)::bigint as saldo from creditos group by perfil_id;

-- ---------- Caixa de avisos (registro oficial) ----------
create table avisos (
  id        uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfis(id) on delete cascade,
  tipo      text not null,                 -- aprovacao, venda, repasse, reserva, fim_prazo, desejo...
  titulo    text not null,
  corpo     text not null,
  item_id   uuid references itens(id),
  link      text,
  lido_em   timestamptz,
  enviado_whatsapp_em timestamptz,
  criado_em timestamptz not null default now()
);
create index on avisos (perfil_id, criado_em desc);

-- ---------- Registro de eventos (append-only) ----------
create table eventos (
  id        bigint generated always as identity primary key,
  tipo      text not null check (tipo in (
    'cadastro', 'entrada', 'pre_avaliacao', 'aprovacao', 'contraproposta', 'recusa', 'vitrine', 'queda',
    'visualizacao', 'favorito', 'desfavorito', 'busca_sem_resultado', 'busca',
    'reserva', 'pagamento', 'retirada', 'desistencia', 'reserva_expirada', 'venda',
    'repasse', 'devolucao', 'estorno', 'doacao', 'vencimento', 'aviso_dono', 'aceite_termo',
    'config_alterada', 'etiqueta_impressa', 'login'
  )),
  perfil_id uuid references perfis(id),
  item_id   uuid references itens(id),
  dados     jsonb not null default '{}',
  ip        inet,
  criado_em timestamptz not null default now()
);
create index on eventos (tipo, criado_em);
create index on eventos (item_id);
create index on eventos (criado_em);

create or replace function app.eventos_imutaveis() returns trigger language plpgsql as $$
begin
  raise exception 'eventos são somente inserção';
end $$;
create trigger eventos_sem_update before update or delete on eventos
  for each row execute function app.eventos_imutaveis();

-- ---------- Códigos curtos (CAS-4012) ----------
create or replace function app.proximo_codigo(p_prefixo char(3)) returns text language plpgsql as $$
declare n int;
begin
  insert into codigos_sequencia (prefixo) values (p_prefixo) on conflict do nothing;
  update codigos_sequencia set ultimo = ultimo + 1 where prefixo = p_prefixo returning ultimo into n;
  return p_prefixo || '-' || n;
end $$;

-- ---------- Ocupação por categoria ----------
create view ocupacao_categorias with (security_invoker = true) as
  select c.id, c.slug, c.nome, c.ativa, c.limite_itens,
         count(i.id) filter (where i.status in ('aguardando_entrega', 'vitrine', 'reservado', 'vencido')) as ocupados,
         count(i.id) filter (where i.status in ('pre_avaliacao', 'contraproposta')) as em_analise
  from categorias c
  left join itens i on i.categoria_id = c.id
  group by c.id;
