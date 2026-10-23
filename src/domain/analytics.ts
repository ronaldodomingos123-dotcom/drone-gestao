/**
 * Indicadores e séries agregadas para o dashboard.
 * Todas as funções recebem o dataset + filtros e devolvem números já calculados,
 * sem efeitos colaterais. As fórmulas estão documentadas em `calc.ts`.
 */
import {
  alertasExcesso, aplicacoes, aplicadoPorItem, areaObstaculo, areaOperacao, areaPlanejadaOS, duracaoTotalMin, inicioSemana, intervaloDatas, percentualExecutado,
  produtividadeEfetiva, produtividadeOperacional, safeDiv, somaParadasMin, type AlertaExcesso,
} from './calc';
import type { LancamentoArea, Dataset, MotivoParada, Operacao, OrdemServico, Parada, StatusOperacao } from './types';
import { MOTIVOS_CLIMATICOS } from './types';

export interface Filtros {
  de: string;
  ate: string;
  campanhaId: string;
  unidadeId: string;
  fazendaId: string;
  osId: string;
  aeronaveId: string;
  pilotoId: string;
  turnoId: string;
  liderId: string;
  status: '' | StatusOperacao;
}

export function indexar<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]));
}

export interface Indices {
  os: Map<string, OrdemServico>;
  paradasPorOp: Map<string, Parada[]>;
}

export function criarIndices(ds: Dataset): Indices {
  const paradasPorOp = new Map<string, Parada[]>();
  for (const p of ds.paradas) {
    const l = paradasPorOp.get(p.operacaoId);
    if (l) l.push(p); else paradasPorOp.set(p.operacaoId, [p]);
  }
  return { os: indexar(ds.ordens), paradasPorOp };
}

/** OS no escopo dos filtros de localização/campanha/OS (exclui canceladas). */
export function ordensNoEscopo(ds: Dataset, f: Filtros): OrdemServico[] {
  return ds.ordens.filter((o) =>
    o.status !== 'cancelada' &&
    (!f.campanhaId || o.campanhaId === f.campanhaId) &&
    (!f.unidadeId || o.unidadeId === f.unidadeId) &&
    (!f.fazendaId || o.fazendaId === f.fazendaId) &&
    (!f.osId || o.id === f.osId));
}

/** Operações que atendem aos filtros. `ignorarInicio` mantém só o limite final (para acumulados). */
export function filtrarOperacoes(ds: Dataset, f: Filtros, idx: Indices, ignorarInicio = false): Operacao[] {
  return ds.operacoes.filter((op) => {
    const os = idx.os.get(op.osId);
    if (!os || os.status === 'cancelada') return false;
    if (!ignorarInicio && f.de && op.data < f.de) return false;
    if (f.ate && op.data > f.ate) return false;
    if (f.campanhaId && op.campanhaId !== f.campanhaId) return false;
    if (f.unidadeId && os.unidadeId !== f.unidadeId) return false;
    if (f.fazendaId && os.fazendaId !== f.fazendaId) return false;
    if (f.osId && op.osId !== f.osId) return false;
    if (f.aeronaveId && op.aeronaveId !== f.aeronaveId) return false;
    if (f.pilotoId && op.pilotoId !== f.pilotoId) return false;
    if (f.turnoId && op.turnoId !== f.turnoId) return false;
    if (f.liderId && op.liderId !== f.liderId) return false;
    if (f.status && op.status !== f.status) return false;
    return true;
  });
}

/**
 * Lançamentos de área (sequência/ficha diária) que atendem aos filtros. Não têm drone, piloto, turno
 * nem status: com qualquer um desses filtros ativos, ficam de fora (não dá para atribuí-los).
 */
export function filtrarLancamentos(ds: Dataset, f: Filtros, idx: Indices, ignorarInicio = false): LancamentoArea[] {
  if (f.aeronaveId || f.pilotoId || f.turnoId || f.liderId || f.status) return [];
  return (ds.lancamentos ?? []).filter((l) => {
    const os = idx.os.get(l.osId);
    if (!os || os.status === 'cancelada') return false;
    if (!ignorarInicio && f.de && l.data < f.de) return false;
    if (f.ate && l.data > f.ate) return false;
    if (f.campanhaId && l.campanhaId !== f.campanhaId) return false;
    if (f.unidadeId && os.unidadeId !== f.unidadeId) return false;
    if (f.fazendaId && os.fazendaId !== f.fazendaId) return false;
    if (f.osId && l.osId !== f.osId) return false;
    return true;
  });
}

