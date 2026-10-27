import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeDiv, duracaoTotalMin, duracaoParadaMin, areaRestante, percentualExecutado, produtividadeEfetiva,
  produtividadeOperacional, alertasExcesso, aplicadoPorItem, quantidadeTotal, volumeTotalCalda, inicioSemana,
  hhmmParaMin, desvioDosePct, areaOperacao,
} from '../src/domain/calc';
import { validarEtapa1, validarEtapa3, validarEtapa5, deslocamentoMin, paradaParaISO, avaliarLeitura, type RascunhoAplicacao, type ContextoValidacao } from '../src/domain/validation';
import { gerarDemo } from '../src/data/demo';
import { calcularIndicadores, criarIndices, filtrarOperacoes, type Filtros } from '../src/domain/analytics';

test('safeDiv protege divisão por zero, negativa e inválida', () => {
  assert.equal(safeDiv(10, 2), 5);
  assert.equal(safeDiv(10, 0), null);
  assert.equal(safeDiv(10, -1), null);
  assert.equal(safeDiv(NaN, 2), null);
  assert.equal(safeDiv(10, Infinity), null);
});

test('duração total trata virada da meia-noite', () => {
  assert.equal(duracaoTotalMin('18:00', '22:30'), 270);
  assert.equal(duracaoTotalMin('19:00', '02:00'), 420);
  assert.equal(duracaoTotalMin('19:00', null), null);
  assert.equal(duracaoTotalMin('25:00', '02:00'), null);
  assert.equal(hhmmParaMin('7:05'), 425);
});

test('duração de parada: aberta ou invertida → null', () => {
  assert.equal(duracaoParadaMin({ inicio: '2026-10-01T23:40', fim: '2026-10-02T00:10' }), 30);
  assert.equal(duracaoParadaMin({ inicio: '2026-10-01T23:40', fim: null }), null);
  assert.equal(duracaoParadaMin({ inicio: '2026-10-01T23:40', fim: '2026-10-01T23:00' }), null);
});

test('área restante e percentual executado', () => {
  assert.equal(areaRestante(100, 30), 70);
  assert.equal(areaRestante(100, 110), -10); // excesso preservado, não corrigido
  assert.equal(percentualExecutado(30, 100), 30);
  assert.equal(percentualExecutado(30, 0), null);
});

test('produtividade efetiva e operacional separadas', () => {
  assert.equal(produtividadeEfetiva(60, 240), 15); // 60 ha em 4 h efetivas
  assert.equal(produtividadeOperacional(60, 360), 10); // 60 ha em 6 h totais
  assert.equal(produtividadeEfetiva(60, 0), null);
});

test('mesma área não é somada duas vezes; excesso só é sinalizado', () => {
  const ordens = [{ id: 'os1', itens: [{ talhaoId: 't1', areaPlanejadaHa: 20 }, { talhaoId: 't2', areaPlanejadaHa: 10 }] }];
  const ops = [
    { osId: 'os1', itens: [{ talhaoId: 't1', areaHa: 12 }] },
    { osId: 'os1', itens: [{ talhaoId: 't1', areaHa: 8 }, { talhaoId: 't2', areaHa: 11 }] },
  ];
  const m = aplicadoPorItem(ops);
  assert.equal(m.get('os1|t1'), 20);
  assert.equal(m.get('os1|t2'), 11);
  const al = alertasExcesso(ordens, ops);
  assert.equal(al.length, 1);
  assert.equal(al[0].talhaoId, 't2');
  assert.ok(Math.abs(al[0].excessoHa - 1) < 1e-9);
  assert.equal(ops[1].itens[1].areaHa, 11, 'dados não são alterados');
});

test('dose, volume de calda e quantidade total não se misturam', () => {
  assert.deepEqual(quantidadeTotal(0.4, 'L/ha', 50), { valor: 20, unidade: 'L' });
  assert.deepEqual(quantidadeTotal(50, 'mL/ha', 100), { valor: 5, unidade: 'L' });
  assert.deepEqual(quantidadeTotal(200, 'g/ha', 10), { valor: 2, unidade: 'kg' });
  assert.equal(quantidadeTotal(-1, 'L/ha', 10), null);
  assert.equal(volumeTotalCalda(20, 50), 1000);
  assert.ok(Math.abs((desvioDosePct(0.4, 0.448) ?? 0) - 12) < 1e-9);
  assert.equal(desvioDosePct(0, 1), null);
});

test('semana começa na segunda-feira', () => {
  assert.equal(inicioSemana('2026-10-18'), '2026-10-12'); // domingo → segunda anterior
  assert.equal(inicioSemana('2026-10-19'), '2026-10-19'); // segunda
});

const ctx: ContextoValidacao = {
  hoje: '2026-10-20',
  areaTalhao: () => 20,
  saldoItem: () => 15,
  limites: { ventoMaxKmh: 10, ventoMinKmh: 2, umidadeMinPct: 55, temperaturaMaxC: 30 },
};
function rascunho(p: Partial<RascunhoAplicacao> = {}): RascunhoAplicacao {
  return {
    data: '2026-10-19', horaInicio: '19:00', unidadeId: 'u', fazendaId: 'f', osId: 'os', campanhaId: 'c', cultura: 'Cana', turnoId: 'tn', liderId: 'ld',
    itens: [{ talhaoId: 't1', areaHa: 10 }], aeronaveId: 'a', pilotoId: 'p', auxiliarIds: [], equipamentosAuxiliares: '',
    volumeLHa: 20, produtos: [{ produtoId: 'x', dosePlanejada: 0.4, doseReal: 0.41, unidade: 'L/ha', lote: '' }],
    velocidadeMs: null, alturaVooM: null, faixaM: null, observacoesTecnicas: '', clima: [],
    horaFim: '01:00', tempoEfetivoMin: 240, paradas: [], observacoesOperador: '', responsavelEncerramento: 'Fulano', ...p,
  };
}

test('validação: data futura, talhão repetido', () => {
  assert.equal(validarEtapa1(rascunho({ data: '2026-12-01' }), ctx).erros.length, 1);
  assert.ok(validarEtapa1(rascunho({ itens: [{ talhaoId: 't1', areaHa: 1 }, { talhaoId: 't1', areaHa: 2 }] }), ctx).erros.some((e) => e.campo === 'itens'));
  assert.equal(validarEtapa1(rascunho(), ctx).erros.length, 0);
});

test('validação: área negativa bloqueia; excesso de saldo só avisa', () => {
  assert.ok(validarEtapa3(rascunho({ itens: [{ talhaoId: 't1', areaHa: -2 }] }), ctx).erros.length > 0);
  const r = validarEtapa3(rascunho({ itens: [{ talhaoId: 't1', areaHa: 18 }] }), ctx);
  assert.equal(r.erros.length, 0);
  assert.ok(r.avisos.some((a) => a.msg.includes('saldo')));
});

test('validação: tempo efetivo + paradas não pode exceder o total', () => {
  // 19:00 → 01:00 = 360 min; efetivo 300 + parada 90 = 390 > 360
  const r = validarEtapa5(rascunho({ tempoEfetivoMin: 300, paradas: [{ motivo: 'Chuva', inicio: '23:30', fim: '01:00', observacoes: '' }] }));
  assert.ok(r.erros.some((e) => e.campo === 'tempoEfetivoMin'));
  const ok = validarEtapa5(rascunho({ tempoEfetivoMin: 240, paradas: [{ motivo: 'Chuva', inicio: '23:30', fim: '00:30', observacoes: '' }] }));
  assert.equal(ok.erros.length, 0);
  assert.equal(deslocamentoMin('19:00', '00:30'), 330);
  assert.equal(paradaParaISO('2026-10-19', '19:00', '00:30'), '2026-10-20T00:30');
});

test('leitura climática: lista o que está fora dos limites, sem declarar "seguro"', () => {
  const fora = avaliarLeitura({ momento: 'inicio', hora: '19:00', temperaturaC: 25, umidadePct: 50, ventoKmh: 12, rajadaKmh: 15, direcaoVento: 'N', chuva: 'sem chuva', orvalho: false, origem: 'x' }, ctx.limites);
  assert.equal(fora.length, 3);
});

test('dados de demonstração são determinísticos e consistentes', () => {
  const a = gerarDemo();
  const b = gerarDemo();
  assert.equal(JSON.stringify({ ...a, geradoEm: '' }), JSON.stringify({ ...b, geradoEm: '' }));
  assert.ok(a.operacoes.length > 50);
  const talhoes = new Set(a.talhoes.map((t) => t.id));
  for (const op of a.operacoes) {
    for (const it of op.itens) { assert.ok(talhoes.has(it.talhaoId)); assert.ok(it.areaHa > 0); }
    if (op.status === 'impedida_clima') assert.equal(areaOperacao(op), 0);
    const total = duracaoTotalMin(op.horaInicio, op.horaFim)!;
    const parado = a.paradas.filter((p) => p.operacaoId === op.id).reduce((s, p) => s + (duracaoParadaMin(p) ?? 0), 0);
    assert.ok(op.tempoEfetivoMin + parado <= total, `tempos inconsistentes em ${op.id}`);
  }
});

test('indicadores: acumulado = soma dos itens; alerta intencional presente', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const f: Filtros = { de: '2026-09-14', ate: '2026-10-19', campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  const ind = calcularIndicadores(ds, f, idx);
  const soma = filtrarOperacoes(ds, f, idx).reduce((s, o) => s + areaOperacao(o), 0);
  assert.ok(Math.abs(ind.areaPeriodo - soma) < 1e-6);
  assert.ok(Math.abs(ind.areaRestante - (ind.areaPlanejada - ind.areaAcumulada)) < 1e-6);
  assert.ok(ind.alertas.length >= 1);
  assert.ok(ind.minEfetivo + ind.minParado <= ind.minTotal);
  const vazio = calcularIndicadores(ds, { ...f, de: '2030-01-01', ate: '2030-01-02' }, idx);
  assert.equal(vazio.prodEfetiva, null);
  assert.equal(vazio.haPorDia, null);
});

test('turnos: toda operação tem turno e líder válidos; filtro por turno particiona a área', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const turnos = new Set(ds.turnos.map((t) => t.id));
  const lideres = new Set(ds.colaboradores.filter((c) => c.funcao === 'Líder de turno').map((c) => c.id));
  for (const op of ds.operacoes) { assert.ok(turnos.has(op.turnoId)); assert.ok(lideres.has(op.liderId)); }
  const f: Filtros = { de: '2026-09-14', ate: '2026-10-19', campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  const total = calcularIndicadores(ds, f, idx).areaPeriodo;
  const soma = ds.turnos.reduce((s, t) => s + calcularIndicadores(ds, { ...f, turnoId: t.id }, idx).areaPeriodo, 0);
  assert.ok(Math.abs(total - soma) < 1e-6, 'soma por turno = total (sem dupla contagem)');
});

import { META_PADRAO, metaDiaria, metaSemanal, metaPorSemana, metaPorDia, metaAcumulada, haPorTurnoDrone, validarMeta } from '../src/domain/metas';

test('meta: reproduz a prévia por drone (32 ha/h → 192 ha/turno → 1.344 ha/semana)', () => {
  assert.equal(haPorTurnoDrone(META_PADRAO), 192);
  assert.equal(metaDiaria(META_PADRAO, { umDrone: true, umTurno: false }), 192);
  assert.equal(metaSemanal(META_PADRAO, { umDrone: true, umTurno: false }), 1344);
});

test('meta: 2 drones em 2 turnos (1 drone por turno) = 384 ha/dia e 2.688 ha/semana', () => {
  assert.equal(metaDiaria(META_PADRAO), 384);
  assert.equal(metaSemanal(META_PADRAO), 2688);
  assert.equal(metaDiaria(META_PADRAO, { umDrone: false, umTurno: true }), 192);
  const ambos = { ...META_PADRAO, dronesPorTurno: 2 }; // os 2 drones voando nos 2 turnos
  assert.equal(metaDiaria(ambos), 768);
  assert.equal(metaSemanal(ambos), 5376);
  assert.equal(metaSemanal(ambos, { umDrone: true, umTurno: false }), 2688);
});

test('meta: semanas parciais são proporcionais; acumulado limitado ao planejado', () => {
  const s = metaPorSemana(META_PADRAO, '2026-09-14', '2026-10-19');
  assert.equal(s[0].meta, 2688);
  assert.equal(s.at(-1)!.diasNoPeriodo, 1);
  assert.equal(s.at(-1)!.meta, 384);
  const total = s.reduce((a, x) => a + x.meta, 0);
  assert.ok(Math.abs(total - metaPorDia(META_PADRAO, '2026-09-14', '2026-10-19').reduce((a, x) => a + x.meta, 0)) < 1e-6);
  const seis = metaPorDia({ ...META_PADRAO, diasPorSemana: 6 }, '2026-10-12', '2026-10-18');
  assert.ok(Math.abs(seis.reduce((a, x) => a + x.meta, 0) - 384 * 6) < 1e-6);
  const acc = metaAcumulada(META_PADRAO, '2026-09-14', '2026-10-19', 1000);
  assert.equal(acc[0], 384); assert.equal(acc.at(-1), 1000);
});

test('meta: validação dos parâmetros', () => {
  assert.equal(validarMeta(META_PADRAO).length, 0);
  assert.ok(validarMeta({ ...META_PADRAO, dronesPorTurno: 3 }).length > 0);
  assert.ok(validarMeta({ ...META_PADRAO, haHoraDrone: 0 }).length > 0);
  assert.ok(validarMeta({ ...META_PADRAO, horasEfetivasTurno: 13 }).length > 0);
});

import { preverTermino, ritmoNecessario, diasEntre } from '../src/domain/previsao';

test('previsão: ritmo constante → data exata, sem faixa de incerteza', () => {
  const r = preverTermino(1000, Array(10).fill(100), '2026-10-19');
  assert.equal(r.ritmoCorrido, 100);
  assert.equal(r.diasNecessarios, 10);
  assert.equal(r.data, '2026-10-29');
  assert.equal(r.faixa!.otimista.dias, 10);
  assert.equal(r.faixa!.pessimista!.dias, 10);
});

test('previsão: dias sem aplicação contam no calendário', () => {
  const r = preverTermino(1000, [200, 0, 200, 0, 200, 0, 200, 0, 200, 0], '2026-10-19');
  assert.equal(r.mediaPorDiaAplicacao, 200);
  assert.equal(r.fracDiasAplicacao, 0.5);
  assert.equal(r.ritmoCorrido, 100);
  assert.equal(r.diasNecessarios, 10);
  assert.ok(r.faixa!.otimista.dias < 10 && r.faixa!.pessimista!.dias > 10, 'variabilidade gera faixa');
});

test('previsão: concluída, sem ritmo e arredondamento para cima', () => {
  assert.equal(preverTermino(0, [100], '2026-10-19').concluida, true);
  const s = preverTermino(500, [0, 0, 0], '2026-10-19');
  assert.equal(s.semRitmo, true); assert.equal(s.data, null);
  assert.equal(preverTermino(1001, Array(5).fill(100), '2026-10-19').diasNecessarios, 11);
});

test('previsão: ritmo necessário até o prazo', () => {
  assert.equal(diasEntre('2026-10-19', '2026-11-15'), 27);
  assert.ok(Math.abs(ritmoNecessario(2700, '2026-10-19', '2026-11-15')! - 100) < 1e-9);
  assert.equal(ritmoNecessario(100, '2026-10-19', '2026-10-01'), null);
  assert.equal(ritmoNecessario(0, '2026-10-19', '2026-10-01'), 0);
});

import { resumoDia, datasComOperacao } from '../src/domain/diario';

test('diário: totais do dia batem com os registros e não duplicam área', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const f = { turnoId: '', liderId: '', campanhaId: '' };
  const datas = datasComOperacao(ds, f);
  for (const d of datas) {
    const r = resumoDia(ds, idx, d, f);
    const soma = ds.operacoes.filter((o) => o.data === d).reduce((s, o) => s + areaOperacao(o), 0);
    assert.ok(Math.abs(r.areaDia - soma) < 1e-6, `área do dia ${d}`);
    assert.ok(Math.abs(r.fazendas.reduce((s, x) => s + x.area, 0) - r.areaDia) < 1e-6, `fazendas ${d}`);
    assert.ok(Math.abs(r.porAeronave.reduce((s, x) => s + x.area, 0) - r.areaDia) < 1e-6, `drones ${d}`);
    assert.ok(r.acumuladoAteDia >= r.areaDia - 1e-6);
    for (let i = 1; i < r.eventos.length; i++) assert.ok(r.eventos[i].minutoAbs >= r.eventos[i - 1].minutoAbs, 'linha do tempo ordenada');
  }
  // filtro por turno particiona o dia
  const d = datas[10];
  const total = resumoDia(ds, idx, d, f).areaDia;
  const porTurno = ds.turnos.reduce((s, t) => s + resumoDia(ds, idx, d, { ...f, turnoId: t.id }).areaDia, 0);
  assert.ok(Math.abs(total - porTurno) < 1e-6);
});

import { boletimVazio, iniciar, pausar, retomar, mudarArea, finalizar, reabrir, metricasDrone, fecharBoletim, type DroneCampo } from '../src/domain/boletim';

