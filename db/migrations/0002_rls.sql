-- =====================================================================
-- Row Level Security
--
-- Como funciona: o app conecta com o usuário dono do banco e, em cada requisição
-- de usuário, abre uma transação que faz:
--     select set_config('app.perfil_id', '<uuid>', true),
--            set_config('app.papel', 'cliente|atendente|gestor', true);
--     set local role app_rls;
-- A partir daí todas as consultas obedecem às políticas abaixo.
-- Rotinas do servidor (cron, webhook de pagamento) rodam sem "set role" (serviço).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls') then
    create role app_rls nologin;
  end if;
end $$;
grant app_rls to current_user;

create or replace function app.perfil_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.perfil_id', true), '')::uuid
$$;
create or replace function app.papel() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.papel', true), ''), 'anon')
$$;
create or replace function app.eh_equipe() returns boolean language sql stable as $$
  select app.papel() in ('atendente', 'gestor')
$$;
create or replace function app.eh_gestor() returns boolean language sql stable as $$
  select app.papel() = 'gestor'
$$;

grant usage on schema app to app_rls;
grant execute on all functions in schema app to app_rls;
grant usage on schema public to app_rls;
grant select, insert, update on all tables in schema public to app_rls;
grant usage on all sequences in schema public to app_rls;
revoke update on eventos, aceites, historico_precos from app_rls;

-- ---------- perfis ----------
alter table perfis enable row level security;
create policy perfis_ver on perfis for select to app_rls
  using (id = app.perfil_id() or app.eh_equipe());
create policy perfis_editar_proprio on perfis for update to app_rls
  using (id = app.perfil_id() or app.eh_gestor())
  with check (id = app.perfil_id() or app.eh_gestor());

-- cliente não muda papel, CPF já gravado nem chave Pix (troca de chave só presencial)
create or replace function app.proteger_perfil() returns trigger language plpgsql as $$
begin
  if current_user = 'app_rls' and not app.eh_gestor() then
    if new.papel is distinct from old.papel then raise exception 'sem permissão para alterar papel'; end if;
    if old.cpf is not null and new.cpf is distinct from old.cpf then raise exception 'CPF não pode ser alterado'; end if;
    if new.chave_pix is distinct from old.chave_pix or new.chave_pix_validada_em is distinct from old.chave_pix_validada_em then
      raise exception 'troca de chave Pix exige validação presencial';
    end if;
    if new.identidade_verificada_em is distinct from old.identidade_verificada_em
       or new.telefone_verificado_em is distinct from old.telefone_verificado_em then
      raise exception 'verificação é feita pelo sistema';
    end if;
  end if;
  return new;
end $$;
create trigger perfis_protegidos before update on perfis for each row execute function app.proteger_perfil();

alter table codigos_verificacao enable row level security; -- só serviço

-- ---------- configuração e categorias (leitura pública; escrita só gestor) ----------
alter table configuracoes enable row level security;
create policy config_ler on configuracoes for select to app_rls using (ativa or app.eh_gestor());
create policy config_gestor on configuracoes for insert to app_rls with check (app.eh_gestor());
create policy config_gestor_upd on configuracoes for update to app_rls using (app.eh_gestor());

alter table categorias enable row level security;
create policy categorias_ler on categorias for select to app_rls using (true);
create policy categorias_gestor on categorias for update to app_rls using (app.eh_gestor());

alter table codigos_sequencia enable row level security;
create policy codseq_equipe on codigos_sequencia for all to app_rls using (app.eh_equipe()) with check (app.eh_equipe());

-- ---------- termos e aceites ----------
alter table termos enable row level security;
create policy termos_ler on termos for select to app_rls using (true);

alter table aceites enable row level security;
create policy aceites_ver on aceites for select to app_rls using (perfil_id = app.perfil_id() or app.eh_gestor());
create policy aceites_criar on aceites for insert to app_rls with check (perfil_id = app.perfil_id());

-- ---------- itens ----------
alter table itens enable row level security;
create policy itens_vitrine on itens for select to app_rls
  using (status in ('vitrine', 'reservado') or dono_id = app.perfil_id() or app.eh_equipe());
