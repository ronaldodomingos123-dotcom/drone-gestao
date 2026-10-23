"""v0.9.1: lote de PDFs no estilo da OS real (quadro Zonas; FN·ZN·TN·AREA OS·AREA TN; tratamento ao lado).
Uso: python3 tests/e2e/pdf_lote.py [pasta-capturas] [pdf-real-opcional]
Os PDFs do lote são FICTÍCIOS (tests/fixtures/gerar_pdfs.py ... lote); o PDF real, se informado, entra junto."""
import sys, pathlib, re, json, time, shutil
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
import os
LOTE = pathlib.Path(os.environ.get('LOTE', 'tests/fixtures/lote'))
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] != '-' else None
REAL = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
esperado = json.loads((LOTE / 'esperado.json').read_text())
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        rede = []; pg.on('request', lambda r: rede.append(r.url) if not r.url.startswith(('file:', 'blob:', 'data:')) and 'fonts.g' not in r.url else None)
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(250)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.click('[data-novo="unidade"]'); pg.fill('.modal [name="nome"]', 'Unidade T'); pg.fill('.modal [name="codigo"]', 'UT'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(150)
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.click('[data-imp="aba-pdf"]')
        arqs = [str(LOTE / e['arquivo']) for e in esperado]
        if REAL: arqs += [str(REAL), str(REAL)]  # o real e uma cópia repetida
        t0 = time.time()
        pg.set_input_files('[data-imp="arquivos"]', arqs)
        pg.wait_for_function(f"document.querySelectorAll('.pdf-item').length === {len(arqs)} && !document.querySelector('.pdf-item .selo-info')", timeout=300000)
        dt = time.time() - t0
        print(f'[{rot}] {len(arqs)} PDFs lidos em {dt:.1f}s')
        resumo = pg.locator('.pdf-resumo').inner_text()
        ok(f'[{rot}] {len(arqs)} PDFs lidos, nenhum com erro', f'{len(arqs)} arquivo' in resumo and 'com erro' not in resumo)
        conf = pg.locator('.pdf-item .selo-ok', has_text='confere').count()
        ok(f'[{rot}] total do PDF confere com a soma dos talhões em todos', conf == len(arqs))
        n_trat = sum(1 for i in range(len(arqs)) if '6 produto' in pg.locator('.pdf-item').nth(i).inner_text())
        ok(f'[{rot}] tratamento (6 produtos) lido em todos', n_trat == len(arqs))
        pg.fill('[data-imp="nome"]', 'Fungicida Lote'); pg.select_option('[data-imp="tipo"]', 'Fungicida'); pg.wait_for_timeout(300)
        n_os = sum(len(e['zonas']) for e in esperado) + (1 if REAL else 0)
        prev = pg.locator('.imp-previa').inner_text()
        ok(f'[{rot}] prévia: {n_os} OS (OS com 2 FN viram 2) e o PDF repetido é ignorado', f'Importar {n_os} OS' in pg.locator('[data-imp="confirmar"]').inner_text() and (not REAL or 'ignorado' in prev))
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-pdf-lote.png'))
        pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(300)
        d = ds()
        fz = {f['id']: f for f in d['fazendas']}; tl = {t['id']: t for t in d['talhoes']}
        certos = 0
        for e in esperado:
            osn = re.search(r'OS (\d+)', e['arquivo']).group(1)
            for z in e['zonas']:
                cod = z['cod'].lstrip('0')
                o = [o for o in d['ordens'] if o['numero'] == osn and fz[o['fazendaId']]['codigo'] == cod]
                if len(o) != 1: continue
                o = o[0]
                prog = sorted((int(tl[i['talhaoId']]['codigo']), round(i['areaPlanejadaHa'], 2), round(tl[i['talhaoId']]['areaHa'], 2)) for i in o['itens'])
                if prog == sorted((t, round(a, 2), round(at, 2)) for t, a, at in z['talhoes']): certos += 1
        n_lote = sum(len(e['zonas']) for e in esperado)
        ok(f'[{rot}] {n_lote}/{n_lote} OS do lote com talhões, AREA OS e AREA TN exatos', certos == n_lote)
        if REAL:
            o = [o for o in d['ordens'] if o['numero'] == '3416']
            ok(f'[{rot}] PDF real: OS 3416 · FN 90 Fazenda Jacinto I · 4 talhões · 32,70 ha · 6 produtos', len(o) == 1 and fz[o[0]['fazendaId']]['codigo'] == '90' and 'Jacinto I' in fz[o[0]['fazendaId']]['nome'] and len(o[0]['itens']) == 4 and round(sum(i['areaPlanejadaHa'] for i in o[0]['itens']), 2) == 32.7 and len(o[0]['calda']['produtos']) == 6)
        ok(f'[{rot}] produtos criados uma vez só (6) com código', len(d['produtos']) == 6 and all(p.get('codigo') for p in d['produtos']))
        ok(f'[{rot}] leitura 100% local (nenhum acesso à rede)', not rede)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
