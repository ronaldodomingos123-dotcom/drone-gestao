"""Taxa de aplicação (L/ha) no importador de PDF da OS e no de tabela: o aviso some ao informar 15 L/ha, as OS e a
campanha recebem 15 L/ha e o início da campanha é o informado. Uso: python3 tests/e2e/taxa.py <pdf real da OS>"""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
PDF = sys.argv[1]
SEQ = pathlib.Path('tests/fixtures/fungicida-sequencia.txt').read_text()
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile).new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        # PDF
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.click('[data-imp="aba-pdf"]'); pg.wait_for_selector('[data-imp="arquivos"]')
        pg.set_input_files('[data-imp="arquivos"]', PDF); pg.wait_for_selector('.pdf-item .selo-ok', timeout=60000)
        pg.fill('[data-imp="nome"]', 'Fungicida 26/27'); pg.select_option('[data-imp="tipo"]', 'Fungicida'); pg.fill('[data-imp="inicio"]', '2026-10-14'); pg.dispatch_event('[data-imp="inicio"]', 'change'); pg.wait_for_timeout(400)
        ok(f'[{rot}] sem taxa: aviso "taxa de aplicação não encontrada"', 'taxa de aplicação (L/ha) não encontrada' in pg.locator('.modal').inner_text())
        pg.fill('[data-imp="taxa"]', '15'); pg.wait_for_timeout(500)
        ok(f'[{rot}] com 15 L/ha o aviso some', 'não encontrada' not in pg.locator('.modal').inner_text())
        pg.click('[data-imp="confirmar"]'); pg.wait_for_timeout(600)
        d = ds(); c = d['campanhas'][0]
        ok(f'[{rot}] OS 3416 e campanha com 15 L/ha; início 14/10', d['ordens'] and all(o['calda']['volumeLHa'] == 15 for o in d['ordens']) and c['calda']['volumeLHa'] == 15 and c['inicio'] == '2026-10-14')
        # tabela, na mesma campanha
        pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ); pg.wait_for_timeout(200)
        ok(f'[{rot}] aba "Colar tabela" também tem a taxa', pg.locator('.modal [data-imp="taxa"]').count() == 1)
        pg.select_option('.modal [data-imp="campanha"]', index=1); pg.fill('.modal [data-imp="taxa"]', '15'); pg.wait_for_timeout(200)
        pg.click('.modal [data-imp="confirmar"]'); pg.wait_for_timeout(500)
        d = ds()
        ok(f'[{rot}] todas as OS com 15 L/ha', len(d['ordens']) >= 5 and all(o['calda']['volumeLHa'] == 15 for o in d['ordens']))
        ir('campanhas'); pg.click('[data-editar="campanha"]'); pg.wait_for_selector('.modal [data-extra="volume"]')
        ok(f'[{rot}] campanha mostra "Taxa de aplicação" = 15', pg.input_value('.modal [data-extra="volume"]') == '15' and 'Taxa de aplicação' in pg.locator('.modal').inner_text())
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
