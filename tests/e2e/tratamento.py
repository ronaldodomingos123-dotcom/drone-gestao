"""v0.8 ponta a ponta: tratamento como conjunto de produtos (colar a tabela da OS) e sequência livre
(posição digitada, arrastar com mouse e com toque, reimportar mantendo a ordem ajustada)."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

SEQ = "Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda A\t3410\t64,45\tFungicida\n2\tFazenda B\t3411\t50\tFungicida\n3\tFazenda C\t3412\t40\tFungicida\n4\tFazenda D\t3413\t30\tFungicida\n"
TRAT = """TRATAMENTO 1 - 64,4500 HA\tDOSE\tTOTAL
AUREO\t0,0200 L/ha\t1,2890 L
CARAVAN KOPPERT\t0,5000 L/ha\t32,2250 L
DNA GRID\t0,5000 L/ha\t32,2250 L
PRIORI TOP SYNGENTA\t0,6000 L/ha\t38,6700 L
RE-LEAF\t1,0000 L/ha\t64,4500 L
SPRAYD FLEX DIRECT\t0,0200 L/ha\t1,2890 L
CODIGO\tRESUMO DE INSUMOS\tTOTAL
21162\tAUREO\t1,2890 L
36423\tCARAVAN KOPPERT\t32,2250 L
17609\tDNA GRID\t32,2250 L
34067\tPRIORI TOP SYNGENTA\t38,6700 L
19140\tRE-LEAF\t64,4500 L
21013\tSPRAYD FLEX DIRECT\t1,2890 L
ÁREA TOTAL\t64,45 ha"""

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(200)
        def ordem():
            d = ds(); return [o['numero'] for o in sorted(d['ordens'], key=lambda o: o['sequencia'])]

        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.click('[data-novo="unidade"]'); pg.fill('.modal [name="nome"]', 'Unidade T'); pg.fill('.modal [name="codigo"]', 'UT'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(150)
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ)
        pg.fill('[data-imp="nome"]', 'Fungicida Teste'); pg.select_option('[data-imp="tipo"]', 'Fungicida'); pg.wait_for_timeout(150)
        ok(f'[{rot}] opção de ordem oculta para campanha nova', not pg.locator('.imp-ordem').is_visible())
        pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(200)
        ok(f'[{rot}] 4 OS importadas na ordem da tabela', ordem() == ['3410', '3411', '3412', '3413'])

        # --- Tratamento: colar a tabela da OS na campanha
        ir('campanhas'); pg.click('[data-editar="campanha"]')
        pg.fill('.modal [data-extra="volume"]', '10')
        pg.click('.modal [data-colar-trat]'); pg.fill('.modal [data-colar-txt]', TRAT); pg.wait_for_timeout(150)
        prev = pg.locator('.modal [data-colar-prev]').inner_text()
        ok(f'[{rot}] prévia lê 6 produtos com códigos', pg.locator('.modal [data-colar-prev] tbody tr').count() == 6 and '21162' in prev and '34067' in prev)
        ok(f'[{rot}] prévia confere dose × área (6 confere)', pg.locator('.modal [data-colar-prev] .selo-ok').count() == 6)
        ok(f'[{rot}] prévia avisa que os produtos serão criados', prev.count('será criado') == 6)
        pg.click('.modal [data-colar-usar]'); pg.wait_for_timeout(100)
        ok(f'[{rot}] 6 linhas no tratamento', pg.locator('.modal .calda-lista .calda-linha').count() == 6)
        ok(f'[{rot}] nome do tratamento preenchido', pg.input_value('.modal [data-extra="tratamento"]') == 'Tratamento 1')
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-tratamento-editor.png'))
        pg.click('.modal [data-salvar]'); pg.wait_for_timeout(200)
        d = ds(); cp = d['campanhas'][0]
        nomes = {p['nome']: p for p in d['produtos']}
        ok(f'[{rot}] produtos criados com código e classe Fungicida', len(d['produtos']) == 6 and nomes['AUREO'].get('codigo') == '21162' and nomes['PRIORI TOP SYNGENTA']['classe'] == 'Fungicida')
        ok(f'[{rot}] calda da campanha = Tratamento 1 com doses exatas', cp['calda']['tratamento'] == 'Tratamento 1' and [x['dosePlanejada'] for x in cp['calda']['produtos']] == [0.02, 0.5, 0.5, 0.6, 1, 0.02])
        ok(f'[{rot}] OS abertas receberam o tratamento', all(o['calda'].get('tratamento') == 'Tratamento 1' and len(o['calda']['produtos']) == 6 for o in d['ordens']))
        ok(f'[{rot}] criação dos produtos auditada', sum(1 for a in d['auditoria'] if a['entidade'] == 'produto' and a['acao'] == 'criar') == 6)
        ok(f'[{rot}] lista de campanhas mostra o tratamento', 'Tratamento 1' in pg.locator('#cp-tab').inner_text())
        # resumo de insumos na OS 3410 (64,45 ha) bate com a tabela da OS
        ir('ordens'); os1 = [o for o in d['ordens'] if o['numero'] == '3410'][0]
        pg.locator(f'[data-editar="ordem"][data-id="{os1["id"]}"]').first.click(); pg.wait_for_selector('.modal [data-calda-resumo] table')
        rs = pg.locator('.modal [data-calda-resumo]').inner_text()
        ok(f'[{rot}] resumo de insumos da OS: totais iguais aos da OS', all(x in rs for x in ['1,2890 L', '32,2250 L', '38,6700 L', '64,4500 L', '64,45 ha']))
        # produto novo digitado na própria linha
        pg.click('.modal [data-add-calda]'); pg.locator('.modal .calda-linha').last.locator('[data-extra="produtoId"]').select_option('__criar')
        ok(f'[{rot}] cadastro rápido de produto aparece', pg.locator('.modal [data-novo-box]').is_visible())
        pg.fill('.modal [data-novo-nome]', 'ADJUVANTE TESTE'); pg.fill('.modal [data-novo-cod]', '99999'); pg.click('.modal [data-novo-ok]')
        pg.locator('.modal .calda-linha').last.locator('[data-extra="dose"]').fill('0,1'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(200)
        d = ds(); os1 = [o for o in d['ordens'] if o['numero'] == '3410'][0]
        ok(f'[{rot}] produto criado pela linha e usado só nesta OS', any(p['nome'] == 'ADJUVANTE TESTE' and p.get('codigo') == '99999' for p in d['produtos']) and len(os1['calda']['produtos']) == 7)
        # duplicidade bloqueada
        ir('campanhas'); pg.click('[data-editar="campanha"]'); pg.click('.modal [data-add-calda]')
        pg.locator('.modal .calda-linha').last.locator('[data-extra="produtoId"]').select_option(label='AUREO · 21162')
        pg.locator('.modal .calda-linha').last.locator('[data-extra="dose"]').fill('1'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(100)
        ok(f'[{rot}] produto repetido no tratamento é bloqueado', 'duas vezes' in pg.locator('.modal .form-msgs').inner_text()); pg.keyboard.press('Escape')

        # --- Talhões da OS: zona, talhão, há, ñ aplicado, real (substitui o GERAL)
        ir('ordens'); os1 = [o for o in ds()['ordens'] if o['numero'] == '3410'][0]
        pg.locator(f'[data-editar="ordem"][data-id="{os1["id"]}"]').first.click(); pg.wait_for_selector('.modal [data-tal-corpo]')
        ok(f'[{rot}] OS mostra tabela de talhões com o GERAL marcado', pg.locator('.modal [data-tal-linha]').count() == 1 and '64,45' in pg.locator('.modal [data-tal-treal]').inner_text())
        pg.click('.modal [data-tal-colar]')
        pg.fill('.modal [data-tal-txt]', 'Fazenda\tZONA\tTn\thá\tñ aplicado\treal\nFazenda A\t90\t19\t7,36\t\t7,36\nFazenda A\t90\t20\t12,33\t0,53\t11,80\nFazenda A\t90\t21\t7,71\t\t7,71\nFazenda A\t90\t22\t5,3\t\t5,30\nFazenda Z\t10\t01\t3\t\t3\n\t\t\t\t\t0,00'); pg.wait_for_timeout(150)
        pv = pg.locator('.modal [data-tal-prev]').inner_text()
        ok(f'[{rot}] prévia: 4 talhões da fazenda, real 32,17; outra fazenda ignorada', '4 talhão' in pv and '32,17' in pv and 'outra fazenda' in pv)
        pg.click('.modal [data-tal-usar]'); pg.wait_for_timeout(100)
        ok(f'[{rot}] tabela: 4 talhões marcados + GERAL desmarcado', pg.locator('.modal [data-tal-linha]').count() == 5 and pg.locator('.modal [data-tal-linha] [data-c="usar"]:checked').count() == 4)
        ok(f'[{rot}] totais: 4 talhões · 32,70 há · 0,53 ñ aplicado · 32,17 real', '4 talhão' in pg.locator('.modal [data-tal-qtd]').inner_text() and pg.locator('.modal [data-tal-tarea]').inner_text() == '32,70' and pg.locator('.modal [data-tal-tnao]').inner_text() == '0,53' and pg.locator('.modal [data-tal-treal]').inner_text() == '32,17')
        ok(f'[{rot}] resumo de insumos usa a área programada (bruta) 32,70', '32,70 ha' in pg.locator('.modal [data-calda-resumo]').inner_text())
        # edição manual: mais um talhão digitado
        pg.click('.modal [data-tal-add]'); ult = pg.locator('.modal [data-tal-linha]').last
        ult.locator('[data-c="zona"]').fill('90'); ult.locator('[data-c="codigo"]').fill('23'); ult.locator('[data-c="area"]').fill('4,00'); ult.locator('[data-c="nao"]').fill('0,25'); pg.wait_for_timeout(50)
        ok(f'[{rot}] linha digitada calcula real 3,75 e total 35,92', ult.locator('[data-c="real"]').inner_text() == '3,75' and pg.locator('.modal [data-tal-treal]').inner_text() == '35,92')
        if SHOTS: pg.locator('.modal [data-talhoes]').screenshot(path=str(SHOTS / f'{rot}-talhoes-os.png'))
        pg.click('.modal [data-salvar]'); pg.wait_for_timeout(250)
        d = ds(); os1 = [o for o in d['ordens'] if o['numero'] == '3410'][0]
        fa = os1['fazendaId']; tal = {t['id']: t for t in d['talhoes']}
        ok(f'[{rot}] OS gravada com 5 talhões, programado bruto 36,70', len(os1['itens']) == 5 and round(sum(i['areaPlanejadaHa'] for i in os1['itens']), 2) == 36.7)
        t20 = [i for i in os1['itens'] if tal[i['talhaoId']]['codigo'] == '020'][0]
        ok(f'[{rot}] talhão 020: zona 90, programado 12,33, desconto previsto 0,53', tal[t20['talhaoId']]['zona'] == '90' and tal[t20['talhaoId']]['areaHa'] == 12.33 and t20['naoAplicadoHa'] == 0.53 and t20['areaPlanejadaHa'] == 12.33)
        ok(f'[{rot}] talhão GERAL removido da fazenda', not any(t.get('geral') for t in d['talhoes'] if t['fazendaId'] == fa))
        ir('ordens'); pg.locator(f'tr:has-text("3410")').first.click(); pg.wait_for_timeout(200)
        det = pg.locator('.modal').inner_text()
        ok(f'[{rot}] detalhe da OS lista zona, programado e desconto previsto', 'desc. previsto' in det.lower() and '12,33' in det and '36,70' in det and '5 talhão' in det)
        pg.keyboard.press('Escape')

        # --- Sequência livre
        ir('relatorios/sequencia'); pg.wait_for_selector('#seq-tab')
        o4 = [o for o in ds()['ordens'] if o['numero'] == '3413'][0]
        campo = pg.locator(f'[data-pos="{o4["id"]}"]'); campo.fill('1'); campo.press('Enter'); pg.wait_for_timeout(250)
        ok(f'[{rot}] posição digitada: 3413 vai para 1º', ordem() == ['3413', '3410', '3411', '3412'])
        au = [a for a in ds()['auditoria'] if a['acao'] == 'reordenar']
        ok(f'[{rot}] reordenação auditada com de → para', au and 'posição 4 → 1' in au[-1]['resumo'])
        # arrastar com mouse: 3410 (2ª) para baixo de 3412 (4ª)
        def centro(sel):
            bb = pg.locator(sel).bounding_box(); return bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        def linha(num):
            return f'#seq-tab tr[data-os="{[o for o in ds()["ordens"] if o["numero"] == num][0]["id"]}"]'
        pg.locator(linha('3411')).scroll_into_view_if_needed()
        ax, ay = centro(linha('3410') + ' [data-arrastar]')
        print(rot, 'alça', ax, ay, 'alvo', pg.locator(linha('3412')).bounding_box()); bb = pg.locator(linha('3412')).bounding_box()
        pg.mouse.move(ax, ay); pg.mouse.down(); pg.mouse.move(ax, ay + 10, steps=3)
        pg.mouse.move(ax, bb['y'] + bb['height'] * 0.8, steps=8)
        ok(f'[{rot}] indicador de destino durante o arraste', pg.locator('.seq-alvo-abaixo').count() == 1)
        pg.mouse.up(); pg.wait_for_timeout(250)
        ok(f'[{rot}] arrastar (mouse): 3410 vai para o fim', ordem() == ['3413', '3411', '3412', '3410'])
        if mobile:
            # arrastar com toque real (eventos de toque do Chrome)
            cdp = ctx.new_cdp_session(pg)
            pg.locator(linha('3411')).evaluate('e => e.scrollIntoView({block: "center"})'); pg.wait_for_timeout(100)
            tx, ty = centro(linha('3410') + ' [data-arrastar]'); bb = pg.locator(linha('3413')).bounding_box()
            alvo_y = bb['y'] + bb['height'] * 0.2
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': tx, 'y': ty}]})
            for k in range(1, 11):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': tx, 'y': ty + (alvo_y - ty) * k / 10}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(300)
            ok(f'[{rot}] arrastar (toque): 3410 vai para o 1º', ordem() == ['3410', '3413', '3411', '3412'])
        ajustada = ordem()
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-sequencia-livre.png'), full_page=True)
        # reimportar mantendo a ordem ajustada (+ uma OS nova)
        pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ + "5\tFazenda E\t3414\t25\tFungicida\n"); pg.wait_for_timeout(150)
        ok(f'[{rot}] opção de ordem aparece com "manter" marcado', pg.locator('.imp-ordem').is_visible() and pg.is_checked('input[name="imp-ordem"][value="manter"]'))
        ok(f'[{rot}] prévia avisa que a nova entra no fim', 'entram no fim' in pg.locator('.imp-previa').inner_text())
        pg.click('[data-imp="confirmar"]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] reimportar mantém a ordem ajustada; nova no fim', ordem() == ajustada + ['3414'])
        pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ + "5\tFazenda E\t3414\t25\tFungicida\n"); pg.check('input[name="imp-ordem"][value="tabela"]'); pg.wait_for_timeout(150)
        pg.click('[data-imp="confirmar"]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] "usar a ordem da tabela" volta à ordem da planilha', ordem() == ['3410', '3411', '3412', '3413', '3414'])
        ok(f'[{rot}] calda das OS existentes não foi apagada pela reimportação', all(len(o['calda']['produtos']) >= 6 for o in ds()['ordens'] if o['numero'] != '3414'))
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