function droneNovo(ac = 'ac-1', pil = 'pl-1'): DroneCampo { return { chave: 'd1', aeronaveId: ac, pilotoId: pil, auxiliarIds: [], estado: 'aguardando', trechos: [] }; }

test('boletim: estados do drone e tempo efetivo calculado (sem digitar)', () => {
  const d = droneNovo();
  assert.equal(pausar(d, 'Chuva', '19:00'), 'Só é possível pausar um drone em aplicação.');
  assert.equal(iniciar(d, 'os-1', '18:00'), null);
  assert.equal(pausar(d, 'Vento acima do limite', '19:00'), null);
  assert.equal(retomar(d, '19:40'), null);
  assert.equal(mudarArea(d, 'os-2', '22:00'), null);
  assert.equal(pausar(d, 'Abastecimento/reabastecimento', '23:50'), null);
  assert.equal(finalizar(d, '00:30'), null); // fecha a pausa aberta e cruza a meia-noite
  assert.equal(d.trechos.length, 2);
  assert.equal(d.trechos[1].pausas[0].fim, '00:30');
  const m = metricasDrone(d);
  assert.equal(m.total, 390); // 18:00 → 00:30
  assert.equal(m.parado, 40 + 40);
  assert.equal(m.efetivo, 310);
  assert.equal(reabrir(d), null); assert.equal(d.estado, 'aplicando');
});

test('boletim: fechar gera 1 operação por trecho, com paradas e sem duplicar área', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const osA = ds.ordens.find((o) => o.status === 'aberta')!;
  const osB = ds.ordens.find((o) => o.status === 'aberta' && o.id !== osA.id && o.campanhaId === osA.campanhaId) ?? ds.ordens.find((o) => o.status === 'em_execucao')!;
  const b = boletimVazio('2026-10-20');
  Object.assign(b, { turnoId: 'tn-a', liderId: 'ld-1', responsavel: 'Joana Ribeiro' });
  const d = droneNovo();
  iniciar(d, osA.id, '18:00'); pausar(d, 'Vento acima do limite', '19:00'); retomar(d, '19:30');
  d.trechos[0].itens.push({ talhaoId: osA.itens[0].talhaoId, areaHa: 20 });
  mudarArea(d, osB.id, '21:00');
  d.trechos[1].itens.push({ talhaoId: osB.itens[0].talhaoId, areaHa: 10 });
  finalizar(d, '01:00');
  b.drones.push(d);
  b.clima.push({ momento: 'inicio', hora: '18:00', temperaturaC: 24, umidadePct: 70, ventoKmh: 6, rajadaKmh: 8, direcaoVento: 'N', chuva: 'sem chuva', orvalho: false, origem: 'Estação portátil' });
  let n = 0;
  const ctx = { hoje: '2026-10-21', areaTalhao: () => 100, saldoItem: () => 100, limites: ds.limites };
  const r = fecharBoletim(b, ds, idx, ctx, (p) => `${p}-${++n}`, '2026-10-21T01:05:00');
  assert.deepEqual(r.erros, []);
  assert.equal(r.ops.length, 2);
  assert.equal(r.ops[0].tempoEfetivoMin, 180 - 30);
  assert.equal(r.ops[1].horaInicio, '21:00'); assert.equal(r.ops[1].horaFim, '01:00');
  assert.equal(r.ops[1].tempoEfetivoMin, 240);
  assert.equal(r.paradas.length, 1);
  assert.equal(r.paradas[0].operacaoId, r.ops[0].id);
  assert.equal(r.ops.reduce((s, o) => s + areaOperacao(o), 0), 30);
  assert.equal(r.ops.reduce((s, o) => s + o.clima.length, 0), 1, 'leitura não é duplicada entre operações');
});

test('boletim: bloqueios — drone não finalizado, sem área, impedida por clima é aceita', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const os = ds.ordens.find((o) => o.status === 'aberta')!;
  const ctx = { hoje: '2026-10-21', areaTalhao: () => 100, saldoItem: () => 100, limites: ds.limites };
  const base = () => Object.assign(boletimVazio('2026-10-20'), { turnoId: 'tn-a', liderId: 'ld-1', responsavel: 'X' });
  const b1 = base(); const d1 = droneNovo(); iniciar(d1, os.id, '18:00'); b1.drones.push(d1);
  assert.ok(fecharBoletim(b1, ds, idx, ctx, (p) => p + Math.random(), '').erros.some((e) => e.msg.includes('finalize')));
  const b2 = base(); const d2 = droneNovo(); iniciar(d2, os.id, '18:00'); finalizar(d2, '20:00'); b2.drones.push(d2);
  assert.ok(fecharBoletim(b2, ds, idx, ctx, (p) => p + Math.random(), '').erros.some((e) => e.msg.includes('área')));
  const b3 = base(); const d3 = droneNovo(); iniciar(d3, os.id, '18:00'); pausar(d3, 'Chuva', '18:05'); finalizar(d3, '20:00'); b3.drones.push(d3);
  const r3 = fecharBoletim(b3, ds, idx, ctx, (p) => p + Math.random(), '');
  assert.deepEqual(r3.erros, []);
  assert.equal(r3.ops[0].status, 'impedida_clima');
  const b4 = base(); b4.drones.push(droneNovo('ac-1'), { ...droneNovo('ac-1'), chave: 'd2' });
  assert.ok(fecharBoletim(b4, ds, idx, ctx, (p) => p, '').erros.some((e) => e.msg.includes('duas vezes')));
});

test('boletim: avisa possível duplicidade com operação já gravada', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const ex = ds.operacoes.find((o) => o.itens.length > 0)!;
  const b = Object.assign(boletimVazio(ex.data), { turnoId: 'tn-a', liderId: 'ld-1', responsavel: 'X' });
  const d = droneNovo(ex.aeronaveId, ex.pilotoId);
  iniciar(d, ex.osId, ex.horaInicio); d.trechos[0].itens.push({ talhaoId: ex.itens[0].talhaoId, areaHa: 1 }); finalizar(d, ex.horaFim!);
  b.drones.push(d);
  const r = fecharBoletim(b, ds, idx, { hoje: '2026-10-21', areaTalhao: () => 100, saldoItem: () => 100, limites: ds.limites }, (p) => p + Math.random(), '');
  assert.ok(r.avisos.some((a) => a.msg.includes('duplicidade')));
});

import { numeroBR, lerSequencia, importarSequencia, lerTalhoes, importarTalhoes, EXEMPLO_SEQUENCIA } from '../src/domain/importacao';
import { migrar, recalcularStatusOS, referencias, baseVazia, VERSAO_ESQUEMA } from '../src/domain/base';

test('importação: números com ponto ou vírgula', () => {
  assert.equal(numeroBR('268,45'), 268.45);
  assert.equal(numeroBR('181.31'), 181.31);
  assert.equal(numeroBR('1.234,56'), 1234.56);
  assert.equal(numeroBR('1,234.5'), 1234.5);
  assert.equal(numeroBR('2.288,21 ha'), 2288.21);
  assert.equal(numeroBR(''), null);
  assert.equal(numeroBR('abc'), null);
});

test('importação: lê a tabela no formato do app atual (tab, cabeçalho, total, OS com barra)', () => {
  const r = lerSequencia(EXEMPLO_SEQUENCIA);
  assert.equal(r.linhas.length, 3);
  assert.deepEqual(r.ignoradas.map((x) => x.motivo), ['cabeçalho', 'linha de total']);
  assert.equal(r.linhas[1].os, '4102/4103');
  assert.equal(r.linhas[2].area, 181.31);
  assert.deepEqual(r.titulos, ['Maturador', 'Inseticida']);
  // sem cabeçalho, separado por ponto e vírgula
  const s = lerSequencia('1;Faz X;10;12,5;Herbicida\n2;Faz Y;11;7;Herbicida\nRealizado;;;19,5');
  assert.equal(s.linhas.length, 2); assert.equal(s.linhas[0].area, 12.5);
  // com FN no cabeçalho
  const f = lerSequencia('Seq,FN,Fazenda,OS,Área\n1,064,Faz Z,99,"10,5"');
  assert.equal(f.linhas[0].fn, '64'); assert.equal(f.linhas[0].area, 10.5);
});

test('importação: cria campanha, fazendas, talhão geral e OS; renumera; filtro por título; não duplica ao reimportar', () => {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U1', codigo: 'U1', municipio: '' });
  let n = 0; const id = (p: string) => `${p}-${++n}`;
  const lidas = lerSequencia(EXEMPLO_SEQUENCIA).linhas;
  const prev = importarSequencia(ds, lidas, { campanhaId: '', novaCampanha: { nome: 'Maturador teste', tipo: 'Maturador', inicio: '', fim: '' }, unidadeId: 'u1', titulos: ['Maturador'] }, id, false, '2026-10-20');
  assert.deepEqual(prev.erros, []);
  assert.equal(ds.ordens.length, 0, 'prévia não altera a base');
  assert.equal(prev.acoes.length, 2); assert.equal(prev.total, 347.81);
  const r = importarSequencia(ds, lidas, { campanhaId: '', novaCampanha: { nome: 'Maturador teste', tipo: 'Maturador', inicio: '', fim: '' }, unidadeId: 'u1', titulos: ['Maturador'] }, id, true, '2026-10-20');
  assert.equal(ds.campanhas.length, 1); assert.equal(ds.fazendas.length, 2); assert.equal(ds.ordens.length, 2);
  assert.equal(ds.ordens[0].sequencia, 1); assert.equal(ds.ordens[1].itens[0].areaPlanejadaHa, 79.36);
  assert.ok(ds.talhoes.every((t) => t.geral));
  assert.equal(ds.auditoria.length, 1);
  // reimportar com área alterada e ordem invertida: atualiza, não duplica
  const novo = lerSequencia('Sequência\tFazenda\tO.S\tÁrea\n1\tFazenda Exemplo B\t4102/4103\t80\n2\tFazenda Exemplo A\t4101\t268,45').linhas;
  const r2 = importarSequencia(ds, novo, { campanhaId: r.campanhaId, unidadeId: 'u1', titulos: [] }, id, true, '2026-10-20');
  assert.equal(r2.atualizadas, 2); assert.equal(ds.ordens.length, 2);
  assert.equal(ds.ordens.find((o) => o.numero === '4102/4103')!.sequencia, 1);
  assert.equal(ds.ordens.find((o) => o.numero === '4102/4103')!.itens[0].areaPlanejadaHa, 80);
});

