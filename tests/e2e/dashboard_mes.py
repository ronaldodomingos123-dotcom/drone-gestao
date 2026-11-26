"""Dashboard: gráfico de área com a chave Dia | Mês. Confere que os meses somam o mesmo que o período (aplicado e meta),
que "Mês" só fica disponível com dois meses ou mais no filtro e que a escolha é lembrada."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); print(res[-1][0], n); return c
num = lambda s: float(s.replace('.', '').replace(',', '.'))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('[data-area-modo]')
    ok('abre em "Dia" (como antes)', 'ativo' in pg.get_attribute('[data-area-modo="dia"]', 'class') and 'por dia' in pg.locator('#g-dia').locator('xpath=ancestor::section[1]').inner_text())
    lado = pg.locator('.destaque').inner_text().replace('\n', ' ')
    aplic = num(re.search(r'Aplicada no período\s*([\d.,]+) ha', lado).group(1))
    meta = num(re.search(r'seriam ([\d.,]+) ha', lado).group(1))
    pg.click('[data-area-modo="mes"]'); pg.wait_for_timeout(400)
    sec = pg.locator('#g-dia').locator('xpath=ancestor::section[1]')
    ok('modo Mês: título e legenda trocam', 'por mês' in sec.inner_text() and 'meta do mês' in sec.inner_text())
    rots = pg.locator('#g-dia svg text').evaluate_all('els => els.map(e => e.textContent)')
    ok(f'um rótulo por mês: set/26, out/26, nov/26 ({[r for r in rots if "/" in r]})', [r for r in rots if '/' in r] == ['set/26', 'out/26', 'nov/26'])
    caixa = pg.locator('#g-dia').bounding_box(); soma_a = soma_m = 0; dicas = []
    for i in range(3):
        pg.mouse.move(caixa['x'] + 46 + (caixa['width'] - 56) * (i + 0.5) / 3, caixa['y'] + caixa['height'] * 0.75); pg.wait_for_timeout(250)
        t = pg.locator('#g-dia .g-tip').inner_text().replace('\n', ' ')
        dicas.append(t)
        soma_a += num(re.search(r'Aplicado\s*([\d.,]+) ha', t).group(1)); soma_m += num(re.search(r'Planejado\s*([\d.,]+) ha', t).group(1))
    ok(f'soma dos meses = aplicado no período ({soma_a:.0f} × {aplic:.1f})', abs(soma_a - aplic) <= 3)
    ok(f'soma das metas dos meses = meta do período no ritmo ({soma_m:.0f} × {meta:.0f})', abs(soma_m - meta) <= 3)
    ok(f'setembro aparece como mês parcial (14/09 a 30/09) ({dicas[0][:60]})', '14/09' in dicas[0] and '30/09' in dicas[0])
    ok('detalhe do mês: dias com e sem aplicação', 'Dias com aplicação' in dicas[1] and 'Dias sem aplicação' in dicas[1])
    pg.goto('about:blank'); pg.goto(URL + '#/dashboard'); pg.wait_for_selector('[data-area-modo]')
    ok('a escolha "Mês" é lembrada ao voltar', 'ativo' in pg.get_attribute('[data-area-modo="mes"]', 'class'))
    pg.click('.filtros-toggle') if not pg.locator('[data-f="de"]').is_visible() else None
    pg.fill('[data-f="de"]', '2026-10-01'); pg.dispatch_event('[data-f="de"]', 'change'); pg.fill('[data-f="ate"]', '2026-10-31'); pg.dispatch_event('[data-f="ate"]', 'change'); pg.wait_for_timeout(500)
    ok('período de um mês só: "Mês" desativado e o gráfico volta a ser por dia', pg.locator('[data-area-modo="mes"]').is_disabled() and 'por dia' in pg.locator('#g-dia').locator('xpath=ancestor::section[1]').inner_text())
    ok('sem erros na página', not er)
print(f"{sum(r[0]=='PASSOU' for r in res)}/{len(res)} passaram")
