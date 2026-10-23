/**
 * Indicadores comparativos e análise de produtividade (Fase 3): período A × período B, no total e
 * quebrado por aeronave, piloto, turno ou fazenda. Usa as mesmas regras do painel.
 */
import { filtrarLancamentos, filtrarOperacoes, temposOperacao, type Filtros, type Indices } from './analytics';
import { addDias, areaOperacao, produtividadeEfetiva, produtividadeOperacional, safeDiv, somaParadasMin } from './calc';
import { metaPorDia } from './metas';
import { diasEntre } from './previsao';
import { MOTIVOS_CLIMATICOS, type Dataset, type Operacao } from './types';

export interface IndicadoresPeriodo {
  de: string; ate: string;
  area: number; areaVoo: number; areaLancada: number;
  dias: number; haPorDia: number | null;
  ops: number; impedidas: number;
  minEfetivo: number; minTotal: number; minParado: number; minParadoClima: number;
  prodEfetiva: number | null; prodOperacional: number | null;
  eficiencia: number | null; pctParado: number | null; pctParadoClima: number | null;
  meta: number; pctMeta: number | null; pctMetaHaH: number | null;
}

export function indicadoresPeriodo(ds: Dataset, f: Filtros, idx: Indices): IndicadoresPeriodo {
  const ops = filtrarOperacoes(ds, f, idx);
  const lanc = filtrarLancamentos(ds, f, idx);
  let minEfetivo = 0, minTotal = 0, minParado = 0, minParadoClima = 0;
  const dias = new Set<string>();
  for (const op of ops) {
    const t = temposOperacao(op, idx); minEfetivo += t.efetivo; minTotal += t.total; minParado += t.parado;
    minParadoClima += somaParadasMin((idx.paradasPorOp.get(op.id) ?? []).filter((p) => MOTIVOS_CLIMATICOS.includes(p.motivo)));
    if (areaOperacao(op) > 0) dias.add(op.data);
  }
  for (const l of lanc) if (areaOperacao(l) > 0) dias.add(l.data);
  const areaVoo = ops.reduce((s, o) => s + areaOperacao(o), 0);
  const areaLancada = lanc.reduce((s, o) => s + areaOperacao(o), 0);
  const area = areaVoo + areaLancada;
  const umDrone = !!(f.aeronaveId || f.pilotoId), umTurno = !!(f.turnoId || f.liderId);
  const meta = metaPorDia(ds.metas, f.de, f.ate, { umDrone, umTurno }).reduce((s, x) => s + x.meta, 0);
  const pe = produtividadeEfetiva(areaVoo, minEfetivo);
  return {
    de: f.de, ate: f.ate, area, areaVoo, areaLancada, dias: dias.size, haPorDia: safeDiv(area, dias.size),
    ops: ops.length, impedidas: ops.filter((o) => o.status === 'impedida_clima').length,
    minEfetivo, minTotal, minParado, minParadoClima,
    prodEfetiva: pe, prodOperacional: produtividadeOperacional(areaVoo, minTotal),
    eficiencia: safeDiv(minEfetivo * 100, minTotal), pctParado: safeDiv(minParado * 100, minTotal), pctParadoClima: safeDiv(minParadoClima * 100, minTotal),
    meta, pctMeta: safeDiv(area * 100, meta), pctMetaHaH: pe === null ? null : (pe / ds.metas.haHoraDrone) * 100,
  };
}

export type ModoComparacao = 'anterior' | 'semana' | 'ano' | 'livre';
/** Período B padrão: o imediatamente anterior com a mesma duração (ou a escolha do usuário). */
export function periodoB(fA: Filtros, modo: ModoComparacao, livre?: { de: string; ate: string }): { de: string; ate: string } {
  if (modo === 'livre' && livre?.de && livre?.ate) return livre;
  if (modo === 'semana') return { de: addDias(fA.de, -7), ate: addDias(fA.ate, -7) };
  if (modo === 'ano') return { de: addDias(fA.de, -364), ate: addDias(fA.ate, -364) };
  const n = diasEntre(fA.de, fA.ate) + 1;
  return { de: addDias(fA.de, -n), ate: addDias(fA.de, -1) };
}

export type Dimensao = 'aeronaveId' | 'pilotoId' | 'turnoId' | 'fazenda';
export interface LinhaComparativa { id: string; rotulo: string; a: Parcial; b: Parcial }
export interface Parcial { area: number; minEfetivo: number; minTotal: number; minParado: number; ops: number; prodEfetiva: number | null; prodOperacional: number | null; eficiencia: number | null }

function agrupar(ops: Operacao[], idx: Indices, chave: (o: Operacao) => string): Map<string, Parcial> {
  const m = new Map<string, Parcial>();
  for (const op of ops) {
    const k = chave(op); const t = temposOperacao(op, idx);
    const x = m.get(k) ?? { area: 0, minEfetivo: 0, minTotal: 0, minParado: 0, ops: 0, prodEfetiva: null, prodOperacional: null, eficiencia: null };
    x.area += areaOperacao(op); x.minEfetivo += t.efetivo; x.minTotal += t.total; x.minParado += t.parado; x.ops++;
    m.set(k, x);
  }
  for (const x of m.values()) { x.prodEfetiva = produtividadeEfetiva(x.area, x.minEfetivo); x.prodOperacional = produtividadeOperacional(x.area, x.minTotal); x.eficiencia = safeDiv(x.minEfetivo * 100, x.minTotal); }
  return m;
}

/** Quebra A × B por dimensão (só operações com voo — produtividade exige tempo registrado). */
export function compararPor(ds: Dataset, fA: Filtros, fB: Filtros, idx: Indices, dim: Dimensao, rotulo: (dim: Dimensao, id: string) => string): LinhaComparativa[] {
  const chave = (o: Operacao) => (dim === 'fazenda' ? idx.os.get(o.osId)?.fazendaId ?? '' : o[dim]);
  const A = agrupar(filtrarOperacoes(ds, fA, idx), idx, chave);
  const B = agrupar(filtrarOperacoes(ds, fB, idx), idx, chave);
  const vazio: Parcial = { area: 0, minEfetivo: 0, minTotal: 0, minParado: 0, ops: 0, prodEfetiva: null, prodOperacional: null, eficiencia: null };
  return [...new Set([...A.keys(), ...B.keys()])].map((id) => ({ id, rotulo: rotulo(dim, id), a: A.get(id) ?? vazio, b: B.get(id) ?? vazio }))
    .sort((x, y) => y.a.area - x.a.area || y.b.area - x.b.area);
}

/** Variação percentual B → A (null quando B é zero/indefinido). */
export const variacao = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