test('importação: unidade não é exigida; linhas repetidas bloqueiam', () => {
  const ds = baseVazia();
  const lidas = lerSequencia('1\tA\t1\t10\n2\tA\t1\t10').linhas;
  const r = importarSequencia(ds, lidas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Maturador', inicio: '', fim: '' }, unidadeId: '', titulos: [] }, (p) => p, false, '2026-10-20');
  assert.ok(!r.erros.some((e) => e.includes('unidade')), 'unidade é opcional');
  assert.ok(r.erros.some((e) => e.includes('repetidas')));
});

test('importação de talhões substitui o talhão geral quando a soma bate', () => {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U1', codigo: 'U1', municipio: '' });
  let n = 0; const id = (p: string) => `${p}-${++n}`;
  importarSequencia(ds, lerSequencia('Seq\tFN\tFazenda\tOS\tÁrea\n1\t910\tFaz T\t50\t30').linhas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Maturador', inicio: '', fim: '' }, unidadeId: 'u1', titulos: [] }, id, true, '2026-10-20');
  const lt = lerTalhoes('FN;Talhão;Área\n910;1;12,5\n910;2;17,5');
  assert.equal(lt.linhas.length, 2); assert.equal(lt.linhas[0].talhao, '001');
  const r = importarTalhoes(ds, lt.linhas, 'u1', id, true);
  assert.deepEqual(r.erros, []);
  assert.equal(r.criados, 2); assert.equal(r.osAjustadas, 1); assert.equal(r.geraisRemovidos, 1);
  assert.equal(ds.ordens[0].itens.length, 2);
  assert.ok(!ds.talhoes.some((t) => t.geral));
});

test('base: migração preserva dados; status recalculado; referências impedem exclusão', () => {
  const ds = gerarDemo() as unknown as Record<string, unknown>;
  delete ds.auditoria; delete ds.origemBase; (ds as { versao: number }).versao = 3;
  const m = migrar(ds)!;
  assert.equal(m.versao, VERSAO_ESQUEMA); assert.equal(m.origemBase, 'demo'); assert.deepEqual(m.auditoria, []);
  assert.ok(m.operacoes.length > 50);
  assert.equal(migrar({ foo: 1 }), null);
  const os = m.ordens.find((o) => o.status === 'aberta')!;
  os.concluidaManual = true; recalcularStatusOS(m);
  assert.equal(os.status, 'concluida');
  assert.ok(referencias(m, 'aeronave', 'ac-1').length > 0);
  assert.deepEqual(referencias(m, 'turno', 'tn-c'), []);
});

import { areaProgramadaEfetiva, areaObstaculo, aplicadoPorItem as api2 } from '../src/domain/calc';
test('OS concluída com saldo: programado continua bruto, saldo vira obstáculo e sai do "falta aplicar"', () => {
  const ds = gerarDemo();
  const os = ds.ordens.find((o) => o.status === 'em_execucao')!;
  const apl = api2(ds.operacoes);
  const plan = os.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0);
  const feito = os.itens.reduce((s, i) => s + (apl.get(`${os.id}|${i.talhaoId}`) ?? 0), 0);
  assert.equal(areaProgramadaEfetiva(os, apl), plan);
  os.concluidaManual = true;
  assert.ok(Math.abs(areaProgramadaEfetiva(os, apl) - feito) < 1e-9);
  const idx = criarIndices(ds);
  const f: Filtros = { de: '2026-09-14', ate: '2026-10-19', campanhaId: os.campanhaId, unidadeId: '', fazendaId: '', osId: os.id, aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  const ind = calcularIndicadores(ds, f, idx);
  assert.ok(Math.abs(ind.areaRestante) < 1e-6, 'nada falta aplicar');
  assert.ok(Math.abs(ind.areaPlanejada - plan) < 1e-9, 'programado continua bruto');
  assert.ok(Math.abs(ind.areaObstaculos - (plan - feito)) < 1e-9, 'obstáculo = programado − aplicado');
  assert.ok(Math.abs((ind.pctExecutado ?? 0) - (feito / plan) * 100) < 1e-6, '% mostra o que foi realmente aplicado');
  assert.equal(areaObstaculo({ ...os, concluidaManual: undefined }, apl), 0, 'OS aberta não tem obstáculo');
});

test('obstáculo do exemplo: 32,70 programado, 32,17 aplicado → 0,53 obstáculo, 98,4%', () => {
  const os = { id: 'o', itens: [{ talhaoId: 't', areaPlanejadaHa: 32.7 }], concluidaManual: true };
  const apl = new Map([['o|t', 32.17]]);
  assert.equal(round(areaObstaculo(os, apl), 2), 0.53);
  assert.equal(round(percentualExecutado(32.17, 32.7)!, 1), 98.4);
  assert.equal(round(areaProgramadaEfetiva(os, apl), 2), 32.17);
});

import { lerTratamento } from '../src/domain/importacao';
const TRAT = `TRATAMENTO 1 - 64,4500 HA\tDOSE\tTOTAL
AUREO\t0,0200 L/ha\t1,2890 L
CARAVAN KOPPERT\t0,5000 L/ha\t32,2250 L
DNA GRID\t0,5000 L/ha\t32,2250 L
PRIORI TOP SYNGENTA\t0,6000 L/ha\t38,6700 L
RE-LEAF\t1,0000 L/ha\t64,4500 L
SPRAYD FLEX DIRECT\t0,0200 L/ha\t1,2890 L
CODIGO\tRESUMO DE INSUMOS\tTOTAL
21162\tAUREO\t1,2890 L
36423\tCARAVAN KOPPERT\t32,2250 L
17609\tDNA GRID\t32,2250 L
34067\tPRIORI TOP SYNGENTA\t38,6700 L
19140\tRE-LEAF\t64,4500 L
21013\tSPRAYD FLEX DIRECT\t1,2890 L
ÁREA TOTAL\t64,45 ha`;

test('tratamento: lê o conjunto de produtos do exemplo da OS, com códigos e conferência dose × área', () => {
  const r = lerTratamento(TRAT);
  assert.equal(r.nome, 'Tratamento 1');
  assert.equal(r.areaHa, 64.45);
  assert.equal(r.itens.length, 6);
  assert.deepEqual(r.itens.map((i) => i.codigo), ['21162', '36423', '17609', '34067', '19140', '21013']);
  assert.equal(r.itens[3].produto, 'PRIORI TOP SYNGENTA'); assert.equal(r.itens[3].dose, 0.6); assert.equal(r.itens[3].unidade, 'L/ha');
  assert.ok(r.itens.every((i) => i.conferido === true), 'todos os totais conferem');
  assert.deepEqual(r.avisos, []);
  // copiado do PDF com espaços e um total errado
  const e = lerTratamento('TRATAMENTO 2 - 10 HA\nPRODUTO A 0,5 L/ha 6,0 L\nPRODUTO B 200 g/ha 2,0 kg');
  assert.equal(e.itens.length, 2); assert.equal(e.itens[1].unidade, 'g/ha');
  assert.equal(e.itens[0].conferido, false); assert.equal(e.itens[1].conferido, true);
  assert.equal(e.avisos.length, 1);
});

import { resolverProdutosNovos, codificarNovo, acharProduto, classePorTipo } from '../src/domain/importacao';
test('tratamento: produtos novos são criados com código ao salvar; existentes são reaproveitados por código ou nome', () => {
  const ds = baseVazia();
  ds.produtos.push({ id: 'p1', nome: 'Re-Leaf', classe: 'Fertilizante foliar', unidadeDose: 'L/ha', unidadeTotal: 'L' });
  const leitura = lerTratamento(TRAT);
  const calda = { tratamento: leitura.nome, volumeLHa: 10, produtos: leitura.itens.map((i) => ({ produtoId: codificarNovo({ nome: i.produto, codigo: i.codigo, unidade: i.unidade }), dosePlanejada: i.dose, doseReal: null, unidade: i.unidade })) };
  let k = 0;
  const criados = resolverProdutosNovos(ds, calda, classePorTipo('Fungicida'), (p) => `${p}-${++k}`);
  assert.equal(criados.length, 5, 'RE-LEAF já existia (nome sem acento/caixa)');
  assert.equal(ds.produtos.length, 6);
  assert.equal(ds.produtos.find((p) => p.id === 'p1')!.codigo, '19140', 'completa o código do existente');
  assert.ok(calda.produtos.every((p) => ds.produtos.some((x) => x.id === p.produtoId)));
  assert.equal(ds.produtos.find((p) => p.nome === 'AUREO')!.codigo, '21162');
  assert.equal(ds.produtos.find((p) => p.nome === 'AUREO')!.classe, 'Fungicida');
  assert.equal(ds.auditoria.filter((a) => a.entidade === 'produto' && a.acao === 'criar').length, 5);
  // segunda vez: nada novo (acha pelo código)
  const c2 = { volumeLHa: 10, produtos: [{ produtoId: codificarNovo({ nome: 'Aureo adjuvante', codigo: '21162', unidade: 'L/ha' }), dosePlanejada: 0.02, doseReal: null, unidade: 'L/ha' as const }] };
  assert.deepEqual(resolverProdutosNovos(ds, c2, 'Fungicida', () => 'x'), []);
  assert.equal(c2.produtos[0].produtoId, ds.produtos.find((p) => p.nome === 'AUREO')!.id);
});

import { moverNaSequencia } from '../src/domain/importacao';
test('sequência livre: mover para posição renumera 1..N; reimportar com "manter ordem" preserva ajustes manuais', () => {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  const tab = 'Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFaz A\t1\t10\tX\n2\tFaz B\t2\t20\tX\n3\tFaz C\t3\t30\tX\n4\tFaz D\t4\t40\tX';
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  const r = importarSequencia(ds, lerSequencia(tab).linhas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Fungicida', inicio: '2026-10-01', fim: '2026-12-01' }, unidadeId: 'u1', titulos: [] }, gid, true, '2026-10-20');
  const cid = r.campanhaId;
  const ordem = () => ds.ordens.filter((o) => o.campanhaId === cid).sort((a, b) => a.sequencia! - b.sequencia!).map((o) => o.numero).join(',');
  assert.equal(ordem(), '1,2,3,4');
  const d = ds.ordens.find((o) => o.numero === '4')!;
  assert.deepEqual(moverNaSequencia(ds, cid, d.id, 1), { de: 4, para: 1 });
  assert.equal(ordem(), '4,1,2,3');
  assert.equal(moverNaSequencia(ds, cid, d.id, 1), null, 'mesma posição: nada muda');
  assert.deepEqual(moverNaSequencia(ds, cid, d.id, 99), { de: 1, para: 4 }, 'posição além do fim vai para o fim');
  moverNaSequencia(ds, cid, d.id, 2);
  assert.equal(ordem(), '1,4,2,3');
  // reimporta a mesma tabela + uma OS nova, mantendo a ordem atual
  const tab2 = tab + '\n5\tFaz E\t5\t50\tX';
  const r2 = importarSequencia(ds, lerSequencia(tab2).linhas, { campanhaId: cid, unidadeId: 'u1', titulos: [], ordem: 'manter' }, gid, true, '2026-10-20');
  assert.deepEqual(r2.erros, []);
  assert.equal(ordem(), '1,4,2,3,5', 'ajuste manual preservado; nova no fim');
  assert.deepEqual(r2.acoes.map((a) => a.seq), [1, 2, 3, 4, 5]);
  assert.equal(r2.acoes[1].os, '4');
  // com "ordem da tabela" volta a seguir a planilha
  importarSequencia(ds, lerSequencia(tab2).linhas, { campanhaId: cid, unidadeId: 'u1', titulos: [], ordem: 'tabela' }, gid, true, '2026-10-20');
  assert.equal(ordem(), '1,2,3,4,5');
});

import { gravarTalhoesOS, limparGeraisSemUso } from '../src/domain/importacao';
import { round } from '../src/domain/calc';
const TALH_OS = 'Fazenda\tZONA\tTn\thá\tñ aplicado\treal\n1023\t90\t19\t7,36\t\t7,36\n1023\t90\t20\t12,33\t0,53\t11,80\n1023\t90\t21\t7,71\t\t7,71\n1023\t90\t22\t5,3\t\t5,30\n\t\t\t\t\t0,00';
test('talhões da OS: lê Fazenda · ZONA · Tn · há · ñ aplicado · real e confere real = há − ñ aplicado', () => {
  const r = lerTalhoes(TALH_OS);
  assert.equal(r.linhas.length, 4);
  assert.deepEqual(r.linhas.map((l) => l.talhao), ['019', '020', '021', '022']);
  assert.ok(r.linhas.every((l) => l.fn === '1023' && l.zona === '90' && l.erros.length === 0 && l.avisos.length === 0));
  assert.equal(r.linhas[1].naoAplicado, 0.53); assert.equal(r.linhas[1].real, 11.8);
  assert.equal(round(r.linhas.reduce((s, l) => s + l.real!, 0), 2), 32.17);
  const errado = lerTalhoes('Fazenda\tZONA\tTn\thá\tñ aplicado\treal\n1023\t90\t20\t12,33\t0,53\t12,33');
  assert.equal(errado.linhas[0].avisos.length, 1, 'real que não confere gera aviso');
});

test('talhões da OS: grava talhões reais no lugar do GERAL; programado = área bruta, ñ aplicado = desconto previsto', () => {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  ds.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '1023', nome: 'Fazenda 1023', municipio: '' });
  ds.talhoes.push({ id: 'g', fazendaId: 'f1', codigo: 'GERAL', areaHa: 32.7, geral: true });
  const os = { id: 'o1', numero: '3410', campanhaId: 'c', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização' as const, status: 'aberta' as const, emissao: '2026-10-20', itens: [{ talhaoId: 'g', areaPlanejadaHa: 32.7 }], calda: { volumeLHa: 10, produtos: [] } };
  ds.ordens.push(os);
  const linhas = lerTalhoes(TALH_OS).linhas.map((l) => ({ zona: l.zona, codigo: l.talhao, areaHa: l.area!, naoAplicadoHa: l.naoAplicado, usar: true }));
  let k = 0;
  const r = gravarTalhoesOS(ds, 'f1', [...linhas, { talhaoId: 'g', zona: '', codigo: 'GERAL', areaHa: 32.7, naoAplicadoHa: 0, usar: false }], (p) => `${p}${++k}`);
  assert.deepEqual(r.erros, []);
  assert.equal(r.itens.length, 4);
  assert.equal(round(r.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0), 2), 32.7, 'chega aos 32,70 do GERAL');
  assert.equal(r.itens[1].naoAplicadoHa, 0.53); assert.equal(r.itens[1].areaPlanejadaHa, 12.33);
  os.itens = r.itens;
  assert.equal(limparGeraisSemUso(ds, 'f1'), 1, 'GERAL removido ao deixar de ser usado');
  assert.equal(ds.talhoes.filter((t) => t.fazendaId === 'f1').map((t) => `${t.zona}-${t.codigo}-${t.areaHa}`).join(','), '90-019-7.36,90-020-12.33,90-021-7.71,90-022-5.3');
  // validações
  assert.ok(gravarTalhoesOS(ds, 'f1', [{ zona: '', codigo: '19', areaHa: 5, naoAplicadoHa: 6, usar: true }], () => 'x').erros.length > 0);
  assert.ok(gravarTalhoesOS(ds, 'f1', [{ zona: '', codigo: '19', areaHa: 5, naoAplicadoHa: 0, usar: true }, { zona: '', codigo: '019', areaHa: 5, naoAplicadoHa: 0, usar: true }], () => 'x').erros.some((e) => e.includes('duas vezes')));
  // reaproveita talhão existente pelo código (019 = 19) e atualiza a área
  const r2 = gravarTalhoesOS(ds, 'f1', [{ zona: '90', codigo: '19', areaHa: 7.5, naoAplicadoHa: 0, usar: true }], () => 'novo');
  assert.equal(ds.talhoes.filter((t) => t.fazendaId === 'f1').length, 4);
  assert.equal(ds.talhoes.find((t) => t.id === r2.itens[0].talhaoId)!.areaHa, 7.5);
});

test('migração v4→v5: OS da v0.8.1 (programado = real) voltam a programar a área bruta', () => {
  const ds = baseVazia() as unknown as Record<string, unknown> & { ordens: unknown[]; versao: number };
  ds.versao = 4;
  ds.ordens.push({ id: 'o', numero: '1', campanhaId: 'c', unidadeId: 'u', fazendaId: 'f', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-20', sequencia: 1, calda: { volumeLHa: 10, produtos: [] }, itens: [{ talhaoId: 't', areaPlanejadaHa: 11.8, naoAplicadoHa: 0.53 }, { talhaoId: 't2', areaPlanejadaHa: 7.36 }] });
  const m = migrar(ds)!;
  assert.deepEqual(m.ordens[0].itens.map((i) => i.areaPlanejadaHa), [12.33, 7.36]);
  assert.deepEqual(migrar(m)!.ordens[0].itens.map((i) => i.areaPlanejadaHa), [12.33, 7.36], 'não soma duas vezes');
});

import { lerOSdoPdf, importarOSPdf } from '../src/domain/importacaoPdf';
const PDF_3410 = [
  'ORDEM DE SERVIÇO - APLICAÇÃO AÉREA (DRONE)',
  'O.S Nº: 3410\tEmissão: 13/10/2026\tOperação: FUNGICIDA',
  'FN: 094 / 095\tUnidade: UNIDADE EXEMPLO',
  'Fazenda\tNome\tZONA\tTalhão\tVariedade\tÁrea (ha)',
  '094\tSITIO EXEMPLO A\t90\t19\tCTC4\t7,36',
  '094\tSITIO EXEMPLO A\t90\t20\tCTC4\t12,33',
  '094\tSITIO EXEMPLO A\t90\t21\tRB975201\t7,71',
  '095\tSITIO EXEMPLO B\t91\t01\tCTC9001\t5,30',
  '095\tSITIO EXEMPLO B\t91\t02\tCTC9001\t31,75',
  'TOTAL\t64,45',
  ...TRAT.split('\n'),
];
test('PDF da OS: extrai OS, FNs, talhões por fazenda, total (confere) e tratamento', () => {
  const d = lerOSdoPdf(PDF_3410, 'OS 3410 - FN 094-095.pdf');
  assert.deepEqual(d.erros, []);
  assert.equal(d.os, '3410');
  assert.deepEqual(d.fns, ['94', '95']);
  assert.equal(d.talhoes.length, 5);
  assert.deepEqual(d.talhoes.map((t) => `${t.fn}/${t.zona}/${t.talhao}/${t.area}`), ['94/90/019/7.36', '94/90/020/12.33', '94/90/021/7.71', '95/91/001/5.3', '95/91/002/31.75']);
  assert.equal(d.talhoes[0].fazenda, 'SITIO EXEMPLO A');
  assert.equal(d.totalDeclarado, 64.45); assert.equal(d.somaTalhoes, 64.45);
  assert.deepEqual(d.avisos, [], 'soma confere com o total');
  assert.equal(d.tratamento.itens.length, 6);
});

test('PDF da OS: sem coluna de fazenda usa a FN da OS; "Área total"; soma divergente avisa; PDF imagem dá erro', () => {
  const d = lerOSdoPdf(['ORDEM DE SERVIÇO', 'OS 3416\tFazenda: 090 - FAZENDA EXEMPLO C', 'Zona\tTn\thá\tñ aplicado', '12\t1\t10,10', '12\t2\t12,60\t0,40', '12\t3\t10,00', 'Área total: 32,70 ha'], 'x.pdf');
  assert.equal(d.os, '3416'); assert.deepEqual(d.fns, ['90']); assert.equal(d.fazendaNome, 'FAZENDA EXEMPLO C');
  assert.equal(d.talhoes.length, 3); assert.equal(d.talhoes[1].naoAplicado, 0.4);
  assert.equal(d.totalDeclarado, 32.7); assert.equal(d.somaTalhoes, 32.7); assert.deepEqual(d.erros, []);
  const div = lerOSdoPdf(['OS 1', 'FN 5', 'Talhão\tÁrea', '1\t10', 'Área total: 12 ha'], 'a.pdf');
  assert.ok(div.avisos.some((a) => a.includes('difere')));
  assert.ok(lerOSdoPdf([], 'OS 9 - FN 1.pdf', true).erros[0].includes('sem texto'));
  const soTotal = lerOSdoPdf(['OS 77 FN 12', 'Área total: 40,5 ha'], 'b.pdf');
  assert.equal(soTotal.totalDeclarado, 40.5); assert.ok(soTotal.avisos[0].includes('GERAL'));
});

test('PDF da OS: importar cria fazendas, talhões, OS por FN, tratamento com códigos; reimportar não duplica', () => {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  const d = lerOSdoPdf(PDF_3410, 'OS 3410 - FN 094-095.pdf');
  const op = { campanhaId: '', novaCampanha: { nome: 'Fungicida 26', tipo: 'Fungicida' as const, inicio: '2026-10-13', fim: '2026-11-30' }, unidadeId: 'u1', usarTratamento: true };
  const prev = importarOSPdf(ds, [d], op, gid, false, '2026-10-20');
  assert.deepEqual(prev.erros, []); assert.equal(ds.ordens.length, 0, 'prévia não grava');
  const r = importarOSPdf(ds, [d], op, gid, true, '2026-10-20');
  assert.equal(r.acoes.length, 2); assert.equal(r.total, 64.45);
  assert.equal(ds.fazendas.length, 2); assert.equal(ds.fazendas[0].nome, 'SITIO EXEMPLO A');
  assert.equal(ds.ordens.length, 2);
  assert.deepEqual(ds.ordens.map((o) => round(o.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0), 2)), [27.4, 37.05]);
  assert.equal(ds.produtos.length, 6); assert.equal(ds.produtos.find((p) => p.nome === 'AUREO')!.codigo, '21162');
  assert.equal(ds.ordens[0].calda.produtos.length, 6); assert.equal(ds.ordens[0].calda.tratamento, 'Tratamento 1');
  // reimporta: atualiza, não duplica
  const r2 = importarOSPdf(ds, [d], { ...op, campanhaId: r.campanhaId }, gid, true, '2026-10-20');
  assert.deepEqual(r2.erros, []); assert.equal(ds.ordens.length, 2); assert.equal(ds.talhoes.length, 5); assert.equal(ds.produtos.length, 6);
  assert.ok(r2.acoes.every((a) => a.acao.includes('Atualiza')));
});

import { readFileSync } from 'node:fs';
test('PDF REAL (OS 3416 · FN 090): quadro Zonas, FN·ZN·TN com tratamento ao lado, Área Total ≠ KML', () => {
  const linhas = readFileSync('tests/fixtures/os-3416-linhas.txt', 'utf8').split('\n');
  const d = lerOSdoPdf(linhas, 'OS 3416 - FN 090.pdf');
  assert.deepEqual(d.erros, []);
  assert.equal(d.os, '3416');
  assert.deepEqual(d.fns, ['90']);
  assert.equal(d.fazendaNome, 'Fazenda Jacinto I');
  assert.deepEqual(d.talhoes.map((t) => `${t.fn}/${t.zona}/${t.talhao}/${t.area}/${t.areaTalhao}/${t.fnOriginal}`), ['90/90/019/7.36/7.36/1023', '90/90/020/12.33/12.33/1023', '90/90/021/7.71/7.71/1023', '90/90/022/5.3/5.3/1023']);
  assert.equal(d.somaTalhoes, 32.7); assert.equal(d.totalDeclarado, 32.7, 'usa "Área Total", não o KML (33,97)');
  assert.deepEqual(d.avisos, []);
  assert.equal(d.tratamento.nome, 'Tratamento 1'); assert.equal(d.tratamento.areaHa, 32.7);
  assert.deepEqual(d.tratamento.itens.map((i) => `${i.codigo} ${i.produto} ${i.dose} ${i.total} ${i.conferido}`), ['21162 AUREO 0.02 0.654 true', '36423 CARAVAN KOPPERT 0.5 16.35 true', '17609 DNA GRID 0.5 16.35 true', '34067 PRIORI TOP SYNGENTA 0.6 19.62 true', '19140 RE-LEAF 1 32.7 true', '21013 SPRAYD FLEX DIRECT 0.02 0.654 true']);
  // importa: fazenda FN 90 "Fazenda Jacinto I", 4 talhões zona 90, OS 3416 com 32,70 programado
  const ds = baseVazia(); ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  let k = 0;
  const r = importarOSPdf(ds, [d, d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '2026-10-13', fim: '2026-11-30' }, unidadeId: 'u1', usarTratamento: true }, (p) => `${p}${++k}`, true, '2026-10-20');
  assert.deepEqual(r.erros, []); assert.equal(r.acoes.length, 1, 'mesmo PDF duas vezes no lote: ignora o repetido');
  assert.ok(r.avisos.some((a) => a.includes('ignorado')));
  assert.equal(ds.fazendas[0].codigo, '90'); assert.equal(ds.fazendas[0].nome, 'Fazenda Jacinto I');
  assert.equal(ds.talhoes.length, 4); assert.ok(ds.talhoes.every((t) => t.zona === '90'));
  assert.equal(round(ds.ordens[0].itens.reduce((s, i) => s + i.areaPlanejadaHa, 0), 2), 32.7);
});

test('PDF: AREA OS menor que AREA TN programa só a parte da OS', () => {
  const d = lerOSdoPdf(['Ordem de Serviço:\t7701', 'Zonas\tÁrea (ha)', '101 - Fazenda X\t7,92', 'FN\tZN\tTN\tAREA OS\tAREA TN', '1101\t101\t1\t7,92\t12,54'], 'a.pdf');
  assert.equal(d.talhoes[0].area, 7.92); assert.equal(d.talhoes[0].areaTalhao, 12.54);
  const ds = baseVazia(); ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  const rr = importarOSPdf(ds, [d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '', fim: '' }, unidadeId: 'u1', usarTratamento: false }, (p) => `${p}1`, true, '2026-10-20');
  assert.deepEqual(rr.erros, []);
  assert.equal(ds.talhoes[0].areaHa, 12.54); assert.equal(ds.ordens[0].itens[0].areaPlanejadaHa, 7.92);
});

