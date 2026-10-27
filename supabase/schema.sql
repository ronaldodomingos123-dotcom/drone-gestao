-- =====================================================================================================
-- Protótipo — Gestão de Aplicações com Drones · banco na nuvem (Supabase)
--
-- COMO USAR: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Pode rodar de novo sem perder dados (o script só cria o que falta e atualiza as funções).
--
-- Regras de acesso garantidas pelo BANCO (não só pelo app):
--   • Sem login (só o link)  → só LÊ os dados. Não grava, não apaga, não vê usuários nem histórico.
--   • Visualizador (login)   → igual a sem login.
--   • Líder (login)          → lê e grava o dia a dia (fechamento, dias parados, OS, fazendas/talhões,
--                              estações…). NÃO altera campanhas, metas, safra, aeronaves, colaboradores,
--                              turnos, produtos, unidades, limites, nem troca a base inteira.
--   • Gestor (login)         → tudo, inclusive usuários, histórico e restauração de versões.
--   • Toda gravação guarda a versão anterior (últimas 60) e exige a versão-base certa (sem sobrescrever
--     o trabalho de outra pessoa sem perceber).
--   • Papel só vale para e-mail CONFIRMADO.
-- =====================================================================================================

-- >>>>>>>>>>>>>>>>>>>>>>>>  GESTOR PRINCIPAL (troque se necessário)  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
-- O e-mail abaixo vira Gestor assim que criar a conta no app (ou imediatamente, se a conta já existir).
create table if not exists public.convites (
  email      text primary key check (email = lower(email)),
  papel      text not null check (papel in ('gestor', 'lider', 'visualizador')),
  criado_por text,
  criado_em  timestamptz not null default now()
);
insert into public.convites (email, papel, criado_por)
values (lower('__EMAIL_GESTOR__'), 'gestor', 'script')
on conflict (email) do update set papel = 'gestor';
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

create table if not exists public.perfis (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  email     text not null,
  papel     text not null default 'visualizador' check (papel in ('gestor', 'lider', 'visualizador')),
  criado_em timestamptz not null default now()
);

