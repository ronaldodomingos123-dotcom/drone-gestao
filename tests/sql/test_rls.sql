-- Testes de segurança do schema.sql: cada linha tenta uma ação como um papel (sem login, visualizador,
-- líder, gestor, e-mail não confirmado) e confere se o banco permite ou recusa.
\set QUIET on
create table _res (n serial, teste text, ok boolean, detalhe text);

-- executa p_sql como p_role com o "login" p_sub; p_espera = 'ERRO', '*' (qualquer sucesso) ou o valor esperado
create function _tentar(p_teste text, p_role text, p_sub uuid, p_sql text, p_espera text) returns void
language plpgsql as $$
declare r text;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub)::text end, true);
    execute p_sql into r;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into _res (teste, ok, detalhe) values (p_teste,
      case when p_espera = 'ERRO' then false when p_espera = '*' then true else coalesce(r, '') like p_espera end,
      'retornou: ' || coalesce(r, '(nulo)'));
  exception when others then
    insert into _res (teste, ok, detalhe) values (p_teste, p_espera = 'ERRO', 'erro: ' || sqlerrm);
  end;
end $$;

-- usuários
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', :'email', now()),
  ('00000000-0000-0000-0000-00000000000b', 'lider@teste.local', now()),
  ('00000000-0000-0000-0000-00000000000c', 'visual@teste.local', now()),
  ('00000000-0000-0000-0000-00000000000d', 'falso@teste.local', null);
\set G '''00000000-0000-0000-0000-00000000000a'''
\set L '''00000000-0000-0000-0000-00000000000b'''
\set V '''00000000-0000-0000-0000-00000000000c'''
\set F '''00000000-0000-0000-0000-00000000000d'''
\set D0 '''{"operacoes":[],"metas":{"m":1},"campanhas":[{"id":"c1"}],"versao":4}'''
\set D1 '''{"operacoes":[{"id":"op1"}],"metas":{"m":1},"campanhas":[{"id":"c1"}],"versao":4}'''
\set D2m '''{"operacoes":[{"id":"op1"}],"metas":{"m":2},"campanhas":[{"id":"c1"}],"versao":4}'''
\set D2c '''{"operacoes":[{"id":"op1"}],"metas":{"m":1},"campanhas":[],"versao":4}'''
\set D3 '''{"operacoes":[{"id":"op1"},{"id":"op2"}],"metas":{"m":1},"campanhas":[{"id":"c1"}],"versao":4}'''

-- SEM LOGIN
select _tentar('sem login: papel = anonimo', 'anon', null, 'select public.meu_papel()', 'anonimo');
select _tentar('sem login: LÊ os dados', 'anon', null, 'select versao::text from public.dataset', '0');
select _tentar('sem login: NÃO grava pela função', 'anon', null, format('select public.salvar_dataset(%L::jsonb, 0)', :D0), 'ERRO');
select _tentar('sem login: NÃO altera a tabela', 'anon', null, 'update public.dataset set versao = 99 returning 1', 'ERRO');
select _tentar('sem login: NÃO apaga', 'anon', null, 'delete from public.dataset returning 1', 'ERRO');
select _tentar('sem login: NÃO insere', 'anon', null, 'insert into public.dataset (id, versao) values (2, 0) returning 1', 'ERRO');
select _tentar('sem login: NÃO mexe no histórico', 'anon', null, $q$insert into public.dataset_historico (versao, dados) values (1, '{}') returning 1$q$, 'ERRO');
select _tentar('sem login: NÃO vê usuários (perfis)', 'anon', null, 'select count(*)::text from public.perfis', 'ERRO');
select _tentar('sem login: NÃO vê convites', 'anon', null, 'select count(*)::text from public.convites', 'ERRO');
select _tentar('sem login: NÃO lista usuários', 'anon', null, 'select count(*)::text from public.listar_usuarios()', 'ERRO');
select _tentar('sem login: NÃO se dá papel', 'anon', null, $q$select public.definir_papel('x@y.z', 'gestor')$q$, 'ERRO');

-- PAPÉIS
select _tentar('gestor do script: papel = gestor', 'authenticated', :G, 'select public.meu_papel()', 'gestor');
select _tentar('conta sem convite: papel = visualizador', 'authenticated', :L, 'select public.meu_papel()', 'visualizador');
select _tentar('sem convite: NÃO grava', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 0)', :D0), 'ERRO');
select _tentar('gestor convida o líder', 'authenticated', :G, $q$select public.definir_papel('LIDER@teste.local', 'lider')::text$q$, '%"ok": true%');
select _tentar('líder: papel = lider', 'authenticated', :L, 'select public.meu_papel()', 'lider');
select _tentar('gestor dá papel de líder a um e-mail', 'authenticated', :G, $q$select public.definir_papel('falso@teste.local', 'lider')::text$q$, '%"ok": true%');
select _tentar('e-mail NÃO confirmado com convite: papel = visualizador', 'authenticated', :F, 'select public.meu_papel()', 'visualizador');
select _tentar('e-mail NÃO confirmado: NÃO grava', 'authenticated', :F, format('select public.salvar_dataset(%L::jsonb, 0)', :D0), 'ERRO');

