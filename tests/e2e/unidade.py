"""Unidade/empresa opcional: importar sem unidade; criar unidade digitada na hora (importação e cadastro de fazenda)."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEQ = "Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda Alfa\t5001\t30,00\tFungicida\n2\tFazenda Beta\t5002\t20,5\tFungicida\n"
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(250)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        # 1. importar sem cadastrar unidade
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ); pg.fill('[data-imp="nome"]', 'Campanha Teste'); pg.wait_for_timeout(150)
        ok(f'[{rot}] importar com "Sem unidade" é permitido', not pg.locator('[data-imp="confirmar"]').is_disabled() and 'unidade' not in pg.locator('.imp-previa').inner_text().lower())
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-unidade-opcional.png'))
        pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(200)
        d = ds(); ok(f'[{rot}] fazendas e OS criadas sem unidade', len(d['fazendas']) == 2 and all(f['unidadeId'] == '' for f in d['fazendas']) and not d['unidades'])
        # 2. importar outra planilha criando a unidade digitada
        pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ.replace('Alfa', 'Gama').replace('Beta', 'Delta').replace('5001', '5003').replace('5002', '5004'))
        pg.select_option('[data-imp="campanha"]', index=1); pg.select_option('[data-un="imp"]', '__nova'); pg.fill('[data-un-nova="imp"]', 'Empresa Exemplo Um'); pg.wait_for_timeout(150)
        pg.click('[data-imp="confirmar"]'); pg.wait_for_timeout(300)
        d = ds(); u = [x for x in d['unidades'] if x['nome'] == 'Empresa Exemplo Um']
        ok(f'[{rot}] "+ Nova unidade/empresa" cria a unidade e liga as fazendas novas', len(u) == 1 and sum(1 for f in d['fazendas'] if f['unidadeId'] == u[0]['id']) == 2)
        # 3. cadastro de fazenda: unidade opcional e nova unidade na hora
        ir('fazendas'); pg.click('[data-novo="fazenda"]'); pg.fill('.modal [name="nome"]', 'Fazenda Sem Unidade'); pg.select_option('.modal [name="unidadeId"]', ''); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(200)
        ok(f'[{rot}] fazenda salva sem unidade', any(f['nome'] == 'Fazenda Sem Unidade' and f['unidadeId'] == '' for f in ds()['fazendas']))
        pg.click('[data-novo="fazenda"]'); pg.fill('.modal [name="nome"]', 'Fazenda Com Nova'); pg.select_option('.modal [name="unidadeId"]', '__nova')
        ok(f'[{rot}] campo do nome aparece ao escolher "+ Nova"', pg.locator('.modal [name="novaUnidade"]').is_visible())
        pg.click('.modal [data-salvar]'); pg.wait_for_timeout(150)
        ok(f'[{rot}] exige o nome da nova unidade', 'nome da nova unidade' in pg.locator('.modal .form-msgs').inner_text().lower())
        pg.fill('.modal [name="novaUnidade"]', 'empresa exemplo um'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(200)
        d = ds(); f = [x for x in d['fazendas'] if x['nome'] == 'Fazenda Com Nova'][0]
        ok(f'[{rot}] mesmo nome reaproveita a unidade existente (não duplica)', len(d['unidades']) == 1 and f['unidadeId'] == d['unidades'][0]['id'])
        pg.click('[data-novo="unidade"]'); pg.fill('.modal [name="nome"]', 'Empresa Exemplo Dois'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(200)
        ok(f'[{rot}] unidade/empresa sem código é aceita', any(x['nome'] == 'Empresa Exemplo Dois' for x in ds()['unidades']))
        # 4. nova aplicação: fazenda disponível sem escolher unidade
        ir('aplicacoes/nova'); pg.wait_for_selector('[data-k="fazendaId"]')
        ok(f'[{rot}] nova aplicação: fazenda liberada sem escolher unidade', pg.locator('[data-k="fazendaId"]').is_enabled() and pg.locator('[data-k="fazendaId"] option').count() >= 5)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
