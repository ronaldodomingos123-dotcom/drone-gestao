"""Mapa de talhões (KML geral real) + KML de voo real: cruzamento por talhão editável no Fechamento do dia.
Uso: python3 tests/e2e/cruzamento.py <mapa.kml> [pasta de capturas]"""
import sys, pathlib, re, time
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
MAPA = sys.argv[1]
SHOTS = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
SEQ = pathlib.Path('tests/fixtures/fungicida-sequencia.txt').read_text()
TAL = pathlib.Path('tests/fixtures/fungicida-talhoes.txt').read_text()
TRA = pathlib.Path('tests/fixtures/fungicida-tratamento.txt').read_text()
COD = str(pathlib.Path('tests/fixtures/acomp-codigo.txt').resolve())
KML = str(pathlib.Path('tests/fixtures/voos-unificados.kml').resolve())
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
EQUIPE = """() => { const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  d.colaboradores.push({ id: 'p1', nome: 'P1', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'p2', nome: 'P2', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'l1', nome: 'L', funcao: 'Líder de turno', unidadeId: '', ativo: true });
  d.turnos.push({ id: 'tn', nome: 'T', periodo: 'Noturno', horaInicio: '12:00', horaFim: '06:00', liderId: 'l1', ativo: true });
  d.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: 'B26WN6P0025KDU', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: 'B26WN690025DVC', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p2' });
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
        # mapa geral
        ir('fazendas'); pg.click('[data-importar-mapa]'); t0 = time.time(); pg.set_input_files('.modal [data-mp="arq"]', MAPA); pg.wait_for_selector('.modal [data-mp="criar"]', timeout=120000)
        tl = time.time() - t0
        t = pg.locator('.modal').inner_text()
        ok(f'[{rot}] mapa lido ({tl:.1f} s): 4246 talhões, 5 fazendas do protótipo encontradas', '4246' in t and '5' in pg.locator('.modal .chips-info').inner_text())
        pg.click('.modal [data-mp="ok"]'); pg.wait_for_timeout(800)
        d = ds(); comPol = [x for x in d['talhoes'] if x.get('poligono')]
        tam = pg.evaluate("localStorage.getItem('dap-proto-v1:dataset').length")
        ok(f'[{rot}] contornos guardados só das 5 fazendas: {len(comPol)} talhões; base {tam/1e6:.2f} MB', len(comPol) == 140 and tam < 4e6)
        # 19/10
        ir('fechamento'); pg.click('[data-acao="importar-acomp"]'); pg.set_input_files('.modal [data-ac="arq"]', COD); pg.wait_for_selector('.modal [data-acomp-dia]')
        pg.fill('.modal [data-ac-data="2026-10-14"]', '2026-10-19'); pg.dispatch_event('.modal [data-ac-data="2026-10-14"]', 'change'); pg.wait_for_timeout(300)
        pg.click('.modal [data-ac-abrir="2026-10-14"]'); pg.wait_for_timeout(500)
        pg.click('[data-acao="importar-kml"]'); pg.set_input_files('.modal [data-kml="arq"]', KML); pg.wait_for_selector('.modal [data-kml-grupo]', timeout=30000)
        t0 = time.time(); pg.click('.modal [data-kml="aplicar"]'); pg.wait_for_selector('.modal [data-cz="aplicar"]', timeout=60000); tc = time.time() - t0
        cz = pg.locator('.modal').inner_text()
        ok(f'[{rot}] cruzamento abre sozinho após o KML ({tc:.1f} s) com as 4 fazendas', cz.count('OS 3416') >= 1 and all(x in cz for x in ['Sítio Clementino', 'Sítio José Lopes', 'Sítio Nunes', 'Jacinto I']))
        ok(f'[{rot}] mapa de cobertura desenhado (1 por fazenda)', pg.locator('.modal canvas.cz-mapa').count() == 4 and pg.evaluate("(() => { const c = document.querySelector('.modal canvas.cz-mapa'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()") > 1000)
        ok(f'[{rot}] Clementino: só o T70 A; José Lopes: só o T70 D', 'T70 D' not in pg.locator('.modal h3:has-text("Clementino") + figure + div').inner_text() and 'T70 A' not in pg.locator('.modal h3:has-text("José Lopes") + figure + div').inner_text())
        if SHOTS: pg.wait_for_timeout(700); pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-cruzamento.png'))
        k20 = pg.locator('.modal h3:has-text("Jacinto") + figure + div tr:has(td b:text-is("020")) [data-cz-v]'); medido20 = k20.input_value()
        k20.fill('11,50'); k20.dispatch_event('change'); pg.wait_for_timeout(300)
        ok(f'[{rot}] edição do talhão 020 ({medido20} → 11,50) marcada como editada', pg.locator('.modal .cz-editado').count() == 1 and 'editado' in pg.locator('.modal').inner_text())
        pg.click('.modal [data-cz="aplicar"]'); pg.wait_for_timeout(800)
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] prévia: pronto, com aviso do cruzamento (falha/repasse) e real alterado', 'Pronto para gravar' in prev and 'Cruzamento' in prev and 'repasse' in prev)
        pg.click('[data-acao="gravar"]'); pg.wait_for_selector('.modal [data-acomp-dia]'); pg.wait_for_timeout(300)
        # 20/10: Ipê, talhão 78 adicionado
        pg.click('.modal [data-ac-abrir="2026-10-20"]'); pg.wait_for_timeout(500)
        pg.click('[data-acao="importar-kml"]'); pg.set_input_files('.modal [data-kml="arq"]', KML); pg.wait_for_selector('.modal [data-kml-grupo]', timeout=30000)
        pg.click('.modal [data-kml="aplicar"]'); pg.wait_for_selector('.modal [data-cz="aplicar"]', timeout=60000)
        if SHOTS: pg.wait_for_timeout(700); pg.locator('.modal figure.cz-fig').first.screenshot(path=str(SHOTS / f'{rot}-cruzamento-ipe.png'))
        sel78 = pg.locator('.modal tr:has(td b:text-is("078")) select[data-cz-fora]')
        ok(f'[{rot}] Ipê: talhão 078 aparece fora da OS (≈15 ha)', sel78.count() == 1)
        opt = [o for o in sel78.locator('option').all() if (o.get_attribute('value') or '').startswith('add:')][0].get_attribute('value')
        sel78.select_option(opt); pg.wait_for_timeout(200)
        pg.click('.modal [data-cz="aplicar"]'); pg.wait_for_timeout(800)
        ok(f'[{rot}] prévia avisa que o 078 será adicionado à OS', 'adicionado à OS' in pg.locator('#fch-previa').inner_text() and 'Pronto para gravar' in pg.locator('#fch-previa').inner_text())
        pg.click('[data-acao="gravar"]'); pg.wait_for_url(re.compile('relatorios/diario')); pg.wait_for_timeout(300)
        d = ds()
        ipe = [o for o in d['ordens'] if o['numero'] == '3413'][0]
        t78 = [x for x in d['talhoes'] if x['codigo'].lstrip('0') == '78' and x['fazendaId'] == ipe['fazendaId']][0]
        ok(f'[{rot}] OS 3413 ganhou o talhão 078 e o aplicado foi gravado nele', any(i['talhaoId'] == t78['id'] for i in ipe['itens']) and sum(i['areaHa'] for o in d['operacoes'] for i in o['itens'] if i['talhaoId'] == t78['id']) > 14)
        # modo "manter o real da ficha"
        ir('fechamento'); pg.click('[data-acao="importar-acomp"]'); pg.wait_for_selector('.modal [data-acomp-dia]'); pg.click('.modal [data-ac-abrir="2026-10-14"]'); pg.wait_for_timeout(500)
        pg.click('[data-acao="importar-kml"]'); pg.set_input_files('.modal [data-kml="arq"]', KML); pg.wait_for_selector('.modal [data-kml-grupo]', timeout=30000)
        pg.click('.modal [data-kml="aplicar"]'); pg.wait_for_selector('.modal [data-cz="aplicar"]', timeout=60000)
        pg.check('.modal input[name="cz-modo"][value="ficha"]'); pg.wait_for_timeout(200)
        ok(f'[{rot}] "Manter o real da ficha" trava a edição', pg.locator('.modal [data-cz-v]').first.is_disabled())
        pg.click('.modal [data-cz="aplicar"]'); pg.wait_for_timeout(600)
        ok(f'[{rot}] modo ficha: real da Jacinto I continua 32,17 e o cruzamento vira conferência', pg.input_value('[data-z="0"][data-k="real"]') == '32,17' and 'Cruzamento 90 · Jacinto I: medido' in pg.locator('#fch-previa').inner_text())
        ok(f'[{rot}] sem rolagem horizontal', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
