"""Fase 4 — dados na nuvem, com as regras REAIS do banco (supabase/schema.sql num PostgreSQL local; só o login
e o gateway HTTP são simulados em nuvem_shim.py).

Cenário: o Gestor (aparelho A) envia a base; um visitante sem login (aparelho B) vê tudo mas não grava; o
Gestor libera um Líder; B cria a conta, confirma e lança; A recebe sozinho; o Líder não altera a safra; A
lança SEM INTERNET enquanto B lança — ao voltar a conexão as duas alterações se juntam; teste de segurança
sem login; restauração de versão chega aos dois; modo local não envia nada."""
import sys, pathlib, json, re, datetime
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from nuvem_shim import Banco

URL = pathlib.Path('dist/index.html').resolve().as_uri()
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

SEED = open(pathlib.Path(__file__).parent / 'dias.py').read()
SEED = SEED[SEED.index('        pg.evaluate("""() => {') + len('        pg.evaluate("""'):SEED.index('}""")', SEED.index('pg.evaluate("""() => {')) + 1]
SEED = SEED.replace("const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));", "const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k)); for (const c of ['unidades','fazendas','talhoes','campanhas','produtos','ordens','aeronaves','colaboradores','turnos','operacoes','lancamentos','paradas','estacoes','registrosEstacao','auditoria']) d[c] = [];")
SEED = SEED.replace("inicio: '2026-10-14', fim: '2026-12-01'", "inicio: '2026-10-19', fim: '2026-11-19'").replace("d.operacoes.push(op('op1', '2026-10-19', 100), op('op2', '2026-10-20', 100.03));", "d.operacoes.push(op('op1', '2026-10-19', 100), op('op2', '2026-10-20', 100)); d.origemBase = 'propria';")

def dados(b):
    return json.loads(b.psql("select coalesce(dados::text, 'null') from public.dataset where id = 1"))
def versao(b):
    return int(b.psql('select versao from public.dataset where id = 1'))
