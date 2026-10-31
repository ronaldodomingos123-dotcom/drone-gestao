"""Sequência: opção "Todas as campanhas" com ordem própria; OS nova (de qualquer campanha) entra no fim; a ordem de cada campanha não muda."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = re.search(r'SEED = """(.*?)"""', pathlib.Path('tests/e2e/diario_obs.py').read_text(), re.S).group(1)
EXTRA = """() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
  const calda = d.campanhas[0].calda;
  d.campanhas.push({ id: 'c2', nome: 'Inseticida 26/27', tipo: 'Inseticida', cultura: 'Cana-de-açúcar', inicio: '2026-10-31', fim: '2026-11-15', calda });
  d.fazendas.push({ id: 'f2', unidadeId: 'u1', codigo: '47', nome: 'Fazenda Paraiso', municipio: '' }, { id: 'f3', unidadeId: 'u1', codigo: '145', nome: 'Fazenda Fundao', municipio: '' }, { id: 'f4', unidadeId: 'u1', codigo: '118', nome: 'Fazenda Quatro', municipio: '' });
  d.talhoes.push({ id: 't2', fazendaId: 'f2', codigo: 'GERAL', areaHa: 51, geral: true }, { id: 't3', fazendaId: 'f3', codigo: 'GERAL', areaHa: 63, geral: true }, { id: 't4', fazendaId: 'f4', codigo: 'GERAL', areaHa: 40, geral: true });
  const os = (id, num, camp, fz, t, seq, area) => ({ id, numero: num, campanhaId: camp, unidadeId: 'u1', fazendaId: fz, tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-30', sequencia: seq, itens: [{ talhaoId: t, areaPlanejadaHa: area }], calda });
  d.ordens.push(os('o4', '3420', 'c1', 'f4', 't4', 2, 40), os('o2', '3663', 'c2', 'f2', 't2', 1, 51), os('o3', '3662', 'c2', 'f3', 't3', 2, 63));
  localStorage.setItem(k, JSON.stringify(d)); }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor'); pg.evaluate(SEED); pg.evaluate(EXTRA)
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/sequencia'); pg.wait_for_selector('[data-k="campanha"]')
    ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    ordem = lambda: pg.evaluate("[...document.querySelectorAll('tr[data-os]')].map(t => t.dataset.os)")
    ok('opção "Todas as campanhas" no seletor', pg.locator('[data-k="campanha"] option', has_text='Todas as campanhas').count() == 1)
    pg.select_option('[data-k="campanha"]', '*todas'); pg.wait_for_timeout(300)
    ok(f'Todas: campanha mais antiga primeiro, cada uma na sua ordem ({ordem()})', ordem() == ['o1', 'o4', 'o2', 'o3'])
    t = pg.locator('#seq').inner_text()
    ok('título "Todas as campanhas", total programado das 4 OS (654,00) e nome da campanha na linha', 'Todas as campanhas' in t and '654,00' in t and 'Inseticida 26/27' in pg.locator('tr[data-os="o2"]').inner_text())
    ok('sem botão "Nova OS" em Todas', pg.locator('[data-novo="ordem"]').count() == 0)
    pg.fill('tr[data-os="o3"] [data-pos]', '1'); pg.press('tr[data-os="o3"] [data-pos]', 'Enter'); pg.wait_for_timeout(400)
    d = ds(); g = {o['id']: o.get('sequenciaGeral') for o in d['ordens']}; sq = {o['id']: o.get('sequencia') for o in d['ordens']}
    ok(f'mover em Todas: o3 vai para 1º ({ordem()}) e grava a ordem geral {g}', ordem() == ['o3', 'o1', 'o4', 'o2'] and g == {'o1': 2, 'o4': 3, 'o2': 4, 'o3': 1})
    ok('a ordem dentro de cada campanha não muda', sq == {'o1': 1, 'o4': 2, 'o2': 1, 'o3': 2})
    ok('auditoria marca "(todas as campanhas)"', any('todas as campanhas' in a['resumo'] for a in d['auditoria']))
    # OS nova pela importação (colar tabela) na campanha Fungicida: entra no FIM da ordem geral
    pg.click('[data-acao="importar"]'); pg.wait_for_selector('.modal .imp-texto')
    pg.select_option('.modal [data-imp="campanha"]', 'c1')
    pg.fill('.modal .imp-texto', 'Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda Nova Z\t3999\t12,5\tFungicida'); pg.wait_for_timeout(400)
    pg.click('.modal [data-imp="confirmar"]'); pg.wait_for_timeout(600)
    d = ds(); nova = [o for o in d['ordens'] if o['numero'] == '3999']
    ok(f'OS nova da Fungicida entra no fim da ordem geral (5ª) e continua em Todas ({ordem()})', len(nova) == 1 and nova[0].get('sequenciaGeral') == 5 and ordem()[-1] == nova[0]['id'] and pg.locator('[data-k="campanha"]').input_value() == '*todas')
    ok('na campanha Fungicida ela entra no fim da campanha (3ª)', nova[0].get('sequencia') == 3)
    pg.select_option('[data-k="campanha"]', 'c2'); pg.wait_for_timeout(300)
    ok(f'campanha Inseticida sozinha segue a ordem dela ({ordem()})', ordem() == ['o2', 'o3'])
    pg.select_option('[data-k="campanha"]', '*todas'); pg.wait_for_timeout(200)
    pg.click('[data-acao="copiar"]'); pg.wait_for_timeout(300)
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
