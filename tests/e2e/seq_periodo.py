"""Sequência: consultar as OS concluídas num período (data da conclusão = último dia com aplicação), conferido com conta própria."""
import pathlib, json
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def num(t): return float(t.replace('.', '').replace(',', '.').split()[0])
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/relatorios/sequencia'); pg.wait_for_selector('#seq-tab')
    d = pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    camp = pg.input_value('[data-k="campanha"]')
    if camp == '*todas':
        camp = d['campanhas'][0]['id']; pg.select_option('[data-k="campanha"]', camp); pg.wait_for_timeout(300)
    # conta própria: OS concluídas da campanha e o último dia com área de cada uma
    ult = {}
    for x in d['operacoes'] + d.get('lancamentos', []):
        if any((i.get('areaHa') or 0) > 0 for i in x['itens']): ult[x['osId']] = max(ult.get(x['osId'], ''), x['data'])
    conc = [o for o in d['ordens'] if o['campanhaId'] == camp and o['status'] == 'concluida']
    datas = sorted(ult[o['id']] for o in conc if o['id'] in ult)
    ok(f'demo tem OS concluídas para testar ({len(conc)})', len(datas) >= 3)
    de, ate = datas[1], datas[-2]
    esperadas = {o['id'] for o in conc if o['id'] in ult and de <= ult[o['id']] <= ate}
    apl = {}
    for x in d['operacoes'] + d.get('lancamentos', []):
        for i in x['itens']: apl[x['osId']] = apl.get(x['osId'], 0) + (i.get('areaHa') or 0)
    pg.fill('[data-k="conc-de"]', de); pg.dispatch_event('[data-k="conc-de"]', 'change'); pg.wait_for_timeout(200)
    pg.fill('[data-k="conc-ate"]', ate); pg.dispatch_event('[data-k="conc-ate"]', 'change'); pg.wait_for_timeout(300)
    ids = set(pg.locator('#seq-tab tbody tr[data-os]').evaluate_all('rs => rs.map(r => r.dataset.os)'))
    ok(f'tabela só com as concluídas entre {de} e {ate} ({len(ids)} de {len(esperadas)})', ids == esperadas)
    tot = sum(apl.get(i, 0) for i in esperadas)
    rod = pg.locator('#seq-tab tfoot td').nth(4).inner_text()
    ok(f'total aplicado {rod} = {tot:.2f}', abs(num(rod) - tot) < 0.006)
    ok('cartão diz "Concluídas no período" com a contagem certa', 'no período' in pg.locator('.seq-card.c-conc header').inner_text().lower() and pg.locator('.seq-card.c-conc header b').inner_text() == str(len(esperadas)))
    ok('aviso resume o período e o topo segue com a campanha inteira', f'{len(esperadas)}' in pg.locator('.aviso').first.inner_text() and 'campanha inteira' in pg.locator('.aviso').first.inner_text())
    ok('fechamento lista só as do período com a data de conclusão', pg.locator('.seq-fech tbody tr').count() == len(esperadas) and 'concluída em' in pg.locator('.seq-fech thead').inner_text().lower())
    ok('linha mostra "concluída dd/mm/aaaa"', 'concluída ' in pg.locator('#seq-tab tbody tr').first.inner_text())
    pg.reload(); pg.wait_for_selector('#seq-tab')
    ok('período fica guardado ao voltar', pg.input_value('[data-k="conc-de"]') == de and pg.locator('#seq-tab tbody tr[data-os]').count() == len(esperadas))
    pg.click('[data-limpar-conc]'); pg.wait_for_timeout(300)
    ok('Limpar período volta ao normal', pg.input_value('[data-k="conc-de"]') == '' and pg.locator('[data-limpar-conc]').count() == 0 and pg.locator('#seq-tab tbody tr[data-os]').count() != len(esperadas))
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