create table if not exists public.dataset (
  id            smallint primary key default 1 check (id = 1),
  dados         jsonb,
  versao        bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.dataset (id, dados, versao) values (1, null, 0) on conflict (id) do nothing;

create table if not exists public.dataset_historico (
  id        bigserial primary key,
  versao    bigint not null,
  dados     jsonb not null,
  salvo_em  timestamptz not null default now(),
  salvo_por text,
  motivo    text
);

-- RLS ligado em tudo. Só a leitura dos dados tem política; o resto passa pelas funções abaixo.
alter table public.convites          enable row level security;
alter table public.perfis            enable row level security;
alter table public.dataset           enable row level security;
alter table public.dataset_historico enable row level security;

revoke all on public.convites, public.perfis, public.dataset, public.dataset_historico from anon, authenticated;
revoke all on sequence public.dataset_historico_id_seq from anon, authenticated;
grant select on public.dataset to anon, authenticated;

drop policy if exists "dados: leitura publica" on public.dataset;
create policy "dados: leitura publica" on public.dataset for select to anon, authenticated using (true);

-- ------------------------------------------------------------------------------------------------
-- Papel do usuário que fez a chamada ('anonimo' sem login; e-mail não confirmado = visualizador)
-- ------------------------------------------------------------------------------------------------
create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'anonimo'
    else coalesce((
      select p.papel from public.perfis p join auth.users u on u.id = p.user_id
      where p.user_id = auth.uid() and u.email_confirmed_at is not null
    ), 'visualizador')
  end
$$;

create or replace function public.meu_perfil() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('papel', public.meu_papel(), 'email', (select email from auth.users where id = auth.uid()))
$$;

-- nome curto para "atualizado por" (os dados são públicos: não expõe o e-mail inteiro)
create or replace function public._quem() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(split_part((select email from auth.users where id = auth.uid()), '@', 1), '?')
$$;

-- ------------------------------------------------------------------------------------------------
-- Novo usuário → perfil (papel do convite, se houver)
-- ------------------------------------------------------------------------------------------------
create or replace function public._ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (user_id, email, papel)
  values (new.id, lower(new.email), coalesce((select papel from public.convites where email = lower(new.email)), 'visualizador'))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users for each row execute function public._ao_criar_usuario();

-- contas que já existiam antes do script
insert into public.perfis (user_id, email, papel)
select u.id, lower(u.email), coalesce(c.papel, 'visualizador')
from auth.users u left join public.convites c on c.email = lower(u.email)
where u.email is not null
on conflict (user_id) do update set papel = excluded.papel
  where excluded.papel = 'gestor';

-- ------------------------------------------------------------------------------------------------
-- Gravar os dados (Líder e Gestor), com controle de versão
-- ------------------------------------------------------------------------------------------------
create or replace function public.salvar_dataset(p_dados jsonb, p_versao_base bigint, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_papel text := public.meu_papel();
  v_atual public.dataset%rowtype;
  k text;
  chaves_gestor text[] := array['unidades', 'campanhas', 'produtos', 'aeronaves', 'colaboradores', 'turnos',
                                'limites', 'metas', 'safra', 'origemBase', 'geradoEm'];
begin
  if v_papel not in ('gestor', 'lider') then
    raise exception 'sem_permissao: entre como Líder ou Gestor para gravar' using errcode = '42501';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' or not (p_dados ? 'operacoes') then
    raise exception 'dados_invalidos' using errcode = '22023';
  end if;
  if octet_length(p_dados::text) > 25 * 1024 * 1024 then
    raise exception 'dados_grandes_demais' using errcode = '54000';
  end if;
  select * into v_atual from public.dataset where id = 1 for update;
  if v_atual.versao <> p_versao_base then
    return jsonb_build_object('ok', false, 'conflito', true, 'versao', v_atual.versao);
  end if;
  if v_papel = 'lider' then
    if v_atual.dados is null then
      raise exception 'somente_gestor: o primeiro envio de dados é feito pelo Gestor' using errcode = '42501';
    end if;
    foreach k in array chaves_gestor loop
      if (v_atual.dados -> k) is distinct from (p_dados -> k) then
        raise exception 'somente_gestor: o Líder não altera %', k using errcode = '42501';
      end if;
    end loop;
  end if;
  if v_atual.dados is not null then
    insert into public.dataset_historico (versao, dados, salvo_por, motivo)
    values (v_atual.versao, v_atual.dados, v_atual.atualizado_por, p_motivo);
    delete from public.dataset_historico where id in (
      select id from public.dataset_historico order by id desc offset 60);
  end if;
  update public.dataset
     set dados = p_dados, versao = v_atual.versao + 1, atualizado_em = now(), atualizado_por = public._quem()
   where id = 1;
  return jsonb_build_object('ok', true, 'versao', v_atual.versao + 1);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Histórico (Líder e Gestor veem; só o Gestor restaura)
-- ------------------------------------------------------------------------------------------------
create or replace function public.listar_historico() returns table (id bigint, versao bigint, salvo_em timestamptz, salvo_por text, tamanho_kb int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.meu_papel() not in ('gestor', 'lider') then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return query select h.id, h.versao, h.salvo_em, h.salvo_por, (octet_length(h.dados::text) / 1024)::int
               from public.dataset_historico h order by h.id desc;
end $$;

create or replace function public.restaurar_versao(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h public.dataset_historico%rowtype; v_atual public.dataset%rowtype;
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao: só o Gestor restaura versões' using errcode = '42501'; end if;
  select * into v_h from public.dataset_historico where id = p_id;
  if not found then raise exception 'versao_nao_encontrada' using errcode = '22023'; end if;
  select * into v_atual from public.dataset where id = 1 for update;
  if v_atual.dados is not null then
    insert into public.dataset_historico (versao, dados, salvo_por, motivo)
    values (v_atual.versao, v_atual.dados, v_atual.atualizado_por, 'antes de restaurar a versão ' || v_h.versao);
  end if;
  update public.dataset set dados = v_h.dados, versao = v_atual.versao + 1, atualizado_em = now(),
         atualizado_por = public._quem() where id = 1;
  return jsonb_build_object('ok', true, 'versao', v_atual.versao + 1);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Usuários (só o Gestor)
-- ------------------------------------------------------------------------------------------------
create or replace function public.listar_usuarios() returns table (email text, papel text, conta_criada boolean, confirmado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return query
    select coalesce(c.email, p.email), coalesce(p.papel, c.papel), p.user_id is not null, u.email_confirmed_at is not null
    from public.convites c
    full join public.perfis p on p.email = c.email
    left join auth.users u on u.id = p.user_id
    order by 1;
end $$;

create or replace function public.definir_papel(p_email text, p_papel text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalido' using errcode = '22023'; end if;
  if p_papel not in ('gestor', 'lider', 'visualizador') then raise exception 'papel_invalido' using errcode = '22023'; end if;
  if p_papel <> 'gestor' and (select count(*) from public.perfis where papel = 'gestor' and email <> e) = 0
     and exists (select 1 from public.perfis where email = e and papel = 'gestor') then
    raise exception 'ultimo_gestor: precisa existir ao menos um Gestor' using errcode = '22023';
  end if;
  insert into public.convites (email, papel, criado_por) values (e, p_papel, public._quem())
  on conflict (email) do update set papel = excluded.papel;
  update public.perfis set papel = p_papel where email = e;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remover_acesso(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if;
  if (select count(*) from public.perfis where papel = 'gestor' and email <> e) = 0
     and exists (select 1 from public.perfis where email = e and papel = 'gestor') then
    raise exception 'ultimo_gestor: precisa existir ao menos um Gestor' using errcode = '22023';
  end if;
  delete from public.convites where email = e;
  update public.perfis set papel = 'visualizador' where email = e;
  return jsonb_build_object('ok', true);
end $$;

-- Conteúdo de uma versão anterior (só o Gestor) — usado para recuperar voos sem voltar a base inteira
create or replace function public.ler_versao(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return (select jsonb_build_object('versao', h.versao, 'salvo_em', h.salvo_em, 'dados', h.dados) from public.dataset_historico h where h.id = p_id);
end $$;

-- Funções: ninguém executa por padrão; libera só o necessário.
revoke execute on function public.meu_papel(), public.meu_perfil(), public._quem(), public._ao_criar_usuario(),
  public.salvar_dataset(jsonb, bigint, text), public.listar_historico(), public.restaurar_versao(bigint),
  public.listar_usuarios(), public.definir_papel(text, text), public.remover_acesso(text), public.ler_versao(bigint) from public, anon, authenticated;
grant execute on function public.meu_papel(), public.meu_perfil() to anon, authenticated;
grant execute on function public.salvar_dataset(jsonb, bigint, text), public.listar_historico(), public.restaurar_versao(bigint),
  public.listar_usuarios(), public.definir_papel(text, text), public.remover_acesso(text), public.ler_versao(bigint) to authenticated;

-- Conferência rápida (aparece no resultado do SQL Editor)
select 'ok' as instalado, (select versao from public.dataset where id = 1) as versao_dados,
       (select count(*) from public.convites where papel = 'gestor') as gestores_convidados;