export function temposOperacao(op: Operacao, idx: Indices) {
  const total = duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0;
  const parado = somaParadasMin(idx.paradasPorOp.get(op.id) ?? []);
  return { total, parado, efetivo: op.tempoEfetivoMin };
}

export interface Indicadores {
  areaPlanejada: number;
  areaPeriodo: number;
  areaAcumulada: number;
  /** Obstáculos/descontos apurados nas OS concluídas com saldo. */
  areaObstaculos: number;
  /** Parte da área do período lançada sem registro de voo (sequência/ficha diária). */
  areaLancada: number;
  areaRestante: number;
  pctExecutado: number | null;
  minEfetivo: number;
  minTotal: number;
  minParado: number;
  prodEfetiva: number | null;
  prodOperacional: number | null;
  diasComAplicacao: number;
  haPorDia: number | null;
  osAbertas: number;
  osEmExecucao: number;
  opsConcluidas: number;
  opsParciais: number;
  opsImpedidasClima: number;
  opsNoPeriodo: number;
  aeronavesDisponiveis: number;
  aeronavesTotal: number;
  alertas: AlertaExcesso[];
  filtroDeRecursoAtivo: boolean;
}

export function calcularIndicadores(ds: Dataset, f: Filtros, idx: Indices): Indicadores {
  const escopo = ordensNoEscopo(ds, f);
  const opsPer = filtrarOperacoes(ds, f, idx);
  const opsAcum = filtrarOperacoes(ds, { ...f, status: '' }, idx, true);
  const aplTodos = aplicadoPorItem(aplicacoes(ds));
  const areaPlanejada = escopo.reduce((s, o) => s + areaPlanejadaOS(o), 0);
  const areaObstaculos = escopo.reduce((s, o) => s + areaObstaculo(o, aplTodos), 0);
  const lancPer = filtrarLancamentos(ds, f, idx);
  const lancAcum = filtrarLancamentos(ds, f, idx, true);
  const areaVoo = opsPer.reduce((s, o) => s + areaOperacao(o), 0); // só o que tem tempo de voo registrado
  const areaLancada = lancPer.reduce((s, o) => s + areaOperacao(o), 0);
  const areaPeriodo = areaVoo + areaLancada;
  const areaAcumulada = opsAcum.reduce((s, o) => s + areaOperacao(o), 0) + lancAcum.reduce((s, o) => s + areaOperacao(o), 0);
  let minEfetivo = 0, minTotal = 0, minParado = 0;
  const dias = new Set<string>();
  for (const op of opsPer) {
    const t = temposOperacao(op, idx);
    minEfetivo += t.efetivo; minTotal += t.total; minParado += t.parado;
    if (areaOperacao(op) > 0) dias.add(op.data);
  }
  for (const l of lancPer) if (areaOperacao(l) > 0) dias.add(l.data);
  const aeronaves = ds.aeronaves.filter((a) => (!f.unidadeId || a.unidadeId === f.unidadeId) && (!f.aeronaveId || a.id === f.aeronaveId));
  const opsEscopoTodas = filtrarOperacoes(ds, { ...f, status: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '' }, idx, true);
  return {
    areaPlanejada, areaPeriodo, areaAcumulada, areaObstaculos,
    areaRestante: areaPlanejada - areaAcumulada - areaObstaculos,
    pctExecutado: percentualExecutado(areaAcumulada, areaPlanejada),
    minEfetivo, minTotal, minParado,
    areaLancada,
    prodEfetiva: produtividadeEfetiva(areaVoo, minEfetivo),
    prodOperacional: produtividadeOperacional(areaVoo, minTotal),
    diasComAplicacao: dias.size,
    haPorDia: safeDiv(areaPeriodo, dias.size),
    osAbertas: escopo.filter((o) => o.status === 'aberta').length,
    osEmExecucao: escopo.filter((o) => o.status === 'em_execucao').length,
    opsConcluidas: opsPer.filter((o) => o.status === 'concluida').length,
    opsParciais: opsPer.filter((o) => o.status === 'parcial').length,
    opsImpedidasClima: opsPer.filter((o) => o.status === 'impedida_clima').length,
    opsNoPeriodo: opsPer.length,
    aeronavesDisponiveis: aeronaves.filter((a) => a.status === 'disponivel').length,
    aeronavesTotal: aeronaves.length,
    alertas: alertasExcesso(escopo, [...opsEscopoTodas, ...filtrarLancamentos(ds, { ...f, status: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '' }, idx, true)]),
    filtroDeRecursoAtivo: !!(f.aeronaveId || f.pilotoId || f.turnoId || f.liderId || f.status),
  };
}

export interface Ponto { rotulo: string; valor: number }

