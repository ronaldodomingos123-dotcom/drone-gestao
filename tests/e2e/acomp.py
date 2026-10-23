"""Importar do app de acompanhamento com o código ACOMP1 REAL (2 dias fechados): o dia registrado como 14/10
(fechado em 20/10) tem a data corrigida para 19/10, abre na ficha e grava
8 voos (4 fazendas × 2 drones) com o desconto no talhão indicado; 20/10 aponta a fazenda IPÊ sem OS."""
import sys, pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri()
COD = str(pathlib.Path('tests/fixtures/acomp-codigo.txt').resolve())
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = """() => {
  const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  d.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  d.produtos.push({ id: 'pr1', nome: 'Fungicida X', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
  const calda = { volumeLHa: 10, produtos: [{ produtoId: 'pr1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
  d.campanhas.push({ id: 'c1', nome: 'Fungicida 26/27', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-01', fim: '2026-12-01', calda });
  const faz = [['f1','90','Fazenda Jacinto I','3416',[['t19',7.36],['t20',12.33],['t21',7.71],['t22',5.3]]],['f2','18','Sítio Clementino','3415',[['c1',16.01]]],['f3','19','Sítio José Lopes','3417',[['j1',28.22]]],['f4','20','Sítio Nunes','3418',[['n1',20],['n2',23.09]]]];
  faz.forEach(([id,cod,nm,os,ts],i) => { d.fazendas.push({ id, unidadeId: 'u1', codigo: cod, nome: nm, municipio: '' }); ts.forEach(([t,a]) => d.talhoes.push({ id: t, fazendaId: id, codigo: t, areaHa: a }));
    d.ordens.push({ id: 'o'+(i+1), numero: os, campanhaId: 'c1', unidadeId: 'u1', fazendaId: id, tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-13', sequencia: i+1, calda, itens: ts.map(([t,a]) => ({ talhaoId: t, areaPlanejadaHa: a })) }); });
  d.colaboradores.push({ id: 'p1', nome: 'Piloto Um', funcao: 'Piloto', unidadeId: 'u1', ativo: true }, { id: 'p2', nome: 'Piloto Dois', funcao: 'Piloto', unidadeId: 'u1', ativo: true }, { id: 'l1', nome: 'Líder Um', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true });
  d.turnos.push({ id: 'tn', nome: 'Turno B', periodo: 'Diurno', horaInicio: '12:00', horaFim: '23:59', liderId: 'l1', ativo: true });
  d.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '1', status: 'disponivel', unidadeId: 'u1', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '2', status: 'disponivel', unidadeId: 'u1', horasAnteriores: 0, pilotoPadraoId: 'p2' });
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
        ir('fechamento'); pg.wait_for_selector('#fch-previa')
        pg.click('[data-acao="importar-acomp"]'); pg.wait_for_selector('.modal [data-ac="txt"]')
        pg.set_input_files('.modal [data-ac="arq"]', COD); pg.wait_for_selector('.modal [data-acomp-dia]')
        t = pg.locator('.modal').inner_text()
        ok(f'[{rot}] código lido: FUNGICIDA, 2 dias fechados, 200,04 ha, meta 844,01', all(x in t for x in ['FUNGICIDA', '200,04', '844,01']) and pg.locator('.modal [data-acomp-dia]').count() == 2)
        ok(f'[{rot}] 14/10 pronto para conferir; 20/10 com pendência da fazenda IPÊ', 'pronto para conferir' in pg.locator('.modal [data-acomp-dia="2026-10-14"]').inner_text() and '"IPÊ" não está no protótipo' in t)
        ok(f'[{rot}] avisa que o T70 D fez bem menos área em 20/10', 'T70 D fez bem menos área' in t)
        ok(f'[{rot}] data suspeita sinalizada: registrado 14/10, fechado em 20/10', 'fechado em 20/10/2026 (6 dias depois)' in t)
        pg.fill('.modal [data-ac-data="2026-10-14"]', '2026-10-19'); pg.dispatch_event('.modal [data-ac-data="2026-10-14"]', 'change'); pg.wait_for_timeout(300)
        lin = pg.locator('.modal [data-acomp-dia="2026-10-14"]').inner_text()
        ok(f'[{rot}] data corrigida para 19/10 mostra "no app: 14/10" e some o aviso', 'no app: 14/10/2026' in lin and '6 dias depois' not in pg.locator('.modal').inner_text())
        if SHOTS: pg.locator('.modal').screenshot(path=str(SHOTS / f'{rot}-acomp-importar.png'))
        pg.click('.modal [data-ac-abrir="2026-10-14"]'); pg.wait_for_timeout(500)
        ok(f'[{rot}] ficha preenchida: 19/10 (corrigida), 12:30–23:00, 2 paradas, 2 drones, 4 fazendas, clima 17 °C/68%', pg.input_value('[data-f="data"]') == '2026-10-19' and pg.input_value('[data-f="inicio"]') == '12:30' and pg.locator('[data-p][data-k="inicio"]').count() == 2 and pg.input_value('[data-p="0"][data-k="motivo"]') == 'Umidade abaixo do limite' and pg.input_value('[data-p="1"][data-k="motivo"]') == 'Deslocamento' and pg.locator('[data-d][data-k="area"]').count() == 2 and pg.locator('[data-z][data-k="real"]').count() == 4 and pg.input_value('[data-c="tFim"]') == '17,0')
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] Jacinto I concluída no app com saldo 0,53: pede o talhão do desconto', 'Marque em qual talhão' in prev and pg.is_disabled('[data-acao="gravar"]'))
        pg.check('[data-desc="0"][value="t20"]'); pg.wait_for_timeout(500)
        prev = pg.locator('#fch-previa').inner_text()
        ok(f'[{rot}] pronto: 8 voos, 119,49 ha, diferença de 0,01 ha avisada, efetivo 4h44', 'Pronto para gravar: 8 voo(s)' in prev and '119,49' in prev and '0,01 ha' in prev and '4h 44min' in prev)
        pg.click('[data-acao="gravar"]'); pg.wait_for_selector('.modal [data-acomp-dia]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] após gravar volta à lista: dia gravado (8 voos) com a data corrigida mantida', 'gravado (8 voos)' in pg.locator('.modal [data-acomp-dia="2026-10-14"]').inner_text() and pg.input_value('.modal [data-ac-data="2026-10-14"]') == '2026-10-19')
        d = ds(); ops = [o for o in d['operacoes'] if o.get('fechamentoDia') == '2026-10-19']
        ok(f'[{rot}] voos gravados em 19/10 (nada em 14/10)', len(ops) == 8 and all(o['data'] == '2026-10-19' for o in ops) and not [o for o in d['operacoes'] if o.get('fechamentoDia') == '2026-10-14'])
        ok(f'[{rot}] voos gravados com piloto fixo; Jacinto 32,17 com obstáculo 0,53 no talhão 20', len(ops) == 8 and round(sum(i['areaHa'] for o in ops if o['osId'] == 'o1' for i in o['itens'] if i['talhaoId'] == 't20'), 2) == 11.8 and all(x.get('concluidaManual') for x in d['ordens']))
        ok(f'[{rot}] sem rolagem horizontal', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
        ok(f'[{rot}] sem erros de JavaScript', not erros) or print(erros)
        b.close()
rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
