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
    tempos = pg.locator('.dia-tempos').inner_text()
    ok(f'efetivo da operação conta os drones simultâneos uma vez (7h 00min; o somado por drone fica à parte): {tempos!r}', 'Efetivo da operação 7h 00min' in tempos.replace('\n', ' ') and 'Parado 30min' in tempos.replace('\n', ' ') and 'por drone (somado): efetivo 4h 00min' in tempos)
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
    # ---- linha do tempo: editar / excluir
    def ev_btn(tipo, n=0): return pg.locator(f'.dia-tempo .ev-{tipo}[data-ev-editar]').nth(n)
    ev_btn('pausa').click(); pg.wait_for_selector('.modal [data-ev-hora]')
    pg.fill('.modal [data-ev-hora]', '20:00'); pg.click('.modal [data-ev-ok]'); pg.wait_for_timeout(300)
    d = ds()
    ok('editar parada nos dois drones: 20:30 → 20:00 e tempo efetivo −30 min', all(x['inicio'].endswith('T20:00') for x in d['paradas']) and all(o['tempoEfetivoMin'] == 90 for o in d['operacoes']) and pg.locator('.dia-tempo .ev').count() == 4)
    ev_btn('pausa').click(); pg.wait_for_selector('.modal [data-ev-hora]')
    pg.fill('.modal [data-ev-hora]', '23:50'); pg.click('.modal [data-ev-ok]'); pg.wait_for_timeout(300)
    ok('hora fora do voo é recusada com mensagem', 'dentro do voo' in pg.locator('.modal').inner_text() and all(x['inicio'].endswith('T20:00') for x in ds()['paradas']))
    pg.uncheck('.modal [data-ev-ref="1"]'); pg.fill('.modal [data-ev-hora]', '19:00'); pg.select_option('.modal [data-ev-motivo]', 'Chuva'); pg.click('.modal [data-ev-ok]'); pg.wait_for_timeout(300)
    d = ds(); p1 = [x for x in d['paradas'] if x['operacaoId'] == 'op1'][0]; p2 = [x for x in d['paradas'] if x['operacaoId'] == 'op2'][0]
    ok('desmarcar um drone: só o DR-01 muda (19:00, Chuva); linha do tempo separa os eventos', p1['inicio'].endswith('T19:00') and p1['motivo'] == 'Chuva' and p2['inicio'].endswith('T20:00') and pg.locator('.dia-tempo .ev-pausa').count() == 2)
    pg.locator('.dia-tempo .ev-pausa[data-ev-editar]').nth(1).click(); pg.wait_for_selector('.modal [data-ev-excluir]')
    pg.click('.modal [data-ev-excluir]'); pg.locator('[data-ok]').last.click(); pg.wait_for_timeout(300)
    d = ds()
    ok('excluir a parada do DR-02: parada some e o efetivo volta (+60 min)', not any(x['operacaoId'] == 'op2' for x in d['paradas']) and [o for o in d['operacoes'] if o['id'] == 'op2'][0]['tempoEfetivoMin'] == 150)
    ev_btn('fim').click(); pg.wait_for_selector('.modal [data-ev-hora]'); pg.fill('.modal [data-ev-hora]', '23:00'); pg.click('.modal [data-ev-ok]'); pg.wait_for_timeout(300)
    ok('editar o fim do voo nos dois drones (23:20 → 23:00)', all(o['horaFim'] == '23:00' for o in ds()['operacoes']) and '23:00' in pg.locator('.dia-tempo').inner_text())
    ev_btn('inicio').click(); pg.wait_for_selector('.modal [data-ev-hora]')
    ok('início/fim do voo: sem "Excluir parada", com "Excluir voo"', pg.locator('.modal [data-ev-excluir]').count() == 0 and pg.locator('.modal [data-ev-excluir-voo]').count() == 1); pg.locator('.modal [data-fechar]').first.click()
    ok('auditoria registra as edições da linha do tempo', sum(1 for a in ds()['auditoria'] if 'Linha do tempo' in a['resumo'] or 'Parada excluída' in a['resumo']) == 4)
    # eventos intercalados (início e parada às 15:50 nos dois drones) também se juntam
    pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
      d.paradas.push({ id: 'pe1', operacaoId: 'op1', motivo: 'Problemas de equipe', inicio: '2026-10-26T15:50', fim: '2026-10-26T16:30', responsavel: '' }, { id: 'pe2', operacaoId: 'op2', motivo: 'Problemas de equipe', inicio: '2026-10-26T15:50', fim: '2026-10-26T16:30', responsavel: '' });
      localStorage.setItem(k, JSON.stringify(d)); }""")
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-tempo')
    ini = pg.locator('.dia-tempo .ev-inicio'); pe = pg.locator('.dia-tempo .ev-pausa', has_text='Problemas de equipe')
    ok('15:50: um "Início" e uma "Problemas de equipe" com os dois drones (antes saíam repetidos)', ini.count() == 1 and pe.count() == 1 and 'DR-01, T70-P DR-02' in pe.inner_text() and 'DR-01, T70-P DR-02' in ini.inner_text())
    ok('ordem no mesmo horário: início antes da parada', pg.evaluate("[...document.querySelectorAll('.dia-tempo .ev')].findIndex(e => e.classList.contains('ev-inicio')) < [...document.querySelectorAll('.dia-tempo .ev')].findIndex(e => e.classList.contains('ev-pausa'))"))
    ok('painel mostra a dica "toque num evento para editar"', 'toque num evento para editar' in pg.locator('#diario').inner_text())
    # ---- adicionar parada (v1.7.9)
    ef0 = {o['id']: o['tempoEfetivoMin'] for o in ds()['operacoes']}
    ok('botão "Adicionar parada" aparece', pg.locator('[data-ev-nova]').count() == 1)
    pg.click('[data-ev-nova]'); pg.wait_for_selector('.modal [data-np-hora]')
    ok('motivos novos na lista (Fim de tarefa, Troca de turno, Refeição/intervalo, Aguardando liberação)', all(pg.locator(f'.modal [data-np-motivo] option:text-is("{m}")').count() == 1 for m in ['Fim de tarefa', 'Troca de turno', 'Refeição/intervalo', 'Aguardando liberação']))
    pg.fill('.modal [data-np-hora]', '14:00'); pg.click('.modal [data-np-ok]'); pg.wait_for_timeout(200)
    ok('hora fora de qualquer voo é recusada', 'nenhum voo' in pg.locator('.modal').inner_text())
    pg.fill('.modal [data-np-hora]', '20:00'); pg.click('.modal [data-np-ok]'); pg.wait_for_timeout(200)
    ok('parada sobreposta a outra é recusada (DR-01 já parado 19:00–21:00) e nada é gravado', 'já existe parada' in pg.locator('.modal').inner_text() and len(ds()['paradas']) == 3)
    pg.fill('.modal [data-np-hora]', '22:30'); pg.select_option('.modal [data-np-motivo]', 'Fim de tarefa'); pg.fill('.modal [data-np-obs]', 'troca de turno'); pg.click('.modal [data-np-ok]'); pg.wait_for_timeout(300)
    d = ds(); novas = [x for x in d['paradas'] if x['motivo'] == 'Fim de tarefa']
    ok('retomada em branco: parada até o fim do voo (22:30–23:00) nos dois drones', len(novas) == 2 and all(x['inicio'].endswith('T22:30') and x['fim'].endswith('T23:00') and x.get('observacoes') == 'troca de turno' for x in novas))
    ok(f'efetivo de cada voo cai 30 min (sem ficar negativo; antes {ef0})', all(o['tempoEfetivoMin'] == max(0, ef0[o['id']] - 30) for o in d['operacoes']))
    fimT = pg.locator('.dia-tempo .ev-pausa', has_text='Fim de tarefa')
    ok('linha do tempo: um item "Fim de tarefa" com os dois drones e sem "Retomada" às 23:00', fimT.count() == 1 and 'DR-01, T70-P DR-02' in fimT.inner_text() and pg.locator('.dia-tempo .ev-retomada', has_text='23:00').count() == 0)
    pg.click('[data-ev-nova]'); pg.wait_for_selector('.modal [data-np-hora]')
    pg.uncheck('.modal [data-np-drone="a1"]'); pg.fill('.modal [data-np-hora]', '17:00'); pg.fill('.modal [data-np-ret]', '17:40'); pg.select_option('.modal [data-np-motivo]', 'Refeição/intervalo'); pg.click('.modal [data-np-ok]'); pg.wait_for_timeout(300)
    d = ds(); r = [x for x in d['paradas'] if x['motivo'] == 'Refeição/intervalo']
    ok('com retomada e só o DR-02: 17:00–17:40 e efetivo do DR-02 −40 min', len(r) == 1 and r[0]['operacaoId'] == 'op2' and r[0]['fim'].endswith('T17:40') and [o for o in d['operacoes'] if o['id'] == 'op2'][0]['tempoEfetivoMin'] == ef0['op2'] - 70 and pg.locator('.dia-tempo .ev-retomada', has_text='17:40').count() == 1)
    fimT.locator('xpath=.').click(); pg.wait_for_selector('.modal [data-ev-excluir]'); pg.click('.modal [data-ev-excluir]'); pg.locator('[data-ok]').last.click(); pg.wait_for_timeout(300)
    d = ds()
    ok('a parada adicionada pode ser excluída (efetivo do DR-01 volta)', not any(x['motivo'] == 'Fim de tarefa' for x in d['paradas']) and [o for o in d['operacoes'] if o['id'] == 'op1'][0]['tempoEfetivoMin'] == max(0, ef0['op1'] - 30) + 30)
    ok('auditoria registra as paradas adicionadas', sum(1 for a in d['auditoria'] if 'Parada adicionada' in a['resumo']) == 2)
    # ---- ordem no mesmo minuto e excluir voo (v1.7.11)
    pg.evaluate("""() => { const k='dap-proto-v1:dataset'; const d=JSON.parse(localStorage.getItem(k));
      const o = JSON.parse(JSON.stringify(d.operacoes.find(x => x.id === 'op1'))); o.id = 'op3'; o.horaInicio = '23:00'; o.horaFim = '23:40'; o.tempoEfetivoMin = 40; o.itens = [{ talhaoId: 't1', areaHa: 5 }];
      d.operacoes.push(o); localStorage.setItem(k, JSON.stringify(d)); }""")
    pg.goto('about:blank'); pg.goto(URL + '#/relatorios/diario'); pg.wait_for_selector('.dia-tempo')
    ordem = pg.evaluate("[...document.querySelectorAll('.dia-tempo .ev')].map(e => e.className.match(/ev-(\\w+)/)[1] + ' ' + e.querySelector('b').textContent)")
    ok(f'mesmo minuto: "Fim" do voo anterior antes do "Início" do seguinte ({ordem[-3:]})', ordem.index('fim 23:00') < ordem.index('inicio 23:00') and ordem[-1] == 'fim 23:40')
    pg.locator('.dia-tempo .ev-inicio', has_text='23:00').click(); pg.wait_for_selector('.modal [data-ev-excluir-voo]')
    pg.click('.modal [data-ev-excluir-voo]'); pg.wait_for_selector('.modal [data-ev-ok2]')
    ok('confirmação mostra o voo e a área (5,00 ha)', '23:00–23:40' in pg.locator('.modal').inner_text() and '5,00' in pg.locator('.modal').inner_text())
    pg.click('.modal [data-ev-ok2]'); pg.wait_for_timeout(200)
    ok('sem motivo não exclui', 'motivo' in pg.locator('.modal').inner_text().lower() and any(o['id'] == 'op3' for o in ds()['operacoes']))
    pg.fill('.modal [data-ev-mot]', 'lançado em dobro'); pg.click('.modal [data-ev-ok2]'); pg.wait_for_timeout(300)
    d = ds()
    ok('excluir voo: some o voo (op3), os outros ficam, auditoria com motivo e o antes', not any(o['id'] == 'op3' for o in d['operacoes']) and len(d['operacoes']) == 2 and any('Voo excluído' in a['resumo'] and a.get('motivo') == 'lançado em dobro' and a.get('antes') for a in d['auditoria']) and '23:40' not in pg.locator('.dia-tempo').inner_text())
    ok('sem erros de página', not erros)
    b.close()
for r, n in res: print(r, n)
print(f"{sum(1 for r, _ in res if r == 'PASSOU')}/{len(res)} passaram")
