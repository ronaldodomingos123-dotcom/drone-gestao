"""Sequência: opção "Todas concluídas" (OS de todas as campanhas terminadas), com consulta por período e sem reordenar."""
import pathlib
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/relatorios/sequencia'); pg.wait_for_selector('#seq-tab')
    # encerra as duas primeiras campanhas da demo (todas as OS concluídas)
    camps = pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k)); const cs=d.campanhas.slice(0,2).map(c=>c.id);
      d.ordens.forEach(o => { if (cs.includes(o.campanhaId) && o.status !== 'cancelada') { o.status='concluida'; o.concluidaManual=true; } }); localStorage.setItem(k, JSON.stringify(d));
      return { cs, n: d.ordens.filter(o => cs.includes(o.campanhaId) && o.status !== 'cancelada').length, nomes: d.campanhas.slice(0,2).map(c=>c.nome) }; }""")
    pg.reload(); pg.wait_for_selector('[data-k="campanha"]')
    opt = pg.locator('[data-k="campanha"] optgroup[label="Concluídas"] option').first
    ok('grupo Concluídas começa com "Todas concluídas"', opt.inner_text() == 'Todas concluídas')
    pg.select_option('[data-k="campanha"]', '*concluidas'); pg.wait_for_timeout(400)
    ok('título "Todas concluídas" com as campanhas encerradas', 'Todas concluídas' in pg.locator('.seq-topo h2').inner_text() and all(nm in pg.locator('.seq-topo').inner_text() for nm in camps['nomes']))
    linhas = pg.locator('#seq-tab tbody tr[data-os]')
    ok(f'mostra todas as OS das campanhas encerradas ({linhas.count()} de {camps["n"]}), mesmo com "Só o que falta fazer"', linhas.count() == camps['n'] and pg.is_checked('[data-k="sofalta"]'))
    ok('cada linha diz a campanha', all(any(nm in t for nm in camps['nomes']) for t in linhas.all_inner_texts()))
    # reordenar é bloqueado
    antes = linhas.first.get_attribute('data-os')
    pg.locator('#seq-tab tbody tr[data-os]').nth(1).locator('[data-acao="subir"]').click(); pg.wait_for_timeout(300)
    ok('subir/descer não muda a ordem aqui', pg.locator('#seq-tab tbody tr[data-os]').first.get_attribute('data-os') == antes and 'não muda' in pg.content())
    # período continua funcionando
    datas = sorted(set(pg.locator('#seq-tab tbody tr[data-os] small').evaluate_all("els => els.map(e => (e.textContent.match(/concluída (\\d\\d)\\/(\\d\\d)\\/(\\d{4})/)||[]).slice(1).reverse().join('-')).filter(Boolean)")))
    de = datas[len(datas) // 2]
    pg.fill('[data-k="conc-de"]', de); pg.dispatch_event('[data-k="conc-de"]', 'change'); pg.wait_for_timeout(300)
    n2 = pg.locator('#seq-tab tbody tr[data-os]').count()
    ok(f'com "Concluídas de {de}" filtra ({n2} OS)', 0 < n2 < camps['n'])
    pg.click('[data-limpar-conc]'); pg.wait_for_timeout(200)
    pg.reload(); pg.wait_for_selector('#seq-tab')
    ok('a escolha "Todas concluídas" fica guardada', pg.input_value('[data-k="campanha"]') == '*concluidas')
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
