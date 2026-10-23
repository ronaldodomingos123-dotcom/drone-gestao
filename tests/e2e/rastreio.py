"""Fase 3.3: rastreabilidade de OS e talhão (linha do tempo campo + alterações) e exportação."""
import sys, pathlib, re, subprocess
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
TMP = pathlib.Path('/tmp/claude-0/-home-claude/2892429b-2f99-5af8-bd4a-dce4628ac0a3/scratchpad/exports'); TMP.mkdir(parents=True, exist_ok=True)
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor')
        # gera uma alteração auditada (correção de operação) para aparecer na linha do tempo
        pg.goto(URL + '#/aplicacoes'); pg.wait_for_selector('tr.clicavel'); pg.locator('tr.clicavel').first.click(); pg.click('[data-op-corrigir]')
        pg.fill('.modal [name="motivo"]', 'Ajuste de área conferido no mapa'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(250)
        d = ds(); au = [a for a in d['auditoria'] if a['acao'] == 'corrigir'][0]
        op = [o for o in d['operacoes'] if o['id'] == au['entidadeId']][0]
        # pelo detalhe da OS → Rastrear
        pg.goto(URL + '#/ordens'); pg.wait_for_selector('#os-tab, table')
        os_ = [o for o in d['ordens'] if o['id'] == op['osId']][0]
        pg.goto(URL + f'#/auditoria?os={os_["id"]}'); pg.wait_for_selector('.rs-linha')
        t = pg.locator('#rs-corpo').inner_text()
        ok(f'[{rot}] linha do tempo da OS com voos, paradas e a correção (com motivo)', 'Voo' in t and 'Parada' in t and 'Ajuste de área conferido no mapa' in t and f'OS {os_["numero"]}' in t)
        acc = [float(x.replace('.', '').replace(',', '.')) for x in re.findall(r'acumulado ([\d.]+,\d+) ha', t)]
        ok(f'[{rot}] acumulado cresce e fecha com o aplicado do topo', acc == sorted(acc) and len(acc) > 1 and f'{acc[-1]:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.') in pg.locator('.chips-info').inner_text())
        pg.select_option('[data-r="tipo"]', 'talhao'); pg.wait_for_timeout(150)
        ok(f'[{rot}] rastrear talhão mostra só o que tocou nele', 'Talhão' in pg.locator('.rs-tit').inner_text() and pg.locator('.rs-ev').count() >= 0)
        pg.select_option('[data-r="tipo"]', 'os'); pg.select_option('[data-r="id"]', os_['id']); pg.wait_for_timeout(150)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-rastreio.png'), full_page=True)
        with pg.expect_download(timeout=60000) as dl: pg.click('[data-exp="pdf"]')
        f = TMP / f'{rot}-rastreio.pdf'; dl.value.save_as(str(f))
        tx = subprocess.run(['pdftotext', '-layout', str(f), '-'], capture_output=True, text=True).stdout
        ok(f'[{rot}] PDF de rastreabilidade com a correção e o acumulado', 'Rastreabilidade' in tx and 'Ajuste de' in tx and 'Acumulado' in tx)
        pg.click('.au-abas a >> text=Alterações'); pg.wait_for_selector('#au-tab')
        ok(f'[{rot}] aba Alterações continua listando o histórico', pg.locator('#au-tab tbody tr').count() >= 1)
        # link Rastrear no detalhe da OS fecha o modal
        pg.goto(URL + '#/ordens'); pg.wait_for_timeout(300); pg.locator('tr.clicavel').first.click(); pg.wait_for_selector('.modal a[href*="auditoria?os="]')
        pg.click('.modal a[href*="auditoria?os="]'); pg.wait_for_selector('.rs-linha')
        ok(f'[{rot}] botão Rastrear do detalhe da OS abre a linha do tempo e fecha o modal', pg.locator('.modal-fundo').count() == 0)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
