"""Estação meteorológica: importa os relatórios REAIS (diário e horário) pela tela, liga fazenda, e confere o clima
no detalhe da operação, no Diário, no relatório técnico/clima e a preservação do vínculo ao editar a fazenda.
Uso: python3 tests/e2e/estacao.py <xlsx diário> <xlsx horário> [pasta de capturas]"""
import sys, pathlib, re, subprocess, tempfile
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
DIARIO, HORARIO = sys.argv[1], sys.argv[2]
SHOTS = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else None
TMP = pathlib.Path(tempfile.mkdtemp())
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('estacoes')
        ok(f'[{rot}] tela vazia orienta a importar', 'nenhuma estação importada' in pg.locator('main').inner_text().lower())
        # 1. relatório diário
        pg.set_input_files('[data-est="arquivo"]', DIARIO); pg.wait_for_selector('[data-est-ok]', timeout=30000)
        txt = pg.locator('.modal').inner_text()
        ok(f'[{rot}] prévia do diário: 30 estações, 240 registros, tipo diário, período 15/10 a 22/10', all(x in txt for x in ['30', '240', 'diário', '15/10/2026', '22/10/2026']))
        ok(f'[{rot}] prévia sinaliza pressão implausível (PIC 20)', '628' in txt)
        pg.click('[data-est-ok]'); pg.wait_for_timeout(400)
        d = ds(); ok(f'[{rot}] diário importado', len(d['estacoes']) == 30 and len(d['registrosEstacao']) == 240)
        # 2. relatório horário (mesmo período, outro tipo: soma, não substitui)
        pg.set_input_files('[data-est="arquivo"]', HORARIO); pg.wait_for_selector('[data-est-ok]', timeout=30000)
        txt = pg.locator('.modal').inner_text()
        ok(f'[{rot}] prévia do horário: 5370 registros, tipo horário', '5370' in txt.replace('.', '') and 'horário' in txt)
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-estacao-previa.png'))
        pg.click('[data-est-ok]'); pg.wait_for_timeout(600)
        d = ds(); ok(f'[{rot}] horário importado junto do diário', len(d['estacoes']) == 30 and len(d['registrosEstacao']) == 240 + 5370)
        pg.set_input_files('[data-est="arquivo"]', HORARIO); pg.wait_for_selector('[data-est-ok]', timeout=30000); pg.click('[data-est-ok]'); pg.wait_for_timeout(600)
        ok(f'[{rot}] reimportar o horário não duplica', len(ds()['registrosEstacao']) == 240 + 5370)
        # 3. ligar a fazenda de uma operação do período à PIC 03 (tem anemômetro)
        op = pg.evaluate("""(() => { const d = JSON.parse(localStorage.getItem('dap-proto-v1:dataset'));
          const ops = d.operacoes.filter(o => o.data >= '2026-10-15' && o.data <= '2026-10-21' && o.horaFim && o.horaInicio < o.horaFim && o.status !== 'impedida_clima').sort((a,b)=>(b.data+b.horaInicio).localeCompare(a.data+a.horaInicio));
          const o = ops[0]; if (!o) return null; const os = d.ordens.find(x => x.id === o.osId); return { id: o.id, data: o.data, ini: o.horaInicio, fim: o.horaFim, faz: os.fazendaId, os: os.numero, nfaz: d.fazendas.find(f => f.id === os.fazendaId).nome }; })()""")
        if not ok(f'[{rot}] base de demonstração tem operação no período do arquivo', op is not None): b.close(); return erros
        est3 = [e for e in ds()['estacoes'] if e['pic'] == '3'][0]
        ir('estacoes'); pg.select_option(f'[data-est="faz"][data-id="{op["faz"]}"]', est3['id']); pg.wait_for_timeout(300)
        ok(f'[{rot}] vínculo fazenda → estação gravado', [f for f in ds()['fazendas'] if f['id'] == op['faz']][0].get('estacaoId') == est3['id'])
        ok(f'[{rot}] contador "Fazendas ligadas" atualiza na hora', pg.locator('[data-est-ligadas]').inner_text().startswith('1/'))
        pg.select_option('[data-est="sel"]', est3['id']); pg.wait_for_timeout(300)
        ok(f'[{rot}] chuva de 15/10 (PIC 03) = 16 mm no gráfico, sem somar diário + horário', '32' not in pg.locator('#g-est-chuva').inner_text() and '16' in pg.locator('#g-est-chuva').inner_text())
        ok(f'[{rot}] auditoria registra o vínculo', any('Estação de' in a['resumo'] for a in ds()['auditoria']))
        ir('estacoes'); tab = pg.locator('#est-ops').inner_text()
        ok(f'[{rot}] "Aplicações × estação" lista a operação como voo (horário)', 'PIC 3' in tab and 'voo' in tab.lower()) or print(tab[:600])
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-estacoes.png'), full_page=True)
        # 4. detalhe da operação
        regs = [r for r in ds()['registrosEstacao'] if r['estacaoId'] == est3['id'] and not r['diario'] and r['fim'] > f"{op['data']}T{op['ini']}" and r['inicio'] < f"{op['data']}T{op['fim']}"]
        raj = max(r['rajada'] for r in regs if r['rajada'] is not None)
        pg.evaluate(f"""(async () => {{ location.hash = '#/aplicacoes'; }})()"""); pg.wait_for_timeout(400)
        busca = pg.locator('input[type="search"]').first; busca.fill(op['nfaz']); pg.wait_for_timeout(300)
        dd = '/'.join(reversed(op['data'].split('-')))
        linha = pg.locator('tbody tr', has_text=dd).filter(has_text=f"{op['ini']}–{op['fim']}").first
        linha.click(); pg.wait_for_selector('[data-estacao-op]', timeout=5000)
        bloco = pg.locator('.modal').inner_text()
        ok(f'[{rot}] detalhe: "Durante o voo ({len(regs)} h)" com rajada máx. {raj} das horas do voo', f'Durante o voo ({len(regs)} h)' in bloco and f"{raj:.1f}".replace('.', ',') in pg.locator('[data-estacao-op]').inner_text())
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-estacao-operacao.png'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # 5. Diário do dia
        pg.evaluate(f"localStorage.setItem('dap-proto-v1:diario', JSON.stringify({{dia: '{op['data']}', filtro: {{}}}}))")
        ir('relatorios/diario'); pg.wait_for_timeout(300)
        ok(f'[{rot}] Diário mostra o cartão da estação com PIC 3', pg.locator('[data-dia-estacao]').count() == 1 and 'PIC 3' in pg.locator('[data-dia-estacao]').inner_text())
        # 6. relatório técnico + PDF
        pg.goto(URL + '#/relatorios/ver?id=tecnico'); pg.wait_for_selector('.rel-doc')
        if pg.locator(f'[data-k="op"] option[value="{op["id"]}"]').count():
            pg.select_option('[data-k="op"]', op['id']); pg.wait_for_timeout(300)
            doc = pg.locator('.rel-doc').inner_text()
            ok(f'[{rot}] técnico: seção "Estação meteorológica — durante o voo" com a fonte e a nota de ΔT', 'Estação meteorológica — durante o voo' in doc and 'Stull' in doc)
            if not mobile:
                with pg.expect_download(timeout=60000) as dl: pg.click('[data-exp="pdf"]')
                c = TMP / 'tec.pdf'; dl.value.save_as(str(c))
                t = subprocess.run(['pdftotext', '-layout', str(c), '-'], capture_output=True, text=True).stdout
                ok(f'[{rot}] PDF técnico inclui a estação (ΔT sem caractere quebrado)', 'Estação meteorológica' in t and 'T estimado' in t)
        else: ok(f'[{rot}] operação aparece na lista do técnico (período padrão)', False)
        # 7. relatório de clima
        pg.goto(URL + '#/relatorios/ver?id=clima'); pg.wait_for_selector('.rel-doc')
        ok(f'[{rot}] relatório de clima ganha a seção da estação e o indicador de alertas', 'Estação meteorológica' in pg.locator('.rel-doc').inner_text() and 'alerta da estação' in pg.locator('.rel-kpis').inner_text().lower())
        # 8. editar a fazenda não perde o vínculo
        ir('fazendas'); pg.locator('#fz-tab input[type="search"]').first.fill(op['nfaz']); pg.wait_for_timeout(300)
        pg.locator('#fz-tab tbody tr', has_text=op['nfaz']).first.click(); pg.wait_for_timeout(300)
        pg.click(f'.modal [data-editar="fazenda"][data-id="{op["faz"]}"]'); pg.wait_for_timeout(300)
        if pg.locator('.modal [name="estacaoId"]').count():
            ok(f'[{rot}] formulário da fazenda mostra a estação selecionada', pg.locator('.modal [name="estacaoId"]').input_value() == est3['id'])
            pg.click('.modal [data-salvar]'); pg.wait_for_timeout(300)
            ok(f'[{rot}] salvar a fazenda mantém a estação', [f for f in ds()['fazendas'] if f['id'] == op['faz']][0].get('estacaoId') == est3['id'])
        else: ok(f'[{rot}] botão de editar fazenda encontrado', False)
        ir('estacoes')
        ok(f'[{rot}] sem rolagem horizontal da página', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1366, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'celular', True)
for s, n in res: print(s, n)
print(f"\n{sum(1 for s, _ in res if s == 'PASSOU')}/{len(res)} passaram")