export function areaPorDia(ops: Pick<Operacao, 'data' | 'itens'>[], de: string, ate: string): Ponto[] {
  const m = new Map<string, number>();
  for (const op of ops) m.set(op.data, (m.get(op.data) ?? 0) + areaOperacao(op));
  return intervaloDatas(de, ate).map((d) => ({ rotulo: d, valor: m.get(d) ?? 0 }));
}

export function areaPorSemana(ops: Pick<Operacao, 'data' | 'itens'>[], de: string, ate: string): Ponto[] {
  const m = new Map<string, number>();
  for (const op of ops) { const s = inicioSemana(op.data); m.set(s, (m.get(s) ?? 0) + areaOperacao(op)); }
  const semanas: string[] = [];
  for (const d of intervaloDatas(inicioSemana(de), ate)) { const s = inicioSemana(d); if (!semanas.includes(s)) semanas.push(s); }
  return semanas.map((s) => ({ rotulo: s, valor: m.get(s) ?? 0 }));
}

/** Acumulado diário (para a curva de evolução da campanha). */
export function evolucaoAcumulada(ops: Pick<Operacao, 'data' | 'itens'>[], de: string, ate: string): Ponto[] {
  const diario = areaPorDia(ops, de, ate);
  let acc = 0;
  return diario.map((p) => ({ rotulo: p.rotulo, valor: (acc += p.valor) }));
}

export interface ComparativoPR { rotulo: string; planejado: number; realizado: number }

export function planejadoVsRealizado(ds: Dataset, f: Filtros, idx: Indices, por: 'fazenda' | 'unidade'): ComparativoPR[] {
  const escopo = ordensNoEscopo(ds, f);
  const ops = filtrarOperacoes(ds, { ...f, status: '' }, idx, true);
  const chave = (o: OrdemServico) => (por === 'fazenda' ? o.fazendaId : o.unidadeId);
  const nome = (id: string) => por === 'fazenda'
    ? (() => { const fz = ds.fazendas.find((x) => x.id === id); return fz ? `${fz.codigo} ${fz.nome}` : id; })()
    : ds.unidades.find((x) => x.id === id)?.nome ?? id;
  const m = new Map<string, ComparativoPR>();
  for (const o of escopo) {
    const k = chave(o);
    const r = m.get(k) ?? { rotulo: nome(k), planejado: 0, realizado: 0 };
    r.planejado += areaPlanejadaOS(o);
    m.set(k, r);
  }
  for (const op of [...ops, ...filtrarLancamentos(ds, { ...f, status: '' }, idx, true)]) {
    const o = idx.os.get(op.osId);
    if (!o) continue;
    const r = m.get(chave(o));
    if (r) r.realizado += areaOperacao(op);
  }
  return [...m.values()];
}

export interface Desempenho { id: string; rotulo: string; area: number; minEfetivo: number; minTotal: number; ops: number; prodEfetiva: number | null; prodOperacional: number | null }

export function desempenhoPor(ops: Operacao[], idx: Indices, campo: 'aeronaveId' | 'pilotoId' | 'turnoId' | 'liderId', nome: (id: string) => string): Desempenho[] {
  const m = new Map<string, Desempenho>();
  for (const op of ops) {
    const id = op[campo];
    const d = m.get(id) ?? { id, rotulo: nome(id), area: 0, minEfetivo: 0, minTotal: 0, ops: 0, prodEfetiva: null, prodOperacional: null };
    const t = temposOperacao(op, idx);
    d.area += areaOperacao(op); d.minEfetivo += t.efetivo; d.minTotal += t.total; d.ops++;
    m.set(id, d);
  }
  return [...m.values()].map((d) => ({ ...d, prodEfetiva: produtividadeEfetiva(d.area, d.minEfetivo), prodOperacional: produtividadeOperacional(d.area, d.minTotal) }))
    .sort((a, b) => b.area - a.area);
}

export function minutosPorMotivo(ops: Operacao[], idx: Indices): { motivo: MotivoParada; minutos: number; ocorrencias: number; climatico: boolean }[] {
  const m = new Map<MotivoParada, { minutos: number; ocorrencias: number }>();
  for (const op of ops) for (const p of idx.paradasPorOp.get(op.id) ?? []) {
    const r = m.get(p.motivo) ?? { minutos: 0, ocorrencias: 0 };
    r.minutos += somaParadasMin([p]); r.ocorrencias++;
    m.set(p.motivo, r);
  }
  return [...m.entries()].map(([motivo, r]) => ({ motivo, ...r, climatico: MOTIVOS_CLIMATICOS.includes(motivo) })).sort((a, b) => b.minutos - a.minutos);
}
