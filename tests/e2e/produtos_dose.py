"""Produtos e insumos: dose por hectare (média ponderada pela área) e área aplicada de cada produto, conferidas com conta própria."""
import pathlib, re, json
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def num(t): return float(t.replace('.', '').replace(',', '.'))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/produtos'); pg.wait_for_selector('#pr-tab tbody tr')
    d = pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    cab = [c.strip().lower() for c in pg.locator('#pr-tab thead th').all_inner_texts()]
    ok(f'colunas "Área aplicada" e "Dose por hectare" ({cab})', any('área aplicada' in c for c in cab) and any('dose por hectare' in c for c in cab))
    # pega o 1º produto e confere com conta independente sobre as operações da tabela (sem filtro de campanha/fazenda; período da tela)
    de = pg.input_value('[data-f="de"]') if pg.locator('[data-f="de"]').count() else ''
    ate = pg.input_value('[data-f="ate"]') if pg.locator('[data-f="ate"]').count() else ''
    linha = pg.locator('#pr-tab tbody tr').first
    nome = linha.locator('td').first.inner_text().strip()
    prod = next(x for x in d['produtos'] if x['nome'] == nome)
    def area_op(o):
        return sum(i.get('areaHa') or 0 for i in o['itens'])
    soma = area = amin = 0; ds_ = []
    for o in d['operacoes']:
        if de and o['data'] < de or ate and o['data'] > ate: continue
        it = next((x for x in o['calda']['produtos'] if x['produtoId'] == prod['id']), None)
        a = area_op(o)
        if not it or a <= 0: continue
        area += a; dz = it.get('doseReal') if it.get('doseReal') is not None else it.get('dosePlanejada')
        if dz is not None and it['unidade'] == prod['unidadeDose']: soma += dz * a; amin += a; ds_.append(dz)
    txt = linha.inner_text()
    idx = cab.index(next(c for c in cab if 'dose por hectare' in c)); ia = cab.index(next(c for c in cab if 'área aplicada' in c))
    celd = linha.locator('td').nth(idx).inner_text(); cela = linha.locator('td').nth(ia).inner_text()
    esperado = soma / amin if amin else None
    ok(f'{nome}: dose {celd!r} ≈ {esperado:.3f} ({len(ds_)} operações)', esperado is not None and abs(num(re.search(r'[\d.,]+', celd).group()) - esperado) < 0.0006 and prod['unidadeDose'] in celd)
    ok(f'{nome}: área {cela!r} ≈ {area:.2f} ha', abs(num(re.search(r'[\d.,]+', cela).group()) - area) < 0.006)
    if len(set(ds_)) > 1: ok('dose variou: mostra a menor e a maior', f"de " in celd and " a " in celd)
    ok('nota explica a média ponderada', 'ponderada pela área' in pg.locator('.nota').first.inner_text() or 'ponderada pela área' in pg.content())
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
