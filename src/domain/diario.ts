/**
 * Resumo de UM dia de operação (base do "Diário de aplicações").
 * Tudo é derivado dos registros: nada é digitado de novo.
 *
 * Convenção de dia: uma operação pertence ao dia em que COMEÇOU (aplicação noturna que passa da
 * meia-noite continua contando no dia de início).
 */
import type { Indices } from './analytics';
import { ultimo, aplicacoes, aplicadoPorItem, areaObstaculo, areaOperacao, areaPlanejadaOS, duracaoParadaMin, duracaoTotalMin, hhmmParaMin, isoLocalParaMin, quantidadeTotal, somaParadasMin } from './calc';
import type { Dataset, LeituraClima, MotivoParada, Operacao, UnidadeDose } from './types';
import { MOTIVOS_CLIMATICOS } from './types';
import { registrar } from './base';

export interface FiltroDia { turnoId: string; liderId: string; campanhaId: string }

export interface EventoLinhaTempo {
  minutoAbs: number; // minutos desde 00:00 do dia (pode passar de 1440 após a meia-noite)
  hora: string;
  tipo: 'inicio' | 'pausa' | 'retomada' | 'fim' | 'impedida';
  texto: string;
  aeronave: string;
  climatico: boolean;
  /** de onde vem o evento (para editar/excluir): voo e, se for parada/retomada, a parada */
  refs: { opId: string; paradaId?: string; aeronave: string }[];
}

export interface ResumoDia {
  data: string;
  ops: Operacao[];
  areaDia: number;
  /** parte da área do dia lançada sem voo (sequência/ficha diária) */
  areaLancadaDia: number;
  inicioMin: number | null; // minutos desde 00:00 do dia
  fimMin: number | null; // pode passar de 1440
  jornadaMin: number;
  minEfetivoSoma: number; // soma entre drones
  minParadoSoma: number;
  minTotalSoma: number;
  fazendas: { fazendaId: string; area: number; talhoes: number; os: string[] }[];
  produtos: { produtoId: string; dose: number; unidade: UnidadeDose; quantidade: { valor: number; unidade: 'L' | 'kg' } | null; lotes: string[] }[];
  porAeronave: { aeronaveId: string; area: number; minEfetivo: number; minTotal: number; ops: number }[];
  climaInicial: LeituraClima | null;
  climaFinal: LeituraClima | null;
  turnos: string[];
  lideres: string[];
  campanhas: string[];
  impedidas: number;
  eventos: EventoLinhaTempo[];
  observacoes: { aeronave: string; texto: string; opIds: string[] }[];
  // Campanha até o dia
  planejadoEscopo: number;
  obstaculosEscopo: number;
  acumuladoAteDia: number;
  diasOperacaoAteDia: number;
  areaPorDiaAteDia: { data: string; area: number }[];
}

export function datasComOperacao(ds: Dataset, f: FiltroDia): string[] {
  const lanc = f.turnoId || f.liderId ? [] : (ds.lancamentos ?? []).filter((l) => !f.campanhaId || l.campanhaId === f.campanhaId);
  return [...new Set([...ds.operacoes.filter((o) => passa(o, f)), ...lanc].map((o) => o.data))].sort();
}

const passa = (o: Operacao, f: FiltroDia) =>
  (!f.turnoId || o.turnoId === f.turnoId) && (!f.liderId || o.liderId === f.liderId) && (!f.campanhaId || o.campanhaId === f.campanhaId);

