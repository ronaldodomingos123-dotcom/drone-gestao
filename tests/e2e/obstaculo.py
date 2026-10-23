"""v0.8.2: programado = área bruta; ao concluir com saldo, o saldo fica visível como OBSTÁCULO,
a barra mostra o que foi realmente aplicado e o fechamento separa aplicado × obstáculos."""
import sys, pathlib, re
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
        ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(250)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        # base própria: 1 OS com GERAL 32,70; turno que aplica 32,17
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.evaluate("""() => {
          const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
          d.unidades.push({ id: 'u1', nome: 'Unidade T', codigo: 'UT', municipio: '' });
          d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Fazenda Teste I', municipio: '' }, { id: 'f2', unidadeId: 'u1', codigo: '18', nome: 'Fazenda Teste II', municipio: '' });
          d.talhoes.push({ id: 't1', fazendaId: 'f1', codigo: 'GERAL', areaHa: 32.7, geral: true }, { id: 't2', fazendaId: 'f2', codigo: 'GERAL', areaHa: 16.01, geral: true });
          d.produtos.push({ id: 'p1', nome: 'PRODUTO A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
          const calda = { volumeLHa: 10, produtos: [{ produtoId: 'p1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
          d.campanhas.push({ id: 'c1', nome: 'Fungicida Teste', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-01', fim: '2026-12-01', calda });
          d.ordens.push({ id: 'o1', numero: '3410', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 1, itens: [{ talhaoId: 't1', areaPlanejadaHa: 32.7 }], calda },
                        { id: 'o2', numero: '3411', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f2', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 2, itens: [{ talhaoId: 't2', areaPlanejadaHa: 16.01 }], calda });
          d.aeronaves.push({ id: 'a1', identificacao: 'T70 A', modelo: 'Agras T70', numeroSerie: 'X1', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 });
          d.colaboradores.push({ id: 'l1', nome: 'Líder', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'p9', nome: 'Piloto', funcao: 'Piloto', unidadeId: 'u1', ativo: true });
          d.turnos.push({ id: 'tn1', nome: 'Turno A', periodo: 'Diurno', horaInicio: '06:00', horaFim: '18:00', liderId: 'l1', ativo: true });
          d.operacoes.push({ id: 'op1', data: '2026-10-19', osId: 'o1', campanhaId: 'c1', cultura: 'Cana-de-açúcar', auxiliarIds: [], aeronaveId: 'a1', pilotoId: 'p9', turnoId: 'tn1', liderId: 'l1', horaInicio: '07:00', horaFim: '09:00', tempoEfetivoMin: 100, status: 'concluida', itens: [{ talhaoId: 't1', areaHa: 32.17 }], calda: JSON.parse(JSON.stringify(calda)), clima: [], origem: 'registro_prototipo', criadoEm: '2026-10-19T09:00:00' });
          localStorage.setItem(k, JSON.stringify(d));
        }""")
        ir('relatorios/sequencia'); pg.reload(); pg.wait_for_selector('#seq-tab tbody tr')
        linha = pg.locator('#seq-tab tr[data-os="o1"]')
        ok(f'[{rot}] antes de concluir: área 32,70, aplicado 32,17, saldo 0,53, 98%', all(x in linha.inner_text() for x in ['32,70', '32,17', '0,53', '98%']))
        ok(f'[{rot}] topo: falta aplicar inclui o saldo (0,53 + 16,01 = 16,54)', '16,54' in pg.locator('.seq-nums').inner_text())
        linha.locator('[data-acao="concluir"]').click(); pg.wait_for_selector('.modal [data-l="salvar"]')
        msg = pg.locator('.modal').inner_text()
        ok(f'[{rot}] concluir com saldo abre o lançamento: programado 32,70, voos 32,17, desconto 0,53 no talhão', '32,70' in msg and '32,17' in msg and pg.locator('.modal [data-l="t-dsc"]').inner_text() == '0,53' and pg.is_checked('.modal [data-l="concluir"]'))
        pg.click('.modal [data-l="salvar"]'); pg.wait_for_timeout(300)
        linha = pg.locator('#seq-tab tr[data-os="o1"]')
        t = linha.inner_text()
        ok(f'[{rot}] concluída mantém saldo 0,53 marcado como obstáculo e barra em 98%', '0,53' in t and 'obstáculo' in t and '98%' in t and 'Concluída' in t)
        ok(f'[{rot}] quadro Concluídas mostra aplicado 32,17 e obst. 0,53', '32,17' in pg.locator('.seq-card.c-conc').inner_text() and 'obst. 0,53' in pg.locator('.seq-card.c-conc').inner_text())
        nums = pg.locator('.seq-nums').inner_text()
        ok(f'[{rot}] topo: programado 48,71 · aplicado 32,17 · obstáculos 0,53 · falta 16,01', all(x in nums for x in ['48,71', '32,17', '0,53', '16,01']))
        fe = pg.locator('.seq-fech').inner_text()
        ok(f'[{rot}] fechamento: programado 32,70 · aplicado 32,17 · obstáculo 0,53 · 98,4%', all(x in fe for x in ['32,70', '32,17', '0,53', '98,4%']))
        d = ds(); o1 = [o for o in d['ordens'] if o['id'] == 'o1'][0]
        ok(f'[{rot}] OS concluída; auditoria registra aplicado e obstáculo', o1['status'] == 'concluida' and any('obstáculo 0,53' in a['resumo'] for a in d['auditoria']))
        if SHOTS: pg.screenshot(path=str(SHOTS / f'{rot}-obstaculo.png'), full_page=True)
        # painel: obstáculos e restante
        ir('dashboard'); pg.wait_for_timeout(500); 
        pg.wait_for_selector('.destaque-lado')
        lado = pg.locator('.destaque-lado').inner_text()
        ok(f'[{rot}] painel mostra obstáculos 0,53 ha e restante 16,0', 'Obstáculos' in lado and '0,53' in lado and '16,0' in lado)
        # reabrir volta o saldo para "falta aplicar"
        ir('relatorios/sequencia'); pg.locator('#seq-tab tr[data-os="o1"] [data-acao="concluir"]').click(); pg.click('.modal [data-ok]'); pg.wait_for_timeout(300)
        ok(f'[{rot}] reabrir: obstáculo zera e falta volta a 16,54', '16,54' in pg.locator('.seq-nums').inner_text() and pg.locator('.seq-fech').count() == 0)
        ok(f'[{rot}] sem erros de JavaScript', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1440, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'iphone', True)
for s, n in res: print(f'{s}  {n}')
print(f"\n{sum(1 for s,_ in res if s=='PASSOU')}/{len(res)} verificações passaram")
sys.exit(0 if all(s == 'PASSOU' for s, _ in res) else 1)
