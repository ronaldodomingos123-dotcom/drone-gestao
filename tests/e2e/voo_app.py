"""Horas em voo do app do drone: lançar por drone/período, validações, uso no Dashboard (ha/h em voo e meta) e no Diário."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = re.search(r'SEED = """(.*?)"""', pathlib.Path('tests/e2e/diario_obs.py').read_text(), re.S).group(1)
META = """() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k)); d.metas.haHoraDrone = 23; localStorage.setItem(k, JSON.stringify(d)); }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor'); pg.evaluate(SEED); pg.evaluate(META)
    pg.goto('about:blank'); pg.goto(URL + '#/aeronaves'); pg.wait_for_selector('#ac-voo-app')
    ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    def lancar(ac, de, ate, h, a, n='', l='', o=''):
        pg.click('[data-vapp-novo]'); pg.wait_for_selector('.modal [data-v="h"]')
        pg.select_option('.modal [data-v="ac"]', ac); pg.fill('.modal [data-v="de"]', de); pg.fill('.modal [data-v="ate"]', ate)
        pg.fill('.modal [data-v="h"]', h); pg.fill('.modal [data-v="a"]', a); pg.fill('.modal [data-v="n"]', n); pg.fill('.modal [data-v="l"]', l); pg.fill('.modal [data-v="o"]', o)
        pg.click('.modal [data-v="ok"]'); pg.wait_for_timeout(300)
        msg = pg.locator('.modal [data-v="msg"]').inner_text() if pg.locator('.modal [data-v="msg"]').count() else ''
        return msg
    ok('erro claro quando as horas parecem minutos (571,33 ha em 22,62 min)', 'alto demais' in lancar('a2', '2026-10-26', '2026-10-31', '0,3', '571,33'))
    pg.locator('.modal [data-fechar]').first.click()
    ok('Alan (DR-02): 22,62 h · 571,33 ha · 221 voos · 9.428,4 L', lancar('a2', '2026-10-26', '2026-10-31', '22.62', '571,33', '221', '9.428,4', 'Alan') == '')
    lin = pg.locator('#ac-voo-app tr', has_text='DR-02').inner_text().replace('\t', ' ')
    ok(f'tabela: 25,26 ha/h em voo · 6,1 min/voo · 16,50 L/ha ({lin})', '25,26' in lin and '6,1' in lin and '16,50' in lin)
    ok('período cruzado no mesmo drone é recusado', 'cruza este período' in lancar('a2', '2026-10-30', '2026-11-02', '5', '100'))
    pg.locator('.modal [data-fechar]').first.click()
    ok('Daniel (DR-01) em hh:mm: 16:36 = 16,6 h', lancar('a1', '2026-10-26', '2026-10-31', '16:36', '381,31', '155', '5990,35', 'Daniel') == '' and abs([r for r in ds()['voosApp'] if r['aeronaveId'] == 'a1'][0]['horasVoo'] - 16.6) < 1e-9)
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.kpi-grupo')
    c = pg.locator('.kpi', has=pg.locator('.kpi-rot', has_text=re.compile('^ha/h em voo por drone$'))).inner_text().replace('\n', ' ')
    ok(f'Dashboard: (571,33 + 381,31) ÷ 39,22 h = 24,29 ha/h · 106% da meta 23 · fonte app do drone ({c})', '24,29' in c and '106%' in c and 'app do drone' in c)
    # filtro por um drone
    pg.goto(URL + '#/aeronaves'); pg.wait_for_selector('#ac-voo-app')
    pg.click('[data-vapp-editar]'); pg.wait_for_selector('.modal [data-v="h"]'); pg.fill('.modal [data-v="o"]', 'Alan · conferido'); pg.click('.modal [data-v="ok"]'); pg.wait_for_timeout(300)
    ok('editar mantém um registro só por período', len(ds()['voosApp']) == 2)
    # Diário: registro de um dia só
    lancar('a2', '2026-11-03', '2026-11-03', '1', '20')
    pg.click('[data-vapp-excluir]'); pg.locator('[data-ok]').last.click(); pg.wait_for_timeout(300)
    ok('excluir remove o registro e vai para a auditoria', len(ds()['voosApp']) == 2 and any('Horas em voo (app do drone) excluídas' in a['resumo'] for a in ds()['auditoria']))
    pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k)); d.voosApp = [{ id:'v1', aeronaveId:'a1', de:'2026-10-26', ate:'2026-10-26', horasVoo: 2, areaHa: 27.44, criadoEm:'x' }, { id:'v2', aeronaveId:'a2', de:'2026-10-26', ate:'2026-10-26', horasVoo: 1, areaHa: 27.44, criadoEm:'x' }]; localStorage.setItem(k, JSON.stringify(d)); }""")
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-kpi')
    t = pg.locator('#diario').inner_text().replace('\n', ' ').lower()
    ok('Diário 26/10: em voo por drone = 54,88 ÷ 3 h = 18,29 (meta 23)', 'em voo por drone 18,29 (meta 23)' in t)
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