test('PDF: tabela de talhões que passa pelo resumo de insumos é lida inteira (com e sem posições)', () => {
  const cab = 'FN\tZN\tTN\tAREA OS\tAREA TN\tGLEBA\tTRATAMENTO\tTRATAMENTO 1 - 30,0000 HA\tDOSE\tTOTAL';
  const linhas = ['Ordem de Serviço:\t6100', 'Zonas\tÁrea (ha)', '200 - Fazenda Z\t30,00', 'Área Total:\t30,00 ha', cab];
  const caixas: { x0: number; x1: number }[][] = [[], [], [], [], [[15, 25], [35, 45], [55, 64], [72, 102], [108, 138], [157, 181], [218, 266], [322, 430], [480, 502], [540, 566]]];
  const row = (tn: number) => ({ t: `1200\t200\t${tn}\t3,00\t3,00\t353\tTrat. 1`, b: [[12, 28], [36, 44], [55, 64], [80, 94], [116, 130], [163, 176], [231, 253]] });
  for (let tn = 1; tn <= 10; tn++) {
    const r = row(tn);
    if (tn === 5) { linhas.push('CODIGO\tRESUMO DE INSUMOS\tTOTAL'); caixas.push([[307, 339], [394, 481], [540, 566]]); }
    if (tn === 6) { linhas.push(r.t + '\t21162\tAUREO\t0,6000 L'); caixas.push([...r.b, [313, 333], [357, 382], [539, 567]]); continue; }
    if (tn === 7) { linhas.push('21162\tAUREO\t0,6000 L'); caixas.push([[313, 333], [357, 382], [539, 567]]); linhas.push('36423\tCARAVAN\t15,0000 L'); caixas.push([[313, 333], [357, 382], [539, 567]]); linhas.push('ÁREA TOTAL\t30,00 ha'); caixas.push([[382, 428], [538, 567]]); }
    linhas.push(r.t); caixas.push(r.b);
  }
  const bx = caixas.map((l) => l.map(([x0, x1]) => ({ x0, x1 })));
  const comPos = lerOSdoPdf(linhas, 'x.pdf', false, bx);
  assert.equal(comPos.talhoes.length, 10); assert.equal(comPos.somaTalhoes, 30); assert.deepEqual(comPos.erros, []);
  assert.ok(comPos.talhoes.every((t) => t.fn === '200' && t.fnOriginal === '1200'));
  const semPos = lerOSdoPdf(linhas, 'x.pdf');
  assert.equal(semPos.talhoes.length, 10, 'texto corrigido à mão também lê tudo');
});

