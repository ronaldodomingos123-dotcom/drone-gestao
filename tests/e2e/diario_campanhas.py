"""Diário: campanhas em andamento no cabeçalho e progresso separado por campanha; campanha terminada some."""
import pathlib, re, sys
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = re.search(r'SEED = """(.*?)"""', pathlib.Path('tests/e2e/diario_obs.py').read_text(), re.S).group(1)
EXTRA = re.search(r'EXTRA = """(.*?)"""', pathlib.Path('tests/e2e/seq_todas.py').read_text(), re.S).group(1).replace("inicio: '2026-10-31'", "inicio: '2026-10-20'")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor'); pg.evaluate(SEED); pg.evaluate(EXTRA)
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('[data-dia-progresso]')
    cab = pg.locator('.dia-cab-chips').inner_text().lower(); prog = pg.locator('[data-dia-progresso]')
    ok(f'cabeçalho: as duas campanhas, a sem aplicação marcada ({cab!r})', 'fungicida' in cab and 'inseticida 26/27' in cab and '(sem aplicação)' in cab)
    blocos = prog.locator('.dia-camp-bloco')
    ok('progresso: um bloco por campanha (Fungicida primeiro, aplicou no dia)', blocos.count() == 2 and blocos.nth(0).get_attribute('data-camp') == 'c1' and 'aplicou 54,88 ha no dia' in blocos.nth(0).inner_text())
    b1, b2 = blocos.nth(0).inner_text(), blocos.nth(1).inner_text()
    ok(f'Fungicida: concluído 54,9 de 540,0 (OS 500 + 40) · 10%', '54,9 ha' in b1 and '540,0 ha' in b1 and '10%' in b1)
    ok(f'Inseticida: 0% · programado 114,0 · previsão "sem aplicação ainda"', '0%' in b2 and '114,0 ha' in b2 and 'sem aplicação ainda' in b2)
    if SHOTS: prog.screenshot(path=str(SHOTS / 'diario-progresso-campanhas.png')); pg.locator('.dia-cab').first.screenshot(path=str(SHOTS / 'diario-cab-campanhas.png'))
    pg.select_option('[data-k="campanhaId"]', 'c1'); pg.wait_for_timeout(300)
    ok('filtro de campanha: só a filtrada (no progresso e no cabeçalho)', pg.locator('.dia-camp-bloco').count() == 1 and pg.locator('.dia-camp-bloco').get_attribute('data-camp') == 'c1' and 'inseticida' not in pg.locator('.dia-cab-chips').inner_text().lower())
    pg.select_option('[data-k="campanhaId"]', ''); pg.wait_for_timeout(200)
    # inseticida terminada (todas as OS concluídas, nada aplicado depois) → some
    pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k)); for (const o of d.ordens) if (o.campanhaId === 'c2') { o.status = 'concluida'; o.concluidaManual = true; } localStorage.setItem(k, JSON.stringify(d)); }""")
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('[data-dia-progresso]')
    ok('campanha terminada some do cabeçalho e do progresso', pg.locator('.dia-camp-bloco').count() == 1 and 'inseticida' not in pg.locator('.dia-cab-chips').inner_text().lower() and 'progresso da campanha' in pg.locator('[data-dia-progresso]').inner_text().lower())
    with pg.expect_download() as dl: pg.click('[data-acao="imagem"]')
    ok('exportar imagem continua funcionando', dl.value.suggested_filename.endswith('.png'))
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
