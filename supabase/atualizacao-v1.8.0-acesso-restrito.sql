-- =====================================================================================================
-- Atualização v1.8.0 — ACESSO RESTRITO: só quem entra com e-mail liberado pelo Gestor vê os dados.
--
-- COMO USAR: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Pode rodar mais de uma vez. Não apaga dados, usuários nem histórico.
--
-- O que muda:
--   • Sem login (só o link): deixa de ler os dados.
--   • Conta criada mas não liberada pelo Gestor (ou e-mail não confirmado): também não lê.
--   • Visualizador, Líder e Gestor liberados: continuam como antes.
--   • "Remover acesso" passa a cortar também a leitura.
-- Antes de rodar: confira no resultado do fim deste arquivo quem tem acesso. Quem não estiver na lista
-- com papel gestor/lider/visualizador deixa de ver os dados.
-- =====================================================================================================

-- 1) Papel: só vale o que o Gestor liberou (tabela convites) e com e-mail confirmado
create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'anonimo'
    else coalesce((
      select c.papel from public.convites c join auth.users u on lower(u.email) = c.email
      where u.id = auth.uid() and u.email_confirmed_at is not null
    ), 'sem_acesso')
  end
$$;

-- 2) Leitura dos dados: tira a leitura pública e libera só para quem tem acesso
revoke all on public.dataset from anon;
revoke all on public.dataset from authenticated;
grant select on public.dataset to authenticated;
drop policy if exists "dados: leitura publica" on public.dataset;
drop policy if exists "dados: leitura com acesso" on public.dataset;
create policy "dados: leitura com acesso" on public.dataset for select to authenticated
  using (public.meu_papel() in ('gestor', 'lider', 'visualizador'));

-- 3) Lista de usuários do app mostra "sem_acesso" para quem não foi liberado
create or replace function public.listar_usuarios() returns table (email text, papel text, conta_criada boolean, confirmado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if;
  return query
    select coalesce(c.email, p.email), coalesce(c.papel, 'sem_acesso'), p.user_id is not null, u.email_confirmed_at is not null
    from public.convites c
    full join public.perfis p on p.email = c.email
    left join auth.users u on u.id = p.user_id
    order by 1;
end $$;
revoke execute on function public.meu_papel(), public.listar_usuarios() from public, anon, authenticated;
grant execute on function public.meu_papel() to anon, authenticated;
grant execute on function public.listar_usuarios() to authenticated;

-- 4) Conferência: quem continua com acesso depois desta atualização
select coalesce(c.email, p.email) as email,
       coalesce(c.papel, 'SEM ACESSO') as papel,
       (u.email_confirmed_at is not null) as email_confirmado
from public.convites c
full join public.perfis p on p.email = c.email
left join auth.users u on u.id = p.user_id
order by 2, 1;
