create or replace function public.ler_versao(p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public as $$ begin if public.meu_papel() <> 'gestor' then raise exception 'sem_permissao' using errcode = '42501'; end if; return (select jsonb_build_object('versao', h.versao, 'salvo_em', h.salvo_em, 'dados', h.dados) from public.dataset_historico h where h.id = p_id); end $$;
revoke execute on function public.ler_versao(bigint) from public, anon, authenticated;
grant execute on function public.ler_versao(bigint) to authenticated;
select 'ok' as atualizado, (select count(*) from public.dataset_historico) as versoes_guardadas;