-- GRAVAÇÃO
select _tentar('líder: primeiro envio é só do gestor', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 0)', :D0), 'ERRO');
select _tentar('gestor envia os dados (versão 1)', 'authenticated', :G, format('select public.salvar_dataset(%L::jsonb, 0)::text', :D0), '%"versao": 1%');
select _tentar('versão-base antiga = conflito (não sobrescreve)', 'authenticated', :G, format('select public.salvar_dataset(%L::jsonb, 0)::text', :D1), '%"conflito": true%');
select _tentar('dados continuam na versão 1 após o conflito', 'anon', null, 'select versao::text from public.dataset', '1');
select _tentar('líder grava operação (versão 2)', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 1)::text', :D1), '%"versao": 2%');
select _tentar('líder NÃO altera metas', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 2)', :D2m), 'ERRO');
select _tentar('líder NÃO altera campanhas', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 2)', :D2c), 'ERRO');
select _tentar('líder NÃO restaura versão', 'authenticated', :L, 'select public.restaurar_versao(1)', 'ERRO');
select _tentar('líder NÃO lista usuários', 'authenticated', :L, 'select count(*)::text from public.listar_usuarios()', 'ERRO');
select _tentar('líder NÃO se promove a gestor', 'authenticated', :L, $q$select public.definir_papel('lider@teste.local', 'gestor')$q$, 'ERRO');
select _tentar('líder VÊ o histórico', 'authenticated', :L, 'select count(*)::text from public.listar_historico()', '1');
select _tentar('visualizador NÃO grava', 'authenticated', :V, format('select public.salvar_dataset(%L::jsonb, 2)', :D3), 'ERRO');
select _tentar('logado NÃO altera a tabela direto', 'authenticated', :G, 'update public.dataset set versao = 99 returning 1', 'ERRO');
select _tentar('logado NÃO apaga o histórico direto', 'authenticated', :G, 'delete from public.dataset_historico returning 1', 'ERRO');
select _tentar('gestor altera metas (versão 3)', 'authenticated', :G, format('select public.salvar_dataset(%L::jsonb, 2)::text', :D2m), '%"versao": 3%');
select _tentar('dados inválidos são recusados', 'authenticated', :G, $q$select public.salvar_dataset('[]'::jsonb, 3)$q$, 'ERRO');

-- HISTÓRICO, RESTAURAÇÃO, USUÁRIOS
select id as h1 from public.dataset_historico where versao = 1 \gset
select _tentar('gestor restaura a versão 1', 'authenticated', :G, format('select public.restaurar_versao(%s)::text', :h1), '%"versao": 4%');
select _tentar('após restaurar: volta ao 1º envio (0 operações, metas m=1)', 'anon', null,
  $q$select (jsonb_array_length(dados->'operacoes') || '/' || (dados->'metas'->>'m')) from public.dataset$q$, '0/1');
select _tentar('"atualizado por" público não expõe o e-mail', 'anon', null, 'select atualizado_por from public.dataset', '%');
select _tentar('gestor lista usuários', 'authenticated', :G, 'select count(*)::text from public.listar_usuarios()', '4');
select _tentar('não dá para remover o último gestor', 'authenticated', :G, format('select public.remover_acesso(%L)', :'email'), 'ERRO');
select _tentar('não dá para rebaixar o último gestor', 'authenticated', :G, format($q$select public.definir_papel(%L, 'lider')$q$, :'email'), 'ERRO');
select _tentar('gestor remove o acesso do líder', 'authenticated', :G, $q$select public.remover_acesso('lider@teste.local')::text$q$, '%"ok": true%');
select _tentar('ex-líder vira visualizador e NÃO grava', 'authenticated', :L, format('select public.salvar_dataset(%L::jsonb, 4)', :D3), 'ERRO');

select _tentar('sem login: NÃO lê versão anterior', 'anon', null, format('select public.ler_versao(%s)::text', :h1), 'ERRO');
select _tentar('líder NÃO lê versão anterior', 'authenticated', :L, format('select public.ler_versao(%s)::text', :h1), 'ERRO');
select _tentar('gestor lê versão anterior (para recuperar voos)', 'authenticated', :G, format('select (public.ler_versao(%s)->>''versao'')', :h1), '1');

-- limite do histórico: 65 gravações → ficam 60
do $$ declare i int; v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000a')::text, true);
  for i in 1..65 loop
    select versao into v from public.dataset where id = 1;
    perform public.salvar_dataset(jsonb_build_object('operacoes', jsonb_build_array(i), 'metas', '{"m":1}'::jsonb, 'campanhas', '[{"id":"c1"}]'::jsonb), v);
  end loop;
end $$;
insert into _res (teste, ok, detalhe) select 'histórico guarda só as últimas 60 versões', count(*) = 60, count(*)::text from public.dataset_historico;
insert into _res (teste, ok, detalhe) select 'e-mail @ não aparece em "atualizado por"', position('@' in coalesce(atualizado_por, '')) = 0, atualizado_por from public.dataset;

\pset footer off
\pset border 1
select n as "#", case when ok then 'PASSOU' else 'FALHOU' end as resultado, teste, left(detalhe, 70) as detalhe from _res order by n;
select count(*) filter (where ok) || '/' || count(*) || ' passaram' as total from _res;