export function resumoDia(ds: Dataset, idx: Indices, data: string, f: FiltroDia): ResumoDia {
  const ops = ds.operacoes.filter((o) => o.data === data && passa(o, f) && idx.os.get(o.osId)?.status !== 'cancelada')
    .sort((a, b) => (hhmmParaMin(a.horaInicio) ?? 0) - (hhmmParaMin(b.horaInicio) ?? 0));
  const lancDia = (ds.lancamentos ?? []).filter((l) => l.data === data && (!f.campanhaId || l.campanhaId === f.campanhaId) && !f.turnoId && !f.liderId && idx.os.get(l.osId)?.status !== 'cancelada');
  const areaLancadaDia = lancDia.reduce((s, l) => s + areaOperacao(l), 0);
  const areaDia = ops.reduce((s, o) => s + areaOperacao(o), 0) + areaLancadaDia;

  let inicioMin: number | null = null;
  let fimMin: number | null = null;
  let minEfetivoSoma = 0, minParadoSoma = 0, minTotalSoma = 0;
  const eventos: EventoLinhaTempo[] = [];
  const baseDia = isoLocalParaMin(`${data}T00:00`) ?? 0;
  const relativo = (iso: string) => (isoLocalParaMin(iso) ?? baseDia) - baseDia;
  const hhmm = (abs: number) => `${String(Math.floor((abs % 1440) / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

  for (const op of ops) {
    const ac = ds.aeronaves.find((a) => a.id === op.aeronaveId)?.identificacao ?? '—';
    const ini = hhmmParaMin(op.horaInicio) ?? 0;
    const tot = duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0;
    const fim = ini + tot;
    inicioMin = inicioMin === null ? ini : Math.min(inicioMin, ini);
    fimMin = fimMin === null ? fim : Math.max(fimMin, fim);
    const paradas = (idx.paradasPorOp.get(op.id) ?? []).slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
    minEfetivoSoma += op.tempoEfetivoMin;
    minParadoSoma += somaParadasMin(paradas);
    minTotalSoma += tot;
    if (op.status === 'impedida_clima') {
      eventos.push({ minutoAbs: ini, hora: hhmm(ini), tipo: 'impedida', texto: `Operação impedida — ${paradas[0]?.motivo ?? 'clima'}`, aeronave: ac, climatico: true, refs: [{ opId: op.id, aeronave: ac }] });
      continue;
    }
    eventos.push({ minutoAbs: ini, hora: hhmm(ini), tipo: 'inicio', texto: 'Início da aplicação', aeronave: ac, climatico: false, refs: [{ opId: op.id, aeronave: ac }] });
    for (const p of paradas) {
      // abastecimento/reabastecimento é rotina do voo: não polui a linha do tempo
      if (p.motivo === 'Abastecimento/reabastecimento') continue;
      const a = relativo(p.inicio);
      const climatico = MOTIVOS_CLIMATICOS.includes(p.motivo as MotivoParada);
      eventos.push({ minutoAbs: a, hora: hhmm(a), tipo: 'pausa', texto: p.motivo + (p.observacoes ? ` — ${p.observacoes}` : ''), aeronave: ac, climatico, refs: [{ opId: op.id, paradaId: p.id, aeronave: ac }] });
      if (p.fim && duracaoParadaMin(p) !== null && relativo(p.fim) < fim) {
        const b = relativo(p.fim);
        eventos.push({ minutoAbs: b, hora: hhmm(b), tipo: 'retomada', texto: climatico ? 'Condições restabelecidas' : 'Retomada da aplicação', aeronave: ac, climatico: false, refs: [{ opId: op.id, paradaId: p.id, aeronave: ac }] });
      }
    }
    eventos.push({ minutoAbs: fim, hora: hhmm(fim), tipo: 'fim', texto: 'Fim da aplicação', aeronave: ac, climatico: false, refs: [{ opId: op.id, aeronave: ac }] });
  }
  // mesmo evento, mesma hora, em vários drones → um só item com os drones juntos (mesmo que intercalados)
  const ORDEM_EV: Record<string, number> = { inicio: 0, impedida: 0, pausa: 1, retomada: 2, fim: 3 };
  const juntos = new Map<string, EventoLinhaTempo>();
  for (const ev of eventos) {
    const k = `${ev.minutoAbs}|${ev.tipo}|${ev.texto}`;
    const j = juntos.get(k);
    if (j) { j.aeronave = `${j.aeronave}, ${ev.aeronave}`; j.refs = [...j.refs, ...ev.refs]; } else juntos.set(k, { ...ev, refs: [...ev.refs] });
  }
  eventos.length = 0;
  eventos.push(...[...juntos.values()].sort((a, b) => a.minutoAbs - b.minutoAbs || ORDEM_EV[a.tipo] - ORDEM_EV[b.tipo] || a.aeronave.localeCompare(b.aeronave)));

  // Fazendas
  const mf = new Map<string, { fazendaId: string; area: number; talhoes: Set<string>; os: Set<string> }>();
  for (const op of [...ops, ...lancDia]) {
    const os = idx.os.get(op.osId);
    if (!os) continue;
    for (const it of op.itens) {
      const r = mf.get(os.fazendaId) ?? { fazendaId: os.fazendaId, area: 0, talhoes: new Set(), os: new Set() };
      r.area += it.areaHa; r.talhoes.add(it.talhaoId); r.os.add(os.numero);
      mf.set(os.fazendaId, r);
    }
  }
  const fazendas = [...mf.values()].map((r) => ({ fazendaId: r.fazendaId, area: r.area, talhoes: r.talhoes.size, os: [...r.os] })).sort((a, b) => b.area - a.area);

  // Produtos: dose ponderada pela área (se doses diferirem entre operações) e quantidade total do dia
  const mp = new Map<string, { produtoId: string; somaDoseArea: number; area: number; unidade: UnidadeDose; lotes: Set<string> }>();
  for (const op of ops) {
    const a = areaOperacao(op);
    for (const p of op.calda.produtos) {
      const r = mp.get(p.produtoId) ?? { produtoId: p.produtoId, somaDoseArea: 0, area: 0, unidade: p.unidade, lotes: new Set() };
      r.somaDoseArea += (p.doseReal ?? p.dosePlanejada) * a; r.area += a;
      if (p.lote) r.lotes.add(p.lote);
      mp.set(p.produtoId, r);
    }
  }
  const produtos = [...mp.values()].map((r) => {
    const dose = r.area > 0 ? r.somaDoseArea / r.area : 0;
    return { produtoId: r.produtoId, dose, unidade: r.unidade, quantidade: quantidadeTotal(dose, r.unidade, r.area), lotes: [...r.lotes] };
  });

  const ma = new Map<string, { aeronaveId: string; area: number; minEfetivo: number; minTotal: number; ops: number }>();
  for (const op of ops) {
    const r = ma.get(op.aeronaveId) ?? { aeronaveId: op.aeronaveId, area: 0, minEfetivo: 0, minTotal: 0, ops: 0 };
    r.area += areaOperacao(op); r.minEfetivo += op.tempoEfetivoMin; r.minTotal += duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0; r.ops++;
    ma.set(op.aeronaveId, r);
  }

  const leituras = ops.flatMap((o) => o.clima);
  const climaInicial = ops[0]?.clima.find((l) => l.momento === 'inicio') ?? leituras[0] ?? null;
  const ultimaOp = ultimo([...ops].sort((a, b) => (hhmmParaMin(a.horaInicio)! + (duracaoTotalMin(a.horaInicio, a.horaFim) ?? 0)) - (hhmmParaMin(b.horaInicio)! + (duracaoTotalMin(b.horaInicio, b.horaFim) ?? 0))));
  const climaFinal = (ultimaOp ? ultimo(ultimaOp.clima.filter((l) => l.momento === 'fim')) : undefined) ?? ultimo(leituras) ?? null;

  // Campanha até o dia (escopo = campanhas do dia, ou a campanha filtrada)
  const campanhas = [...new Set([...ops, ...lancDia].map((o) => o.campanhaId))];
  const escopoCamp = f.campanhaId ? [f.campanhaId] : campanhas;
  const ordens = ds.ordens.filter((o) => o.status !== 'cancelada' && escopoCamp.includes(o.campanhaId));
  const opsAte = [...ds.operacoes, ...(ds.lancamentos ?? [])].filter((o) => escopoCamp.includes(o.campanhaId) && o.data <= data && idx.os.get(o.osId)?.status !== 'cancelada');
  const porDia = new Map<string, number>();
  for (const o of opsAte) porDia.set(o.data, (porDia.get(o.data) ?? 0) + areaOperacao(o));

  return {
    data, ops, areaDia, areaLancadaDia, inicioMin, fimMin,
    jornadaMin: inicioMin === null || fimMin === null ? 0 : fimMin - inicioMin,
    minEfetivoSoma, minParadoSoma, minTotalSoma,
    fazendas, produtos, porAeronave: [...ma.values()].sort((a, b) => b.area - a.area),
    climaInicial, climaFinal,
    turnos: [...new Set(ops.map((o) => o.turnoId))],
    lideres: [...new Set(ops.map((o) => o.liderId))],
    campanhas,
    impedidas: ops.filter((o) => o.status === 'impedida_clima').length,
    eventos,
    observacoes: observacoesDigitadas(ds, ops),
    planejadoEscopo: ordens.reduce((s, o) => s + areaPlanejadaOS(o), 0),
    obstaculosEscopo: ordens.reduce((s, o) => s + areaObstaculo(o, aplicadoPorItem(aplicacoes(ds))), 0),
    acumuladoAteDia: opsAte.reduce((s, o) => s + areaOperacao(o), 0),
    diasOperacaoAteDia: [...porDia.values()].filter((v) => v > 0).length,
    areaPorDiaAteDia: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, area]) => ({ data: d, area })),
  };
}

/** Notas que o próprio app escreve (não foram digitadas): ficam no registro da operação, mas não no Diário. */
const NOTA_AUTOMATICA = /^(Data corrigida:|Fechamento do dia\b|Importad[oa] d[oe] |Gerad[oa] (pelo|a partir))/i;

/**
 * Só o que foi digitado (observações do operador / da ficha), sem as notas técnicas automáticas.
 * Texto igual em vários voos do dia aparece uma vez, com os drones juntos.
 */
const partesObs = (txt: string) => txt.split(/\s+·\s+|\n+/);
const limparParte = (p: string) => p.replace(/^Encerramento:\s*/i, '').trim();
const ehAuto = (p: string) => NOTA_AUTOMATICA.test(limparParte(p));

/** Texto digitado (sem notas automáticas) de uma observação gravada — um texto por voo. */
export function textosDigitados(txt: string | undefined): string[] {
  const t = partesObs(txt ?? '').filter((p) => p.trim() && !ehAuto(p)).map(limparParte).join(' · ');
  return t ? [t] : [];
}

export function observacoesDigitadas(ds: Dataset, ops: Operacao[]): { aeronave: string; texto: string; opIds: string[] }[] {
  const porTexto = new Map<string, { acs: Set<string>; ids: string[] }>();
  for (const o of ops) {
    const ac = ds.aeronaves.find((a) => a.id === o.aeronaveId)?.identificacao ?? '—';
    for (const t of textosDigitados(o.observacoesOperador)) {
      const x = porTexto.get(t) ?? porTexto.set(t, { acs: new Set(), ids: [] }).get(t)!;
      x.acs.add(ac); x.ids.push(o.id);
    }
  }
  return [...porTexto.entries()].map(([texto, x]) => ({ aeronave: [...x.acs].join(', '), texto, opIds: x.ids }));
}

/**
 * Edita (novo texto) ou exclui (null) uma observação digitada nos voos indicados. As notas automáticas
 * ficam como estão. Retorna erro ou null.
 */
export function editarObservacao(ds: Dataset, opIds: string[], antigo: string, novo: string | null): string | null {
  const n = novo?.trim() ?? null;
  if (novo !== null && !n) return 'Escreva a observação ou use Excluir.';
  let mudou = 0;
  for (const o of ds.operacoes) {
    if (!opIds.includes(o.id) || !o.observacoesOperador) continue;
    if (textosDigitados(o.observacoesOperador)[0] !== antigo) continue;
    const auto = partesObs(o.observacoesOperador).filter((p) => p.trim() && ehAuto(p)).map((p) => p.trim());
    o.observacoesOperador = [...auto, ...(n ? [n] : [])].join(' · ');
    mudou++;
  }
  if (!mudou) return 'Observação não encontrada (talvez já tenha sido alterada). Atualize a tela.';
  registrar(ds, { entidade: 'operacao', entidadeId: opIds[0], acao: n ? 'editar' : 'excluir', resumo: n ? `Observação editada: "${antigo}" → "${n}"` : `Observação excluída: "${antigo}"`, antes: antigo, depois: n ?? undefined });
  return null;
}
