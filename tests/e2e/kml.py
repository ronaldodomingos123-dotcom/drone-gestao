"""KML de voo real (84 cargas, 2 drones) no Fechamento do dia: 19/10 (do código do app, data corrigida) e 20/10.
Área de cada drone em cada fazenda vem do KML; série do drone e local da fazenda ficam aprendidos."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
SEQ = pathlib.Path('tests/fixtures/fungicida-sequencia.txt').read_text()
TAL = pathlib.Path('tests/fixtures/fungicida-talhoes.txt').read_text()
TRA = pathlib.Path('tests/fixtures/fungicida-tratamento.txt').read_text()
COD = str(pathlib.Path('tests/fixtures/acomp-codigo.txt').resolve())
KML = str(pathlib.Path('tests/fixtures/voos-unificados.kml').resolve())
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
EQUIPE = """() => { const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  d.colaboradores.push({ id: 'p1', nome: 'P1', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'p2', nome: 'P2', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'l1', nome: 'L', funcao: 'Líder de turno', unidadeId: '', ativo: true });
  d.turnos.push({ id: 'tn', nome: 'T', periodo: 'Noturno', horaInicio: '12:00', horaFim: '06:00', liderId: 'l1', ativo: true });
  d.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p2' });
  localStorage.setItem(k, JSON.stringify(d)); }"""
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile).new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ); pg.fill('[data-imp="nome"]', 'FUNGICIDA'); pg.select_option('[data-imp="tipo"]', 'Fungicida'); pg.fill('[data-imp="inicio"]', '2026-10-14'); pg.fill('[data-imp="taxa"]', '15'); pg.wait_for_timeout(200)
        pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(300)
        ir('fazendas'); pg.click('[data-importar-talhoes]'); pg.fill('.modal .imp-texto', TAL); pg.wait_for_timeout(300); pg.click('.modal [data-imp="confirmar"]'); pg.wait_for_timeout(400)
        ir('campanhas'); pg.click('[data-editar="campanha"]'); pg.click('.modal [data-colar-trat]'); pg.fill('.modal [data-colar-txt]', TRA); pg.wait_for_timeout(200); pg.click('.modal [data-colar-usar]'); pg.wait_for_timeout(150); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(300)
        pg.evaluate(EQUIPE); pg.reload(); pg.wait_for_timeout(300)
        # 19/10 pelo código do app
        ir('fechamento'); pg.click('[data-acao="importar-acomp"]'); pg.set_input_files('.modal [data-ac="arq"]', COD); pg.wait_for_selector('.modal [data-acomp-dia]')
        pg.fill('.modal [data-ac-data="2026-10-14"]', '2026-10-19'); pg.dispatch_event('.modal [data-ac-data="2026-10-14"]', 'change'); pg.wait_for_timeout(300)
        pg.click('.modal [data-ac-abrir="2026-10-14"]'); pg.wait_for_timeout(500)
        # KML
        pg.click('[data-acao="importar-kml"]'); pg.set_input_files('.modal [data-kml="arq"]', KML); pg.wait_for_selector('.modal [data-kml-grupo]', timeout=30000)
        t = pg.locator('.modal').inner_text()
        ok(f'[{rot}] KML lido: 84 voos, 2 drones, 200,04 ha, 17 fora da taxa, mapa', all(x in t for x in ['84', '200,04']) and 'Fora da taxa' in t and '17' in t and pg.locator('.modal svg.kml-mapa polyline').count() == 84)
        g = lambda gid: pg.locator(f'.modal [data-kml-grupo="{gid}"]').inner_text()
        ok(f'[{rot}] sugestão: G1 (Ipê) fora de 19/10; G2 = Clementino + José Lopes; G3 = Nunes; G4 = Jacinto I', 'Não é deste dia' in g('G1') and 'Sítio Clementino' in g('G2') and 'Sítio José Lopes' in g('G2') and 'Sítio Nunes' in g('G3') and 'Jacinto I' in g('G4'))
        pg.select_option('.modal [data-kml-serie="B26WN6P0025KDU"]', 'aD'); pg.select_option('.modal [data-kml-serie="B26WN690025DVC"]', 'aA')
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-kml.png'))
        pg.click('.modal [data-kml="aplicar"]'); pg.wait_for_timeout(600)
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] ficha: T70 D 51,05 e T70 A 68,44 (do KML), com aviso da diferença para a ficha', pg.input_value('[data-d="0"][data-k="area"]') == '51,05' and pg.input_value('[data-d="1"][data-k="area"]') == '68,44' and 'ficha 64,75 ha → KML 51,05 ha' in prev)
        ok(f'[{rot}] Jacinto I medida: 19,71 + 12,46', pg.input_value('[data-cel$="|aD"] >> nth=0') == '19,71' and pg.input_value('[data-cel$="|aA"] >> nth=0') == '12,46')
        ok(f'[{rot}] prévia mostra tempo em voo e ha/h em voo', 'em voo (kml)' in prev.lower() and 'ha/h em voo' in prev.lower())
        ok(f'[{rot}] pronto para gravar 8 voos', 'Pronto para gravar: 8 voo(s)' in prev)
        if SHOTS: pg.locator('#fch-previa').screenshot(path=str(SHOTS / f'{rot}-kml-previa.png'))
        pg.click('[data-acao="gravar"]'); pg.wait_for_selector('.modal [data-acomp-dia]'); pg.wait_for_timeout(300)
        # 20/10
        pg.click('.modal [data-ac-abrir="2026-10-20"]'); pg.wait_for_timeout(500)
        pg.click('[data-acao="importar-kml"]'); pg.set_input_files('.modal [data-kml="arq"]', KML); pg.wait_for_selector('.modal [data-kml-grupo]', timeout=30000)
        ok(f'[{rot}] 20/10: drones já reconhecidos pela série; só G1 (Ipê) sugerido', pg.input_value('.modal [data-kml-serie="B26WN6P0025KDU"]') == 'aD' and 'Ipê' in g('G1') and 'Não é deste dia' in g('G4'))
        pg.click('.modal [data-kml="aplicar"]'); pg.wait_for_timeout(600)
        ok(f'[{rot}] 20/10: T70 D 69,27 + T70 A 11,27 = 80,54', pg.input_value('[data-d="0"][data-k="area"]') == '69,27' and pg.input_value('[data-d="1"][data-k="area"]') == '11,27' and 'Pronto para gravar: 2 voo(s)' in pg.locator('#fch-previa').inner_text())
        pg.click('[data-acao="gravar"]'); pg.wait_for_url(re.compile('relatorios/diario')); pg.wait_for_timeout(300)
        d = ds()
        ok(f'[{rot}] 10 voos com dados do KML; séries gravadas nas aeronaves; local de Jacinto e Ipê aprendido', len(d['operacoes']) == 10 and all(o.get('voo', {}).get('origem') == 'kml' and o.get('alturaVooM') for o in d['operacoes']) and {a['id']: a['numeroSerie'] for a in d['aeronaves']} == {'aD': 'B26WN6P0025KDU', 'aA': 'B26WN690025DVC'} and all(isinstance(f.get('lat'), float) for f in d['fazendas'] if f['nome'] in ('Jacinto I', 'Ipê')))
        ir('aplicacoes'); pg.locator('tbody tr').first.click(); pg.wait_for_selector('.modal [data-voo-kml]')
        ok(f'[{rot}] detalhe da operação mostra "Medido no KML de voo"', 'Taxa real' in pg.locator('.modal [data-voo-kml]').inner_text())
        pg.keyboard.press('Escape')
        ok(f'[{rot}] sem rolagem horizontal', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