create policy itens_criar on itens for insert to app_rls
  with check ((dono_id = app.perfil_id() and status = 'pre_avaliacao') or app.eh_equipe());
create policy itens_equipe on itens for update to app_rls using (app.eh_equipe()) with check (app.eh_equipe());

alter table item_fotos enable row level security;
create policy fotos_ver on item_fotos for select to app_rls
  using (exists (select 1 from itens i where i.id = item_id));          -- herda a visibilidade do item
create policy fotos_criar on item_fotos for insert to app_rls
  with check (app.eh_equipe() or exists (
    select 1 from itens i where i.id = item_id and i.dono_id = app.perfil_id() and i.status = 'pre_avaliacao'));

alter table historico_precos enable row level security;
create policy historico_ver on historico_precos for select to app_rls
  using (exists (select 1 from itens i where i.id = item_id));
create policy historico_equipe on historico_precos for insert to app_rls with check (app.eh_equipe());

alter table avaliacoes enable row level security;
create policy avaliacoes_ver on avaliacoes for select to app_rls
  using (app.eh_equipe() or exists (select 1 from itens i where i.id = item_id and i.dono_id = app.perfil_id()));
create policy avaliacoes_criar on avaliacoes for insert to app_rls with check (app.eh_equipe() and avaliador_id = app.perfil_id());

alter table favoritos enable row level security;
create policy favoritos_proprios on favoritos for all to app_rls
  using (perfil_id = app.perfil_id()) with check (perfil_id = app.perfil_id());
grant delete on favoritos to app_rls;

-- ---------- pagamentos / reservas / vendas ----------
alter table pagamentos enable row level security;
create policy pagamentos_ver on pagamentos for select to app_rls using (pagador_id = app.perfil_id() or app.eh_equipe());
create policy pagamentos_equipe on pagamentos for insert to app_rls with check (app.eh_equipe());
create policy pagamentos_equipe_upd on pagamentos for update to app_rls using (app.eh_equipe());

alter table reservas enable row level security;
create policy reservas_ver on reservas for select to app_rls using (cliente_id = app.perfil_id() or app.eh_equipe());
create policy reservas_equipe_upd on reservas for update to app_rls using (app.eh_equipe());

alter table vendas enable row level security;
create policy vendas_ver on vendas for select to app_rls using (comprador_id = app.perfil_id() or app.eh_equipe());
create policy vendas_equipe on vendas for insert to app_rls with check (app.eh_equipe());

alter table venda_pagamentos enable row level security;
create policy vp_equipe on venda_pagamentos for all to app_rls using (app.eh_equipe()) with check (app.eh_equipe());

-- repasses: dono vê os seus; gestor vê todos; ATENDENTE NÃO VÊ
alter table repasses enable row level security;
create policy repasses_ver on repasses for select to app_rls using (dono_id = app.perfil_id() or app.eh_gestor());
create policy repasses_criar on repasses for insert to app_rls with check (app.eh_equipe());   -- gerado na venda (caixa)
create policy repasses_gestor on repasses for update to app_rls using (app.eh_gestor());

alter table creditos enable row level security;
create policy creditos_ver on creditos for select to app_rls using (perfil_id = app.perfil_id() or app.eh_equipe());
create policy creditos_equipe on creditos for insert to app_rls with check (app.eh_equipe());

-- ---------- avisos / eventos ----------
alter table avisos enable row level security;
create policy avisos_proprios on avisos for select to app_rls using (perfil_id = app.perfil_id());
create policy avisos_marcar_lido on avisos for update to app_rls using (perfil_id = app.perfil_id());
create policy avisos_equipe on avisos for insert to app_rls with check (app.eh_equipe());

alter table eventos enable row level security;
create policy eventos_gestor on eventos for select to app_rls using (app.eh_gestor());
create policy eventos_inserir on eventos for insert to app_rls
  with check (perfil_id is null or perfil_id = app.perfil_id() or app.eh_equipe());