import { distribuirDesconto, gravarAplicadoOS, lerFichaDiaria, fichaDaOS, situacaoOS } from '../src/domain/lancamento';
import { aplicacoes, areaObstaculo as obstOS } from '../src/domain/calc';
function osJacinto() {
  const ds = baseVazia();
  ds.unidades.push({ id: 'u1', nome: 'U', codigo: 'U', municipio: '' });
  ds.fazendas.push({ id: 'f1', unidadeId: 'u1', codigo: '90', nome: 'Jacinto I', municipio: '' });
  [['t19', '019', 7.36], ['t20', '020', 12.33], ['t21', '021', 7.71], ['t22', '022', 5.3]].forEach(([id, c, a]) => ds.talhoes.push({ id: id as string, fazendaId: 'f1', codigo: c as string, zona: '90', areaHa: a as number }));
  ds.campanhas.push({ id: 'c1', nome: 'F', tipo: 'Fungicida', cultura: 'Cana', inicio: '2026-10-01', fim: '2026-12-01' });
  ds.ordens.push({ id: 'o1', numero: '3416', campanhaId: 'c1', unidadeId: 'u1', fazendaId: 'f1', tipo: 'Pulverização', status: 'aberta', emissao: '2026-10-13', sequencia: 1, calda: { volumeLHa: 10, produtos: [] }, itens: ds.talhoes.map((t) => ({ talhaoId: t.id, areaPlanejadaHa: t.areaHa })) });
  return ds;
}
test('aplicado na sequência: 32,17 com desconto no talhão 20 → obstáculo 0,53 (não 32,70)', () => {
  const ds = osJacinto();
  const sit = situacaoOS(ds, 'o1');
  assert.equal(round(sit.talhoes.reduce((s, t) => s + t.programado, 0), 2), 32.7);
  const sem = distribuirDesconto(sit.talhoes, 32.17, []);
  assert.ok(sem.erros[0].includes('Marque em qual talhão'), 'pede o talhão do desconto');
  const d = distribuirDesconto(sit.talhoes, 32.17, ['t20']);
  assert.deepEqual(d.erros, []);
  assert.deepEqual([...d.aplicado.values()], [7.36, 11.8, 7.71, 5.3]);
  let k = 0;
  assert.equal(gravarAplicadoOS(ds, 'o1', d.aplicado, '2026-10-19', 'manual', true, (p) => `${p}${++k}`), null);
  const apl = api2(aplicacoes(ds));
  assert.equal(round(ds.ordens[0].itens.reduce((s, i) => s + (apl.get(`o1|${i.talhaoId}`) ?? 0), 0), 2), 32.17);
  assert.equal(round(obstOS(ds.ordens[0], apl), 2), 0.53, 'obstáculo = 0,53');
  assert.equal(apl.get('o1|t20'), 11.8);
  recalcularStatusOS(ds); assert.equal(ds.ordens[0].status, 'concluida');
  // editar de novo substitui (não soma)
  assert.equal(gravarAplicadoOS(ds, 'o1', distribuirDesconto(sit.talhoes, 32.0, ['t20', 't22']).aplicado, '2026-10-19', 'manual', true, (p) => `${p}${++k}`), null);
  assert.equal(ds.lancamentos.length, 1);
  assert.equal(round(obstOS(ds.ordens[0], api2(aplicacoes(ds))), 2), 0.7);
  // indicadores: entra na área, não na produtividade
  const idx = criarIndices(ds);
  const f: Filtros = { de: '2026-10-01', ate: '2026-10-20', campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  const ind = calcularIndicadores(ds, f, idx);
  assert.equal(round(ind.areaAcumulada, 2), 32); assert.equal(round(ind.areaLancada, 2), 32); assert.equal(ind.prodEfetiva, null);
  assert.equal(round(ind.areaObstaculos, 2), 0.7); assert.ok(Math.abs(ind.areaRestante) < 1e-6);
});

test('aplicado: não aceita menos que o já voado nem mais que o programado', () => {
  const ds = osJacinto();
  ds.operacoes.push({ id: 'op', data: '2026-10-18', osId: 'o1', campanhaId: 'c1', cultura: 'Cana', turnoId: 't', liderId: 'l', aeronaveId: 'a', pilotoId: 'p', auxiliarIds: [], horaInicio: '07:00', horaFim: '08:00', status: 'parcial', itens: [{ talhaoId: 't20', areaHa: 12 }], tempoEfetivoMin: 50, calda: { volumeLHa: 10, produtos: [] }, clima: [], origem: 'registro_prototipo', criadoEm: '' });
  const sit = situacaoOS(ds, 'o1');
  assert.ok(distribuirDesconto(sit.talhoes, 32.17, ['t20']).erros[0].includes('só comportam'), '0,53 no t20 é impossível: já voou 12 de 12,33');
  const ok = distribuirDesconto(sit.talhoes, 32.17, ['t20', 't21']);
  assert.deepEqual(ok.erros, []);
  assert.equal(round([...ok.aplicado.values()].reduce((s, x) => s + x, 0), 2), 32.17);
  assert.ok(ok.aplicado.get('t20')! >= 12);
  assert.ok(distribuirDesconto(sit.talhoes, 33, ['t20']).erros[0].includes('maior que o programado'));
  let k = 0;
  assert.equal(gravarAplicadoOS(ds, 'o1', ok.aplicado, '2026-10-19', 'ficha_diaria', false, (p) => `${p}${++k}`), null);
  assert.equal(round(ds.lancamentos[0].itens.reduce((s, i) => s + i.areaHa, 0), 2), 20.17, 'lança só a diferença além do voado');
});

test('ficha diária: lê data, FN/fazenda e área (último número), e filtra a fazenda da OS', () => {
  const l = lerFichaDiaria('Data\tFazenda\tÁrea\n13/10/2026\t090\tJacinto I\t32,17\n13/10/2026\t018\tSítio Clementino\t16,01\nTotal\t\t48,18\n19/10 · FN 90 Jacinto I · T70 D 0,20 · T70 A 0,30 · Total 0,50\nJacinto I - 1,25 ha', 2026);
  assert.equal(l.length, 4);
  assert.deepEqual(l.map((x) => `${x.data}|${x.fn}|${x.fazenda}|${x.area}`), ['2026-10-13|90|Jacinto I|32.17', '2026-10-13|18|Sítio Clementino|16.01', '2026-10-19|90|Jacinto I|0.5', '2026-10-19||Jacinto I|1.25']);
  const ds = osJacinto();
  assert.deepEqual(fichaDaOS(ds, 'o1', l).map((x) => x.area), [32.17, 0.5, 1.25]);
});

import { gerarRelatorio, RELATORIOS } from '../src/domain/relatorios';
import { paraCSV, arquivosXLSX, nomeArquivo } from '../src/domain/exportar';
test('relatórios: números iguais aos do painel (mesmas regras) e cabeçalho obrigatório', () => {
  const ds = gerarDemo();
  const idx = criarIndices(ds);
  const f: Filtros = { de: '2026-09-14', ate: '2026-10-19', campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  const ind = calcularIndicadores(ds, f, idx);
  const agora = '2026-10-20T15:00:00.000Z';
  const os = gerarRelatorio(ds, 'os', f, 'Fulano', agora);
  const T = os.secoes[0].totais!;
  assert.ok(Math.abs((T[6] as number) - ind.areaPlanejada) < 1e-6, 'programado');
  assert.ok(Math.abs((T[7] as number) - ind.areaAcumulada) < 1e-6, 'aplicado até a data final');
  assert.ok(Math.abs((T[9] as number) - ind.areaObstaculos) < 1e-6, 'obstáculos');
  const pl = gerarRelatorio(ds, 'planejado', f, 'Fulano', agora);
  assert.ok(Math.abs((pl.secoes[0].totais![3] as number) - ind.areaPlanejada) < 1e-6 && Math.abs((pl.secoes[0].totais![4] as number) - ind.areaAcumulada) < 1e-6);
  const ae = gerarRelatorio(ds, 'aeronave', f, 'Fulano', agora);
  assert.ok(Math.abs((ae.secoes[0].totais![3] as number) - ind.areaPeriodo) < 1e-6, 'área do período (demo não tem lançamentos)');
  assert.ok(Math.abs((ae.secoes[0].totais![7] as number) - ind.prodEfetiva!) < 1e-9, 'ha/h efetivo igual ao painel');
  const op = gerarRelatorio(ds, 'operador', f, 'Fulano', agora);
  assert.ok(Math.abs((op.secoes[0].totais![3] as number) - ind.areaPeriodo) < 1e-6);
  const ev = gerarRelatorio(ds, 'evolucao', f, 'Fulano', agora);
  assert.ok(Math.abs((ev.secoes[0].totais![2] as number) - ind.areaAcumulada) < 1e-6, 'acumulado final = acumulado do painel');
  const pa = gerarRelatorio(ds, 'paradas', f, 'Fulano', agora);
  assert.equal(pa.secoes[0].totais![4], ind.minParado, 'tempo parado somando os drones igual ao painel');
  assert.ok((pa.secoes[0].totais![3] as number) <= (pa.secoes[0].totais![4] as number), 'no relógio nunca passa da soma dos drones');
  const fz = gerarRelatorio(ds, 'fazenda', f, 'Fulano', agora);
  assert.ok(Math.abs((fz.secoes[0].totais![3] as number) - ind.areaPlanejada) < 1e-6 && Math.abs((fz.secoes[0].totais![4] as number) - ind.areaAcumulada) < 1e-6);
  const cl = gerarRelatorio(ds, 'clima', f, 'Fulano', agora);
  assert.ok(cl.secoes[0].linhas.length > 0);
  const opId = ds.operacoes.find((o) => o.data >= f.de && o.clima.length && o.calda.produtos.length)!.id;
  const tec = gerarRelatorio(ds, 'tecnico', f, 'Fulano', agora, { operacaoId: opId });
  assert.deepEqual(tec.secoes.map((s) => s.titulo.split(' ')[0]), ['Identificação', 'Áreas', 'Calda', 'Parâmetros', 'Condições', 'Paradas', 'Observações']);
  for (const r of RELATORIOS) {
    const x = gerarRelatorio(ds, r.id, f, 'Fulano', agora, { operacaoId: opId });
    assert.equal(x.responsavel, 'Fulano'); assert.equal(x.geradoEm, agora); assert.ok(x.filtros.length > 0);
    assert.equal(!!x.periodo, r.usaPeriodo);
  }
  // CSV: padrão Excel BR
  const csv = paraCSV(os);
  assert.ok(csv.startsWith('﻿Resumo por ordem de serviço\r\nPeríodo: 14/09/2026 a 19/10/2026\r\nFiltros: Sem filtros além do período\r\nGerado em: 20/10/2026 15:00 · Responsável: Fulano'));
  assert.ok(csv.includes(`Programado (ha);Aplicado (ha)`)); assert.ok(/;\d+,\d{2};/.test(csv), 'decimal com vírgula');
  // XLSX: XML bem formado com os totais numéricos
  const xl = arquivosXLSX(os);
  assert.ok(xl['xl/worksheets/sheet1.xml'].includes(`<v>${T[6]}</v>`));
  assert.equal(nomeArquivo(os, 'pdf'), 'resumo-por-ordem-de-servico_2026-09-14_a_2026-10-19.pdf');
});

import { indicadoresPeriodo, periodoB, compararPor, variacao } from '../src/domain/comparativo';
test('comparativo: período B, indicadores iguais ao painel e quebra fecha com o total', () => {
  const ds = gerarDemo(); const idx = criarIndices(ds);
  const fA: Filtros = { de: '2026-10-06', ate: '2026-10-19', campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
  assert.deepEqual(periodoB(fA, 'anterior'), { de: '2026-09-22', ate: '2026-10-05' });
  assert.deepEqual(periodoB(fA, 'semana'), { de: '2026-09-29', ate: '2026-10-12' });
  assert.deepEqual(periodoB(fA, 'livre', { de: '2026-09-01', ate: '2026-09-10' }), { de: '2026-09-01', ate: '2026-09-10' });
  const A = indicadoresPeriodo(ds, fA, idx); const ind = calcularIndicadores(ds, fA, idx);
  assert.ok(Math.abs(A.area - ind.areaPeriodo) < 1e-9 && A.prodEfetiva === ind.prodEfetiva && A.minParado === ind.minParado && A.dias === ind.diasComAplicacao);
  const fB = { ...fA, ...periodoB(fA, 'anterior') };
  for (const dim of ['aeronaveId', 'pilotoId', 'turnoId', 'fazenda'] as const) {
    const q = compararPor(ds, fA, fB, idx, dim, (_d, id) => id);
    assert.ok(Math.abs(q.reduce((s, x) => s + x.a.area, 0) - A.areaVoo) < 1e-6, `quebra ${dim} fecha com o total`);
    assert.ok(Math.abs(q.reduce((s, x) => s + x.b.area, 0) - indicadoresPeriodo(ds, fB, idx).areaVoo) < 1e-6);
  }
  assert.equal(variacao(110, 100), 10); assert.equal(variacao(5, 0), null); assert.equal(variacao(null, 3), null);
});

import { rastrear } from '../src/domain/rastreio';
test('rastreabilidade: OS e talhão com voos, paradas, lançamento, conclusão e acumulado correto', () => {
  const ds = gerarDemo();
  const os = ds.ordens.find((o) => ds.operacoes.filter((op) => op.osId === o.id).length >= 2 && ds.paradas.some((p) => ds.operacoes.find((op) => op.id === p.operacaoId)?.osId === o.id))!;
  const r = rastrear(ds, { tipo: 'os', id: os.id });
  const apl = api2(aplicacoes(ds));
  const total = os.itens.reduce((s, i) => s + (apl.get(`${os.id}|${i.talhaoId}`) ?? 0), 0);
  assert.ok(Math.abs(r.aplicado - total) < 1e-6, 'acumulado final = aplicado da OS');
  assert.ok(r.eventos.some((e) => e.tipo === 'voo') && r.eventos.some((e) => e.tipo === 'parada'));
  const ordenado = r.eventos.map((e) => e.quando);
  assert.deepEqual(ordenado, [...ordenado].sort());
  const acc = r.eventos.filter((e) => e.acumulado !== null).map((e) => e.acumulado!);
  assert.ok(acc.every((v, i) => i === 0 || v >= acc[i - 1]), 'acumulado não decresce');
  // talhão: só o que tocou aquele talhão
  const tid = os.itens[0].talhaoId;
  const rt = rastrear(ds, { tipo: 'talhao', id: tid });
  const aplT = ds.ordens.reduce((s, o) => s + (apl.get(`${o.id}|${tid}`) ?? 0), 0);
  assert.ok(Math.abs(rt.aplicado - aplT) < 1e-6);
  // com lançamento e conclusão (auditoria entra na linha do tempo)
  const d2 = osJacinto(); let k = 0;
  gravarAplicadoOS(d2, 'o1', distribuirDesconto(situacaoOS(d2, 'o1').talhoes, 32.17, ['t20']).aplicado, '2026-10-19', 'ficha_diaria', true, (p) => `${p}${++k}`);
  const r2 = rastrear(d2, { tipo: 'os', id: 'o1' });
  assert.ok(r2.eventos.some((e) => e.tipo === 'lancamento' && Math.abs((e.area ?? 0) - 32.17) < 1e-6));
  assert.ok(r2.eventos.some((e) => e.fonte === 'auditoria' && e.titulo.includes('obstáculo 0,53')));
  assert.equal(rastrear(d2, { tipo: 'talhao', id: 't20' }).aplicado, 11.8);
});

import { planejarCampanhas } from '../src/domain/planejamento';
test('planejamento: falta = programado − aplicado − obstáculos; datas e drone-turnos coerentes com a meta', () => {
  const ds = osJacinto();
  ds.campanhas[0].fim = '2026-10-30';
  let k = 0;
  gravarAplicadoOS(ds, 'o1', distribuirDesconto(situacaoOS(ds, 'o1').talhoes, 20, ['t20', 't21', 't22']).aplicado, '2026-10-19', 'manual', false, (p) => `${p}${++k}`);
  const [p] = planejarCampanhas(ds, '2026-10-20');
  assert.equal(round(p.falta, 2), 12.7); assert.equal(round(p.aplicado, 2), 20);
  assert.equal(p.diasAtePrazo, 11);
  assert.equal(round(p.necessarioDia!, 4), round(12.7 / 11, 4));
  assert.equal(round(p.droneTurnosNecessarios!, 4), round(12.7 / 11 / 192, 4), '192 ha por drone-turno');
  assert.equal(round(p.diasNaMeta!, 4), round(12.7 / 384, 4), 'meta diária = 2 turnos × 1 drone × 192');
  assert.equal(p.situacao, 'no_prazo');
  // concluída com obstáculo: nada falta
  gravarAplicadoOS(ds, 'o1', distribuirDesconto(situacaoOS(ds, 'o1').talhoes, 32.17, ['t20']).aplicado, '2026-10-20', 'manual', true, (p2) => `${p2}${++k}`);
  const [q] = planejarCampanhas(ds, '2026-10-20');
  assert.equal(q.falta, 0); assert.equal(q.situacao, 'concluida'); assert.equal(round(q.obstaculos, 2), 0.53);
});

import { resolverUnidade } from '../src/domain/base';
test('unidade/empresa é opcional: importar sem unidade e criar unidade digitada (sem duplicar)', () => {
  const tab = 'Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda A\t1\t10\tX\n2\tFazenda B\t2\t20\tX';
  const ds = baseVazia(); let k = 0; const gid = (p: string) => `${p}${++k}`;
  const r = importarSequencia(ds, lerSequencia(tab).linhas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Fungicida', inicio: '2026-10-01', fim: '2026-12-01' }, unidadeId: '', titulos: [] }, gid, true, '2026-10-21');
  assert.deepEqual(r.erros, [], 'sem unidade não bloqueia');
  assert.ok(ds.fazendas.every((f) => f.unidadeId === '') && ds.ordens.every((o) => o.unidadeId === ''));
  const ds2 = baseVazia();
  const prev = importarSequencia(ds2, lerSequencia(tab).linhas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Fungicida', inicio: '', fim: '' }, unidadeId: 'nova:Empresa Exemplo', titulos: [] }, gid, false, '2026-10-21');
  assert.deepEqual(prev.erros, []); assert.equal(ds2.unidades.length, 0, 'prévia não cria');
  importarSequencia(ds2, lerSequencia(tab).linhas, { campanhaId: '', novaCampanha: { nome: 'C', tipo: 'Fungicida', inicio: '', fim: '' }, unidadeId: 'nova:Empresa Exemplo', titulos: [] }, gid, true, '2026-10-21');
  assert.equal(ds2.unidades.length, 1); assert.equal(ds2.unidades[0].nome, 'Empresa Exemplo');
  assert.ok(ds2.fazendas.every((f) => f.unidadeId === ds2.unidades[0].id));
  assert.equal(resolverUnidade(ds2, 'nova:  empresa   exemplo ', gid), ds2.unidades[0].id, 'mesmo nome (sem acento/caixa/espaços) reaproveita');
  assert.equal(ds2.unidades.length, 1);
  assert.equal(resolverUnidade(ds2, '', gid), ''); assert.equal(resolverUnidade(ds2, 'nova:', gid), '');
  // talhões e PDF também sem unidade
  const lt = lerTalhoes('Fazenda;Talhão;Área\nFazenda Nova;1;5');
  assert.deepEqual(importarTalhoes(baseVazia(), lt.linhas, '', gid, true).erros, []);
  const d = lerOSdoPdf(PDF_3410, 'OS 3410 - FN 094-095.pdf');
  assert.deepEqual(importarOSPdf(baseVazia(), [d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '', fim: '' }, unidadeId: '', usarTratamento: false }, gid, true, '2026-10-21').erros, []);
});

import { lerRelatorioEstacao, importarEstacao, contextoClima, deltaT, bulboUmido, dataHora, resumoContexto, resumoDiario } from '../src/domain/estacao';
test('estação: lê o relatório diário REAL (30 PICs × 8 dias), liga à fazenda pelo código e dá o contexto do dia', () => {
  const linhas = JSON.parse(readFileSync('tests/fixtures/estacao-diario.json', 'utf8'));
  const l = lerRelatorioEstacao(linhas);
  assert.deepEqual(l.erros, []);
  assert.equal(l.estacoes.length, 30); assert.equal(l.registros.length, 240); assert.ok(l.diario);
  assert.deepEqual(l.periodo, { de: '2026-10-15', ate: '2026-10-22' });
  assert.equal(l.estacoes.filter((e) => e.temVento).length, 12, '12 estações com anemômetro');
  const pic25 = l.estacoes.find((e) => e.pic === '25')!;
  assert.equal(pic25.fn, '17'); assert.equal(pic25.lat, -22.979739);
  assert.ok(l.avisos.some((a) => a.includes('628 hPa')), 'pressão implausível sinalizada');
  const r19 = l.registros.find((r) => r.estacaoId === pic25.id && r.inicio === '2026-10-19')!;
  assert.deepEqual([r19.chuva, r19.tmin, r19.tmax, r19.urmin, r19.urmax], [0.2, 12, 30, 30, 94]);
  // importar duas vezes não duplica; fazenda FN 17 é ligada à PIC 25
  const ds = osJacinto();
  ds.fazendas.push({ id: 'f17', unidadeId: 'u1', codigo: '017', nome: 'Santa Rita', municipio: '' });
  const r = importarEstacao(ds, l);
  assert.equal(r.fazendasLigadas, 1); assert.equal(ds.fazendas.find((f) => f.id === 'f17')!.estacaoId, pic25.id);
  importarEstacao(ds, lerRelatorioEstacao(linhas));
  assert.equal(ds.registrosEstacao.length, 240); assert.equal(ds.estacoes.length, 30);
  ds.ordens.push({ ...ds.ordens[0], id: 'o17', fazendaId: 'f17', numero: '9999' });
  const c = contextoClima(ds, { osId: 'o17', data: '2026-10-19', horaInicio: '07:00', horaFim: '09:00' })!;
  assert.ok(c.diario, 'só há dado diário: marcado como resumo do dia');
  assert.equal(c.chuva, 0.2); assert.equal(c.tmax, 30); assert.equal(c.urmin, 30);
  assert.ok(c.alertas.some((a) => a.includes('UR mín.')) && c.alertas.some((a) => a.includes('sem sensor de vento')));
  assert.ok(resumoContexto(c).startsWith('Resumo do dia · PIC 25'));
  assert.equal(contextoClima(ds, { osId: 'o1', data: '2026-10-19', horaInicio: '07:00', horaFim: '09:00' }), null, 'fazenda sem estação ligada');
});

test('estação: ΔT por Stull (2011) e relatório horário cobre o horário do voo (inclusive após a meia-noite)', () => {
  assert.ok(Math.abs(bulboUmido(20, 50) - 13.7) < 0.1, 'exemplo do artigo: 20 °C, 50% → 13,7 °C');
  assert.equal(deltaT(20, 50), 6.3); assert.equal(deltaT(30, 100), null);
  assert.equal(dataHora('22/10/2026 13:15'), '2026-10-22T13:15'); assert.equal(dataHora(46317.5), '2026-10-22T12:00');
  const cab = ['ID', 'PIC', 'Lat.', 'Lon.', 'Início [GMT-3]', 'Fim [GMT-3]', 'Chuva [mm]', 'Temp. [°C]', 'Umidade [%]', 'Vento médio [km/h]', 'Rajada máx. [km/h]'];
  const linhas = [cab, ...['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'].map((h, i) => [1, '017 - Faz X - PIC 25', '-22,9', '-49,7', `19/10/2026 ${h}`, `19/10/2026 ${String(18 + i + 1).padStart(2, '0').replace('24', '23')}:${i === 5 ? '59' : '00'}`, 0, 24 - i, 60 + i * 5, 3 + i, 8 + i * 2])];
  const l = lerRelatorioEstacao(linhas);
  assert.ok(!l.diario);
  const ds = osJacinto(); ds.fazendas[0].codigo = '17';
  importarEstacao(ds, l);
  const c = contextoClima(ds, { osId: 'o1', data: '2026-10-19', horaInicio: '19:30', horaFim: '21:30' })!;
  assert.ok(!c.diario, 'usa os registros do horário do voo');
  assert.equal(c.registros.length, 3, '19h, 20h e 21h');
  assert.equal(c.rajada, 14); assert.equal(c.tmax, 23); assert.equal(c.urmin, 65);
  assert.ok(c.alertas.some((a) => a.includes('rajada máx. durante o voo 14 km/h > 10')));
});

test('estação: relatório HORÁRIO real (PIC 25, 03 e 20) — voo usa só as horas cobertas, com extremos medidos', () => {
  const linhas = JSON.parse(readFileSync('tests/fixtures/estacao-horario.json', 'utf8'));
  const l = lerRelatorioEstacao(linhas);
  assert.deepEqual(l.erros, []);
  assert.ok(!l.diario, 'reconhecido como horário');
  assert.equal(l.estacoes.length, 3); assert.equal(l.registros.length, 537);
  assert.deepEqual(l.periodo, { de: '2026-10-15', ate: '2026-10-22' });
  const p03 = l.estacoes.find((e) => e.pic === '3')!; const p25 = l.estacoes.find((e) => e.pic === '25')!;
  assert.ok(p03.temVento && !p25.temVento);
  assert.ok(l.avisos.some((a) => a.includes('hPa')), 'PIC 20 com pressão implausível');
  const ds = osJacinto(); ds.fazendas[0].codigo = '058'; // Santana Nova = PIC 03
  importarEstacao(ds, l);
  assert.equal(ds.fazendas[0].estacaoId, p03.id);
  const regs = ds.registrosEstacao.filter((r) => r.estacaoId === p03.id && r.inicio >= '2026-10-21T07:00' && r.inicio < '2026-10-21T10:00');
  assert.equal(regs.length, 3);
  const c = contextoClima(ds, { osId: 'o1', data: '2026-10-21', horaInicio: '07:15', horaFim: '09:40' })!;
  assert.ok(!c.diario); assert.equal(c.registros.length, 3, '07h, 08h e 09h');
  assert.equal(c.rajada, Math.max(...regs.map((r) => r.rajada!)));
  assert.equal(c.tmax, Math.max(...regs.map((r) => r.tmax!)), 'usa T máx. medida na hora, não a média');
  assert.equal(c.urmin, Math.min(...regs.map((r) => r.urmin!)));
  assert.ok(resumoContexto(c).startsWith('Durante o voo · PIC 3'));
  // reimportar não duplica
  importarEstacao(ds, lerRelatorioEstacao(linhas)); assert.equal(ds.registrosEstacao.length, 537);
});

test('estação: diário + horário do mesmo dia não somam a chuva em dobro; sem diário, soma as horas', () => {
  const ds = osJacinto();
  importarEstacao(ds, lerRelatorioEstacao(JSON.parse(readFileSync('tests/fixtures/estacao-horario.json', 'utf8'))));
  const p3 = ds.estacoes.find((e) => e.pic === '3')!;
  const soHoras = resumoDiario(ds, p3.id).find((d) => d.data === '2026-10-15')!;
  assert.equal(soHoras.fonte, 'horario'); assert.equal(soHoras.horas, 24); assert.equal(soHoras.chuva, 16, 'soma das 24 h = 16 mm');
  importarEstacao(ds, lerRelatorioEstacao(JSON.parse(readFileSync('tests/fixtures/estacao-diario.json', 'utf8'))));
  const ambos = resumoDiario(ds, p3.id).find((d) => d.data === '2026-10-15')!;
  assert.equal(ambos.fonte, 'diario'); assert.equal(ambos.chuva, 16, 'não 32: usa o total diário');
  const ult = resumoDiario(ds, p3.id).find((d) => d.data === '2026-10-22')!;
  assert.equal(ult.fonte, 'diario');
});

import { ratear, alvoDiaOS, tempoDrone, previaFechamento, gravarFechamento, fichaVazia, type FichaDia } from '../src/domain/fechamentoDia';
function dia1410() {
  const ds = osJacinto();
  ds.produtos.push({ id: 'pr1', nome: 'Fungicida X', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' } as never);
  ds.ordens[0].calda = { volumeLHa: 10, produtos: [{ produtoId: 'pr1', dosePlanejada: 0.5, doseReal: null, unidade: 'L/ha' as never }] };
  const faz: [string, string, string, [string, number][]][] = [['f2', '18', 'Sítio Clementino', [['c1', 10], ['c2', 6.01]]], ['f3', '19', 'Sítio José Lopes', [['j1', 28.22]]], ['f4', '20', 'Sítio Nunes', [['n1', 20], ['n2', 23.09]]]];
  faz.forEach(([id, cod, nm, ts], k) => {
    ds.fazendas.push({ id, unidadeId: 'u1', codigo: cod, nome: nm, municipio: '' });
    ts.forEach(([tid, a]) => ds.talhoes.push({ id: tid, fazendaId: id, codigo: tid, areaHa: a }));
    ds.ordens.push({ ...ds.ordens[0], id: `o${k + 2}`, numero: `34${k + 20}`, fazendaId: id, sequencia: k + 2, itens: ts.map(([tid, a]) => ({ talhaoId: tid, areaPlanejadaHa: a })) });
  });
  ds.colaboradores.push({ id: 'p1', nome: 'Piloto D', funcao: 'Piloto', ativo: true } as never, { id: 'p2', nome: 'Piloto A', funcao: 'Piloto', ativo: true } as never, { id: 'l1', nome: 'Líder', funcao: 'Líder de turno', ativo: true } as never);
  ds.turnos.push({ id: 'tn', nome: 'Turno B', periodo: 'Diurno', horaInicio: '12:00', horaFim: '23:59', liderId: 'l1', ativo: true });
  ds.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '1', status: 'ativa', unidadeId: 'u1', horasAnteriores: 0, pilotoPadraoId: 'p1' } as never, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '2', status: 'ativa', unidadeId: 'u1', horasAnteriores: 0, pilotoPadraoId: 'p2' } as never);
  const f: FichaDia = { ...fichaVazia('2026-10-14'), inicio: '12:30', fim: '23:00', turnoId: 'tn', liderId: 'l1', responsavel: 'Teste',
    pausas: [{ motivo: 'Umidade abaixo do limite', inicio: '13:04', fim: '18:15' }, { motivo: 'Deslocamento', inicio: '20:10', fim: '20:45', observacoes: 'Mudança de área' }],
    drones: [{ aeronaveId: 'aD', pilotoId: 'p1', area: 64.75, inicio: '', fim: '', pausas: [] }, { aeronaveId: 'aA', pilotoId: 'p2', area: 54.75, inicio: '', fim: '', pausas: [] }],
    fazendas: [{ osId: 'o1', real: 32.17, concluir: true, descontoEm: ['t20'] }, { osId: 'o2', real: 16.01, concluir: false, descontoEm: [] }, { osId: 'o3', real: 28.22, concluir: false, descontoEm: [] }, { osId: 'o4', real: 43.09, concluir: false, descontoEm: [] }],
    clima: { tIni: 24, urIni: 55, vIni: 6, tFim: 17, urFim: 68, vFim: 5 } };
  return { ds, f };
}
const somaCol = (m: number[][], j: number) => round(m.reduce((s, l) => s + l[j], 0), 2);

test('fechamento: rateio 350 = 145 + 205 fecha linhas e colunas exatamente; célula editada mantém os totais', () => {
  const r = ratear([120, 95.5, 134.5], [145, 205], [[null, null], [null, null], [null, null]]);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.m, [[49.72, 70.28], [39.56, 55.94], [55.72, 78.78]]);
  assert.equal(somaCol(r.m, 0), 145); assert.equal(somaCol(r.m, 1), 205);
  assert.ok(r.estimada.every((l) => l.every(Boolean)));
  const e = ratear([120, 95.5, 134.5], [145, 205], [[null, null], [95.5, null], [null, null]]);
  assert.deepEqual(e.m[1], [95.5, 0], 'T70 D fez toda a fazenda Y → T70 A = 0');
  assert.equal(somaCol(e.m, 0), 145); assert.equal(somaCol(e.m, 1), 205);
  assert.ok(e.m.every((l, i) => round(l[0] + l[1], 2) === [120, 95.5, 134.5][i]));
  assert.equal(e.estimada[1][0], false);
  const falta = ratear([120, 95.5, 132.7], [145, 205], [[null, null], [null, null], [null, null]]);
  assert.ok(falta.erros[0].startsWith('Faltam 1,80 ha'), falta.erros[0]);
});

test('fechamento: ficha real de 14/10 → voos com ha/h efetivo, pausas sem sobreposição, obstáculo 0,53 no talhão 20', () => {
  const { ds, f } = dia1410();
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  const p = previaFechamento(ds, f, gid, '2026-10-14T23:10:00');
  assert.deepEqual(p.erros, []);
  assert.ok(p.avisos.some((a) => a.includes('0,01 ha')), 'diferença 119,49 × 119,50 absorvida e avisada');
  const t = p.tempos[0]!;
  assert.deepEqual([t.total, t.parado, t.efetivo], [630, 346, 284], 'jornada 10h30, parado 5h46, efetivo 4h44');
  assert.equal(somaCol(p.rateio.m, 0) + somaCol(p.rateio.m, 1), 119.49);
  assert.deepEqual(p.rateio.m[0], [17.43, 14.74], 'Jacinto I = T70 D 17,43 + T70 A 14,74');
  // gravar
  assert.equal(gravarFechamento(ds, f, gid, '2026-10-14T23:10:00'), null);
  const ops = ds.operacoes;
  assert.equal(ops.length, 8, '2 drones × 4 fazendas');
  for (const ac of ['aD', 'aA']) {
    const o = ops.filter((x) => x.aeronaveId === ac);
    assert.equal(o.reduce((s, x) => s + x.tempoEfetivoMin, 0), 284, 'tempo efetivo do drone preservado');
    const ps = ds.paradas.filter((x) => o.some((y) => y.id === x.operacaoId)).sort((a, b) => a.inicio.localeCompare(b.inicio));
    assert.equal(ps.reduce((s, x) => s + duracaoParadaMin(x)!, 0), 346);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].inicio >= ps[i - 1].fim!, 'paradas não se sobrepõem');
    assert.ok(o.every((x) => x.pilotoId === (ac === 'aD' ? 'p1' : 'p2') && x.fechamentoDia === '2026-10-14'));
  }
  const area = (ac: string) => round(ops.filter((x) => x.aeronaveId === ac).reduce((s, x) => s + x.itens.reduce((a, i) => a + i.areaHa, 0), 0), 2);
  assert.equal(area('aD') + area('aA'), 119.49);
  const apl = api2(aplicacoes(ds));
  assert.equal(round(['t19', 't20', 't21', 't22'].reduce((s, t) => s + (apl.get(`o1|${t}`) ?? 0), 0), 2), 32.17);
  assert.equal(round(apl.get('o1|t20')!, 2), 11.8, 'desconto ficou no talhão 20');
  assert.equal(round(obstOS(ds.ordens[0], apl), 2), 0.53);
  assert.equal(ds.ordens[0].concluidaManual, true);
  // reimportar o mesmo dia substitui, não duplica
  assert.equal(previaFechamento(ds, { ...f, fazendas: f.fazendas.map((x) => ({ ...x, concluir: false })) }, gid, '').substitui.length, 8);
  assert.equal(gravarFechamento(ds, { ...f, fazendas: f.fazendas.map((x, i) => ({ ...x, concluir: i === 0 })) }, gid, ''), null);
  assert.equal(ds.operacoes.length, 8);
  assert.equal(ds.lancamentos.length, 0, 'nada de área sem voo');
});

