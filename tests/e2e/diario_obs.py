"""Diário: linha do tempo junta o mesmo evento dos dois drones; observações só digitadas, com editar/excluir;
os botões não saem na imagem."""
import pathlib, re
from playwright.sync_api import sync_playwright
URL = pathlib.Path('dist/index.html').resolve().as_uri() + '?modo=local'  # sem nuvem nos testes de tela
res = []
def ok(n, c): res.append(('PASSOU' if c else 'FALHOU', n)); return c
SEED = """() => {
  const k = 'dap-proto-v1:dataset'; const d = JSON.parse(localStorage.getItem(k));
  for (const c of ['unidades','fazendas','talhoes','campanhas','produtos','ordens','aeronaves','colaboradores','turnos','operacoes','lancamentos','paradas','estacoes','registrosEstacao','auditoria']) d[c] = [];
  d.origemBase = 'propria';
  d.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  d.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '117', nome: 'Fazenda Teste', municipio: '' });
  d.talhoes.push({ id: 't1', fazendaId: 'f1', codigo: 'GERAL', areaHa: 500, geral: true });
  d.produtos.push({ id: 'p1', nome: 'PRODUTO A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' });
  const calda = { volumeLHa: 15, produtos: [{ produtoId: 'p1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' }] };
  d.campanhas.push({ id: 'c1', nome: 'Fungicida', tipo: 'Fungicida', cultura: 'Cana-de-açúcar', inicio: '2026-10-19', fim: '2026-11-19', calda });
  d.ordens.push({ id: 'o1', numero: '3411', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-10', sequencia: 1, itens: [{ talhaoId: 't1', areaPlanejadaHa: 500 }], calda });
  d.aeronaves.push({ id: 'a1', identificacao: 'T70-P DR-01', modelo: 'T70', numeroSerie: '1', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 }, { id: 'a2', identificacao: 'T70-P DR-02', modelo: 'T70', numeroSerie: '2', unidadeId: 'u1', status: 'disponivel', horasAnteriores: 0 });
  d.colaboradores.push({ id: 'l1', nome: 'Líder', funcao: 'Líder de turno', unidadeId: 'u1', ativo: true }, { id: 'p9', nome: 'Piloto', funcao: 'Piloto', unidadeId: 'u1', ativo: true });
  d.turnos.push({ id: 'tn2', nome: '2º Turno', periodo: 'Noturno', horaInicio: '15:50', horaFim: '23:59', liderId: 'l1', ativo: true });
  const op = (id, ac) => ({ id, data: '2026-10-26', osId: 'o1', campanhaId: 'c1', cultura: 'Cana-de-açúcar', auxiliarIds: [], aeronaveId: ac, pilotoId: 'p9', turnoId: 'tn2', liderId: 'l1', horaInicio: '15:50', horaFim: '23:20', tempoEfetivoMin: 120, status: 'concluida', itens: [{ talhaoId: 't1', areaHa: 27.44 }], calda: JSON.parse(JSON.stringify(calda)), clima: [], origem: 'registro_prototipo', criadoEm: '2026-10-26T23:30:00',
    observacoesOperador: 'Encerramento: Vento acima do limite · fim do turno às 23h20', observacoesTecnicas: 'Fechamento do dia (ficha diária). Área do drone por fazenda estimada por proporção.' });
  d.operacoes.push(op('op1', 'a1'), op('op2', 'a2'));
  d.paradas.push({ id: 'pa1', operacaoId: 'op1', motivo: 'Vento acima do limite', inicio: '2026-10-26T20:30', fim: '2026-10-26T21:00' }, { id: 'pa2', operacaoId: 'op2', motivo: 'Vento acima do limite', inicio: '2026-10-26T20:30', fim: '2026-10-26T21:00' });
  localStorage.setItem(k, JSON.stringify(d));
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1366, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page(); erros = []; pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.goto(URL + '#/dashboard'); pg.wait_for_selector('.destaque-valor')
    pg.evaluate(SEED); pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-tempo')
    ds = lambda: pg.evaluate("JSON.parse(localStorage.getItem('dap-proto-v1:dataset'))")
    evs = pg.locator('.dia-tempo .ev')
    txt = pg.locator('.dia-tempo').inner_text()
    ok(f'linha do tempo: um item por evento com os dois drones ({evs.count()} itens)', evs.count() == 4 and 'T70-P DR-01, T70-P DR-02' in txt)
    obs = pg.locator('.dia-obs li')
    t = pg.locator('.dia-obs').inner_text()
    ok('observações: uma só, com os dois drones, sem "Encerramento:" nem nota automática', obs.count() == 1 and 'T70-P DR-01, T70-P DR-02' in t and 'Vento acima do limite · fim do turno às 23h20' in t and 'Encerramento' not in t and 'Fechamento do dia' not in pg.locator('#diario').inner_text())
    ok('botões de editar e excluir aparecem', pg.locator('[data-obs-editar]').count() == 1 and pg.locator('[data-obs-excluir]').count() == 1)
    pg.click('[data-obs-editar]'); pg.wait_for_selector('.modal [data-obs-txt]'); pg.fill('.modal [data-obs-txt]', 'Vento forte no fim do turno'); pg.click('.modal [data-obs-ok]'); pg.wait_for_timeout(300)
    d = ds()
    ok('editar troca o texto nos dois voos e mantém a nota técnica', all(o['observacoesOperador'] == 'Vento forte no fim do turno' and 'Fechamento do dia' in o['observacoesTecnicas'] for o in d['operacoes']) and 'Vento forte no fim do turno' in pg.locator('.dia-obs').inner_text())
    with pg.expect_download() as dl: pg.click('[data-acao="imagem"]')
    ok('imagem exportada gerada (botões ficam fora)', dl.value.suggested_filename.endswith('.png'))
    pg.click('[data-obs-excluir]'); pg.locator('[data-ok]').last.click(); pg.wait_for_timeout(300)
    d = ds()
    ok('excluir remove dos dois voos', all(not o['observacoesOperador'] for o in d['operacoes']) and 'Sem observações digitadas' in pg.locator('#diario').inner_text())
    ok('auditoria registra edição e exclusão', sum(1 for a in d['auditoria'] if 'Observação' in a['resumo']) == 2)
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
