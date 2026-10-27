"""Checape do painel: período que começa antes da campanha não pode diluir o ritmo nem a meta; dias parados por clima
aparecem no cartão; botão Exportar imagem gera um PNG do painel."""
import sys, pathlib, re, datetime, struct
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c

def rodar(vp, rot, mobile=False):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
        pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.clock.set_fixed_time(datetime.datetime(2026, 10, 23, 12, 0))
        def ir(h): pg.goto(URL + '#/' + h); pg.wait_for_timeout(300)
        pg.goto(URL); pg.wait_for_selector('.destaque-valor')
        ir('configuracoes'); pg.click('[data-acao="base-propria"]'); pg.click('[data-ok]'); pg.wait_for_url(re.compile('#/fazendas')); pg.wait_for_selector('#fz-tab')
        pg.evaluate("""() => {
          const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
          d.unidades.push({ id: 'u1', nome: 'Unidade T', codigo: 'UT', municipio: '' });
          d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Fazenda Teste I', municipio: '' });
          d.talhoes.push({ id: 't1', fazendaId: 'f1', codigo: 'GERAL', areaHa: 843.9, geral: true });
          d.produtos.push({ id: 'p1', nome: 'PRODUTO A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
          const calda = { volumeLHa: 15, produtos: [{ produtoId: 'p1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
          d.campanhas.push({ id: 'c1', nome: 'Fungicida Teste', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-19', fim: '2026-11-19', calda });
          d.ordens.push({ id: 'o1', numero: '3410', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 1, itens: [{ talhaoId: 't1', areaPlanejadaHa: 843.9 }], calda });
          d.aeronaves.push({ id: 'a1', identificacao: 'T70 A', modelo: 'Agras T70', numeroSerie: 'X1', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 });
          d.colaboradores.push({ id: 'l1', nome: 'Líder', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'p9', nome: 'Piloto', funcao: 'Piloto', unidadeId: 'u1', ativo: true });
          d.turnos.push({ id: 'tn1', nome: 'Turno A', periodo: 'Diurno', horaInicio: '06:00', horaFim: '18:00', liderId: 'l1', ativo: true });
          const op = (id, data, a) => ({ id, data, osId: 'o1', campanhaId: 'c1', cultura: 'Cana-de-açúcar', auxiliarIds: [], aeronaveId: 'a1', pilotoId: 'p9', turnoId: 'tn1', liderId: 'l1', horaInicio: '07:00', horaFim: '15:00', tempoEfetivoMin: 400, status: 'concluida', itens: [{ talhaoId: 't1', areaHa: a }], calda: JSON.parse(JSON.stringify(calda)), clima: [], origem: 'registro_prototipo', criadoEm: data + 'T15:00:00' });
          d.operacoes.push(op('op1', '2026-10-19', 100), op('op2', '2026-10-20', 100));
          d.diasParados = [{ id: 'dp1', data: '2026-10-21', motivo: 'Chuva', campanhaIds: ['c1'], criadoEm: '2026-10-21T10:00:00' }, { id: 'dp2', data: '2026-10-22', motivo: 'Vento acima do limite', campanhaIds: ['c1'], criadoEm: '2026-10-22T10:00:00' }];
          localStorage.setItem(k, JSON.stringify(d));
        }""")
        ir('dashboard'); pg.reload(); pg.wait_for_selector('.destaque-lado')
        if mobile: pg.click('#dash-filtros .filtros-toggle'); pg.wait_for_timeout(200)
        pg.fill('#dash-filtros [data-f="de"]', '2026-09-22'); pg.dispatch_event('#dash-filtros [data-f="de"]', 'change')
        pg.fill('#dash-filtros [data-f="ate"]', '2026-10-23'); pg.dispatch_event('#dash-filtros [data-f="ate"]', 'change'); pg.wait_for_timeout(400)
        pv = pg.locator('.previsao').inner_text()
        ok(f'[{rot}] janela do ritmo começa em 19/10 (início da campanha), não em 22/09', '5 (19/10/2026 a 23/10/2026)' in pv and 'começa no início da campanha' in pv)
        ok(f'[{rot}] ritmo corrido 40,0 ha/dia (200 ÷ 5), não 6,5', '40,0 ha/dia' in pv)
        ok(f'[{rot}] previsão dentro do prazo (sem o falso atraso de 72 dias)', 'Dentro do prazo' in pv and 'Atraso' not in pv)
        lado = pg.locator('.destaque-lado').inner_text()
        ok(f'[{rot}] meta do período conta a partir de 19/10', 'meta conta a partir de 19/10/2026' in lado)
        g = pg.locator('#g-dia').inner_html()
        ok(f'[{rot}] período longo (32 dias): só ícones nos dias parados, motivo no detalhe; antes da campanha e hoje sem marca', g.count('fill="#fdeedd"') == 2 and '>Chuva<' not in g and 'Dia sem aplicação' in g and 'Chuva' in g and 'Vento acima do limite' in g and 'Sem registro' not in g and 'Sem aplicação (motivo)' in pg.locator('#g-dia').locator('xpath=ancestor::section[1]').inner_text())
        pg.fill('#dash-filtros [data-f="de"]', '2026-10-14'); pg.dispatch_event('#dash-filtros [data-f="de"]', 'change'); pg.wait_for_timeout(400)
        g = pg.locator('#g-dia').inner_html()
        ok(f'[{rot}] período curto: motivo escrito embaixo da data (Chuva, Vento)', '>Chuva<' in g and '>Vento<' in g)
        pg.fill('#dash-filtros [data-f="de"]', '2026-09-22'); pg.dispatch_event('#dash-filtros [data-f="de"]', 'change'); pg.wait_for_timeout(400)
        ok(f'[{rot}] cartão de clima mostra 2 dias sem aplicação por clima', '2 dia(s) sem aplicação por clima' in pg.locator('.kpis').last.inner_text() or '2 dia(s) sem aplicação por clima' in pg.locator('#dash-corpo').inner_text())
        prev_painel = re.search(r'(\d\d/\d\d/\d{4})', pg.locator('.prev-principal').inner_text()).group(1)
        # mesma conta no Planejamento (antes: últimos 14 dias incluindo dias antes da campanha)
        ir('planejamento'); pg.wait_for_selector('.plan-c')
        pc = pg.locator('.plan-c').first.inner_text()
        cel = pg.locator('.plan-c .dias-celulas').first.inner_text().replace('\n', ' ')
        ok(f'[{rot}] Planejamento: um quadro por dia com área ou motivo ({cel})', all(x in cel for x in ['19/10 100,0 ha', '21/10 Chuva', '22/10 Vento', '23/10 hoje']))
        ok(f'[{rot}] Planejamento usa o mesmo ritmo (40,0 ha/dia) e a mesma data do painel ({prev_painel})', '40,0 ha/dia' in pc and prev_painel in pc and prev_painel == '09/11/2026')
        ok(f'[{rot}] aplicado igual nas 3 telas: painel, campanha e safra = 200,0 ha', '200,0 ha' in pc and '200,0 ha' in pg.locator('[data-safra]').inner_text())
        ir('dashboard'); pg.wait_for_selector('.destaque-lado')
        with pg.expect_download() as dl: pg.click('[data-acao="exportar-imagem"]')
        d = dl.value; caminho = d.path(); dados = open(caminho, 'rb').read()
        w, h = struct.unpack('>II', dados[16:24]) if dados[:8] == b'\x89PNG\r\n\x1a\n' else (0, 0)
        ok(f'[{rot}] Exportar imagem baixa um PNG ({w}×{h}) com nome do período', d.suggested_filename == 'dashboard-2026-09-22-a-2026-10-23.png' and w == 2 * pg.evaluate("Math.ceil(document.querySelector('#dash-corpo').getBoundingClientRect().width) + (document.documentElement.clientWidth < 700 ? 28 : 56)") // 2 * (3 if mobile else 2) and h > 1000)
        if SHOTS: d.save_as(str(SHOTS / f'{rot}-dashboard-exportado.png'))
        # termina na linha "Evolução × semana": altura ≈ do topo do painel até o fim desse bloco (+ cabeçalho), nada abaixo
        fim = pg.evaluate("(() => { const c = document.querySelector('#dash-corpo'); const ev = document.querySelector('#g-evolucao').closest('.cartao'), se = document.querySelector('#g-semana').closest('.cartao'); return Math.max(ev.getBoundingClientRect().bottom, se.getBoundingClientRect().bottom) - c.getBoundingClientRect().top; })()")
        esc_ = 3 if mobile else 2
        ok(f'[{rot}] imagem termina no bloco Evolução/Semana (altura {h // esc_} px; na tela esse bloco termina em {round(fim)} px, letras maiores na imagem)', fim < h / esc_ < fim * 1.25 + 260 and h / esc_ < pg.evaluate("document.querySelector('#dash-corpo').scrollHeight"))
        ok(f'[{rot}] sem erros de página', not erros)
        if erros: print(erros)
        b.close()

rodar({'width': 1366, 'height': 900}, 'desktop')
rodar({'width': 390, 'height': 844}, 'mobile', True)
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