def esperar(pg, cond, ms=15000):
    for _ in range(ms // 250):
        try:
            if cond(): return True
        except Exception: pass
        pg.wait_for_timeout(250)
    return False
def ds_local(pg):
    return pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")

def novo(b, p, nome, intervalo=1500, vp=None, semente=None):
    ctx = p.chromium.launch().new_context(viewport=vp or {'width': 1280, 'height': 900})
    b.ligar(ctx)
    ctx.add_init_script(f"try {{ localStorage.setItem('dap-proto-v1:nuvem-intervalo', '{intervalo}') }} catch (e) {{}}")
    if semente:  # base própria deste aparelho, gravada antes do app abrir (só na 1ª abertura)
        ctx.add_init_script("try { if (!localStorage.getItem('semente-ok')) { localStorage.setItem('dap-proto-v1:dataset', " + json.dumps(semente) + "); localStorage.setItem('semente-ok', '1'); } } catch (e) {}")
    pg = ctx.new_page(); pg.erros = []; pg.on('pageerror', lambda e: pg.erros.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('[data-nuvem-chip]')
    return ctx, pg

def painel(pg):
    if not pg.locator('[data-nuvem-painel]').count():
        pg.click('[data-nuvem-chip]'); pg.wait_for_selector('[data-nuvem-painel] [data-np]')
    return pg.locator('[data-nuvem-painel]')

def fechar_modais(pg):
    while pg.locator('.modal-fundo').count():
        pg.locator('.modal-fundo').last.locator('[data-fechar]').first.click(); pg.wait_for_timeout(100)

def entrar(pg, email, senha):
    m = painel(pg)
    m.locator('[data-np-email]').fill(email); m.locator('[data-np-senha]').fill(senha)
    m.locator('[data-np="entrar"]').click()

def dia_parado(pg, data, motivo):
    pg.goto(pg.url.split('#')[0] + '#/fechamento'); pg.wait_for_selector('[data-acao="dia-parado"]')
    pg.click('[data-acao="dia-parado"]'); pg.wait_for_selector('.modal [data-dp="gravar"]')
    pg.fill('.modal [data-dp="de"]', data); pg.dispatch_event('.modal [data-dp="de"]', 'change'); pg.fill('.modal [data-dp="ate"]', data)
    pg.select_option('.modal [data-dp="motivo"]', motivo); pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(400)
    t = pg.locator('.modal [data-dp="msg"]').inner_text(); fechar_modais(pg); return t

b = Banco('gestor@teste.local')
b.criar_usuario('gestor@teste.local', 'senhaGestor1')
try:
    with sync_playwright() as p:
        # ---------------- A: Gestor com a base própria neste aparelho; nuvem vazia
        # monta a base própria (2 voos, 200 ha) numa aba descartável e abre o aparelho A já com ela
        ctx0 = p.chromium.launch().new_context(); P0 = ctx0.new_page(); P0.goto(URL + '?modo=local#/dashboard'); P0.wait_for_selector('.destaque-valor')
        semente = P0.evaluate(SEED.replace("localStorage.setItem(k, JSON.stringify(d));", "return JSON.stringify(d);")); ctx0.close()
        ctxA, A = novo(b, p, 'A', semente=semente)
        A.wait_for_function("document.querySelector('.destaque-valor') && document.querySelector('.destaque-valor').innerText.includes('200,0')")
        ok('A sem login: chip mostra "Nuvem sem dados" e "Entrar"', esperar(A, lambda: 'Nuvem sem dados' in A.inner_text('[data-nuvem-chip]') and 'Entrar' in A.inner_text('[data-nuvem-chip]')))
        t = dia_parado(A, '2026-10-21', 'Chuva')
        ok('A sem login: gravar é recusado (somente leitura)', 'Somente leitura' in t and not (ds_local(A).get('diasParados') or []))
        entrar(A, 'gestor@teste.local', 'errada')
        ok('senha errada: mensagem clara', esperar(A, lambda: 'E-mail ou senha incorretos' in A.inner_text('[data-nuvem-painel]')))
        entrar(A, 'gestor@teste.local', 'senhaGestor1')
        ok('A entra como Gestor', esperar(A, lambda: 'Gestor' in A.inner_text('[data-nuvem-chip]') and 'Primeiro envio' in A.inner_text('[data-nuvem-painel]')))
        ok('painel mostra a base deste aparelho (2 voos, própria)', 'própria' in A.inner_text('[data-nuvem-painel]') and 'Voos 2' in A.inner_text('[data-nuvem-painel]').replace('\n', ' '))
        A.click('[data-np="enviar-base"]'); A.locator('[data-ok]').last.click()
        ok('primeiro envio: nuvem na versão 1 com os 2 voos', esperar(A, lambda: versao(b) == 1) and len(dados(b)['operacoes']) == 2)
        ok('A: chip "Sincronizado"', esperar(A, lambda: 'Sincronizado' in A.inner_text('[data-nuvem-chip]')))
        if SHOTS: A.screenshot(path=str(SHOTS / 'nuvem-A-painel.png'))
        fechar_modais(A)

        # ---------------- B: visitante sem login vê tudo
        ctxB, B = novo(b, p, 'B', vp={'width': 390, 'height': 844})
        ok('B sem login recebe os dados da nuvem (faixa "Dados da nuvem", 2 voos)', esperar(B, lambda: 'Dados da nuvem' in B.inner_text('.faixa-demo') and len(ds_local(B)['operacoes']) == 2))
        ok('B: painel mostra 200,0 ha', esperar(B, lambda: '200,0' in B.inner_text('.destaque-valor')))
        ok('B: faixa avisa "somente leitura"', 'somente leitura' in B.inner_text('.faixa-demo'))
        ok('B no celular sem login: o botão do topo mostra "Entrar"', B.locator('[data-nuvem-chip] em').is_visible() and 'Entrar' in B.inner_text('[data-nuvem-chip]'))
        t = dia_parado(B, '2026-10-21', 'Chuva')
        ok('B sem login: gravar é recusado', 'Somente leitura' in t and versao(b) == 1)
        if SHOTS: B.screenshot(path=str(SHOTS / 'nuvem-B-leitura.png'))

        # ---------------- Gestor libera o Líder; B cria a conta e confirma
        m = painel(A)
        m.locator('[data-np-novo-email]').fill('Lider@Teste.local'); m.locator('[data-np-novo-papel]').select_option('lider'); m.locator('[data-np="liberar"]').click()
        ok('Gestor libera lider@teste.local como Líder', esperar(A, lambda: 'lider@teste.local' in A.inner_text('[data-np-usuarios]') and 'criar no Supabase' in A.inner_text('[data-np-usuarios]')))
        fechar_modais(A)
        b.criar_usuario('lider@teste.local', 'senhaLider1', confirmado=False)   # Gestor cria no painel do Supabase (sem Auto Confirm)
        ok('lista mostra a conta como não confirmada', esperar(A, lambda: (fechar_modais(A), painel(A), 'não confirmada' in A.inner_text('[data-np-usuarios]'))[2]))
        fechar_modais(A)
        entrar(B, 'lider@teste.local', 'senhaLider1')
        ok('sem confirmar o e-mail: não entra', esperar(B, lambda: 'Confirme o e-mail' in B.inner_text('[data-nuvem-painel]')))
        b.confirmar('lider@teste.local')   # Auto Confirm
        entrar(B, 'lider@teste.local', 'senhaLider1')
        ok('após confirmar: B entra como Líder (senha provisória)', esperar(B, lambda: 'Líder' in B.inner_text('[data-nuvem-painel]') and 'Sua conta' in B.inner_text('[data-nuvem-painel]')))
        B.click('[data-np="senha"]'); B.fill('[data-ns]', 'novaSenha99'); B.click('[data-ns-ok]')
        ok('Líder troca a senha provisória', esperar(B, lambda: b.senhas['lider@teste.local'][1] == 'novaSenha99'))
        fechar_modais(B)

        # ---------------- Líder lança; Gestor recebe sozinho
        t = dia_parado(B, '2026-10-21', 'Chuva')
        ok('Líder registra 21/10 Chuva', '1 dia(s) registrado(s)' in t)
        ok('vai para a nuvem (versão 2)', esperar(B, lambda: versao(b) == 2 and len(dados(b)['diasParados']) == 1))
        ok('auditoria registra o Líder como autor', any(a['usuario'] == 'lider' and 'sem aplicação' in a['resumo'] for a in dados(b)['auditoria']))
        ok('A recebe sem recarregar (diasParados = 1)', esperar(A, lambda: len(ds_local(A).get('diasParados') or []) == 1, 12000))
        A.goto(A.url.split('#')[0] + '#/dashboard'); A.wait_for_selector('.destaque-lado')
        ok('A: painel mostra os dias parados do Líder', esperar(A, lambda: 'parados 1' in A.inner_text('.destaque-lado')))
        # Líder não mexe na safra
        B.goto(B.url.split('#')[0] + '#/planejamento'); B.wait_for_selector('[data-safra-editar]')
        B.click('[data-safra-editar]'); B.wait_for_selector('.modal [name="metaHa"]'); B.fill('.modal [name="metaHa"]', '30000'); B.click('.modal [data-salvar]'); B.wait_for_timeout(400)
        ok('Líder NÃO altera a meta da safra (mensagem clara; nuvem intacta)', 'Somente o Gestor altera meta da safra' in B.inner_text('.modal') and 'safra' not in dados(b))
        fechar_modais(B)

        # ---------------- Conflito: A sem internet, B lança ao mesmo tempo
        ctxA.set_offline(True)
        t = dia_parado(A, '2026-10-22', 'Vento acima do limite')
        ok('A sem internet: grava no aparelho e mostra "Sem internet · alterações aguardando"', '1 dia(s) registrado(s)' in t and esperar(A, lambda: 'aguardando' in A.inner_text('[data-nuvem-chip]')))
        t = dia_parado(B, '2026-10-17', 'Manutenção')
        ok('B lança 17/10 enquanto A está sem internet (versão 3)', esperar(B, lambda: versao(b) == 3))
        ctxA.set_offline(False); A.evaluate("window.dispatchEvent(new Event('online'))")
        ok('A volta: as duas alterações se juntam na nuvem (17, 21 e 22/10)', esperar(A, lambda: sorted(x['data'] for x in dados(b)['diasParados']) == ['2026-10-17', '2026-10-21', '2026-10-22'], 15000))
        ok('A e B ficam iguais à nuvem', esperar(B, lambda: len(ds_local(B)['diasParados']) == 3 and len(ds_local(A)['diasParados']) == 3, 12000))

        # ---------------- Teste de segurança (sem login) contra as regras reais
        m = painel(A); m.locator('[data-np="teste"]').click()
        ok('teste de segurança: 12/12 passaram', esperar(A, lambda: '12/12 verificações passaram' in A.inner_text('[data-np-teste]'), 20000))
        if SHOTS: A.locator('[data-nuvem-painel] .modal').screenshot(path=str(SHOTS / 'nuvem-teste-seguranca.png'))
        vt = versao(b)
        ok('após o teste: nenhuma alteração na nuvem', len(dados(b)['diasParados']) == 3 and vt == versao(b))

        # ---------------- Histórico e restauração
        m.locator('[data-np="hist"]').click()
        ok('Gestor vê as versões anteriores', esperar(A, lambda: A.locator('[data-np-rest]').count() >= 3))
        A.locator('[data-np-rest][data-v="1"]').click(); A.locator('[data-ok]').last.click()
        ok('Gestor volta à versão 1: nuvem sem dias parados', esperar(A, lambda: not dados(b).get('diasParados')))
        ok('B recebe a restauração', esperar(B, lambda: not ds_local(B).get('diasParados'), 12000))
        fechar_modais(A)

        # ---------------- Modo local: nada vai para a nuvem
        ctxC = p.chromium.launch().new_context(); b.ligar(ctxC); C = ctxC.new_page()
        chamadasC = []; C.on('request', lambda r: chamadasC.append(r.url) if 'supabase.co' in r.url else None)
        C.goto(URL + '?modo=local#/dashboard'); C.wait_for_selector('[data-nuvem-chip]')
        v0 = versao(b)
        t = dia_parado(C, '2026-10-21', 'Chuva')
        C.wait_for_timeout(2000)
        ok('modo local: grava sem login, só no aparelho, sem chamar a nuvem', 'Modo local' in C.inner_text('[data-nuvem-chip]') and '1 dia(s)' in t and versao(b) == v0 and not chamadasC)

        ok('sem erros de página', not (A.erros or B.erros))
        if A.erros or B.erros: print(A.erros, B.erros)
finally:
    b.fechar()

for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
