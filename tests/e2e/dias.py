"""v1.6: dias sem aplicação (chuva/vento) + dias corridos/efetivos da campanha + meta fixa da safra (24.000 ha, editável)."""
import sys, pathlib, re, datetime
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.clock.set_fixed_time(datetime.datetime(2026, 10, 23, 12, 0))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.evaluate("""() => {
          const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
          d.unidades.push({ id: 'u1', nome: 'Unidade T', codigo: 'UT', municipio: '' });
          d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Fazenda Teste I', municipio: '' });
          d.talhoes.push({ id: 't1', fazendaId: 'f1', codigo: 'GERAL', areaHa: 500, geral: true });
          d.produtos.push({ id: 'p1', nome: 'PRODUTO A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
          const calda = { volumeLHa: 15, produtos: [{ produtoId: 'p1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
          d.campanhas.push({ id: 'c1', nome: 'Fungicida Teste', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-14', fim: '2026-12-01', calda });
          d.ordens.push({ id: 'o1', numero: '3410', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 1, itens: [{ talhaoId: 't1', areaPlanejadaHa: 500 }], calda });
          d.aeronaves.push({ id: 'a1', identificacao: 'T70 A', modelo: 'Agras T70', numeroSerie: 'X1', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 });
          d.colaboradores.push({ id: 'l1', nome: 'Líder', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'p9', nome: 'Piloto', funcao: 'Piloto', unidadeId: 'u1', ativo: true });
          d.turnos.push({ id: 'tn1', nome: 'Turno A', periodo: 'Diurno', horaInicio: '06:00', horaFim: '18:00', liderId: 'l1', ativo: true });
          const op = (id, data, a) => ({ id, data, osId: 'o1', campanhaId: 'c1', cultura: 'Cana-de-açúcar', auxiliarIds: [], aeronaveId: 'a1', pilotoId: 'p9', turnoId: 'tn1', liderId: 'l1', horaInicio: '07:00', horaFim: '15:00', tempoEfetivoMin: 400, status: 'concluida', itens: [{ talhaoId: 't1', areaHa: a }], calda: JSON.parse(JSON.stringify(calda)), clima: [], origem: 'registro_prototipo', criadoEm: data + 'T15:00:00' });
          d.operacoes.push(op('op1', '2026-10-19', 100), op('op2', '2026-10-20', 100.03));
          localStorage.setItem(k, JSON.stringify(d));
        }""")
        # --- Fechamento: Dia sem aplicação
        ir('fechamento'); pg.reload(); pg.wait_for_selector('[data-acao="dia-parado"]')
        pg.click('[data-acao="dia-parado"]'); pg.wait_for_selector('.modal [data-dp="gravar"]')
        ok(f'[{rot}] modal abre com campanha ativa marcada', pg.is_checked('.modal [data-dp-camp="c1"]'))
        pg.fill('.modal [data-dp="de"]', '2026-10-21'); pg.dispatch_event('.modal [data-dp="de"]', 'change')
        pg.fill('.modal [data-dp="ate"]', '2026-10-22'); pg.select_option('.modal [data-dp="motivo"]', 'Chuva'); pg.fill('.modal [data-dp="obs"]', 'chuva e vento')
        pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] 21 e 22/10 registrados (2 dias)', '2 dia(s) registrado(s)' in pg.locator('.modal [data-dp="msg"]').inner_text() and pg.locator('.modal [data-dp-linha]').count() == 2)
        # 22/10 = vento (substitui)
        pg.fill('.modal [data-dp="de"]', '2026-10-22'); pg.dispatch_event('.modal [data-dp="de"]', 'change'); pg.fill('.modal [data-dp="ate"]', '2026-10-22')
        pg.select_option('.modal [data-dp="motivo"]', 'Vento acima do limite'); pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        d = ds(); dp = sorted(d.get('diasParados', []), key=lambda x: x['data'])
        ok(f'[{rot}] mesmo dia substitui: 21 Chuva, 22 Vento', [(x['data'], x['motivo']) for x in dp] == [('2026-10-21', 'Chuva'), ('2026-10-22', 'Vento acima do limite')] and dp[0]['campanhaIds'] == ['c1'])
        # dia com aplicação não é marcado
        pg.fill('.modal [data-dp="de"]', '2026-10-19'); pg.dispatch_event('.modal [data-dp="de"]', 'change'); pg.fill('.modal [data-dp="ate"]', '2026-10-19')
        pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] 19/10 (com aplicação) não é marcado', 'já têm aplicação' in pg.locator('.modal [data-dp="msg"]').inner_text() and len(ds().get('diasParados', [])) == 2)
        # futuro = erro
        pg.fill('.modal [data-dp="de"]', '2026-10-25'); pg.fill('.modal [data-dp="ate"]', '2026-10-25'); pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] data futura é recusada', 'futuro' in pg.locator('.modal [data-dp="msg"]').inner_text() and len(ds().get('diasParados', [])) == 2)
        # remover e registrar de novo
        pg.fill('.modal [data-dp="de"]', '2026-10-17'); pg.dispatch_event('.modal [data-dp="de"]', 'change'); pg.fill('.modal [data-dp="ate"]', '2026-10-17'); pg.select_option('.modal [data-dp="motivo"]', 'Manutenção') if pg.locator('.modal [data-dp="motivo"] option[value="Manutenção"]').count() else None
        pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        n3 = len(ds().get('diasParados', []))
        pg.locator('.modal [data-dp-linha="2026-10-17"] [data-dp-rm]').click(); pg.wait_for_timeout(250)
        ok(f'[{rot}] registrar 17/10 e remover pela lista (3 → 2)', n3 == 3 and len(ds().get('diasParados', [])) == 2 and pg.locator('.modal [data-dp-linha]').count() == 2)
        ok(f'[{rot}] auditoria registra criação e remoção', sum(1 for a in ds()['auditoria'] if 'sem aplicação' in a['resumo']) >= 3)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-dia-parado.png'), full_page=False)
        pg.click('.modal [data-fechar]')
        # --- Planejamento: safra + dias
        ir('planejamento'); pg.wait_for_selector('[data-safra]')
        sf = pg.locator('[data-safra]').inner_text()
        ok(f'[{rot}] safra padrão: meta 24.000 ha, aplicado 200,0 ha', '24.000' in sf and '200,0' in sf)
        dc = pg.locator('.plan-c [data-dias]').first.inner_text()
        ok(f'[{rot}] campanha: 10 corridos, 2 com aplicação, 2 parados, 6 sem registro', all(re.search(p, dc, re.S) for p in [r'Corridos\s*10', r'Com aplicação\s*2', r'Parados\s*2', r'Sem registro\s*6']))
        ok(f'[{rot}] campanha: 100,0 ha/dia com aplicação e 20,0 ha/dia corrido; motivos Chuva 1 · Vento 1', '100,0' in dc and '20,0' in dc and 'Chuva: 1' in dc and 'Vento acima do limite: 1' in dc)
        ok(f'[{rot}] faixa: 2 verdes, 2 laranja, 6 cinza', pg.locator('.plan-c .dias-faixa .dia-apl').count() == 2 and pg.locator('.plan-c .dias-faixa .dia-par').count() == 2 and pg.locator('.plan-c .dias-faixa .dia-sem').count() == 6)
        pg.click('[data-safra-editar]'); pg.wait_for_selector('.modal [name="metaHa"]')
        ok(f'[{rot}] formulário vem com 24000', pg.input_value('.modal [name="metaHa"]') == '24000')
        pg.fill('.modal [name="nome"]', 'Safra 2026/27'); pg.fill('.modal [name="metaHa"]', '26.000'); pg.fill('.modal [name="inicio"]', '2026-04-01'); pg.fill('.modal [name="fim"]', '2027-03-31')
        pg.click('.modal [data-salvar]'); pg.wait_for_timeout(400)
        s = ds().get('safra') or {}
        ok(f'[{rot}] safra gravada: 26.000 ha, 01/04/2026 a 31/03/2027', s.get('metaHa') == 26000 and s.get('inicio') == '2026-04-01' and s.get('fim') == '2027-03-31')
        sf = pg.locator('[data-safra]').inner_text()
        ok(f'[{rot}] cartão atualizado: 26.000, 159 dias restantes, 0,8%', '26.000' in sf and '159' in sf and '0,8%' in sf)
        pg.click('[data-safra-editar]'); pg.wait_for_selector('.modal [name="metaHa"]'); pg.fill('.modal [name="metaHa"]', '0'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] meta 0 é recusada', pg.locator('.modal').count() > 0 and ds()['safra']['metaHa'] == 26000)
        pg.click('.modal [data-fechar]')
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-planejamento-safra.png'), full_page=True)
        # --- Painel
        ir('dashboard'); pg.wait_for_selector('.destaque-lado')
        lado = pg.locator('.destaque-lado').inner_text()
        ok(f'[{rot}] painel: meta da safra 200,0 de 26.000 (independe do filtro)', '200,0 ha de 26.000 ha' in lado)
        ok(f'[{rot}] painel: 2 com aplicação de 10 corridos, parados 2', '2 com aplicação de 10 corridos' in lado and 'parados 2' in lado)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-painel-safra.png'), full_page=False)
        larg = pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        ok(f'[{rot}] sem rolagem horizontal', larg)
        ok(f'[{rot}] sem erros de página', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1366, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'mobile', True)
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
