/**
 * Central de relatórios (Fase 3). Cada relatório é montado como DADOS (seções com colunas tipadas e
 * valores numéricos crus); a tela, o CSV, o Excel e o PDF apenas formatam. Assim os quatro mostram
 * exatamente os mesmos números, e os números são os mesmos do painel (mesmas funções de cálculo).
 */
import { areaPorDia, areaPorSemana, criarIndices, filtrarLancamentos, filtrarOperacoes, ordensNoEscopo, temposOperacao, type Filtros, type Indices } from './analytics';
import {
  aplicacoes, aplicadoPorItem, areaObstaculo, areaOperacao, areaPlanejadaOS, chaveItem, duracaoParadaMin, duracaoTotalMin,
  percentualExecutado, produtividadeEfetiva, produtividadeOperacional, quantidadeTotal, round, safeDiv, somaParadasMin, minutosParadasRelogio,
} from './calc';
import { metaPorDia, metaPorSemana } from './metas';
import { MOTIVOS_CLIMATICOS, type Dataset, type MotivoParada, type Operacao, type Parada } from './types';
import { avaliarLeitura } from './validation';
import { contextoClima } from './estacao';

export type TipoCol = 'texto' | 'int' | 'num' | 'ha' | 'pct' | 'hah' | 'data' | 'min' | 'dose';
export type Valor = string | number | null;
export interface Coluna { titulo: string; tipo: TipoCol; casas?: number; /** como totalizar */ total?: 'soma' | 'media' }
export interface Secao { titulo: string; colunas: Coluna[]; linhas: Valor[][]; totais?: Valor[]; nota?: string; /** tabela chave → valor (relatório técnico) */ ficha?: boolean }
export interface Relatorio {
  id: string;
  titulo: string;
  periodo: { de: string; ate: string } | null;
  filtros: string[];
  geradoEm: string;
  responsavel: string;
  indicadores: { rotulo: string; valor: Valor; tipo: TipoCol }[];
  secoes: Secao[];
  notas: string[];
}

export const RELATORIOS = [
  { id: 'os', titulo: 'Resumo por ordem de serviço', desc: 'Programado, aplicado, saldo/obstáculo e execução de cada OS', usaPeriodo: true },
  { id: 'fazenda', titulo: 'Resumo por fazenda e talhão', desc: 'Área, programado e aplicado por talhão, com última aplicação', usaPeriodo: true },
  { id: 'aeronave', titulo: 'Desempenho por aeronave', desc: 'Área, horas, ha/h efetivo e operacional, paradas e eficiência', usaPeriodo: true },
  { id: 'operador', titulo: 'Desempenho por operador', desc: 'Mesmos indicadores por piloto', usaPeriodo: true },
  { id: 'planejado', titulo: 'Planejado × realizado', desc: 'Por fazenda (com obstáculos) e por semana contra a meta', usaPeriodo: true },
  { id: 'clima', titulo: 'Histórico de condições climáticas', desc: 'Leituras de campo com avaliação contra os limites', usaPeriodo: true },
  { id: 'paradas', titulo: 'Relatório de paradas', desc: 'Cada interrupção e o total por motivo', usaPeriodo: true },
  { id: 'evolucao', titulo: 'Evolução da campanha', desc: 'Área por dia, acumulado, meta e percentual executado', usaPeriodo: true },
  { id: 'tecnico', titulo: 'Relatório técnico da aplicação', desc: 'Documento completo de uma operação (para fiscalização)', usaPeriodo: false },
] as const;
export type IdRelatorio = (typeof RELATORIOS)[number]['id'];

