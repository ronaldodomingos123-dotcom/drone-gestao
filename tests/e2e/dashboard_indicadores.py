"""Dashboard: indicadores em dois blocos (máquina por drone × frente no relógio), meta por drone em hora pulverizando (KML),
frente parada na mesma base e meta do período limitada ao programado. Diário com os mesmos nomes."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = re.search(r'SEED = """(.*?)"""', pathlib.Path('tests/e2e/diario_obs.py').read_text(), re.S).group(1)
KML = """() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
  d.operacoes.find(o => o.id === 'op1').voo = { origem: 'kml', cargas: 10, tempoVooMin: 60, volumeL: 400, taxaLHa: 14.6, foraTaxa: 0, dividido: false };
  d.metas.haHoraDrone = 23; localStorage.setItem(k, JSON.stringify(d)); }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1366, 'height': 900}); er = []; pg.on('pageerror', lambda e: er.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor'); pg.evaluate(SEED); pg.evaluate(KML)
    pg.goto('about:blank'); pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.kpi-grupo')
    def card(rot):
        c = pg.locator('.kpi', has=pg.locator('.kpi-rot', has_text=re.compile('^' + re.escape(rot) + '$')))
        return c.inner_text().replace('\n', ' ') if c.count() == 1 else ''
    g = pg.locator('.kpi-grupo h3').all_inner_texts()
    ok(f'dois blocos: Máquina · por drone e Frente · no relógio ({g})', len(g) == 2 and 'por drone' in g[0].lower() and 'relógio' in g[1].lower())
    t = card('ha/h em voo por drone')
    ok(f'em voo por drone = 27,44 ÷ 1 h = 27,44 · meta 23 → 119% · KML em 50% da área ({t})', '27,44' in t and '119%' in t and 'KML em 50' in t)
    t = card('ha/h efetivo por drone'); ok(f'efetivo por drone = 54,88 ÷ 4 h = 13,72 ({t})', '13,72' in t)
    t = card('ha/h por drone com paradas'); ok(f'com paradas = 54,88 ÷ 15 h = 3,66 ({t})', '3,66' in t)
    t = card('Aproveitamento do tempo do drone'); ok(f'aproveitamento = 4 h ÷ 15 h = 26,7% ({t})', '26,7' in t)
    t = card('ha/h efetivo da frente'); ok(f'efetivo da frente = 54,88 ÷ 7 h = 7,84 ({t})', '7,84' in t and '7h 00min' in t)
    t = card('ha/h da jornada da frente'); ok(f'jornada da frente = 54,88 ÷ 7h30 = 7,32 ({t})', '7,32' in t and '7h 30min' in t)
    t = card('Frente parada'); ok(f'frente parada = 7h30 − 7h00 = 30min, 6,7% da jornada; algum drone parado 30min ({t})', t.startswith('Frente parada') and '30min' in t and '6,7%' in t)
    ok('cartões antigos com base misturada saíram', card('Tempo parado') == '' and card('Produtividade efetiva') == '')
    lado = pg.locator('.destaque-lado').inner_text().replace('\n', ' ')
    ok(f'meta do período limitada ao programado (500,0 ha), não ao ritmo de dias ({lado[:200]})', 'limitada ao programado' in lado and '500,0 ha' in lado)
    # intervalo sem voo entre dois voos do dia conta na jornada da frente (como no Diário)
    pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
      const o = JSON.parse(JSON.stringify(d.operacoes.find(x => x.id === 'op1'))); o.id = 'op3'; o.horaInicio = '23:40'; o.horaFim = '23:55'; o.tempoEfetivoMin = 15; delete o.voo; o.itens = [{ talhaoId: 't1', areaHa: 2 }];
      d.operacoes.push(o); localStorage.setItem(k, JSON.stringify(d)); }""")
    pg.goto('about:blank'); pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.kpi-grupo')
    t = card('ha/h da jornada da frente'); ok(f'jornada da frente = 15:50 a 23:55 = 8h05 (com voo 7h45) · 56,88 ÷ 8,083 = 7,04 ({t})', '8h 05min' in t and '7h 45min com voo' in t and '7,04' in t)
    t = card('Frente parada'); ok(f'frente parada = 8h05 − 7h15 = 50min ({t})', '50min' in t)
    pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-kpi')
    t = pg.locator('#diario').inner_text().replace('\n', ' ').lower()
    ok('Diário: mesmos nomes ("da frente") e em voo por drone com a meta', 'ha/h efetivo da frente' in t and 'ha/h da jornada da frente' in t and 'em voo por drone 27,44 (meta 23)' in t)
    ok('sem erros de página', not er)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
