"""Caminho do piloto com os dados reais da campanha FUNGICIDA: colar a sequência (5 fazendas), colar os talhões
com "ñ aplicado", importar o código do app (data 14/10 corrigida para 19/10) e gravar 19/10 e 20/10 sem marcar
nada à mão: obstáculos iguais às planilhas."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SEQ = pathlib.Path('tests/fixtures/fungicida-sequencia.txt').read_text()
TAL = pathlib.Path('tests/fixtures/fungicida-talhoes.txt').read_text()
TRA = pathlib.Path('tests/fixtures/fungicida-tratamento.txt').read_text()
COD = str(pathlib.Path('tests/fixtures/acomp-codigo.txt').resolve())
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
EQUIPE = """() => { const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  d.colaboradores.push({ id: 'p1', nome: 'P1', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'p2', nome: 'P2', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'l1', nome: 'L', funcao: 'Líder de turno', unidadeId: '', ativo: true });
  d.turnos.push({ id: 'tn', nome: 'T', periodo: 'Noturno', horaInicio: '12:00', horaFim: '06:00', liderId: 'l1', ativo: true });
  d.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '1', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '2', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p2' });
  localStorage.setItem(k, JSON.stringify(d)); }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
    pg.goto(URL); pg.wait_for_selector('.destaque-valor')
    ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
    ir('relatorios/sequencia'); pg.click('[data-acao="importar"]'); pg.fill('.imp-texto', SEQ); pg.fill('[data-imp="nome"]', 'FUNGICIDA'); pg.wait_for_timeout(200)
    pg.click('[data-imp="confirmar"]'); pg.wait_for_selector('#seq-tab tbody tr'); pg.wait_for_timeout(300)
    d = ds(); ok('sequência colada: 5 fazendas e 5 OS (3416, 3415 ×2, 3414, 3413)', len(d['fazendas']) == 5 and sorted(o['numero'] for o in d['ordens']) == ['3413', '3414', '3415', '3415', '3416'])
    ir('fazendas'); pg.click('[data-importar-talhoes]'); pg.fill('.modal .imp-texto', TAL); pg.wait_for_timeout(300)
    pg.click('.modal [data-imp="confirmar"]'); pg.wait_for_timeout(400)
    d = ds()
    prev = {f['nome']: round(sum(i.get('naoAplicadoHa', 0) for o in d['ordens'] if o['fazendaId'] == f['id'] for i in o['itens']), 2) for f in d['fazendas']}
    ok('talhões colados: 36 talhões (4+7+5+11+9); desconto previsto 0,53 · 0 · 1,84 · 0,48 · 0,39', len([t for t in d['talhoes'] if not t.get('geral')]) == 36 and prev == {'Jacinto I': 0.53, 'Sítio Clementino': 0.0, 'Sítio José Lopes': 1.84, 'Sítio Nunes': 0.48, 'Ipê': 0.39})
    # tratamento da campanha pela tela: colar a tabela + volume 15 L/ha
    ir('campanhas'); pg.click('[data-editar="campanha"]'); pg.fill('.modal [data-extra="volume"]', '15')
    pg.click('.modal [data-colar-trat]'); pg.fill('.modal [data-colar-txt]', TRA); pg.wait_for_timeout(200); pg.click('.modal [data-colar-usar]'); pg.wait_for_timeout(150)
    pg.click('.modal [data-salvar]'); pg.wait_for_timeout(300)
    d = ds(); ok('campanha: 6 produtos e 15 L/ha; as 5 OS herdam a calda', all(o['calda']['volumeLHa'] == 15 and len(o['calda']['produtos']) == 6 for o in d['ordens']))
    pg.evaluate(EQUIPE); pg.reload(); pg.wait_for_timeout(300)
    ir('fechamento'); pg.click('[data-acao="importar-acomp"]'); pg.set_input_files('.modal [data-ac="arq"]', COD); pg.wait_for_selector('.modal [data-acomp-dia]')
    ok('código: os 2 dias ficam prontos para conferir (sem pendências)', pg.locator('.modal .selo-info', has_text='pronto para conferir').count() == 2)
    pg.fill('.modal [data-ac-data="2026-10-14"]', '2026-10-19'); pg.dispatch_event('.modal [data-ac-data="2026-10-14"]', 'change'); pg.wait_for_timeout(300)
    pg.click('.modal [data-ac-abrir="2026-10-14"]'); pg.wait_for_timeout(600)
    ok('volume não precisa ser digitado: campo mostra "15,0 (da OS)"', pg.input_value('[data-f="volumeLHa"]') == '' and '15,0 (da OS)' in pg.get_attribute('[data-f="volumeLHa"]', 'placeholder'))
    ok('19/10: pronto sem marcar talhão (desconto do ñ aplicado)', 'Pronto para gravar: 8 voo(s)' in pg.locator('#fch-previa').inner_text())
    pg.click('[data-acao="gravar"]'); pg.wait_for_selector('.modal [data-acomp-dia]'); pg.wait_for_timeout(300)
    pg.click('.modal [data-ac-abrir="2026-10-20"]'); pg.wait_for_timeout(600)
    ok('20/10: Ipê pronto (2 voos) com calda 15 L/ha', 'Pronto para gravar: 2 voo(s)' in pg.locator('#fch-previa').inner_text() and '15,0 L/ha' in pg.locator('#fch-previa').inner_text())
    pg.click('[data-acao="gravar"]'); pg.wait_for_url(re.compile('relatorios/diario')); pg.wait_for_timeout(300)
    ir('relatorios/sequencia'); pg.wait_for_selector('#seq-tab tbody tr')
    tab = pg.locator('#seq-tab').inner_text()
    ok('sequência: aplicado 32,17 · 16,01 · 28,22 · 43,09 · 80,54', all(x in tab for x in ['32,17', '16,01', '28,22', '43,09', '80,54']))
    ok('fechamento da campanha: obstáculos 0,53 + 1,84 + 0,48 = 2,85 ha', '2,85' in pg.locator('.seq-fech').inner_text())
    d = ds(); ok('10 voos com calda de 15 L/ha e os 6 produtos', len(d['operacoes']) == 10 and all(o['calda']['volumeLHa'] == 15 and len(o['calda']['produtos']) == 6 for o in d['operacoes']))
    ok('sem erros de JavaScript', not erros) or print(erros)
    b.close()
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