test('fechamento: drone que quebrou para só ele; clima trocado e total que não fecha bloqueiam', () => {
  const { ds, f } = dia1410();
  f.drones[1].pausas = [{ motivo: 'Falha de equipamento', inicio: '21:00', fim: '22:00' }];
  const p = previaFechamento(ds, f, (x) => x + Math.random(), '');
  assert.deepEqual(p.erros, []);
  assert.equal(p.tempos[0]!.efetivo, 284); assert.equal(p.tempos[1]!.efetivo, 224, 'T70 A parou 1 h a mais');
  // pausa do drone sobreposta à do dia não conta em dobro
  const f2 = { ...f, drones: [f.drones[0], { ...f.drones[1], pausas: [{ motivo: 'Falha de equipamento' as const, inicio: '18:00', fim: '18:30' }] }] };
  assert.equal(previaFechamento(ds, f2, (x) => x + Math.random(), '').tempos[1]!.parado, 346 + 15);
  const tr = previaFechamento(ds, { ...f, clima: { ...f.clima, tFim: 68, urFim: 17 } }, (x) => x, '');
  assert.ok(tr.erros.some((e) => e.includes('parecem trocadas')));
  const nf = previaFechamento(ds, { ...f, fazendas: f.fazendas.map((x, i) => (i === 3 ? { ...x, real: 41.3 } : x)) }, (x) => x, '');
  assert.ok(nf.erros.some((e) => e.startsWith('Faltam 1,80 ha')), nf.erros.join('|'));
  const sp = previaFechamento(ds, { ...f, drones: f.drones.map((d) => ({ ...d, pilotoId: '' })) }, (x) => x, '');
  assert.ok(sp.erros.some((e) => e.includes('piloto')));
  const sd = alvoDiaOS(ds, 'o1', 32.17, true, []);
  assert.ok(sd.erros[0].includes('Marque em qual talhão'));
  assert.equal(typeof tempoDrone({ ...f, inicio: '' }, f.drones[0]), 'string');
});

import { redistribuirEstimados } from '../src/domain/fechamentoDia';
test('fechamento: indicar o talhão do desconto depois redistribui os voos do dia sem mudar a área de cada drone', () => {
  const { ds, f } = dia1410();
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  f.fazendas[0].concluir = false; f.fazendas[0].descontoEm = [];
  assert.equal(gravarFechamento(ds, f, gid, ''), null);
  const porDrone = () => ['aD', 'aA'].map((ac) => round(ds.operacoes.filter((o) => o.aeronaveId === ac).reduce((s, o) => s + o.itens.reduce((a, i) => a + i.areaHa, 0), 0), 4));
  const antes = porDrone();
  let apl = api2(aplicacoes(ds));
  assert.ok(apl.get('o1|t20')! > 11.8, 'sem desconto indicado, o dia foi dividido pelo saldo (estimado)');
  const sit = jaPorTalhaoT(ds);
  const d = distribuirDesconto(sit.map((t) => ({ ...t, voos: 0 })), 32.17, ['t20']);
  assert.equal(redistribuirEstimados(ds, 'o1', d.aplicado), null);
  apl = api2(aplicacoes(ds));
  assert.equal(round(apl.get('o1|t20')!, 2), 11.8);
  assert.equal(round(['t19', 't20', 't21', 't22'].reduce((s, t) => s + apl.get(`o1|${t}`)!, 0), 2), 32.17);
  assert.deepEqual(porDrone(), antes, 'área de cada drone inalterada');
  ds.ordens[0].concluidaManual = true;
  assert.equal(round(obstOS(ds.ordens[0], apl), 2), 0.53);
});
function jaPorTalhaoT(ds: ReturnType<typeof baseVazia>) { return ds.ordens[0].itens.map((i) => ({ talhaoId: i.talhaoId, programado: i.areaPlanejadaHa, voos: 0 })); }

import { lerCodigoAcomp, fichaDoDiaAcomp, pausasDaTimeline } from '../src/domain/acomp';
test('app de acompanhamento: código ACOMP1 real → 2 dias fechados; 14/10 vira fechamento completo, 20/10 aponta a fazenda sem OS', () => {
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  assert.equal(l.erro, null);
  assert.equal(l.campanha, 'FUNGICIDA'); assert.equal(l.meta, 844.01);
  assert.deepEqual(l.dias.map((d) => [d.data, d.t70d, d.t70a, d.fazendas.length]), [['2026-10-14', 64.75, 54.75, 4], ['2026-10-20', 25.6, 54.94, 1]]);
  assert.equal(l.seq['JACINTO I'].concluida, true); assert.equal(l.seq['IPÊ'].concluida, false);
  assert.deepEqual(pausasDaTimeline(l.dias[0].timeline, '23:00').map((p) => [p.inicio, p.fim, p.motivo]), [['13:04', '18:15', 'Umidade abaixo do limite'], ['20:10', '20:45', 'Deslocamento']]);
  assert.deepEqual(pausasDaTimeline(l.dias[1].timeline, '22:40'), [], '20/10 sem pausas; o fim por vento vira observação');
  const { ds } = dia1410();
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  const a = fichaDoDiaAcomp(ds, l, l.dias[0], base);
  assert.deepEqual(a.pendencias, []);
  assert.deepEqual(a.ficha.drones.map((d) => [d.aeronaveId, d.pilotoId, d.area]), [['aD', 'p1', 64.75], ['aA', 'p2', 54.75]]);
  assert.deepEqual(a.ficha.fazendas.map((z) => [z.osId, z.real, z.concluir]), [['o1', 32.17, true], ['o2', 16.01, true], ['o3', 28.22, true], ['o4', 43.09, true]]);
  assert.deepEqual([a.ficha.clima.tFim, a.ficha.clima.urFim], [17, 68], 'clima já corrigido no app');
  let p = previaFechamento(ds, a.ficha, (x) => x + Math.random(), '');
  assert.ok(p.erros.some((e) => e.includes('OS 3416') && e.includes('Marque em qual talhão')), 'Jacinto concluída com saldo pede o talhão do desconto');
  a.ficha.fazendas[0].descontoEm = ['t20'];
  p = previaFechamento(ds, a.ficha, (x) => x + Math.random(), '');
  assert.deepEqual(p.erros, []);
  assert.equal(p.tempos[0]!.efetivo, 284);
  const b = fichaDoDiaAcomp(ds, l, l.dias[1], base);
  assert.ok(b.pendencias.some((x) => x.includes('"IPÊ" não está no protótipo')));
  assert.ok(b.avisos.some((x) => x.startsWith('T70 D fez bem menos área')));
  assert.ok(b.ficha.observacoes.includes('Vento acima do limite'));
  assert.ok(lerCodigoAcomp('ACOMP1:abc').erro);
});

import { dataSuspeita } from '../src/domain/acomp';
test('app de acompanhamento: data errada (14/10 fechado em 20/10) é sinalizada; corrigir para 19/10 grava em 19/10 e substitui o que foi gravado como 14/10', () => {
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  assert.ok(dataSuspeita(l.dias[0])!.includes('fechado em 20/10/2026 (6 dias depois)'));
  assert.equal(dataSuspeita(l.dias[1]), null, '20/10 fechado na madrugada de 21/10 é normal');
  const { ds } = dia1410();
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  // grava primeiro com a data errada (como estava no app)
  const errada = fichaDoDiaAcomp(ds, l, l.dias[0], base);
  assert.ok(errada.avisos.some((a) => a.includes('Confira a data')));
  errada.ficha.fazendas[0].descontoEm = ['t20'];
  assert.equal(gravarFechamento(ds, errada.ficha, gid, ''), null);
  assert.equal(ds.operacoes.filter((o) => o.fechamentoDia === '2026-10-14').length, 8);
  // corrige para 19/10
  const certa = fichaDoDiaAcomp(ds, l, l.dias[0], base, '2026-10-19');
  assert.equal(certa.ficha.data, '2026-10-19'); assert.equal(certa.ficha.substituiDia, '2026-10-14');
  assert.ok(certa.avisos.some((a) => a.includes('data antiga (14/10/2026)')));
  assert.ok(certa.ficha.observacoes.startsWith('Data corrigida'));
  certa.ficha.fazendas[0].descontoEm = ['t20'];
  const p = previaFechamento(ds, certa.ficha, gid, '');
  assert.deepEqual(p.erros, []); assert.equal(p.substitui.length, 8);
  assert.equal(gravarFechamento(ds, certa.ficha, gid, ''), null);
  assert.equal(ds.operacoes.filter((o) => o.fechamentoDia === '2026-10-14').length, 0, 'nada fica em 14/10');
  assert.equal(ds.operacoes.filter((o) => o.fechamentoDia === '2026-10-19' && o.data === '2026-10-19').length, 8);
  assert.equal(ds.operacoes.length, 8, 'não duplicou');
});