// ---------------- nomes ----------------
function nomes(ds: Dataset) {
  const f = (id: string) => { const x = ds.fazendas.find((y) => y.id === id); return x ? `${x.codigo ? `${x.codigo} · ` : ''}${x.nome}` : '—'; };
  return {
    fazenda: f,
    fazendaDaOS: (osId: string) => f(ds.ordens.find((o) => o.id === osId)?.fazendaId ?? ''),
    os: (id: string) => ds.ordens.find((o) => o.id === id)?.numero ?? '—',
    talhao: (id: string) => ds.talhoes.find((t) => t.id === id)?.codigo ?? '—',
    aeronave: (id: string) => ds.aeronaves.find((a) => a.id === id)?.identificacao ?? '—',
    pessoa: (id: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? '—',
    turno: (id: string) => ds.turnos.find((t) => t.id === id)?.nome ?? '—',
    campanha: (id: string) => ds.campanhas.find((c) => c.id === id)?.nome ?? '—',
    produto: (id: string) => ds.produtos.find((p) => p.id === id)?.nome ?? '—',
    unidade: (id: string) => ds.unidades.find((u) => u.id === id)?.nome ?? '—',
  };
}

const STATUS_OS: Record<string, string> = { aberta: 'Aberta', em_execucao: 'Em execução', concluida: 'Concluída', cancelada: 'Cancelada' };
const STATUS_OP: Record<string, string> = { concluida: 'Concluída', parcial: 'Parcial', impedida_clima: 'Impedida (clima)', em_andamento: 'Em andamento' };

/** Descrição legível dos filtros usados (vai no cabeçalho de todos os formatos). */
export function descreverFiltros(ds: Dataset, f: Filtros, usaPeriodo: boolean): string[] {
  const n = nomes(ds);
  const out: string[] = [];
  if (f.campanhaId) out.push(`Campanha: ${n.campanha(f.campanhaId)}`);
  if (f.unidadeId) out.push(`Unidade: ${n.unidade(f.unidadeId)}`);
  if (f.fazendaId) out.push(`Fazenda: ${n.fazenda(f.fazendaId)}`);
  if (f.osId) out.push(`OS: ${n.os(f.osId)}`);
  if (f.aeronaveId) out.push(`Aeronave: ${n.aeronave(f.aeronaveId)}`);
  if (f.pilotoId) out.push(`Piloto: ${n.pessoa(f.pilotoId)}`);
  if (f.turnoId) out.push(`Turno: ${n.turno(f.turnoId)}`);
  if (f.liderId) out.push(`Líder: ${n.pessoa(f.liderId)}`);
  if (f.status) out.push(`Status da operação: ${STATUS_OP[f.status] ?? f.status}`);
  if (!out.length) out.push(usaPeriodo ? 'Sem filtros além do período' : 'Sem filtros');
  return out;
}

interface Ctx { ds: Dataset; f: Filtros; idx: Indices; responsavel: string; agora: string }
const base = (c: Ctx, id: string, titulo: string, usaPeriodo = true): Relatorio => ({
  id, titulo, periodo: usaPeriodo ? { de: c.f.de, ate: c.f.ate } : null, filtros: descreverFiltros(c.ds, c.f, usaPeriodo), geradoEm: c.agora, responsavel: c.responsavel, indicadores: [], secoes: [], notas: [],
});
function totalizar(sec: Secao, rotulo = 'Total') {
  sec.totais = sec.colunas.map((c, i) => {
    if (i === 0) return rotulo;
    const vs = sec.linhas.map((l) => l[i]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (c.total === 'soma') return round(vs.reduce((s, v) => s + v, 0), 6);
    if (c.total === 'media') return vs.length ? round(vs.reduce((s, v) => s + v, 0) / vs.length, 6) : null;
    return null;
  });
  return sec;
}

/** Aplicado (voos + lançamentos) até a data final do filtro, por OS×talhão. */
function aplicadoAte(ds: Dataset, ate: string) {
  return aplicadoPorItem([...ds.operacoes.filter((o) => !ate || o.data <= ate), ...(ds.lancamentos ?? []).filter((l) => !ate || l.data <= ate)]);
}

// ---------------- 1. Resumo por OS ----------------
function relOS(c: Ctx): Relatorio {
  const { ds, f } = c; const n = nomes(ds);
  const r = base(c, 'os', 'Resumo por ordem de serviço');
  const apl = aplicadoAte(ds, f.ate);
  const aplTotal = aplicadoPorItem(aplicacoes(ds));
  const ordens = ordensNoEscopo(ds, f).sort((a, b) => a.campanhaId.localeCompare(b.campanhaId) || (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9));
  const ops = [...ds.operacoes, ...(ds.lancamentos ?? [])].filter((o) => !f.ate || o.data <= f.ate);
  const sec: Secao = { titulo: 'Ordens de serviço', colunas: [
    { titulo: 'Seq.', tipo: 'int' }, { titulo: 'OS', tipo: 'texto' }, { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Campanha', tipo: 'texto' }, { titulo: 'Situação', tipo: 'texto' },
    { titulo: 'Talhões', tipo: 'int', total: 'soma' }, { titulo: 'Programado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' },
    { titulo: 'Falta aplicar (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Obstáculo (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Execução', tipo: 'pct' },
    { titulo: 'Registros', tipo: 'int', total: 'soma' }, { titulo: '1ª aplicação', tipo: 'data' }, { titulo: 'Última', tipo: 'data' },
  ], linhas: [] };
  for (const o of ordens) {
    const plan = areaPlanejadaOS(o);
    const a = o.itens.reduce((s, i) => s + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0);
    const obst = areaObstaculo(o, aplTotal);
    const datas = ops.filter((x) => x.osId === o.id).map((x) => x.data).sort();
    sec.linhas.push([o.sequencia ?? null, o.numero, n.fazenda(o.fazendaId), n.campanha(o.campanhaId), STATUS_OS[o.status] + (o.concluidaManual ? ' (manual)' : ''), o.itens.length, round(plan, 4), round(a, 4),
      o.status === 'concluida' ? 0 : round(Math.max(0, plan - a), 4), round(obst, 4), percentualExecutado(a, plan), datas.length, datas[0] ?? null, datas[datas.length - 1] ?? null]);
  }
  totalizar(sec);
  if (sec.totais) sec.totais[10] = percentualExecutado(sec.totais[7] as number, sec.totais[6] as number);
  r.secoes.push(sec);
  const T = sec.totais ?? [];
  r.indicadores = [
    { rotulo: 'OS', valor: ordens.length, tipo: 'int' }, { rotulo: 'Programado', valor: T[6] ?? 0, tipo: 'ha' }, { rotulo: 'Aplicado', valor: T[7] ?? 0, tipo: 'ha' },
    { rotulo: 'Obstáculos', valor: T[9] ?? 0, tipo: 'ha' }, { rotulo: 'Falta aplicar', valor: T[8] ?? 0, tipo: 'ha' }, { rotulo: 'Execução', valor: T[10] ?? null, tipo: 'pct' },
  ];
  r.notas.push('Aplicado = voos registrados + lançamentos (sequência/ficha diária) até a data final. Obstáculo = programado − aplicado nas OS concluídas.');
  return r;
}

// ---------------- 2. Fazenda e talhão ----------------
function relFazenda(c: Ctx): Relatorio {
  const { ds, f } = c; const n = nomes(ds);
  const r = base(c, 'fazenda', 'Resumo por fazenda e talhão');
  const ordens = ordensNoEscopo(ds, f);
  const apl = aplicadoAte(ds, f.ate);
  const regs = [...ds.operacoes, ...(ds.lancamentos ?? [])].filter((o) => !f.ate || o.data <= f.ate);
  const ultima = new Map<string, string>(); const qtd = new Map<string, number>();
  for (const o of regs) for (const i of o.itens) { if ((ultima.get(i.talhaoId) ?? '') < o.data) ultima.set(i.talhaoId, o.data); qtd.set(i.talhaoId, (qtd.get(i.talhaoId) ?? 0) + 1); }
  const porTalhao = new Map<string, { plan: number; apl: number; os: Set<string> }>();
  for (const o of ordens) for (const i of o.itens) {
    const x = porTalhao.get(i.talhaoId) ?? { plan: 0, apl: 0, os: new Set() };
    x.plan += i.areaPlanejadaHa; x.apl += apl.get(chaveItem(o.id, i.talhaoId)) ?? 0; x.os.add(o.numero);
    porTalhao.set(i.talhaoId, x);
  }
  const talhoes = ds.talhoes.filter((t) => porTalhao.has(t.id)).sort((a, b) => n.fazenda(a.fazendaId).localeCompare(n.fazenda(b.fazendaId), 'pt-BR', { numeric: true }) || (a.zona ?? '').localeCompare(b.zona ?? '', 'pt-BR', { numeric: true }) || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
  const sec: Secao = { titulo: 'Talhões', colunas: [
    { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Zona', tipo: 'texto' }, { titulo: 'Talhão', tipo: 'texto' }, { titulo: 'OS', tipo: 'texto' }, { titulo: 'Área do talhão (ha)', tipo: 'ha', total: 'soma' },
    { titulo: 'Programado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Saldo (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Execução', tipo: 'pct' },
    { titulo: 'Registros', tipo: 'int', total: 'soma' }, { titulo: 'Última aplicação', tipo: 'data' },
  ], linhas: talhoes.map((t) => { const x = porTalhao.get(t.id)!; return [n.fazenda(t.fazendaId), t.zona ?? '', t.geral ? 'GERAL' : t.codigo, [...x.os].join(', '), round(t.areaHa, 4), round(x.plan, 4), round(x.apl, 4), round(x.plan - x.apl, 4), percentualExecutado(x.apl, x.plan), qtd.get(t.id) ?? 0, ultima.get(t.id) ?? null]; }) };
  totalizar(sec); if (sec.totais) sec.totais[8] = percentualExecutado(sec.totais[6] as number, sec.totais[5] as number);
  const porFaz = new Map<string, { talhoes: number; area: number; plan: number; apl: number }>();
  for (const t of talhoes) { const x = porTalhao.get(t.id)!; const k = n.fazenda(t.fazendaId); const y = porFaz.get(k) ?? { talhoes: 0, area: 0, plan: 0, apl: 0 }; y.talhoes++; y.area += t.areaHa; y.plan += x.plan; y.apl += x.apl; porFaz.set(k, y); }
  const secF: Secao = { titulo: 'Por fazenda', colunas: [{ titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Talhões', tipo: 'int', total: 'soma' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Programado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Execução', tipo: 'pct' }],
    linhas: [...porFaz.entries()].map(([k, y]) => [k, y.talhoes, round(y.area, 4), round(y.plan, 4), round(y.apl, 4), percentualExecutado(y.apl, y.plan)]) };
  totalizar(secF); if (secF.totais) secF.totais[5] = percentualExecutado(secF.totais[4] as number, secF.totais[3] as number);
  r.secoes.push(secF, sec);
  r.indicadores = [{ rotulo: 'Fazendas', valor: porFaz.size, tipo: 'int' }, { rotulo: 'Talhões', valor: talhoes.length, tipo: 'int' }, { rotulo: 'Programado', valor: secF.totais?.[3] ?? 0, tipo: 'ha' }, { rotulo: 'Aplicado', valor: secF.totais?.[4] ?? 0, tipo: 'ha' }];
  return r;
}

// ---------------- 3/4. Desempenho por aeronave / operador ----------------
function relDesempenho(c: Ctx, campo: 'aeronaveId' | 'pilotoId'): Relatorio {
  const { ds, f, idx } = c; const n = nomes(ds);
  const r = base(c, campo === 'aeronaveId' ? 'aeronave' : 'operador', campo === 'aeronaveId' ? 'Desempenho por aeronave' : 'Desempenho por operador');
  const ops = filtrarOperacoes(ds, f, idx);
  const m = new Map<string, { area: number; efet: number; total: number; parado: number; ops: number; dias: Set<string>; impedidas: number }>();
  for (const op of ops) {
    const id = op[campo]; const t = temposOperacao(op, idx);
    const x = m.get(id) ?? { area: 0, efet: 0, total: 0, parado: 0, ops: 0, dias: new Set(), impedidas: 0 };
    x.area += areaOperacao(op); x.efet += t.efetivo; x.total += t.total; x.parado += t.parado; x.ops++; if (areaOperacao(op) > 0) x.dias.add(op.data); if (op.status === 'impedida_clima') x.impedidas++;
    m.set(id, x);
  }
  const meta = ds.metas.haHoraDrone;
  const sec: Secao = { titulo: campo === 'aeronaveId' ? 'Aeronaves' : 'Operadores', colunas: [
    { titulo: campo === 'aeronaveId' ? 'Aeronave' : 'Piloto', tipo: 'texto' }, { titulo: 'Operações', tipo: 'int', total: 'soma' }, { titulo: 'Dias', tipo: 'int' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' },
    { titulo: 'Horas totais', tipo: 'min', total: 'soma' }, { titulo: 'Horas efetivas', tipo: 'min', total: 'soma' }, { titulo: 'Horas paradas', tipo: 'min', total: 'soma' },
    { titulo: 'ha/h efetivo', tipo: 'hah' }, { titulo: 'ha/h operacional', tipo: 'hah' }, { titulo: `% da meta (${meta} ha/h)`, tipo: 'pct' }, { titulo: 'Eficiência (efetivo/total)', tipo: 'pct' }, { titulo: 'Impedidas (clima)', tipo: 'int', total: 'soma' },
  ], linhas: [...m.entries()].map(([id, x]) => { const pe = produtividadeEfetiva(x.area, x.efet); return [campo === 'aeronaveId' ? n.aeronave(id) : n.pessoa(id), x.ops, x.dias.size, round(x.area, 4), x.total, x.efet, x.parado, pe, produtividadeOperacional(x.area, x.total), pe === null ? null : (pe / meta) * 100, safeDiv(x.efet * 100, x.total), x.impedidas]; })
    .sort((a, b) => (b[3] as number) - (a[3] as number)) };
  totalizar(sec);
  if (sec.totais) {
    const A = sec.totais[3] as number, E = sec.totais[5] as number, Tt = sec.totais[4] as number;
    const pe = produtividadeEfetiva(A, E);
    sec.totais[2] = new Set(ops.filter((o) => areaOperacao(o) > 0).map((o) => o.data)).size;
    sec.totais[7] = pe; sec.totais[8] = produtividadeOperacional(A, Tt); sec.totais[9] = pe === null ? null : (pe / meta) * 100; sec.totais[10] = safeDiv(E * 100, Tt);
  }
  r.secoes.push(sec);
  r.indicadores = [{ rotulo: 'Área', valor: sec.totais?.[3] ?? 0, tipo: 'ha' }, { rotulo: 'ha/h efetivo', valor: sec.totais?.[7] ?? null, tipo: 'hah' }, { rotulo: 'ha/h operacional', valor: sec.totais?.[8] ?? null, tipo: 'hah' }, { rotulo: 'Eficiência', valor: sec.totais?.[10] ?? null, tipo: 'pct' }];
  r.notas.push('ha/h efetivo = área ÷ horas efetivas de aplicação; operacional = área ÷ horas totais (com paradas). Área lançada sem voo (sequência/ficha diária) não entra neste relatório.');
  return r;
}

// ---------------- 5. Planejado × realizado ----------------
function relPlanejado(c: Ctx): Relatorio {
  const { ds, f, idx } = c; const n = nomes(ds);
  const r = base(c, 'planejado', 'Planejado × realizado');
  const ordens = ordensNoEscopo(ds, f);
  const apl = aplicadoAte(ds, f.ate); const aplTotal = aplicadoPorItem(aplicacoes(ds));
  const m = new Map<string, { plan: number; apl: number; obst: number; os: number; conc: number }>();
  for (const o of ordens) {
    const k = n.fazenda(o.fazendaId); const x = m.get(k) ?? { plan: 0, apl: 0, obst: 0, os: 0, conc: 0 };
    x.plan += areaPlanejadaOS(o); x.apl += o.itens.reduce((s, i) => s + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0); x.obst += areaObstaculo(o, aplTotal); x.os++; if (o.status === 'concluida') x.conc++;
    m.set(k, x);
  }
  const sec: Secao = { titulo: 'Por fazenda', colunas: [{ titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'OS', tipo: 'int', total: 'soma' }, { titulo: 'Concluídas', tipo: 'int', total: 'soma' }, { titulo: 'Programado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Obstáculo (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Falta aplicar (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Execução', tipo: 'pct' }, { titulo: 'Aproveitamento', tipo: 'pct' }],
    linhas: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true })).map(([k, x]) => [k, x.os, x.conc, round(x.plan, 4), round(x.apl, 4), round(x.obst, 4), round(Math.max(0, x.plan - x.apl - x.obst), 4), percentualExecutado(x.apl, x.plan), percentualExecutado(x.apl, x.plan - (x.plan - x.apl - x.obst > 0.005 ? x.plan - x.apl - x.obst : 0))]) };
  totalizar(sec);
  if (sec.totais) { const P = sec.totais[3] as number, A = sec.totais[4] as number, F = sec.totais[6] as number; sec.totais[7] = percentualExecutado(A, P); sec.totais[8] = percentualExecutado(A, P - F); }
  // semanas: meta × realizado no período
  const reg = [...filtrarOperacoes(ds, { ...f, status: '' }, idx), ...filtrarLancamentos(ds, { ...f, status: '' }, idx)];
  const sem = areaPorSemana(reg, f.de, f.ate);
  const metas = metaPorSemana(ds.metas, f.de, f.ate);
  const secS: Secao = { titulo: 'Por semana (meta × realizado)', colunas: [{ titulo: 'Semana (início)', tipo: 'data' }, { titulo: 'Dias no período', tipo: 'int' }, { titulo: 'Meta (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Realizado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Diferença (ha)', tipo: 'ha', total: 'soma' }, { titulo: '% da meta', tipo: 'pct' }],
    linhas: metas.map((mm) => { const real = sem.find((s) => s.rotulo === mm.semana)?.valor ?? 0; return [mm.semana, mm.diasNoPeriodo, round(mm.meta, 4), round(real, 4), round(real - mm.meta, 4), safeDiv(real * 100, mm.meta)]; }) };
  totalizar(secS); if (secS.totais) secS.totais[5] = safeDiv((secS.totais[3] as number) * 100, secS.totais[2] as number);
  r.secoes.push(sec, secS);
  const T = sec.totais ?? [];
  r.indicadores = [{ rotulo: 'Programado', valor: T[3] ?? 0, tipo: 'ha' }, { rotulo: 'Aplicado', valor: T[4] ?? 0, tipo: 'ha' }, { rotulo: 'Obstáculos', valor: T[5] ?? 0, tipo: 'ha' }, { rotulo: 'Falta aplicar', valor: T[6] ?? 0, tipo: 'ha' }, { rotulo: 'Execução', valor: T[7] ?? null, tipo: 'pct' }, { rotulo: 'Meta do período', valor: secS.totais?.[2] ?? 0, tipo: 'ha' }];
  r.notas.push('Aproveitamento = aplicado ÷ (programado − falta aplicar): quanto da área já encerrada foi de fato aplicada (o resto é obstáculo).', `Meta: ${ds.metas.haHoraDrone} ha/h × ${ds.metas.horasEfetivasTurno} h × ${ds.metas.dronesPorTurno} drone(s) × ${ds.metas.turnosPorDia} turno(s) por dia, ${ds.metas.diasPorSemana} dias/semana.`);
  return r;
}

// ---------------- 6. Clima ----------------
function relClima(c: Ctx): Relatorio {
  const { ds, f, idx } = c; const n = nomes(ds);
  const r = base(c, 'clima', 'Histórico de condições climáticas');
  const ops = filtrarOperacoes(ds, f, idx).sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));
  const M: Record<string, string> = { inicio: 'Início', durante: 'Durante', fim: 'Fim' };
  const linhas: Valor[][] = [];
  let fora = 0;
  for (const op of ops) for (const l of op.clima) {
    const av = avaliarLeitura(l, ds.limites); if (av.length) fora++;
    linhas.push([op.data, l.hora, M[l.momento] ?? l.momento, n.fazendaDaOS(op.osId), n.aeronave(op.aeronaveId), l.temperaturaC, l.umidadePct, l.ventoKmh, l.rajadaKmh, l.chuva ?? '', av.length ? `Fora: ${av.join('; ')}` : 'Dentro dos limites']);
  }
  const sec: Secao = { titulo: 'Leituras', colunas: [{ titulo: 'Data', tipo: 'data' }, { titulo: 'Hora', tipo: 'texto' }, { titulo: 'Momento', tipo: 'texto' }, { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Aeronave', tipo: 'texto' }, { titulo: 'Temp. (°C)', tipo: 'num', casas: 1, total: 'media' }, { titulo: 'UR (%)', tipo: 'num', casas: 0, total: 'media' }, { titulo: 'Vento (km/h)', tipo: 'num', casas: 1, total: 'media' }, { titulo: 'Rajada (km/h)', tipo: 'num', casas: 1 }, { titulo: 'Chuva', tipo: 'texto' }, { titulo: 'Avaliação', tipo: 'texto' }], linhas };
  totalizar(sec, 'Média');
  r.secoes.push(sec);
  r.indicadores = [{ rotulo: 'Leituras', valor: linhas.length, tipo: 'int' }, { rotulo: 'Fora dos limites', valor: fora, tipo: 'int' }, { rotulo: '% fora', valor: safeDiv(fora * 100, linhas.length), tipo: 'pct' }, { rotulo: 'Operações impedidas por clima', valor: ops.filter((o) => o.status === 'impedida_clima').length, tipo: 'int' }];
  const est = secaoEstacao(ds, ops, n);
  if (est) { r.secoes.push(est.secao); r.indicadores.push({ rotulo: 'Operações com alerta da estação', valor: est.comAlerta, tipo: 'int' }); r.notas.push(NOTA_ESTACAO); }
  r.notas.push(`Limites de referência (configuráveis): vento ${ds.limites.ventoMinKmh}–${ds.limites.ventoMaxKmh} km/h, UR ≥ ${ds.limites.umidadeMinPct}%, temperatura ≤ ${ds.limites.temperaturaMaxC} °C. Não substituem a bula/recomendação técnica.`);
  return r;
}

const NOTA_ESTACAO = 'Estação meteorológica: "Durante o voo" usa os registros horários que cobrem o horário da operação (extremos medidos em cada hora); "Resumo do dia" usa o relatório diário e não representa o momento da aplicação. ΔT = temperatura − bulbo úmido (Stull, 2011), estimado para a pior combinação (T máx. com UR mín.).';
/** Uma linha por operação com o clima da estação ligada à fazenda (null se nenhuma operação tiver estação). */
function secaoEstacao(ds: Dataset, ops: Operacao[], n: ReturnType<typeof nomes>): { secao: Secao; comAlerta: number } | null {
  const linhas: Valor[][] = []; let comAlerta = 0;
  for (const op of ops) {
    const c = contextoClima(ds, op); if (!c) continue;
    const al = c.alertas.filter((x) => x !== 'estação sem sensor de vento');
    if (al.length) comAlerta++;
    linhas.push([op.data, `${op.horaInicio}–${op.horaFim ?? '…'}`, n.fazendaDaOS(op.osId), n.aeronave(op.aeronaveId), `PIC ${c.estacao.pic || c.estacao.id}`, c.diario ? 'Resumo do dia' : `Durante o voo (${c.registros.length} h)`, c.chuva, c.tmax, c.urmin, c.estacao.temVento ? c.vento : 'sem sensor', c.estacao.temVento ? c.rajada : 'sem sensor', c.deltaTPior, al.join('; ') || 'Sem alerta']);
  }
  if (!linhas.length) return null;
  return { comAlerta, secao: { titulo: 'Estação meteorológica', colunas: [{ titulo: 'Data', tipo: 'data' }, { titulo: 'Horário', tipo: 'texto' }, { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Aeronave', tipo: 'texto' }, { titulo: 'Estação', tipo: 'texto' }, { titulo: 'Base', tipo: 'texto' }, { titulo: 'Chuva (mm)', tipo: 'num', casas: 1 }, { titulo: 'T máx. (°C)', tipo: 'num', casas: 1 }, { titulo: 'UR mín. (%)', tipo: 'num', casas: 0 }, { titulo: 'Vento (km/h)', tipo: 'num', casas: 1 }, { titulo: 'Rajada (km/h)', tipo: 'num', casas: 1 }, { titulo: 'ΔT pior (°C)', tipo: 'num', casas: 1 }, { titulo: 'Alertas', tipo: 'texto' }], linhas } };
}

// ---------------- 7. Paradas ----------------
function relParadas(c: Ctx): Relatorio {
  const { ds, f, idx } = c; const n = nomes(ds);
  const r = base(c, 'paradas', 'Relatório de paradas');
  const ops = filtrarOperacoes(ds, f, idx);
  const opPor = new Map(ops.map((o) => [o.id, o]));
  const ps = ds.paradas.filter((p) => opPor.has(p.operacaoId)).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const sec: Secao = { titulo: 'Paradas', colunas: [{ titulo: 'Data', tipo: 'data' }, { titulo: 'Início', tipo: 'texto' }, { titulo: 'Fim', tipo: 'texto' }, { titulo: 'Duração', tipo: 'min', total: 'soma' }, { titulo: 'Motivo', tipo: 'texto' }, { titulo: 'Climática', tipo: 'texto' }, { titulo: 'Aeronave', tipo: 'texto' }, { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'Observação', tipo: 'texto' }],
    linhas: ps.map((p) => { const op = opPor.get(p.operacaoId)!; return [p.inicio.slice(0, 10), p.inicio.slice(11, 16), p.fim ? p.fim.slice(11, 16) : 'em aberto', duracaoParadaMin(p), p.motivo, MOTIVOS_CLIMATICOS.includes(p.motivo) ? 'Sim' : 'Não', n.aeronave(op.aeronaveId), n.fazendaDaOS(op.osId), p.observacoes ?? '']; }) };
  totalizar(sec);
  const totalMin = ops.reduce((s, o) => s + (duracaoTotalMin(o.horaInicio, o.horaFim) ?? 0), 0);
  const mm = new Map<MotivoParada, { oc: number; min: number; ps: Parada[] }>();
  for (const p of ps) { const x = mm.get(p.motivo) ?? { oc: 0, min: 0, ps: [] }; x.oc++; x.min += somaParadasMin([p]); x.ps.push(p); mm.set(p.motivo, x); }
  // tempo no relógio: drones parados ao mesmo tempo contam uma vez; "somando os drones" = horas-drone (base da %)
  const secM: Secao = { titulo: 'Por motivo', colunas: [{ titulo: 'Motivo', tipo: 'texto' }, { titulo: 'Climática', tipo: 'texto' }, { titulo: 'Ocorrências', tipo: 'int', total: 'soma' }, { titulo: 'Tempo parado (relógio)', tipo: 'min' }, { titulo: 'Somando os drones', tipo: 'min', total: 'soma' }, { titulo: '% do tempo dos voos', tipo: 'pct' }, { titulo: 'Média por parada', tipo: 'min' }],
    linhas: [...mm.entries()].map(([mo, x]) => ({ mo, x, rel: minutosParadasRelogio(x.ps) })).sort((a, b) => b.rel - a.rel).map(({ mo, x, rel }) => [mo, MOTIVOS_CLIMATICOS.includes(mo) ? 'Sim' : 'Não', x.oc, rel, x.min, safeDiv(x.min * 100, totalMin), safeDiv(x.min, x.oc)]) };
  totalizar(secM);
  const relTotal = minutosParadasRelogio(ps);
  if (secM.totais) { secM.totais[3] = relTotal; secM.totais[5] = safeDiv((secM.totais[4] as number) * 100, totalMin); }
  r.secoes.push(secM, sec);
  const clim = minutosParadasRelogio(ps.filter((p) => MOTIVOS_CLIMATICOS.includes(p.motivo)));
  r.indicadores = [{ rotulo: 'Paradas', valor: ps.length, tipo: 'int' }, { rotulo: 'Tempo parado (relógio)', valor: relTotal, tipo: 'min' }, { rotulo: 'Somando os drones', valor: secM.totais?.[4] ?? 0, tipo: 'min' }, { rotulo: '% do tempo dos voos', valor: secM.totais?.[5] ?? null, tipo: 'pct' }, { rotulo: 'Por clima (relógio)', valor: clim, tipo: 'min' }];
  r.notas = [...(r.notas ?? []), 'Tempo parado no relógio: paradas de drones diferentes no mesmo horário contam uma vez. "Somando os drones" soma a parada de cada drone (horas-drone) e é a base da % sobre o tempo dos voos.'];
  return r;
}

// ---------------- 8. Evolução ----------------
function relEvolucao(c: Ctx): Relatorio {
  const { ds, f, idx } = c;
  const r = base(c, 'evolucao', 'Evolução da campanha');
  const ordens = ordensNoEscopo(ds, f);
  const plan = ordens.reduce((s, o) => s + areaPlanejadaOS(o), 0);
  const reg = [...filtrarOperacoes(ds, { ...f, status: '' }, idx, true), ...filtrarLancamentos(ds, { ...f, status: '' }, idx, true)];
  const antes = reg.filter((o) => o.data < f.de).reduce((s, o) => s + areaOperacao(o), 0);
  const dias = areaPorDia(reg.filter((o) => o.data >= f.de), f.de, f.ate);
  const metas = metaPorDia(ds.metas, f.de, f.ate);
  let acc = antes, accMeta = 0;
  const sec: Secao = { titulo: 'Por dia', colunas: [{ titulo: 'Data', tipo: 'data' }, { titulo: 'Área do dia (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Acumulado (ha)', tipo: 'ha' }, { titulo: 'Meta do dia (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Meta acumulada (ha)', tipo: 'ha' }, { titulo: '% do programado', tipo: 'pct' }],
    linhas: dias.map((d, i) => { acc += d.valor; accMeta += metas[i]?.meta ?? 0; return [d.rotulo, round(d.valor, 4), round(acc, 4), round(metas[i]?.meta ?? 0, 4), round(accMeta, 4), percentualExecutado(acc, plan)]; }) };
  totalizar(sec);
  if (sec.totais) { sec.totais[2] = round(acc, 4); sec.totais[4] = round(accMeta, 4); sec.totais[5] = percentualExecutado(acc, plan); }
  r.secoes.push(sec);
  const diasOp = dias.filter((d) => d.valor > 0).length;
  r.indicadores = [{ rotulo: 'Programado', valor: round(plan, 4), tipo: 'ha' }, { rotulo: 'Acumulado até o fim do período', valor: round(acc, 4), tipo: 'ha' }, { rotulo: 'No período', valor: round(acc - antes, 4), tipo: 'ha' }, { rotulo: 'Dias com aplicação', valor: diasOp, tipo: 'int' }, { rotulo: 'Média por dia aplicado', valor: safeDiv(acc - antes, diasOp), tipo: 'ha' }, { rotulo: 'Executado', valor: percentualExecutado(acc, plan), tipo: 'pct' }];
  if (antes > 0) r.notas.push(`O acumulado parte de ${round(antes, 2).toFixed(2).replace('.', ',')} ha aplicados antes do início do período.`);
  return r;
}

// ---------------- 9. Relatório técnico da aplicação ----------------
function relTecnico(c: Ctx, opId: string): Relatorio {
  const { ds, idx } = c; const n = nomes(ds);
  const op = ds.operacoes.find((o) => o.id === opId);
  const r = base(c, 'tecnico', 'Relatório técnico da aplicação', false);
  if (!op) { r.notas.push('Operação não encontrada.'); return r; }
  const os = ds.ordens.find((o) => o.id === op.osId);
  r.filtros = [`Operação ${op.data.split('-').reverse().join('/')} ${op.horaInicio} · OS ${n.os(op.osId)} · ${n.fazendaDaOS(op.osId)}`];
  const t = temposOperacao(op, idx);
  const area = areaOperacao(op);
  const ficha = (titulo: string, pares: [string, Valor, TipoCol?][]): Secao => ({ titulo, ficha: true, colunas: [{ titulo: 'Campo', tipo: 'texto' }, { titulo: 'Valor', tipo: 'texto' }], linhas: pares.map(([k, v, tp]) => [k, v === null || v === undefined || v === '' ? '—' : tp ? formatarValor(v, tp) : v]) });
  r.secoes.push(ficha('Identificação', [
    ['Data', op.data.split('-').reverse().join('/')], ['Início / fim', `${op.horaInicio} – ${op.horaFim ?? 'em andamento'}`], ['Situação', STATUS_OP[op.status] ?? op.status],
    ['Ordem de serviço', n.os(op.osId)], ['Fazenda', n.fazendaDaOS(op.osId)], ['Unidade', os ? n.unidade(os.unidadeId) : '—'], ['Campanha', n.campanha(op.campanhaId)], ['Cultura', op.cultura],
    ['Turno / líder', `${n.turno(op.turnoId)} · ${n.pessoa(op.liderId)}`], ['Aeronave', n.aeronave(op.aeronaveId)], ['Piloto', n.pessoa(op.pilotoId)], ['Auxiliares', op.auxiliarIds.map(n.pessoa).join(', ') || '—'], ['Equipamentos auxiliares', op.equipamentosAuxiliares ?? '—'],
  ]));
  r.secoes.push({ titulo: 'Áreas aplicadas', colunas: [{ titulo: 'Talhão', tipo: 'texto' }, { titulo: 'Zona', tipo: 'texto' }, { titulo: 'Programado na OS (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado nesta operação (ha)', tipo: 'ha', total: 'soma' }],
    linhas: op.itens.map((i) => { const tl = ds.talhoes.find((x) => x.id === i.talhaoId); return [tl?.geral ? 'GERAL' : tl?.codigo ?? '—', tl?.zona ?? '', os?.itens.find((x) => x.talhaoId === i.talhaoId)?.areaPlanejadaHa ?? null, round(i.areaHa, 4)]; }) });
  totalizar(r.secoes[1]);
  r.secoes.push({ titulo: `Calda${op.calda.tratamento ? ` — ${op.calda.tratamento}` : ''} (volume ${String(op.calda.volumeLHa).replace('.', ',')} L/ha)`, colunas: [{ titulo: 'Produto', tipo: 'texto' }, { titulo: 'Código', tipo: 'texto' }, { titulo: 'Dose planejada', tipo: 'dose' }, { titulo: 'Dose real', tipo: 'dose' }, { titulo: 'Unidade', tipo: 'texto' }, { titulo: 'Quantidade total', tipo: 'num', casas: 3 }, { titulo: 'Un.', tipo: 'texto' }, { titulo: 'Lote', tipo: 'texto' }],
    linhas: op.calda.produtos.map((p) => { const q = quantidadeTotal(p.doseReal ?? p.dosePlanejada, p.unidade, area); return [n.produto(p.produtoId), ds.produtos.find((x) => x.id === p.produtoId)?.codigo ?? '', p.dosePlanejada, p.doseReal, p.unidade, q?.valor ?? null, q?.unidade ?? '', p.lote ?? '']; }),
    nota: `Volume total de calda: ${(op.calda.volumeLHa * area).toFixed(0)} L para ${area.toFixed(2).replace('.', ',')} ha.` });
  r.secoes.push(ficha('Parâmetros de voo e tempos', [
    ['Velocidade (m/s)', op.velocidadeMs ?? null, 'num'], ['Altura de voo (m)', op.alturaVooM ?? null, 'num'], ['Faixa (m)', op.faixaM ?? null, 'num'],
    ['Tempo total', t.total, 'min'], ['Tempo efetivo', t.efetivo, 'min'], ['Tempo parado', t.parado, 'min'],
    ['ha/h efetivo', produtividadeEfetiva(area, t.efetivo), 'hah'], ['ha/h operacional', produtividadeOperacional(area, t.total), 'hah'],
    ...(op.voo ? ([['Cargas (KML de voo)', op.voo.cargas, 'int'], ['Tempo em voo (KML)', Math.round(op.voo.tempoVooMin), 'min'], ['ha/h em voo (KML)', op.voo.tempoVooMin > 0 ? area / (op.voo.tempoVooMin / 60) : null, 'hah'], ['Volume pulverizado (KML, L)', op.voo.volumeL, 'num'], ['Taxa real (KML, L/ha)', op.voo.taxaLHa, 'num'], ['Cargas fora da taxa', op.voo.foraTaxa, 'int']] as [string, Valor, TipoCol][]) : []),
  ]));
  const M: Record<string, string> = { inicio: 'Início', durante: 'Durante', fim: 'Fim' };
  r.secoes.push({ titulo: 'Condições climáticas', colunas: [{ titulo: 'Momento', tipo: 'texto' }, { titulo: 'Hora', tipo: 'texto' }, { titulo: 'Temp. (°C)', tipo: 'num', casas: 1 }, { titulo: 'UR (%)', tipo: 'num', casas: 0 }, { titulo: 'Vento (km/h)', tipo: 'num', casas: 1 }, { titulo: 'Rajada', tipo: 'num', casas: 1 }, { titulo: 'Direção', tipo: 'texto' }, { titulo: 'Chuva', tipo: 'texto' }, { titulo: 'Fonte', tipo: 'texto' }, { titulo: 'Avaliação', tipo: 'texto' }],
    linhas: op.clima.map((l) => { const av = avaliarLeitura(l, ds.limites); return [M[l.momento] ?? l.momento, l.hora, l.temperaturaC, l.umidadePct, l.ventoKmh, l.rajadaKmh, l.direcaoVento ?? '', l.chuva ?? '', l.origem, av.length ? `Fora: ${av.join('; ')}` : 'Dentro']; }) });
  const cc = contextoClima(ds, op);
  if (cc) {
    const fx = (v: number | null, k: number) => (v === null ? '—' : formatarValor(v, 'num', k));
    r.secoes.push(ficha(`Estação meteorológica — ${cc.diario ? 'resumo do dia' : `durante o voo (${cc.registros.length} registro(s) horário(s))`}`, [
      ['Estação', cc.estacao.nome], ['Base dos dados', cc.diario ? 'Relatório diário (não representa o horário do voo)' : `Registros de ${cc.registros[0].inicio.slice(11, 16)} a ${cc.registros[cc.registros.length - 1].fim.slice(11, 16)}`],
      ['Chuva (mm)', cc.chuva, 'num'], ['Temperatura mín. – máx. (°C)', `${fx(cc.tmin, 1)} – ${fx(cc.tmax, 1)}`], ['UR mín. – máx. (%)', `${fx(cc.urmin, 0)} – ${fx(cc.urmax, 0)}`],
      ['Vento médio máx. (km/h)', cc.estacao.temVento ? cc.vento : 'estação sem sensor de vento', cc.estacao.temVento ? 'num' : undefined], ['Rajada máx. (km/h)', cc.estacao.temVento ? cc.rajada : 'estação sem sensor de vento', cc.estacao.temVento ? 'num' : undefined],
      ['ΔT estimado na pior condição (°C)', cc.deltaTPior, 'num'], ['Alertas', cc.alertas.filter((x) => x !== 'estação sem sensor de vento').join('; ') || 'Nenhum'],
    ]));
    r.notas.push(NOTA_ESTACAO);
  }
  const ps = (idx.paradasPorOp.get(op.id) ?? []).slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
  r.secoes.push({ titulo: 'Paradas', colunas: [{ titulo: 'Início', tipo: 'texto' }, { titulo: 'Fim', tipo: 'texto' }, { titulo: 'Duração', tipo: 'min', total: 'soma' }, { titulo: 'Motivo', tipo: 'texto' }, { titulo: 'Responsável', tipo: 'texto' }, { titulo: 'Observação', tipo: 'texto' }],
    linhas: ps.map((p) => [p.inicio.slice(11, 16), p.fim ? p.fim.slice(11, 16) : 'em aberto', duracaoParadaMin(p), p.motivo, p.responsavel, p.observacoes ?? '']) });
  if (ps.length) totalizar(r.secoes[r.secoes.length - 1]);
  r.secoes.push(ficha('Observações e encerramento', [['Observações técnicas', op.observacoesTecnicas ?? null], ['Observações do operador', op.observacoesOperador ?? null], ['Responsável pelo encerramento', op.responsavelEncerramento ?? null], ['Registrado em', op.criadoEm ? op.criadoEm.slice(0, 16).replace('T', ' ') : null], ['Origem do registro', op.origem === 'demo' ? 'Demonstração (fictício)' : 'Registro no protótipo']]));
  r.indicadores = [{ rotulo: 'Área', valor: area, tipo: 'ha' }, { rotulo: 'Tempo efetivo', valor: t.efetivo, tipo: 'min' }, { rotulo: 'ha/h efetivo', valor: produtividadeEfetiva(area, t.efetivo), tipo: 'hah' }, { rotulo: 'Produtos', valor: op.calda.produtos.length, tipo: 'int' }];
  return r;
}

export function opcoesTecnico(ds: Dataset, f: Filtros): Operacao[] {
  return filtrarOperacoes(ds, f, criarIndices(ds)).sort((a, b) => (b.data + b.horaInicio).localeCompare(a.data + a.horaInicio));
}

export function gerarRelatorio(ds: Dataset, id: IdRelatorio, f: Filtros, responsavel: string, agora: string, extra: { operacaoId?: string } = {}, idx = criarIndices(ds)): Relatorio {
  const c: Ctx = { ds, f, idx, responsavel, agora };
  switch (id) {
    case 'os': return relOS(c);
    case 'fazenda': return relFazenda(c);
    case 'aeronave': return relDesempenho(c, 'aeronaveId');
    case 'operador': return relDesempenho(c, 'pilotoId');
    case 'planejado': return relPlanejado(c);
    case 'clima': return relClima(c);
    case 'paradas': return relParadas(c);
    case 'evolucao': return relEvolucao(c);
    case 'tecnico': return relTecnico(c, extra.operacaoId ?? '');
  }
}

// ---------------- formatação comum (tela, CSV, PDF) ----------------
const nf = (v: number, casas: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export function formatarValor(v: Valor, tipo: TipoCol, casas?: number): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') {
    if (tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
    return v;
  }
  if (!Number.isFinite(v)) return '—';
  switch (tipo) {
    case 'int': return nf(v, 0);
    case 'ha': return nf(v, casas ?? 2);
    case 'pct': return `${nf(v, casas ?? 1)}%`;
    case 'hah': return nf(v, casas ?? 2);
    case 'dose': return nf(v, casas ?? 3);
    case 'min': { const h = Math.floor(Math.round(v) / 60), m = Math.round(v) % 60; return `${h}h${String(m).padStart(2, '0')}`; }
    case 'num': return nf(v, casas ?? 2);
    default: return String(v);
  }
}
