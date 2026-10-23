"""Fechamento do dia pela ficha diária (caso real de 14/10, reduzido a 2 fazendas): toda área vira voo,
rateio fazenda × drone que fecha os dois totais, célula editável, bloqueios (total que não fecha, clima
trocado), desconto no talhão certo, e o "Aplicado" da OS sem área sem voo."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = """() => {
  const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  d.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Jacinto I', municipio: '' }, { id: 'f2', unidadeId: 'u1', codigo: '18', nome: 'Sítio Clementino', municipio: '' });
  [['t19','019',7.36],['t20','020',12.33],['t21','021',7.71],['t22','022',5.3]].forEach(([id,c,a]) => d.talhoes.push({ id, fazendaId: 'f1', codigo: c, zona: '90', areaHa: a }));
  d.talhoes.push({ id: 'g2', fazendaId: 'f2', codigo: 'GERAL', areaHa: 16.01, geral: true });
  d.produtos.push({ id: 'pr1', nome: 'Fungicida X', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
  const calda = { volumeLHa: 10, produtos: [{ produtoId: 'pr1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
  d.campanhas.push({ id: 'c1', nome: 'Fungicida Teste', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-01', fim: '2026-12-01', calda });
  d.ordens.push({ id: 'o1', numero: '3416', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-13', sequencia: 1, calda, itens: [['t19',7.36],['t20',12.33],['t21',7.71],['t22',5.3]].map(([t,a]) => ({ talhaoId: t, areaPlanejadaHa: a })) },
                { id: 'o2', numero: '3415', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f2', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-13', sequencia: 2, calda, itens: [{ talhaoId: 'g2', areaPlanejadaHa: 16.01 }] });
  d.colaboradores.push({ id: 'p1', nome: 'Piloto Um', funcao: 'Piloto', unidadeId: 'u1', ativo: true }, { id: 'p2', nome: 'Piloto Dois', funcao: 'Piloto', unidadeId: 'u1', ativo: true }, { id: 'l1', nome: 'Líder Um', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true });
  d.turnos.push({ id: 'tn', nome: 'Turno B', periodo: 'Diurno', horaInicio: '12:00', horaFim: '23:59', liderId: 'l1', ativo: true });
  d.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '1', status: 'disponivel', unidadeId: 'u1', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '2', status: 'disponivel', unidadeId: 'u1', horasAnteriores: 0 });
  localStorage.setItem(k, JSON.stringify(d));
}"""
def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(250)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.evaluate(SEED); pg.reload(); pg.wait_for_timeout(300)
        # 0. piloto fixo no cadastro da aeronave
        ir('aeronaves'); pg.click('[data-ac="aA"]'); pg.wait_for_selector('.modal [data-editar="aeronave"]'); pg.click('.modal [data-editar="aeronave"]'); pg.wait_for_selector('.modal [name="pilotoPadraoId"]')
        pg.select_option('.modal [name="pilotoPadraoId"]', 'p2'); pg.click('.modal [data-salvar]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] aeronave guarda o piloto fixo', [a for a in ds()['aeronaves'] if a['id'] == 'aA'][0].get('pilotoPadraoId') == 'p2')
        # 1. ficha do dia
        ir('fechamento'); pg.wait_for_selector('#fch-previa')
        pg.fill('[data-f="data"]', '2026-10-14'); pg.dispatch_event('[data-f="data"]', 'change'); pg.wait_for_timeout(150)
        pg.fill('[data-f="inicio"]', '12:30'); pg.fill('[data-f="fim"]', '23:00')
        pg.click('[data-acao="add-pausa"]'); pg.fill('[data-p="0"][data-k="inicio"]', '13:04'); pg.fill('[data-p="0"][data-k="fim"]', '18:15')
        pg.click('[data-acao="add-pausa"]'); pg.fill('[data-p="1"][data-k="inicio"]', '20:10'); pg.fill('[data-p="1"][data-k="fim"]', '20:45'); pg.select_option('[data-p="1"][data-k="motivo"]', 'Deslocamento')
        pg.click('[data-acao="add-drone"]'); pg.click('[data-acao="add-drone"]')
        ok(f'[{rot}] drones vêm com o piloto fixo', pg.input_value('[data-d="0"][data-k="pilotoId"]') == 'p1' and pg.input_value('[data-d="1"][data-k="pilotoId"]') == 'p2')
        pg.fill('[data-d="0"][data-k="area"]', '25,00'); pg.fill('[data-d="1"][data-k="area"]', '23,18')
        pg.click('[data-acao="add-faz"]'); pg.select_option('[data-z="0"][data-k="osId"]', 'o1'); pg.fill('[data-z="0"][data-k="real"]', '32,17')
        pg.click('[data-acao="add-faz"]'); pg.select_option('[data-z="1"][data-k="osId"]', 'o2'); pg.fill('[data-z="1"][data-k="real"]', '16,01')
        for k, v in [('tIni', '24'), ('urIni', '55'), ('vIni', '6'), ('tFim', '68'), ('urFim', '17'), ('vFim', '5')]: pg.fill(f'[data-c="{k}"]', v)
        pg.wait_for_timeout(400)
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] clima trocado bloqueia e oferece "Trocar"', 'parecem trocadas' in prev and pg.is_disabled('[data-acao="gravar"]') and pg.locator('[data-acao="trocar-clima"]').count() == 1)
        pg.click('[data-acao="trocar-clima"]'); pg.wait_for_timeout(400)
        ok(f'[{rot}] trocar corrige para 17 °C e 68%', pg.input_value('[data-c="tFim"]') == '17,0' and pg.input_value('[data-c="urFim"]') == '68,0')
        # concluir Jacinto com desconto no talhão 20
        pg.check('[data-z="0"][data-k="concluir"]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] concluir com saldo pede o talhão do obstáculo 0,53', 'Obstáculo de 0,53 ha' in pg.locator('.fch-desc').inner_text())
        pg.check('[data-desc="0"][value="t20"]'); pg.wait_for_timeout(400)
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] total fecha: fazendas 48,18 = drones 48,18', 'fecha com os drones' in pg.locator('[data-tot="faz"]').inner_text())
        mat = pg.locator('.fch-mat tfoot').inner_text()
        ok(f'[{rot}] matriz estimada fecha cada drone (25,00 e 23,18)', '25,00' in mat and '23,18' in mat and '≠' not in mat and pg.locator('.fch-cel.est').count() == 4)
        ok(f'[{rot}] tempo por drone: jornada 10h30, parado 5h46, efetivo 4h44', all(x in prev for x in ['10h 30min', '5h 46min', '4h 44min']))
        ok(f'[{rot}] pronto para gravar 4 voos', 'Pronto para gravar: 4 voo(s)' in prev and not pg.is_disabled('[data-acao="gravar"]'))
        # célula editada: T70 D fez toda a Clementino
        pg.fill('[data-cel="o2|aD"]', '16,01'); pg.dispatch_event('[data-cel="o2|aD"]', 'change'); pg.wait_for_timeout(400)
        mat = pg.locator('.fch-mat').inner_text()
        ok(f'[{rot}] editar célula: Clementino T70 A = 0 e os totais continuam fechando', pg.input_value('[data-cel="o2|aA"]') == '0,00' and pg.input_value('[data-cel="o1|aD"]') == '8,99' and '≠' not in mat and pg.locator('.fch-cel.fixa').count() == 1)
        if SHOTS: pg.locator('#fch-previa').screenshot(path=str(SHOTS / f'{rot}-fechamento-previa.png'))
        # total que não fecha
        pg.fill('[data-z="0"][data-k="real"]', '30,37'); pg.wait_for_timeout(400)
        ok(f'[{rot}] fazendas com 1,80 ha a menos: "faltam 1,80 ha" e gravação bloqueada', 'faltam 1,80 ha' in pg.locator('[data-tot="faz"]').inner_text() and 'Faltam 1,80 ha' in pg.locator('#fch-previa').inner_text() and pg.is_disabled('[data-acao="gravar"]'))
        pg.fill('[data-z="0"][data-k="real"]', '32,17'); pg.fill('[data-d="1"][data-k="area"]', '21,38'); pg.wait_for_timeout(400)
        ok(f'[{rot}] drone com 1,80 ha a menos: "sobram 1,80 ha" e gravação bloqueada', 'sobram 1,80 ha' in pg.locator('[data-tot="faz"]').inner_text() and pg.is_disabled('[data-acao="gravar"]'))
        pg.fill('[data-d="1"][data-k="area"]', '23,18'); pg.wait_for_timeout(400)
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-fechamento.png'), full_page=True)
        ok(f'[{rot}] sem rolagem horizontal', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        pg.click('[data-acao="gravar"]'); pg.wait_for_url(re.compile('#/relatorios/diario')); pg.wait_for_timeout(300)
        d = ds(); ops = [o for o in d['operacoes'] if o.get('fechamentoDia') == '2026-10-14']
        ok(f'[{rot}] gravou 3 voos (Clementino só no T70 D) com piloto e tempo efetivo', len(ops) == 3 and sum(o['tempoEfetivoMin'] for o in ops if o['aeronaveId'] == 'aD') == 284 and all(o['pilotoId'] == ('p1' if o['aeronaveId'] == 'aD' else 'p2') for o in ops))
        ok(f'[{rot}] nenhuma área sem voo', not d.get('lancamentos'))
        ok(f'[{rot}] Diário abre no dia 14/10 com 48,18 ha', '48,1' in pg.locator('main').inner_text() and '14/10/2026' in pg.locator('main').inner_text())
        # sequência: Jacinto concluída com obstáculo 0,53
        ir('relatorios/sequencia'); pg.wait_for_selector('#seq-tab tbody tr')
        t = pg.locator('#seq-tab tr[data-os="o1"]').inner_text()
        ok(f'[{rot}] sequência: 32,17 aplicado, obstáculo 0,53, Concluída', all(x in t for x in ['32,17', '0,53', 'Concluída']))
        # Aplicado da OS: sem acrescentar área; mover o desconto redistribui os voos
        pg.locator('#seq-tab tr[data-os="o1"] [data-acao="aplicado"]').click(); pg.wait_for_selector('.modal [data-l="salvar"]')
        ok(f'[{rot}] "Aplicado" mostra 32,17 dos voos (somente leitura) e o atalho do Fechamento', pg.input_value('.modal [data-l="total"]') == '32,17' and pg.locator('.modal [data-l="total"][readonly]').count() == 1 and pg.locator('.modal a[href="#/fechamento"]').count() == 1)
        pg.locator('.modal tr[data-t="t20"] [data-l="desc"]').uncheck(); pg.locator('.modal tr[data-t="t22"] [data-l="desc"]').check(); pg.wait_for_timeout(150)
        pg.click('.modal [data-l="salvar"]'); pg.wait_for_timeout(300)
        d = ds(); apl = {}
        for o in d['operacoes']:
            if o['osId'] == 'o1':
                for i in o['itens']: apl[i['talhaoId']] = apl.get(i['talhaoId'], 0) + i['areaHa']
        ok(f'[{rot}] desconto movido para o talhão 22: 22 = 4,77, 20 = 12,33, total 32,17', round(apl.get('t22', 0), 2) == 4.77 and round(apl.get('t20', 0), 2) == 12.33 and round(sum(apl.values()), 2) == 32.17)
        ok(f'[{rot}] área de cada drone não mudou', round(sum(i['areaHa'] for o in d['operacoes'] if o['aeronaveId'] == 'aD' for i in o['itens']), 2) == 25.0)
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
