"""Servidor simulado do Supabase para os testes de tela da nuvem.

As chamadas que o app faz para o projeto (login, leitura da tabela, funções RPC) são interceptadas pelo
Playwright e executadas num PostgreSQL 16 LOCAL com o MESMO supabase/schema.sql — ou seja, as regras de
segurança testadas são as reais; só o login (Auth) e o gateway HTTP são simulados aqui.
"""
import base64, json, os, re, secrets, subprocess, tempfile, time, uuid, urllib.parse, pathlib

BIN = '/usr/lib/postgresql/16/bin'
RAIZ = pathlib.Path(__file__).resolve().parents[2]
PROJETO = 'https://erqijxkauqedqglzuekm.supabase.co'


def _su(cmd):
    return subprocess.run(['su', 'claude', '-s', '/bin/bash', '-c', cmd], capture_output=True, text=True)


class Banco:
    def __init__(self, email_gestor='gestor@teste.local'):
        self.tmp = tempfile.mkdtemp(); os.chmod(self.tmp, 0o777)
        r = _su(f'{BIN}/initdb -D {self.tmp}/db -U postgres -A trust')
        assert r.returncode == 0, r.stderr
        r = _su(f"{BIN}/pg_ctl -D {self.tmp}/db -o '-k {self.tmp} -c listen_addresses=' -l {self.tmp}/log start")
        assert r.returncode == 0, r.stderr
        time.sleep(1)
        self.psql(open(RAIZ / 'tests/sql/stub_supabase.sql').read())
        self.psql(open(RAIZ / 'supabase/schema.sql').read().replace('__EMAIL_GESTOR__', email_gestor))
        self.senhas = {}       # email -> (id, senha)
        self.chamadas = []     # registro das requisições (para conferência)

    def fechar(self):
        _su(f'{BIN}/pg_ctl -D {self.tmp}/db stop -m fast')

    def psql(self, sql):
        r = subprocess.run(['psql', '-h', self.tmp, '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'],
                           input=sql, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    def como(self, sub, sql):
        """Executa `sql` como o papel do PostgREST: anon (sem login) ou authenticated (com o usuário `sub`)."""
        role = 'authenticated' if sub else 'anon'
        claims = json.dumps({'sub': sub}) if sub else ''
        return self.psql(f"begin; set local role {role}; select set_config('request.jwt.claims', $c${claims}$c$, true) \\g /dev/null\n{sql};\ncommit;")

    # ---------- Auth simulado ----------
    def criar_usuario(self, email, senha, confirmado=True):
        uid = str(uuid.uuid4())
        self.psql(f"insert into auth.users (id, email, email_confirmed_at) values ('{uid}', '{email}', {'now()' if confirmado else 'null'})")
        self.senhas[email.lower()] = (uid, senha)
        return uid

    def confirmar(self, email):
        self.psql(f"update auth.users set email_confirmed_at = now() where lower(email) = '{email.lower()}'")

    @staticmethod
    def _token(uid, email):
        p = base64.urlsafe_b64encode(json.dumps({'sub': uid, 'email': email}).encode()).decode().rstrip('=')
        return f'x.{p}.y'

    @staticmethod
    def _sub(auth):
        if not auth or not auth.startswith('Bearer x.'):
            return None
        p = auth.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))['sub']

    # ---------- HTTP ----------
    def responder(self, metodo, url, cab, corpo):
        u = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(u.query)
        caminho = u.path
        sub = self._sub(cab.get('authorization'))
        self.chamadas.append((metodo, caminho, sub))
        dados = json.loads(corpo) if corpo else {}
        try:
            if caminho == '/auth/v1/signup':
                e = dados['email'].lower()
                if e in self.senhas:
                    return 422, {'error_code': 'user_already_exists', 'msg': 'User already registered'}
                if len(dados.get('password', '')) < 6:
                    return 422, {'error_code': 'weak_password', 'msg': 'weak'}
                uid = self.criar_usuario(e, dados['password'], confirmado=False)
                return 200, {'id': uid, 'email': e}
            if caminho == '/auth/v1/token':
                if q.get('grant_type') == ['password']:
                    e = dados['email'].lower()
                    if e not in self.senhas or self.senhas[e][1] != dados['password']:
                        return 400, {'error_code': 'invalid_credentials', 'msg': 'Invalid login credentials'}
                    conf = self.psql(f"select email_confirmed_at is not null from auth.users where lower(email) = '{e}'")
                    if conf != 't':
                        return 400, {'error_code': 'email_not_confirmed', 'msg': 'Email not confirmed'}
                    uid = self.senhas[e][0]
                    return 200, {'access_token': self._token(uid, e), 'refresh_token': 'r-' + uid + '-' + e, 'expires_in': 3600, 'user': {'email': e}}
                if q.get('grant_type') == ['refresh_token']:
                    return 400, {'msg': 'refresh não simulado'}
            if caminho == '/auth/v1/user' and metodo == 'PUT':
                if not sub: return 401, {'msg': 'not authenticated'}
                e = next(k for k, v in self.senhas.items() if v[0] == sub)
                self.senhas[e] = (sub, dados['password'])
                return 200, {'id': sub, 'email': e}
            if caminho in ('/auth/v1/logout', '/auth/v1/recover'):
                return 204, None
            if caminho.startswith('/rest/v1/rpc/'):
                fn = caminho.rsplit('/', 1)[1]
                if not re.fullmatch(r'[a-z_]+', fn):
                    return 404, {'message': 'not found'}
                def lit(v):
                    if v is None: return 'null'
                    if isinstance(v, (dict, list)): return f'$j${json.dumps(v)}$j$::jsonb'
                    return f'$j${v}$j$'
                args = ', '.join(f'{k} => {lit(v)}' for k, v in dados.items())
                if fn in ('listar_usuarios', 'listar_historico'):
                    sql = f'select coalesce(jsonb_agg(t), \'[]\'::jsonb) from public.{fn}({args}) t'
                else:
                    sql = f'select to_jsonb(public.{fn}({args}))'
                return 200, json.loads(self.como(sub, sql) or 'null')
            if caminho.startswith('/rest/v1/'):
                tabela = caminho.rsplit('/', 1)[1]
                if not re.fullmatch(r'[a-z_]+', tabela):
                    return 404, {'message': 'not found'}
                filtro = ' and '.join(f"{k} = '{v[0][3:]}'" for k, v in q.items() if v[0].startswith('eq.'))
                where = f' where {filtro}' if filtro else ''
                if metodo == 'GET':
                    cols = q.get('select', ['*'])[0]
                    lim = f" limit {int(q['limit'][0])}" if 'limit' in q else ''
                    sql = f'select coalesce(jsonb_agg(t), \'[]\'::jsonb) from (select {cols} from public.{tabela}{where}{lim}) t'
                    return 200, json.loads(self.como(sub, sql))
                if metodo == 'PATCH':
                    sets = ', '.join(f"{k} = $j${v}$j$" for k, v in dados.items())
                    return 200, json.loads(self.como(sub, f'with x as (update public.{tabela} set {sets}{where} returning 1) select coalesce(jsonb_agg(x), \'[]\') from x'))
                if metodo == 'DELETE':
                    return 200, json.loads(self.como(sub, f'with x as (delete from public.{tabela}{where} returning 1) select coalesce(jsonb_agg(x), \'[]\') from x'))
                if metodo == 'POST':
                    cols = ', '.join(dados.keys()); vals = ', '.join(f"$j${v}$j$" for v in dados.values())
                    return 201, json.loads(self.como(sub, f'with x as (insert into public.{tabela} ({cols}) values ({vals}) returning 1) select coalesce(jsonb_agg(x), \'[]\') from x'))
            return 404, {'message': 'rota não simulada: ' + caminho}
        except RuntimeError as e:
            msg = re.sub(r'^.*?ERROR:\s*', '', str(e)).split('\n')[0]
            negado = 'permission denied' in msg or 'sem_permissao' in msg or 'somente_gestor' in msg
            return (401 if not sub else 403) if negado else 400, {'code': '42501' if negado else 'P0001', 'message': msg}

    def rota(self, route):
        req = route.request
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=_CORS)
        st, corpo = self.responder(req.method, req.url, {k.lower(): v for k, v in req.headers.items()}, req.post_data)
        route.fulfill(status=st, headers={**_CORS, 'content-type': 'application/json'}, body='' if corpo is None else json.dumps(corpo))

    def ligar(self, contexto):
        contexto.route(PROJETO + '/**', self.rota)


_CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
