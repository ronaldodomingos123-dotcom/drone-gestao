"""v1.7.9: parada de UM turno (o outro aplicou) lançada à mão no fechamento + todas as datas no gráfico diário."""
import sys, pathlib, re, datetime
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.clock.set_fixed_time(datetime.datetime(2026, 10, 29, 9, 0))
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.evaluate("""() => {
          const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
          d.unidades.push({ id: 'u1', nome: 'Unidade T', codigo: 'UT', municipio: '' });
          d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Fazenda Teste I', municipio: '' });
          d.talhoes.push({ id: 't1', fazendaId: 'f1', codigo: 'GERAL', areaHa: 2000, geral: true });
          d.produtos.push({ id: 'p1', nome: 'PRODUTO A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
          const calda = { volumeLHa: 15, produtos: [{ produtoId: 'p1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
          d.campanhas.push({ id: 'c1', nome: 'Fungicida Teste', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-19', fim: '2026-12-01', calda });
          d.ordens.push({ id: 'o1', numero: '3410', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 1, itens: [{ talhaoId: 't1', areaPlanejadaHa: 2000 }], calda });
          d.aeronaves.push({ id: 'a1', identificacao: 'T70 A', modelo: 'Agras T70', numeroSerie: 'X1', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 });
          d.colaboradores.push({ id: 'l1', nome: 'Ronaldo', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'l2', nome: 'Raphael', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'p9', nome: 'Piloto', funcao: 'Piloto', unidadeId: 'u1', ativo: true });
          d.turnos.push({ id: 'tn1', nome: 'Turno A', periodo: 'Diurno', horaInicio: '06:00', horaFim: '18:00', liderId: 'l1', ativo: true }, { id: 'tn2', nome: 'Turno B', periodo: 'Noturno', horaInicio: '18:00', horaFim: '06:00', liderId: 'l2', ativo: true });
          const op = (id, data, a, t) => ({ id, data, osId: 'o1', campanhaId: 'c1', cultura: 'Cana-de-açúcar', auxiliarIds: [], aeronaveId: 'a1', pilotoId: 'p9', turnoId: t, liderId: t === 'tn1' ? 'l1' : 'l2', horaInicio: '19:00', horaFim: '23:00', tempoEfetivoMin: 200, status: 'concluida', itens: [{ talhaoId: 't1', areaHa: a }], calda: JSON.parse(JSON.stringify(calda)), clima: [], origem: 'registro_prototipo', criadoEm: data + 'T23:00:00' });
          d.operacoes.push(op('op1', '2026-10-19', 119, 'tn1'), op('op2', '2026-10-20', 80.5, 'tn1'), op('op3', '2026-10-24', 56.9, 'tn1'), op('op4', '2026-10-26', 81.6, 'tn1'), op('op5', '2026-10-28', 78.3, 'tn2'));
          const dp = (data, motivo) => ({ id: 'dp' + data, data, motivo, campanhaIds: ['c1'], criadoEm: data + 'T10:00:00' });
          d.diasParados = [dp('2026-10-21', 'Vento acima do limite'), dp('2026-10-22', 'Chuva'), dp('2026-10-23', 'Chuva'), dp('2026-10-25', 'Chuva'), dp('2026-10-27', 'Vento acima do limite')];
          localStorage.setItem(k, JSON.stringify(d));
        }""")
        # --- Fechamento: link "Este turno não aplicou?" com o Turno A na ficha
        ir('fechamento'); pg.reload(); pg.wait_for_selector('[data-f="turnoId"]')
        pg.fill('[data-f="data"]', '2026-10-28'); pg.dispatch_event('[data-f="data"]', 'change')
        pg.select_option('[data-f="turnoId"]', 'tn1'); pg.wait_for_timeout(200)
        pg.click('[data-acao="turno-parado"]'); pg.wait_for_selector('.modal [data-dp="gravar"]')
        ok(f'[{rot}] modal abre com "Só o Turno A" e a data da ficha', pg.input_value('.modal [data-dp="turno"]') == 'tn1' and pg.input_value('.modal [data-dp="de"]') == '2026-10-28')
        pg.select_option('.modal [data-dp="motivo"]', 'Vento acima do limite'); pg.fill('.modal [data-dp="obs"]', 'rajadas no turno do dia')
        pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        d = ds(); t28 = [x for x in d['diasParados'] if x['data'] == '2026-10-28']
        ok(f'[{rot}] 28/10 gravado só para o Turno A, mesmo com aplicação do Turno B', len(t28) == 1 and t28[0].get('turnoId') == 'tn1' and t28[0]['motivo'] == 'Vento acima do limite')
        ok(f'[{rot}] lista mostra a abrangência "Turno A"', 'Turno A' in pg.locator('.modal [data-dp-linha="2026-10-28"]').inner_text())
        # Turno B aplicou em 28/10: parada desse turno é recusada
        pg.select_option('.modal [data-dp="turno"]', 'tn2'); pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] parada do Turno B em 28/10 recusada (ele aplicou)', 'esse turno já tem aplicação' in pg.locator('.modal [data-dp="msg"]').inner_text() and len([x for x in ds()['diasParados'] if x['data'] == '2026-10-28']) == 1)
        # dia inteiro em dia com aplicação continua recusado
        pg.select_option('.modal [data-dp="turno"]', ''); pg.click('.modal [data-dp="gravar"]'); pg.wait_for_timeout(250)
        ok(f'[{rot}] dia inteiro em 28/10 continua recusado', 'já têm aplicação' in pg.locator('.modal [data-dp="msg"]').inner_text())
        pg.click('.modal [data-fechar]')
        # --- Painel: todas as datas e "½ Vento" no 28/10
        ir('painel'); pg.reload(); pg.wait_for_selector('#g-dia svg')
        eixo30 = [x for x in pg.eval_on_selector_all('#g-dia text.g-eixo', 'els => els.map(e => e.textContent)') if re.match(r'^\d{2}/\d{2}$', x or '')]
        ok(f'[{rot}] período de 30 dias: datas espaçadas terminando em hoje (29/10)', eixo30 and eixo30[-1] == '29/10')
        pg.eval_on_selector('#dash-filtros [data-f="de"]', 'e => { e.value = "2026-10-19"; e.dispatchEvent(new Event("change", { bubbles: true })); }'); pg.wait_for_timeout(400)
        eixo = pg.eval_on_selector_all('#g-dia text.g-eixo', 'els => els.map(e => e.textContent)')
        datas = [x for x in eixo if re.match(r'^\d{2}/\d{2}$', x or '')]
        if not mobile: ok(f'[{rot}] eixo com todas as datas 19/10 a 29/10 (11)', datas == [f'{d}/10' for d in range(19, 30)])
        else: ok(f'[{rot}] eixo no celular inclui o último dia (29/10)', datas and datas[-1] == '29/10')
        mot = pg.eval_on_selector_all('#g-dia text.g-dia-mot', 'els => els.map(e => e.textContent)')
        g = pg.locator('#g-dia').inner_html()
        if not mobile: ok(f'[{rot}] 28/10 marcado como "½ Vento" (barra do Turno B mantida)', '½ Vento' in mot)
        ok(f'[{rot}] detalhe do 28/10 diz "Turno A parado · Vento acima do limite" e mantém 78,3 ha', 'Turno A parado' in g and 'rajadas no turno do dia' in g and '78,3' in g)
        ok(f'[{rot}] subtítulo explica o ½', '½ = só um turno parado' in pg.locator('#g-dia').locator('xpath=ancestor::section[1]').inner_text() or '½ = só um turno parado' in pg.content())
        if SHOTS: pg.locator('#g-dia').locator('xpath=ancestor::section[1]').screenshot(path=str(SHOTS / f'grafico-dia-{rot}.png'))
        # --- Planejamento: célula do 28/10
        ir('planejamento'); pg.reload(); pg.wait_for_timeout(400)
        ok(f'[{rot}] Dias da campanha: 28/10 mostra "Turno A: Vento"', 'Turno A: Vento' in pg.locator('.dias-celulas').first.inner_text())
        ok(f'[{rot}] sem erros de página', not erros) or print(erros)
        b.close()

out = pathlib.Path(SHOTS) if SHOTS else None
if out: out.mkdir(parents=True, exist_ok=True)
rodar({'width': 1280, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'mobile', True)
for s, n in res: print(s, n)
sys.exit(1 if any(s == 'FALHOU' for s, _ in res) else 0)
