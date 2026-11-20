-- Armazenamento de arquivos no próprio Postgres — usado só quando não há S3 configurado
-- (ambiente de testes). Acesso apenas pelo servidor (RLS ligado, sem políticas).
create table arquivos (
  chave     text primary key,
  tipo      text not null,
  dados     bytea not null,
  criado_em timestamptz not null default now()
);
alter table arquivos enable row level security;
