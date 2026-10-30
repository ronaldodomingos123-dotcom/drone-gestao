"""Diário: excluir o turno inteiro de um dia (voos, paradas e "turno sem aplicação") para refazer; os outros turnos ficam."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = re.search(r'SEED = """(.*?)"""', pathlib.Path('tests/e2e/diario_obs.py').read_text(), re.S).group(1)
EXTRA = """() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
  d.turnos.push({ id: 'tn1', nome: '1º Turno', periodo: 'Diurno', horaInicio: '07:00', horaFim: '15:00', liderId: 'l1', ativo: true });
  const o = JSON.parse(JSON.stringify(d.operacoes[0])); o.id = 'op4'; o.turnoId = 'tn1'; o.horaInicio = '07:00'; o.horaFim = '12:00'; o.itens = [{ talhaoId: 't1', areaHa: 40 }];
  d.operacoes.push(o); d.paradas.push({ id: 'pa4', operacaoId: 'op4', motivo: 'Orvalho', inicio: '2026-10-26T07:00', fim: '2026-10-26T08:00', responsavel: '' });
  d.diasParados = [{ id: 'dp1', data: '2026-10-26', motivo: 'Vento acima do limite', campanhaIds: [], criadoEm: '2026-10-26T23:00', turnoId: 'tn2' }, { id: 'dp2', data: '2026-10-25', motivo: 'Chuva', campanhaIds: [], criadoEm: '2026-10-25T23:00' }];
  localStorage.setItem(k, JSON.stringify(d)); }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor'); pg.evaluate(SEED); pg.evaluate(EXTRA)
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-tempo')
    ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    ok('botão "Excluir turno" na barra do dia', pg.locator('[data-turno-excluir]').count() == 1)
    pg.click('[data-turno-excluir]'); pg.wait_for_selector('.modal [data-tx-turno]')
    ok('lista os dois turnos do dia', pg.locator('.modal [data-tx-turno] option').count() == 2)
    pg.select_option('.modal [data-tx-turno]', 'tn2'); t = pg.locator('.modal [data-tx-lista]').inner_text()
    ok(f'prévia do 2º turno: 2 voos, 54,88 ha, paradas e turno sem aplicação', '2 voo(s)' in t and '54,88' in t and '2 parada(s)' in t and '1 registro(s) de turno sem aplicação' in t)
    pg.fill('.modal [data-tx-mot]', 'ficha errada'); pg.click('.modal [data-tx-excluir]'); pg.wait_for_timeout(200)
    ok('sem marcar a confirmação não exclui', 'Marque a confirmação' in pg.locator('.modal').inner_text() and len(ds()['operacoes']) == 3)
    pg.fill('.modal [data-tx-mot]', ''); pg.check('.modal [data-tx-ok]'); pg.click('.modal [data-tx-excluir]'); pg.wait_for_timeout(200)
    ok('sem motivo não exclui', 'motivo' in pg.locator('.modal').inner_text().lower() and len(ds()['operacoes']) == 3)
    pg.fill('.modal [data-tx-mot]', 'ficha errada'); pg.click('.modal [data-tx-excluir]'); pg.wait_for_timeout(400)
    d = ds()
    ok('2º turno some (voos, paradas, turno sem aplicação); 1º turno e o dia 25 ficam', [o['id'] for o in d['operacoes']] == ['op4'] and [x['id'] for x in d['paradas']] == ['pa4'] and [x['id'] for x in d['diasParados']] == ['dp2'])
    a = [x for x in d['auditoria'] if 'Turno excluído' in x['resumo']]
    ok('auditoria com motivo e tudo o que saiu', len(a) == 1 and a[0]['motivo'] == 'ficha errada' and len(a[0]['antes']['operacoes']) == 2 and len(a[0]['antes']['diasParados']) == 1)
    ok('oferece ir para o Fechamento do dia', pg.locator('.modal [data-tx-ir]').count() == 1)
    pg.click('.modal [data-tx-ir]'); pg.wait_for_timeout(500)
    ok('leva ao Fechamento do dia', '#/fechamento' in pg.url)
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-tempo')
    ok('Diário do dia segue com o 1º turno', '07:00' in pg.locator('.dia-tempo').inner_text() and '15:50' not in pg.locator('.dia-tempo').inner_text())
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
