"""Fase 2 ponta a ponta: base própria, cadastros, importação da sequência (formato do app atual),
importação de talhões, registro de turno, reordenar/concluir, correção auditável, backup/restauração."""
import sys, pathlib, re, json
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

SEQ = "Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda Alfa\t5001\t30,00\tMaturador\n2\tFazenda Beta\t5002/5003\t20.5\tMaturador\n3\tFazenda Gama\t5004\t40\tInseticida\nTotal\t\t\t90,5\t\n"

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def form(campos, salvar=True):
            for k, v in campos.items():
                el = pg.locator(f'.modal [name="{k}"]')
                tag = el.evaluate('e => e.tagName')
                if tag == 'SELECT': el.select_option(label=v) if not v.startswith('id:') else el.select_option(v[3:])
                elif el.get_attribute('type') == 'checkbox': el.set_checked(v)
                else: el.fill(v)
            if salvar: pg.click('.modal [data-salvar]'); pg.wait_for_timeout(150)
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(200)

        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        # A. base própria
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        d = ds(); ok(f'[{rot}] base própria criada vazia', d['origemBase'] == 'propria' and not d['fazendas'] and not d['operacoes'])
        ok(f'[{rot}] faixa indica base própria', 'Base própria' in pg.locator('.faixa-demo').inner_text())
        # B. unidade
        pg.click('[data-novo="unidade"]'); form({'nome': 'Unidade Teste', 'codigo': 'UT'})
        ok(f'[{rot}] unidade cadastrada', len(ds()['unidades']) == 1)
        pg.click('[data-novo="unidade"]'); form({'nome': 'Outra', 'codigo': 'ut'})
        ok(f'[{rot}] código de unidade duplicado é bloqueado', 'Já existe' in pg.locator('.modal .form-msgs').inner_text()); pg.keyboard.press('Escape')
        # C. produto
        ir('produtos'); pg.click('[data-novo="produto"]'); form({'nome': 'Produto X', 'classe': 'Maturador', 'unidadeDose': 'L/ha', 'unidadeTotal': 'L'})
        ok(f'[{rot}] produto cadastrado', any(x['nome'] == 'Produto X' for x in ds()['produtos']))
        # D. importar sequência
        ir('relatorios/sequencia'); pg.click('[data-acao="importar"]')
        pg.fill('.imp-texto', SEQ); pg.wait_for_timeout(150)
        ok(f'[{rot}] importador reconhece 2 títulos', pg.locator('[data-titulo]').count() == 2)
        pg.locator('[data-titulo="Inseticida"]').uncheck(); pg.fill('[data-imp="nome"]', 'Maturador Teste'); pg.wait_for_timeout(150)
        btn = pg.locator('[data-imp="confirmar"]').inner_text()
        ok(f'[{rot}] prévia: 2 linhas, 50,50 ha (Total ignorado)', '2 linha' in btn and '50,50' in btn)
        ok(f'[{rot}] prévia mostra OS com barra', '5002/5003' in pg.locator('.imp-previa').inner_text())
        pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(200)
        d = ds(); ok(f'[{rot}] campanha, 2 fazendas e 2 OS criadas', len(d['campanhas']) == 1 and len(d['fazendas']) == 2 and len(d['ordens']) == 2)
        ok(f'[{rot}] sequência mostra próxima = Fazenda Alfa', 'Fazenda Alfa' in pg.locator('.seq-proxima').inner_text())
        # E. calda da campanha
        ir('campanhas'); pg.click('[data-editar="campanha"]')
        pg.fill('.modal [data-extra="volume"]', '20'); pg.click('.modal [data-add-calda]')
        pg.locator('.modal .calda-lista [data-extra="produtoId"]').select_option(label='Produto X')
        pg.fill('.modal .calda-lista [data-extra="dose"]', '0,5'); form({'aplicarOS': True})
        d = ds(); ok(f'[{rot}] calda definida e aplicada às OS abertas', all(o['calda']['produtos'] and o['calda']['volumeLHa'] == 20 for o in d['ordens']))
        # F. importar talhões
        ir('fazendas'); pg.click('[data-importar-talhoes]'); pg.fill('.modal .imp-texto', 'Fazenda;Talhão;Área\nFazenda Alfa;1;10\nFazenda Alfa;2;20'); pg.wait_for_timeout(150)
        ok(f'[{rot}] prévia: OS passa a usar talhões reais', 'OS que passam a usar talhões reais 1' in pg.locator('.modal .imp-previa').inner_text().replace('\n', ' '))
        pg.click('.modal [data-imp="confirmar"]'); pg.wait_for_timeout(200)
        d = ds(); alfa = [o for o in d['ordens'] if o['numero'] == '5001'][0]
        ok(f'[{rot}] OS 5001 com 2 talhões reais (talhão geral removido)', len(alfa['itens']) == 2 and not any(t.get('geral') and t['fazendaId'] == alfa['fazendaId'] for t in d['talhoes']))
        # G. equipe
        ir('colaboradores'); pg.click('[data-novo="colaborador"]'); form({'nome': 'Líder L', 'funcao': 'Líder de turno'})
        pg.click('[data-novo="colaborador"]'); form({'nome': 'Piloto P', 'funcao': 'Piloto'})
        ir('turnos'); pg.click('[data-novo="turno"]'); form({'nome': 'Turno A', 'liderId': 'Líder L'})
        ir('aeronaves'); pg.click('[data-novo="aeronave"]'); form({'identificacao': 'T70 D', 'modelo': 'Agras T70'})
        d = ds(); ok(f'[{rot}] equipe, turno e aeronave cadastrados', len(d['colaboradores']) == 2 and len(d['turnos']) == 1 and len(d['aeronaves']) == 1)
        # H. registro de campo
        ir('campo'); pg.evaluate("localStorage.removeItem('dap-proto-v1:boletim')"); pg.reload(); pg.wait_for_selector('#campo')
        tn = d['turnos'][0]['id']; pg.select_option('[data-k="turnoId"]', tn)
        pg.click('[data-a="add-drone"]'); dr = pg.locator('.campo-drone').first
        dr.locator('[data-k$=".pilotoId"]').select_option(label='Piloto P')
        dr.locator('select.campo-os').select_option(alfa['id'])
        dr.locator('[data-ui$=".hora"]').fill('18:00'); dr.locator('[data-a="iniciar"]').click()
        dr.locator('summary').click(); dr.locator('[data-a="add-talhao"]').first.click()
        dr.locator('[data-ui$=".hora"]').fill('19:00'); dr.locator('[data-a="finalizar"]').click()
        pg.click('[data-a="fechar"]'); pg.wait_for_selector('.modal [data-ok]'); pg.click('.modal [data-ok]'); pg.wait_for_url(re.compile('relatorios/diario'))
        d = ds(); ok(f'[{rot}] turno gravado com a calda importada', len(d['operacoes']) == 1 and d['operacoes'][0]['itens'][0]['areaHa'] == 10)
        # I. sequência: andamento, reordenar, concluir manual
        ir('relatorios/sequencia'); pg.wait_for_selector('#seq-tab')
        ok(f'[{rot}] Alfa em andamento com saldo 20', pg.locator('#seq-tab .seq-andamento').count() == 1 and '20,00' in pg.locator('#seq-tab .seq-andamento').inner_text() and pg.locator('#seq-tab .seq-andamento .p-and').count() == 1 and 'fazenda alfa' in pg.locator('.seq-card.c-and').inner_text().lower())
        beta = [o for o in d['ordens'] if o['numero'] == '5002/5003'][0]
        pg.click(f'[data-acao="subir"][data-id="{beta["id"]}"]'); pg.wait_for_timeout(200)
        d = ds(); ok(f'[{rot}] reordenar: Beta passa a ser a 1ª', [o for o in d['ordens'] if o['id'] == beta['id']][0]['sequencia'] == 1)
        pg.click(f'[data-acao="concluir"][data-id="{beta["id"]}"]'); pg.wait_for_selector('.modal [data-l="salvar"]')
        ok(f'[{rot}] "Aplicado" não aceita área sem voo (total = voos, somente leitura)', pg.input_value('.modal [data-l="total"]') == '0,00' and pg.locator('.modal [data-l="total"][readonly]').count() == 1)
        pg.click('.modal [data-l="salvar"]'); pg.wait_for_timeout(250)
        d = ds(); ok(f'[{rot}] concluir OS sem voos é bloqueado e aponta o Fechamento do dia', [o for o in d['ordens'] if o['id'] == beta['id']][0]['status'] != 'concluida' and 'Fechamento do dia' in pg.locator('.modal [data-l="msgs"]').inner_text() and not d.get('lancamentos'))
        pg.click('.modal [data-fechar]'); pg.wait_for_timeout(150)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-sequencia.png'), full_page=True)
        # J. copiar resumo
        pg.click('[data-acao="copiar"]'); pg.wait_for_timeout(200)
        txt = pg.evaluate('navigator.clipboard.readText()')
        ok(f'[{rot}] resumo copiado para WhatsApp', 'SEQUÊNCIA — MATURADOR TESTE' in txt and 'Próxima' in txt)
        # K. correção auditável
        ir('aplicacoes'); pg.locator('tr.clicavel').first.click(); pg.click('[data-op-corrigir]')
        form({'area_0': '9,5'}, salvar=False); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(100)
        ok(f'[{rot}] correção exige motivo', 'Motivo' in pg.locator('.modal .form-msgs').inner_text())
        form({'motivo': 'Área medida no GPS'})
        d = ds(); au = [a for a in d['auditoria'] if a['acao'] == 'corrigir']
        ok(f'[{rot}] correção gravada com antes/depois e motivo', d['operacoes'][0]['itens'][0]['areaHa'] == 9.5 and au and au[0]['motivo'] == 'Área medida no GPS' and au[0]['antes']['itens'][0]['areaHa'] == 10)
        # L. exclusão bloqueada por vínculo
        ir('fazendas'); pg.locator('[data-excluir="fazenda"]').first.click(); pg.wait_for_timeout(150)
        ok(f'[{rot}] fazenda em uso não é excluída', 'Não é possível excluir' in pg.locator('#toasts').inner_text() and len(ds()['fazendas']) == 2)
        # M. auditoria
        ir('auditoria'); ok(f'[{rot}] histórico lista as alterações', pg.locator('#au-tab tbody tr').count() >= 8)
        # N. backup e restauração
        ir('configuracoes')
        with pg.expect_download() as dl: pg.click('[data-acao="backup"]')
        arq = SHOTS / f'{rot}-backup.json' if SHOTS else pathlib.Path(f'/tmp/{rot}-backup.json'); dl.value.save_as(str(arq))
        ok(f'[{rot}] backup exportado com a base própria', json.loads(arq.read_text())['origemBase'] == 'propria')
        pg.click('[data-acao="restaurar"]'); pg.click('[data-ok]'); pg.wait_for_timeout(200)
        ok(f'[{rot}] voltar à demonstração avisa e troca a base', ds()['origemBase'] == 'demo')
        ir('configuracoes'); pg.set_input_files('[data-acao="restaurar-backup"]', str(arq)); pg.click('[data-ok]'); pg.wait_for_timeout(250)
        d = ds(); ok(f'[{rot}] backup restaurado (operação corrigida preservada)', d['origemBase'] == 'propria' and d['operacoes'][0]['itens'][0]['areaHa'] == 9.5)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
