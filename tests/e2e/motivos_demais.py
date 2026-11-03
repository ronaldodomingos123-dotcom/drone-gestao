"""Dashboard → Motivos de parada: os motivos além dos 6 coloridos aparecem um a um na legenda (sob "Demais motivos") e no detalhe."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def minutos(t):
    h = re.search(r'(\d+)h', t); m = re.search(r'(\d+)min', t)
    return (int(h.group(1)) if h else 0) * 60 + (int(m.group(1)) if m else 0)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('#g-motivos .legenda-lista li')
    principais = pg.locator('#g-motivos .legenda-lista li:not(.leg-sub)'); subs = pg.locator('#g-motivos li.leg-sub')
    dem = pg.locator('#g-motivos .legenda-lista li:not(.leg-sub)', has_text='Demais motivos')
    ok(f'"Demais motivos (N)" com N = itens listados abaixo ({subs.count()})', dem.count() == 1 and f'({subs.count()})' in dem.inner_text() and subs.count() >= 1)
    soma = sum(minutos(subs.nth(i).locator('b').inner_text()) for i in range(subs.count()))
    ok(f'soma dos itens = tempo de "Demais" ({soma} min)', abs(soma - minutos(dem.locator('b').inner_text())) <= subs.count())
    ok('6 motivos coloridos + Demais', principais.count() == 7)
    tip = pg.locator('#g-motivos path[data-grupo="f6"]').get_attribute('data-tip') or ''
    ok('detalhe da fatia cinza lista cada motivo', all(subs.nth(i).locator('span').inner_text().split(' ·')[0] in tip for i in range(subs.count())))
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