import { importarSequencia, importarTalhoes, lerSequencia, lerTalhoes as lerTalhoesTxt } from '../src/domain/importacao';
test('cadeia real FUNGICIDA: sequência + talhões (ñ aplicado) + código do app → 19/10 e 20/10 fechados; obstáculos iguais às planilhas', () => {
  const ds = baseVazia();
  let k = 0; const gid = (p: string) => `${p}${++k}`;
  const seq = importarSequencia(ds, lerSequencia(readFileSync('tests/fixtures/fungicida-sequencia.txt', 'utf8')).linhas, { campanhaId: '', novaCampanha: { nome: 'FUNGICIDA', tipo: 'Fungicida', inicio: '2026-10-01', fim: '2026-11-30' }, unidadeId: '', titulos: [] }, gid, true, '2026-10-22');
  assert.deepEqual(seq.erros, []);
  const tal = importarTalhoes(ds, lerTalhoesTxt(readFileSync('tests/fixtures/fungicida-talhoes.txt', 'utf8')).linhas, '', gid, true);
  assert.deepEqual(tal.erros, []); assert.equal(tal.osAjustadas, 5, 'as 5 OS passam a usar os talhões reais');
  const os = (nome: string) => ds.ordens.find((o) => ds.fazendas.find((f) => f.id === o.fazendaId)!.nome === nome)!;
  const prog = (nome: string) => round(os(nome).itens.reduce((s, i) => s + i.areaPlanejadaHa, 0), 2);
  const prev = (nome: string) => round(os(nome).itens.reduce((s, i) => s + (i.naoAplicadoHa ?? 0), 0), 2);
  assert.deepEqual(['Jacinto I', 'Sítio Clementino', 'Sítio José Lopes', 'Sítio Nunes', 'Ipê'].map((n) => [prog(n), prev(n)]), [[32.7, 0.53], [16.01, 0], [30.06, 1.84], [43.57, 0.48], [80.93, 0.39]]);
  // calda e equipe (no protótipo: campanha, aeronaves com piloto fixo, turno)
  ds.produtos.push({ id: 'pr1', nome: 'Produto 1', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' } as never);
  for (const o of ds.ordens) o.calda = { volumeLHa: 0, produtos: [{ produtoId: 'pr1', dosePlanejada: 0.6, doseReal: null, unidade: 'L/ha' as never }] };
  assert.deepEqual(ds.ordens.map((o) => o.numero), ['3416', '3415', '3415', '3414', '3413'], 'OS 3415 cobre Clementino e José Lopes');
  ds.colaboradores.push({ id: 'p1', nome: 'P1', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'p2', nome: 'P2', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'l1', nome: 'L', funcao: 'Líder de turno', unidadeId: '', ativo: true });
  ds.turnos.push({ id: 'tn', nome: 'T', periodo: 'Noturno', horaInicio: '12:00', horaFim: '06:00', liderId: 'l1', ativo: true });
  ds.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '1', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '2', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p2' });
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  const d19 = fichaDoDiaAcomp(ds, l, l.dias[0], base, '2026-10-19');
  assert.deepEqual(d19.pendencias, []);
  assert.ok(previaFechamento(ds, d19.ficha, gid, '').erros.some((e) => e.includes('informe a taxa de aplicação')), 'sem volume na OS nem no dia: pede o volume');
  d19.ficha.volumeLHa = 15;
  assert.deepEqual(previaFechamento(ds, d19.ficha, gid, '').erros, [], 'sem marcar nada: o desconto vem do ñ aplicado da planilha');
  assert.equal(gravarFechamento(ds, d19.ficha, gid, ''), null);
  assert.ok(ds.operacoes.every((o) => o.calda.volumeLHa === 15) && ds.ordens.every((o) => o.calda.volumeLHa === 0), 'volume do dia vai para os voos; a OS não muda');
  const d20 = fichaDoDiaAcomp(ds, l, l.dias[1], { ...base, volumeLHa: 15 });
  d20.ficha.fazendas[0].volumeLHa = 12;
  assert.deepEqual(d20.pendencias, []);
  assert.equal(gravarFechamento(ds, d20.ficha, gid, ''), null);
  assert.ok(ds.operacoes.filter((o) => o.fechamentoDia === '2026-10-20').every((o) => o.calda.volumeLHa === 12), 'volume próprio da fazenda prevalece sobre o do dia');
  const apl = api2(aplicacoes(ds));
  const talhao = (faz: string, cod: string) => { const o = os(faz); const t = ds.talhoes.find((x) => x.fazendaId === o.fazendaId && x.codigo.replace(/^0+/, '') === cod)!; return round(apl.get(`${o.id}|${t.id}`) ?? 0, 2); };
  assert.deepEqual([talhao('Jacinto I', '20'), talhao('Sítio José Lopes', '4'), talhao('Sítio José Lopes', '5'), talhao('Sítio Nunes', '10'), talhao('Sítio Nunes', '11')], [11.8, 12.34, 5.97, 3.71, 1.85], 'igual à coluna "real" das planilhas');
  recalcularStatusOS(ds);
  assert.deepEqual(['Jacinto I', 'Sítio Clementino', 'Sítio José Lopes', 'Sítio Nunes'].map((n) => round(obstOS(os(n), apl), 2)), [0.53, 0, 1.84, 0.48]);
  assert.equal(round(os('Ipê').itens.reduce((s, i) => s + (apl.get(`${os('Ipê').id}|${i.talhaoId}`) ?? 0), 0), 2), 80.54);
  assert.notEqual(os('Ipê').status, 'concluida', 'Ipê segue em andamento (não concluída no app)');
  assert.equal(round(ds.operacoes.reduce((s, o) => s + o.itens.reduce((a, i) => a + i.areaHa, 0), 0), 2), 200.03, '119,49 + 80,54');
});

import { lerTratamento as lerTrat2 } from '../src/domain/importacao';
test('bloco de tratamento da campanha FUNGICIDA (planilha): 6 produtos com dose em L/ha', () => {
  const t = lerTrat2(readFileSync('tests/fixtures/fungicida-tratamento.txt', 'utf8'));
  assert.deepEqual(t.itens.map((i) => [i.produto, i.dose, i.unidade]), [['AUREO', 0.02, 'L/ha'], ['CARAVAN', 0.5, 'L/ha'], ['DNA GRID', 0.5, 'L/ha'], ['PRIORI TOP', 0.6, 'L/ha'], ['RE-LEAF', 1, 'L/ha'], ['DIRECT', 0.02, 'L/ha']]);
});

test('importar OS por PDF e por tabela: taxa de aplicação (L/ha) informada vai para a campanha e para todas as OS; início da campanha respeitado', () => {
  const d = lerOSdoPdf(PDF_3410, 'OS 3410 - FN 094-095.pdf');
  const semTaxa = importarOSPdf(baseVazia(), [d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '2026-10-14', fim: '2026-11-14' }, unidadeId: '', usarTratamento: true }, (p) => p + Math.random(), false, '2026-10-23');
  assert.ok(semTaxa.avisos.some((a) => a.includes('taxa de aplicação (L/ha) não encontrada')));
  const ds = baseVazia(); let k = 0;
  const r = importarOSPdf(ds, [d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '2026-10-14', fim: '2026-11-14' }, unidadeId: '', usarTratamento: true, taxaLHa: 15 }, (p) => `${p}${++k}`, true, '2026-10-23');
  assert.deepEqual(r.erros, []);
  assert.ok(!r.avisos.some((a) => a.includes('taxa de aplicação')), 'com a taxa informada, o aviso some');
  assert.ok(ds.ordens.length > 0 && ds.ordens.every((o) => o.calda.volumeLHa === 15));
  assert.equal(ds.campanhas[0].calda!.volumeLHa, 15); assert.equal(ds.campanhas[0].inicio, '2026-10-14');
  assert.ok(importarOSPdf(baseVazia(), [d], { campanhaId: '', novaCampanha: { nome: 'F', tipo: 'Fungicida', inicio: '', fim: '' }, unidadeId: '', usarTratamento: true, taxaLHa: 500 }, (p) => p, false, '2026-10-23').erros[0].includes('não é plausível'));
  const ds2 = baseVazia();
  importarSequencia(ds2, lerSequencia(readFileSync('tests/fixtures/fungicida-sequencia.txt', 'utf8')).linhas, { campanhaId: '', novaCampanha: { nome: 'FUNGICIDA', tipo: 'Fungicida', inicio: '2026-10-14', fim: '2026-11-30' }, unidadeId: '', titulos: [], taxaLHa: 15 }, (p) => `${p}${++k}`, true, '2026-10-23');
  assert.ok(ds2.ordens.length === 5 && ds2.ordens.every((o) => o.calda.volumeLHa === 15));
  assert.equal(ds2.campanhas[0].inicio, '2026-10-14');
});

import { lerKmlVoos, agruparVoos, sugerirOS, aplicarKmlNaFicha } from '../src/domain/kmlVoo';
function baseFungicida() {
  const ds = baseVazia(); let k = 0; const gid = (p: string) => `${p}${++k}`;
  importarSequencia(ds, lerSequencia(readFileSync('tests/fixtures/fungicida-sequencia.txt', 'utf8')).linhas, { campanhaId: '', novaCampanha: { nome: 'FUNGICIDA', tipo: 'Fungicida', inicio: '2026-10-14', fim: '2026-11-30' }, unidadeId: '', titulos: [], taxaLHa: 15 }, gid, true, '2026-10-23');
  importarTalhoes(ds, lerTalhoesTxt(readFileSync('tests/fixtures/fungicida-talhoes.txt', 'utf8')).linhas, '', gid, true);
  ds.produtos.push({ id: 'pr1', nome: 'Produto 1', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' } as never);
  for (const o of ds.ordens) o.calda.produtos = [{ produtoId: 'pr1', dosePlanejada: 0.6, doseReal: null, unidade: 'L/ha' as never }];
  ds.colaboradores.push({ id: 'p1', nome: 'P1', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'p2', nome: 'P2', funcao: 'Piloto', unidadeId: '', ativo: true }, { id: 'l1', nome: 'L', funcao: 'Líder de turno', unidadeId: '', ativo: true });
  ds.turnos.push({ id: 'tn', nome: 'T', periodo: 'Noturno', horaInicio: '12:00', horaFim: '06:00', liderId: 'l1', ativo: true });
  ds.aeronaves.push({ id: 'aD', identificacao: 'T70 D', modelo: 'T70', numeroSerie: '', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p1' }, { id: 'aA', identificacao: 'T70 A', modelo: 'T70', numeroSerie: '', status: 'disponivel', unidadeId: '', horasAnteriores: 0, pilotoPadraoId: 'p2' });
  return { ds, gid };
}
test('KML de voo real: 84 voos, unidades reconhecidas, 4 grupos = áreas reais das fazendas; 17 voos fora da taxa', () => {
  const l = lerKmlVoos(readFileSync('tests/fixtures/voos-unificados.kml', 'utf8'));
  assert.deepEqual(l.erros, []);
  assert.equal(l.voos.length, 84);
  assert.ok(l.unidades.includes('mL → L') && l.unidades.includes('ms → min'), l.unidades);
  assert.deepEqual([...new Set(l.voos.map((v) => v.serie))].sort(), ['B26WN690025DVC', 'B26WN6P0025KDU']);
  assert.equal(round(l.voos.reduce((s, v) => s + v.areaHa, 0), 2), 200.04);
  assert.equal(l.voos[0].tempoMin, 10.4); assert.equal(l.voos[0].taxa, 14.94);
  const g = agruparVoos(l.voos, 15);
  assert.deepEqual(g.map((x) => round(x.areaHa, 2)), [80.54, 44.23, 43.09, 32.17]);
  assert.equal(g.reduce((s, x) => s + x.foraTaxa.length, 0), 17);
  assert.equal(round(g.reduce((s, x) => s + x.volumeL, 0), 1), 3519.1);
});

test('KML de voo + ficha do app: área de cada drone em cada fazenda vem do KML; local da fazenda aprendido; 20/10 Ipê pelo KML', () => {
  const { ds, gid } = baseFungicida();
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  const grupos = agruparVoos(lerKmlVoos(readFileSync('tests/fixtures/voos-unificados.kml', 'utf8')).voos, 15);
  const os = (n: string) => ds.ordens.find((o) => ds.fazendas.find((f) => f.id === o.fazendaId)!.nome === n)!.id;
  const f19 = fichaDoDiaAcomp(ds, l, l.dias[0], base, '2026-10-19').ficha;
  const sug = sugerirOS(ds, f19, grupos);
  assert.deepEqual(grupos.map((g) => sug[g.id]), [[], [os('Sítio Clementino'), os('Sítio José Lopes')], [os('Sítio Nunes')], [os('Jacinto I')]], 'Ipê não é de 19/10; o grupo de 44,23 = Clementino + José Lopes');
  const series = { B26WN6P0025KDU: 'aD', B26WN690025DVC: 'aA' };
  const ap = aplicarKmlNaFicha(ds, f19, grupos, sug, series);
  assert.deepEqual(ap.erros, []);
  assert.ok(ap.avisos.some((a) => a.startsWith('T70 D: ficha 64,75 ha → KML 51,05 ha')), ap.avisos.join(' | '));
  const p = previaFechamento(ds, ap.ficha, gid, '');
  assert.deepEqual(p.erros, []);
  const cel = (o: string, ac: string) => { const i = ap.ficha.fazendas.findIndex((z) => z.osId === os(o)); const j = ap.ficha.drones.findIndex((d) => d.aeronaveId === ac); return p.rateio.m[i][j]; };
  assert.deepEqual([cel('Jacinto I', 'aD'), cel('Jacinto I', 'aA'), cel('Sítio Nunes', 'aD'), cel('Sítio Nunes', 'aA')], [19.71, 12.46, 1.91, 41.18], 'medido no KML');
  assert.ok(p.ops.every((o) => o.voo && o.voo.origem === 'kml' && o.alturaVooM && o.velocidadeMs && o.faixaM));
  assert.ok(Math.abs(p.tempoVoo![0]! + p.tempoVoo![1]! - (g2min(grupos, 1) + g2min(grupos, 2) + g2min(grupos, 3))) <= 1, 'tempo em voo do dia = soma dos grupos (±1 min de arredondamento)');
  assert.equal(gravarFechamento(ds, ap.ficha, gid, ''), null);
  const jac = ds.fazendas.find((f) => f.nome === 'Jacinto I')!;
  assert.ok(typeof jac.lat === 'number' && typeof jac.lon === 'number', 'local da Jacinto I aprendido');
  assert.equal(ds.aeronaves.find((a) => a.id === 'aD')!.numeroSerie, 'B26WN6P0025KDU', 'nº de série gravado na aeronave');
  // 20/10: Ipê
  const f20 = fichaDoDiaAcomp(ds, l, l.dias[1], base).ficha;
  const s20 = sugerirOS(ds, f20, grupos);
  assert.deepEqual(grupos.map((g) => s20[g.id].length), [1, 0, 0, 0]);
  const a20 = aplicarKmlNaFicha(ds, f20, grupos, s20, series);
  const p20 = previaFechamento(ds, a20.ficha, gid, '');
  assert.deepEqual(p20.erros, []);
  assert.deepEqual(a20.ficha.drones.map((d) => [d.aeronaveId, d.area]), [['aD', 69.27], ['aA', 11.27]], 'linha fecha com o real 80,54 (centésimo no maior resto)');
  // num KML futuro, sem real na ficha, a Jacinto I é reconhecida pelo local
  const vazio = { ...f19, fazendas: [] };
  assert.deepEqual(sugerirOS(ds, vazio, grupos)[grupos[3].id], [], 'Jacinto já concluída: não é sugerida numa ficha vazia');
  ds.ordens.find((o) => o.id === os('Jacinto I'))!.concluidaManual = false;
  ds.ordens.find((o) => o.id === os('Jacinto I'))!.status = 'em_execucao';
  assert.deepEqual(sugerirOS(ds, vazio, grupos)[grupos[3].id], [os('Jacinto I')], 'OS aberta reconhecida pelo local aprendido');
});
function g2min(g: ReturnType<typeof agruparVoos>, i: number) { return g[i].tempoMin; }

import { lerMapaTalhoes, aplicarMapaTalhoes } from '../src/domain/mapaTalhoes';
import { cruzarCobertura } from '../src/domain/cobertura';
test('mapa de talhões + KML de voo (reais): cruzamento em grade de 1 m confere com o cálculo de referência', () => {
  const { ds, gid } = baseFungicida();
  const m = lerMapaTalhoes(readFileSync('tests/fixtures/mapa-5zonas.kml', 'utf8'));
  assert.deepEqual(m.erros, []); assert.equal(m.zonas, 5);
  const r = aplicarMapaTalhoes(ds, m, { criarTalhoes: true, atualizarArea: false }, gid);
  assert.equal(r.fazendas, 5);
  const t20 = ds.talhoes.find((t) => t.codigo.replace(/^0+/, '') === '20' && ds.fazendas.find((f) => f.id === t.fazendaId)!.codigo === '90')!;
  assert.ok(t20.poligono!.length >= 10 && t20.poligono!.length <= 121, `contorno simplificado: ${t20.poligono!.length} pontos`);
  assert.equal(t20.areaPlantadaHa, 12.33); assert.equal(t20.areaTotalHa, 12.84); assert.ok(t20.restricaoVoo);
  const voos = lerKmlVoos(readFileSync('tests/fixtures/voos-unificados.kml', 'utf8')).voos;
  const c = cruzarCobertura(ds, voos, ds.ordens.map((o) => o.id));
  const fz = (cod: string) => c.fazendas.find((x) => ds.fazendas.find((f) => f.id === x.fazendaId)!.codigo === cod)!;
  const soma = (cod: string) => round(fz(cod).talhoes.reduce((s, t) => s + t.medidoHa, 0), 2);
  // referência (Python, grade de 1 m, mesmo método e mesmo descarte do deslocamento): 31,18 · 14,38 · 28,44 · 41,01 · 61,40
  for (const [cod, ref] of [['90', 31.18], ['18', 14.38], ['36', 28.44], ['138', 41.01], ['130', 61.4]] as const) assert.ok(Math.abs(soma(cod) - ref) <= 0.15, `zona ${cod}: ${soma(cod)} × ${ref}`);
  const j20 = fz('90').talhoes.find((t) => t.codigo.replace(/^0+/, '') === '20')!;
  assert.ok(Math.abs(j20.pct - 0.961) <= 0.01, String(j20.pct));
  assert.deepEqual(Object.keys(fz('18').talhoes[0].porSerie), ['B26WN690025DVC'], 'Clementino: só o …DVC');
  assert.ok(Object.keys(fz('36').talhoes.find((t) => t.codigo.replace(/^0+/, '') === '4')!.porSerie).every((s) => s.endsWith('KDU')), 'José Lopes: só o …KDU');
  const t78 = fz('130').fora.find((t) => t.codigo.replace(/^0+/, '') === '78')!;
  assert.ok(t78 && Math.abs(t78.cobertoHa - 14.4) <= 0.3 && t78.pct > 0.7, `Ipê: talhão 78 fora da OS com ~14,4 ha cobertos (${t78?.cobertoHa})`);
  const ipe = (cod: string) => fz('130').talhoes.find((t) => t.codigo.replace(/^0+/, '') === cod)!;
  assert.ok(ipe('71').pct < 0.03 && ipe('72').pct < 0.03, 'Ipê 71 e 72: só o deslocamento passava por eles — descartado');
  assert.ok(ipe('92').pct > 0.95, 'Ipê 92: faixas reais preservadas');
  assert.ok(!fz('90').fora.length, 'Jacinto I: nada fora da OS acima de 10%');
});

import { linhasPadrao, aplicarCoberturaNaFicha } from '../src/domain/cobertura';
test('cruzamento na ficha: aplicado por talhão medido (editável) define os voos; cada sítio com o seu drone; talhão de fora adicionado à OS', () => {
  const { ds, gid } = baseFungicida();
  aplicarMapaTalhoes(ds, lerMapaTalhoes(readFileSync('tests/fixtures/mapa-5zonas.kml', 'utf8')), { criarTalhoes: true, atualizarArea: false }, gid);
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  const voos = lerKmlVoos(readFileSync('tests/fixtures/voos-unificados.kml', 'utf8')).voos;
  const grupos = agruparVoos(voos, 15);
  const series = { B26WN6P0025KDU: 'aD', B26WN690025DVC: 'aA' };
  const os = (n: string) => ds.ordens.find((o) => ds.fazendas.find((f) => f.id === o.fazendaId)!.nome === n)!.id;
  const tal = (n: string, cod: string) => ds.talhoes.find((t) => t.fazendaId === ds.ordens.find((o) => o.id === os(n))!.fazendaId && t.codigo.replace(/^0+/, '') === cod)!.id;
  // 19/10
  const f19 = fichaDoDiaAcomp(ds, l, l.dias[0], base, '2026-10-19').ficha;
  const k1 = aplicarKmlNaFicha(ds, f19, grupos, sugerirOS(ds, f19, grupos), series).ficha;
  const ids = k1.fazendas.map((z) => z.osId);
  const c = cruzarCobertura(ds, grupos.filter((g) => g.areaHa < 80).flatMap((g) => g.voos), ids);
  const lp = linhasPadrao(ds, c, '2026-10-19');
  const valores: Record<string, number> = Object.fromEntries(lp.map((x) => [`${x.osId}|${x.talhaoId}`, x.padrao]));
  valores[`${os('Jacinto I')}|${tal('Jacinto I', '20')}`] = 11.8; // edição manual
  const r = aplicarCoberturaNaFicha(ds, k1, c, valores, {}, series);
  assert.deepEqual(r.erros, []);
  const p = previaFechamento(ds, r.ficha, gid, '');
  assert.deepEqual(p.erros, []);
  const cel = (n: string, ac: string) => r.ficha.fixas[`${os(n)}|${ac}`];
  assert.equal(cel('Sítio Clementino', 'aD'), 0); assert.ok(cel('Sítio Clementino', 'aA') > 14, 'Clementino só no T70 A (…DVC)');
  assert.equal(cel('Sítio José Lopes', 'aA'), 0); assert.ok(cel('Sítio José Lopes', 'aD') > 28, 'José Lopes só no T70 D (…KDU)');
  const op20 = p.ops.filter((o) => o.osId === os('Jacinto I')).flatMap((o) => o.itens).filter((i) => i.talhaoId === tal('Jacinto I', '20'));
  assert.equal(round(op20.reduce((s, i) => s + i.areaHa, 0), 2), 11.8, 'valor editado respeitado');
  const realJac = r.ficha.fazendas.find((z) => z.osId === os('Jacinto I'))!.real!;
  assert.ok(realJac > 30.8 && realJac < 31.6, String(realJac));
  assert.equal(gravarFechamento(ds, r.ficha, gid, ''), null);
  // 20/10: Ipê com o talhão 78 adicionado à OS
  const f20 = fichaDoDiaAcomp(ds, l, l.dias[1], base).ficha;
  const k2 = aplicarKmlNaFicha(ds, f20, grupos, sugerirOS(ds, f20, grupos), series).ficha;
  const c2 = cruzarCobertura(ds, grupos[0].voos, [os('Ipê')]);
  const v2: Record<string, number> = Object.fromEntries(linhasPadrao(ds, c2, '2026-10-20').map((x) => [`${x.osId}|${x.talhaoId}`, x.padrao]));
  const r2 = aplicarCoberturaNaFicha(ds, k2, c2, v2, { [tal('Ipê', '78')]: { tipo: 'adicionar', osId: os('Ipê') } }, series);
  assert.deepEqual(r2.erros, []);
  assert.deepEqual(previaFechamento(ds, r2.ficha, gid, '').erros, []);
  assert.equal(gravarFechamento(ds, r2.ficha, gid, ''), null);
  assert.ok(ds.ordens.find((o) => o.id === os('Ipê'))!.itens.some((i) => i.talhaoId === tal('Ipê', '78')), 'talhão 78 entrou na OS');
  const apl = api2(aplicacoes(ds));
  assert.ok((apl.get(`${os('Ipê')}|${tal('Ipê', '78')}`) ?? 0) > 14, 'aplicado no 78 registrado');
});

import { diasCampanha, resumoSafra, registrarDiasParados, removerDiaParado, gravarSafra, safraAtual } from '../src/domain/dias';
test('dias da campanha e meta da safra: corridos, com aplicação, parados (chuva/vento) e sem registro; safra de 24.000 ha editável', () => {
  const { ds, gid } = baseFungicida();
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  const base = { turnoId: 'tn', liderId: 'l1', responsavel: 'Teste' };
  assert.equal(gravarFechamento(ds, fichaDoDiaAcomp(ds, l, l.dias[0], base, '2026-10-19').ficha, gid, ''), null);
  assert.equal(gravarFechamento(ds, fichaDoDiaAcomp(ds, l, l.dias[1], base).ficha, gid, ''), null);
  const hoje = '2026-10-23';
  // 2 dias sem aplicação
  assert.equal(registrarDiasParados(ds, { de: '2026-10-21', ate: '2026-10-21', motivo: 'Chuva', observacao: 'chuva o dia todo', campanhaIds: [] }, gid, hoje).gravados, 1);
  assert.equal(registrarDiasParados(ds, { de: '2026-10-22', ate: '2026-10-22', motivo: 'Vento acima do limite', campanhaIds: [] }, gid, hoje).gravados, 1);
  const r = registrarDiasParados(ds, { de: '2026-10-19', ate: '2026-10-20', motivo: 'Chuva', campanhaIds: [] }, gid, hoje);
  assert.deepEqual([r.gravados, r.ignorados], [0, ['2026-10-19', '2026-10-20']], 'dia com aplicação não vira dia parado');
  assert.ok(registrarDiasParados(ds, { de: '2026-10-24', ate: '', motivo: 'Chuva', campanhaIds: [] }, gid, hoje).erro!.includes('futuro'));
  const d = diasCampanha(ds, ds.campanhas[0].id, hoje)!;
  assert.deepEqual([d.corridos, d.comAplicacao, d.parados, d.paradosClima, d.semRegistro], [10, 2, 2, 2, 6], '14/10 a 23/10');
  assert.equal(d.porMotivo['Chuva'], 1); assert.equal(d.porMotivo['Vento acima do limite'], 1);
  assert.equal(round(d.area, 2), 200.03); assert.equal(round(d.haDiaEfetivo!, 2), 100.02); assert.equal(round(d.haDiaCorrido!, 2), 20.0);
  // safra: padrão 24.000 ha; o usuário define o período e pode mudar a meta
  assert.equal(safraAtual(ds, hoje).metaHa, 24000);
  assert.equal(gravarSafra(ds, { nome: 'Safra 2026/27', inicio: '2026-04-01', fim: '2027-03-31', metaHa: 24000 }), null);
  const s = resumoSafra(ds, hoje);
  assert.equal(round(s.aplicado, 2), 200.03); assert.equal(round(s.pct!, 2), 0.83);
  assert.equal(s.diasRestantes, 159, '24/10/2026 a 31/03/2027'); assert.equal(round(s.necessarioDia!, 2), round((24000 - 200.03) / 159, 2));
  assert.equal(s.corridos, 10, 'dias da safra contam a partir da 1ª campanha (14/10), não de 01/04');
  assert.equal(s.de, '2026-10-14'); assert.equal(s.projecaoFim, Math.round(200.03 + (200.03 / 10) * 159));
  assert.ok(gravarSafra(ds, { nome: 'X', inicio: '2026-04-01', fim: '2026-03-01', metaHa: 1 })!.includes('depois'));
  assert.equal(gravarSafra(ds, { nome: 'Safra 2026/27', inicio: '2026-04-01', fim: '2027-03-31', metaHa: 26000 }), null);
  assert.equal(resumoSafra(ds, hoje).safra.metaHa, 26000, 'meta editável');
  // remover
  assert.equal(removerDiaParado(ds, ds.diasParados![0].id), null);
  assert.equal(diasCampanha(ds, ds.campanhas[0].id, hoje)!.parados, 1);
});

import { mesclar3 } from '../src/domain/mesclar';
test('nuvem: mescla em 3 vias junta o que cada um gravou, respeita exclusões e marca conflito no mesmo item', () => {
  const base = { versao: 4, metas: { m: 1 }, operacoes: [{ id: 'a', area: 1 }, { id: 'b', area: 2 }, { id: 'c', area: 3 }], diasParados: [] as { id: string; motivo: string }[] };
  const local = { ...base, operacoes: [{ id: 'a', area: 1 }, { id: 'b', area: 20 }, { id: 'c', area: 3 }, { id: 'd', area: 4 }], diasParados: [{ id: 'p1', motivo: 'Vento' }] };
  const remoto = { ...base, metas: { m: 2 }, operacoes: [{ id: 'a', area: 10 }, { id: 'b', area: 2 }, { id: 'e', area: 5 }], diasParados: [{ id: 'p2', motivo: 'Chuva' }] };
  const r = mesclar3(base, local, remoto);
  assert.deepEqual(r.valor.operacoes, [{ id: 'a', area: 10 }, { id: 'b', area: 20 }, { id: 'e', area: 5 }, { id: 'd', area: 4 }], 'a: nuvem; b: local; c: apagado na nuvem; d e e: novos');
  assert.deepEqual(r.valor.metas, { m: 2 }, 'metas: só a nuvem mudou');
  assert.deepEqual(r.valor.diasParados.map((x) => x.id), ['p2', 'p1'], 'os dois dias parados entram');
  assert.equal(r.conflitos.length, 0);
  const l2 = { ...base, operacoes: [{ id: 'a', area: 7 }, ...base.operacoes.slice(1)] };
  const r2 = { ...base, operacoes: [{ id: 'a', area: 9 }, ...base.operacoes.slice(1)] };
  const m2 = mesclar3(base, l2, r2);
  assert.equal(m2.valor.operacoes[0].area, 7, 'mesmo item alterado pelos dois: vale o deste aparelho');
  assert.deepEqual(m2.conflitos, ['operacoes:a']);
  const l3 = { ...base, operacoes: base.operacoes.filter((o) => o.id !== 'b') };
  const r3 = { ...base, operacoes: base.operacoes.map((o) => (o.id === 'b' ? { ...o, area: 99 } : o)) };
  assert.deepEqual(mesclar3(base, l3, r3).valor.operacoes.map((o) => o.id), ['a', 'b', 'c'], 'apagado aqui mas alterado na nuvem: mantém (não perde o trabalho do outro)');
});

import { observacoesDigitadas } from '../src/domain/diario';
test('Diário: observações só com o que foi digitado (sem notas automáticas), texto repetido aparece uma vez', () => {
  const ds = { aeronaves: [{ id: 'a1', identificacao: 'T70-P DR-01' }, { id: 'a2', identificacao: 'T70-P DR-02' }] } as never;
  const op = (aeronaveId: string, oper: string, tec: string) => ({ aeronaveId, observacoesOperador: oper, observacoesTecnicas: tec }) as never;
  const r = observacoesDigitadas(ds, [
    op('a1', 'Data corrigida: no app de acompanhamento constava 14/10/2026. · Encerramento: Fim do 1º Turno · atraso do gerador', 'Fechamento do dia (ficha diária). Área do drone por fazenda estimada por proporção.'),
    op('a2', 'Data corrigida: no app de acompanhamento constava 14/10/2026. · Encerramento: Fim do 1º Turno · atraso do gerador', 'Fechamento do dia com KML de voo: …'),
    op('a2', '', ''),
  ]);
  assert.deepEqual(r.map(({ aeronave, texto }) => ({ aeronave, texto })), [{ aeronave: 'T70-P DR-01, T70-P DR-02', texto: 'Fim do 1º Turno · atraso do gerador' }]);
});

import { recuperarVoos, voosAusentes } from '../src/domain/recuperar';
import { textosDigitados } from '../src/domain/diario';
test('fechamento: 2º turno no mesmo dia com o mesmo drone NÃO apaga o 1º turno; regravar o mesmo turno substitui; voos apagados podem ser recuperados de uma versão anterior', () => {
  const { ds, gid } = baseFungicida();
  ds.turnos.push({ id: 'tn2', nome: '2º Turno', periodo: 'Noturno', horaInicio: '15:50', horaFim: '23:59', liderId: 'l1', ativo: true });
  ds.ordens.forEach((o) => o.itens.forEach((i) => { i.areaPlanejadaHa *= 10; })); ds.talhoes.forEach((t) => { t.areaHa *= 10; }); // saldo para dois turnos
  const l = lerCodigoAcomp(readFileSync('tests/fixtures/acomp-codigo.txt', 'utf8'));
  const diaObs = { ...l.dias[0], obs: ['Das 13h20 até a troca de turno houve atraso do gerador'] };
  const f1 = fichaDoDiaAcomp(ds, l, diaObs, { turnoId: 'tn', liderId: 'l1', responsavel: 'T' }, '2026-10-19').ficha;
  f1.fazendas.forEach((z) => { z.concluir = false; z.descontoEm = []; }); // OS seguem abertas para o 2º turno
  assert.equal(gravarFechamento(ds, f1, gid, ''), null);
  const n1 = ds.operacoes.length, area1 = ds.operacoes.reduce((s, o) => s + areaOperacao(o), 0);
  const obs1 = textosDigitados(f1.observacoes);
  const f2acomp = fichaDoDiaAcomp(ds, l, diaObs, { turnoId: 'tn2', liderId: 'l1', responsavel: 'T' }, '2026-10-19').ficha;
  assert.ok(obs1.length > 0, 'o dia do fixture tem observação digitada');
  assert.deepEqual(textosDigitados(f2acomp.observacoes).filter((t) => obs1.some((o) => o.includes(t))), [], 'observação do 1º turno não é repetida no 2º turno');
  const antes = JSON.parse(JSON.stringify(ds));
  const f2 = { ...JSON.parse(JSON.stringify(f1)), turnoId: 'tn2' };
  assert.equal(gravarFechamento(ds, f2, gid, ''), null);
  assert.equal(ds.operacoes.length, n1 * 2, '2º turno soma: os voos do 1º turno ficam');
  assert.equal(round(ds.operacoes.reduce((s, o) => s + areaOperacao(o), 0), 2), round(area1 * 2, 2));
  assert.equal(gravarFechamento(ds, JSON.parse(JSON.stringify(f2)), gid, ''), null);
  assert.equal(ds.operacoes.length, n1 * 2, 'regravar o 2º turno substitui só o 2º turno');
  // simula a perda (versão de antes tinha o 1º turno) e recupera
  const perdidos = ds.operacoes.filter((o) => o.turnoId === 'tn').map((o) => o.id);
  ds.operacoes = ds.operacoes.filter((o) => o.turnoId !== 'tn'); ds.paradas = ds.paradas.filter((p) => !perdidos.includes(p.operacaoId));
  const aus = voosAusentes(ds, antes);
  assert.deepEqual(aus.map((a) => a.op.id).sort(), perdidos.sort(), 'lista exatamente os voos que sumiram');
  assert.equal(recuperarVoos(ds, antes, perdidos, 7), null);
  assert.equal(ds.operacoes.length, n1 * 2);
  assert.ok(ds.paradas.some((p) => perdidos.includes(p.operacaoId)) || !antes.paradas.some((p: { operacaoId: string }) => perdidos.includes(p.operacaoId)), 'paradas do voo voltam junto');
  assert.ok(recuperarVoos(ds, antes, perdidos, 7)!.includes('Nenhum'), 'não duplica ao recuperar de novo');
  assert.ok(ds.auditoria.some((a) => a.resumo.includes('Recuperados')));
});

import { duracaoUniao } from '../src/domain/diario';
test('Diário: efetivo da operação não soma drones simultâneos (união dos intervalos)', () => {
  // 2 drones, 15:50–23:20, ambos parados 15:50–18:30 e 20:30–23:20 → cada um 2h efetivo; juntos 2h (não 4h)
  const ativo: [number, number][] = [[1110, 1230], [1110, 1230]];
  assert.equal(duracaoUniao(ativo), 120);
  assert.equal(duracaoUniao([[0, 60], [30, 90], [120, 150]]), 120, 'sobreposição parcial conta uma vez');
  assert.equal(duracaoUniao([[950, 1400], [950, 1400]]) - duracaoUniao(ativo), 330, 'parado da operação = janela − efetivo = 5h30');
});

import { minutosParadasRelogio, somaParadasMin as somaPar } from '../src/domain/calc';
test('paradas no relógio: "Problemas de equipe" 13:20–18:30 com os dois drones parados juntos dá 5h10 (não 7h50)', () => {
  const ps = [
    { inicio: '2026-10-26T13:20', fim: '2026-10-26T15:50' }, // DR-02, 1º turno
    { inicio: '2026-10-26T15:50', fim: '2026-10-26T18:30' }, // DR-01, 2º turno
    { inicio: '2026-10-26T15:50', fim: '2026-10-26T18:30' }, // DR-02, 2º turno (ao mesmo tempo)
  ];
  assert.equal(minutosParadasRelogio(ps), 310, '5h10 no relógio');
  assert.equal(somaPar(ps as never), 470, '7h50 somando os drones');
  assert.equal(minutosParadasRelogio([{ inicio: '2026-10-26T23:30', fim: '2026-10-27T00:30' }, { inicio: '2026-10-27T00:00', fim: '2026-10-27T01:00' }]), 90, 'atravessa a meia-noite e sobrepõe em parte');
  assert.equal(minutosParadasRelogio([{ inicio: '2026-10-26T10:00', fim: null }]), 0, 'parada sem término não entra');
});
