/**
 * Dias de operação e meta da safra.
 *
 * Por campanha (e na safra): dias corridos desde o início até hoje (ou até o fim, se já passou), dias com
 * aplicação, dias parados (registrados como "dia sem aplicação" ou com operação impedida por clima, sem
 * área) por motivo, e dias sem registro (nem aplicação nem parada informada).
 *
 * Safra: meta fixa (ex.: 24.000 ha) e período próprios, independentes das campanhas; aplicado = toda a
 * área aplicada no período da safra, de todas as campanhas.
 */
import { addDias, areaOperacao, round, safeDiv } from './calc';
import { registrar } from './base';
import { MOTIVOS_CLIMATICOS, type Dataset, type MotivoParada } from './types';

export interface DiaParado { id: string; data: string; motivo: MotivoParada; observacao?: string; /** vazio = todas as campanhas */ campanhaIds: string[]; criadoEm: string }
export interface Safra { nome: string; inicio: string; fim: string; metaHa: number }

export const META_SAFRA_PADRAO = 24000;

/** Safra gravada, ou a padrão: início = 1ª campanha, 12 meses, meta 24.000 ha. */
export function safraAtual(ds: Dataset, hoje: string): Safra {
  if (ds.safra) return ds.safra;
  const ini = [...ds.campanhas.map((c) => c.inicio)].filter(Boolean).sort()[0] ?? hoje;
  const ano = Number(ini.slice(0, 4));
  return { nome: `Safra ${ano}/${String((ano + 1) % 100).padStart(2, '0')}`, inicio: ini, fim: addDias(addDias(ini, 365), -1), metaHa: META_SAFRA_PADRAO };
}

const entre = (d: string, de: string, ate: string) => d >= de && d <= ate;
function diasNoIntervalo(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate && out.length < 2000; d = addDias(d, 1)) out.push(d);
  return out;
}

export type TipoDia = 'aplicacao' | 'parado' | 'sem_registro';
export interface Dia { data: string; tipo: TipoDia; area: number; motivo?: MotivoParada; observacao?: string }
export interface ResumoDias {
  de: string; ate: string; corridos: number; comAplicacao: number; parados: number; paradosClima: number; paradosOutros: number;
  porMotivo: Partial<Record<MotivoParada, number>>; semRegistro: number; area: number;
  haDiaEfetivo: number | null; haDiaCorrido: number | null; pctEfetivo: number | null; dias: Dia[];
}

/** Resumo de dias de `de` a `ate` para as campanhas indicadas (null = todas). */
export function resumoDias(ds: Dataset, de: string, ate: string, campanhaIds: string[] | null): ResumoDias {
  const noEscopo = (c: string) => !campanhaIds || campanhaIds.includes(c);
  const areaDia = new Map<string, number>();
  for (const o of [...ds.operacoes, ...(ds.lancamentos ?? [])]) if (noEscopo(o.campanhaId) && entre(o.data, de, ate)) areaDia.set(o.data, (areaDia.get(o.data) ?? 0) + areaOperacao(o));
  const parado = new Map<string, { motivo: MotivoParada; observacao?: string }>();
  for (const p of ds.diasParados ?? []) if (entre(p.data, de, ate) && (!p.campanhaIds.length || !campanhaIds || p.campanhaIds.some(noEscopo))) parado.set(p.data, { motivo: p.motivo, observacao: p.observacao });
  // operação impedida por clima, sem área no dia
  for (const o of ds.operacoes) if (o.status === 'impedida_clima' && noEscopo(o.campanhaId) && entre(o.data, de, ate) && !parado.has(o.data)) {
    const m = ds.paradas.find((x) => x.operacaoId === o.id && MOTIVOS_CLIMATICOS.includes(x.motivo))?.motivo ?? 'Chuva';
    parado.set(o.data, { motivo: m, observacao: 'Operação impedida por clima' });
  }
  const dias: Dia[] = de <= ate ? diasNoIntervalo(de, ate).map((d) => {
    const a = round(areaDia.get(d) ?? 0, 4);
    if (a > 0.005) return { data: d, tipo: 'aplicacao', area: a };
    const p = parado.get(d);
    return p ? { data: d, tipo: 'parado', area: 0, ...p } : { data: d, tipo: 'sem_registro', area: 0 };
  }) : [];
  const porMotivo: Partial<Record<MotivoParada, number>> = {};
  for (const d of dias) if (d.tipo === 'parado' && d.motivo) porMotivo[d.motivo] = (porMotivo[d.motivo] ?? 0) + 1;
  const comAplicacao = dias.filter((d) => d.tipo === 'aplicacao').length;
  const parados = dias.filter((d) => d.tipo === 'parado').length;
  const paradosClima = dias.filter((d) => d.tipo === 'parado' && d.motivo && MOTIVOS_CLIMATICOS.includes(d.motivo)).length;
  const area = round(dias.reduce((s, d) => s + d.area, 0), 4);
  return {
    de, ate, corridos: dias.length, comAplicacao, parados, paradosClima, paradosOutros: parados - paradosClima, porMotivo,
    semRegistro: dias.filter((d) => d.tipo === 'sem_registro').length, area,
    haDiaEfetivo: safeDiv(area, comAplicacao), haDiaCorrido: safeDiv(area, dias.length), pctEfetivo: safeDiv(comAplicacao * 100, dias.length), dias,
  };
}

/** Dias da campanha: do início até hoje (ou até o fim, se já terminou). */
export function diasCampanha(ds: Dataset, campanhaId: string, hoje: string): ResumoDias | null {
  const c = ds.campanhas.find((x) => x.id === campanhaId);
  if (!c) return null;
  const ate = c.fim && c.fim < hoje ? c.fim : hoje;
  return resumoDias(ds, c.inicio, ate, [campanhaId]);
}

export interface ResumoSafra extends ResumoDias {
  safra: Safra; aplicado: number; pct: number | null; falta: number; diasRestantes: number;
  necessarioDia: number | null; ritmoCorrido: number | null; projecaoFim: number | null;
}
export function resumoSafra(ds: Dataset, hoje: string): ResumoSafra {
  const s = safraAtual(ds, hoje);
  const ate = s.fim < hoje ? s.fim : hoje;
  // dias contados a partir do início da 1ª campanha da safra (antes disso não há operação para registrar)
  const iniCamp = ds.campanhas.filter((c) => c.inicio <= s.fim && (!c.fim || c.fim >= s.inicio)).map((c) => c.inicio).sort()[0];
  const de = iniCamp && iniCamp > s.inicio ? iniCamp : s.inicio;
  const r = resumoDias(ds, de, ate, null);
  const falta = Math.max(0, s.metaHa - r.area);
  const diasRestantes = s.fim >= hoje ? diasNoIntervalo(addDias(hoje, 1), s.fim).length : 0;
  return {
    ...r, safra: s, aplicado: r.area, pct: safeDiv(r.area * 100, s.metaHa), falta,
    diasRestantes, necessarioDia: diasRestantes ? round(falta / diasRestantes, 2) : null,
    ritmoCorrido: r.haDiaCorrido, projecaoFim: r.haDiaCorrido === null ? null : round(r.area + r.haDiaCorrido * diasRestantes, 0),
  };
}

/** Grava/edita a safra (meta e período). Retorna erro ou null. */
export function gravarSafra(ds: Dataset, s: Safra): string | null {
  if (!s.nome.trim()) return 'Informe o nome da safra.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(s.fim)) return 'Informe o início e o fim da safra.';
  if (s.fim < s.inicio) return 'O fim da safra precisa ser depois do início.';
  if (!(s.metaHa > 0)) return 'Informe a meta da safra (ha).';
  const antes = ds.safra;
  ds.safra = { nome: s.nome.trim(), inicio: s.inicio, fim: s.fim, metaHa: round(s.metaHa, 2) };
  registrar(ds, { entidade: 'configuracao', entidadeId: 'safra', acao: 'editar', resumo: `Safra ${ds.safra.nome}: meta ${ds.safra.metaHa.toLocaleString('pt-BR')} ha · ${s.inicio.split('-').reverse().join('/')} a ${s.fim.split('-').reverse().join('/')}`, antes, depois: ds.safra });
  return null;
}

/**
 * Registra dia(s) sem aplicação (ex.: 2 dias de chuva). Dias com aplicação no escopo não são marcados
 * (num dia com aplicação, a parada é registrada no fechamento do dia). Mesmo dia já registrado: substitui.
 */
export function registrarDiasParados(ds: Dataset, p: { de: string; ate: string; motivo: MotivoParada; observacao?: string; campanhaIds: string[] }, gerarId: (x: string) => string, hoje: string): { gravados: number; ignorados: string[]; erro: string | null } {
  const ate = p.ate || p.de;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.de)) return { gravados: 0, ignorados: [], erro: 'Informe a data.' };
  if (ate < p.de) return { gravados: 0, ignorados: [], erro: 'A data final precisa ser igual ou depois da inicial.' };
  if (ate > hoje) return { gravados: 0, ignorados: [], erro: 'Não dá para registrar dia sem aplicação no futuro.' };
  const dias = diasNoIntervalo(p.de, ate);
  if (dias.length > 62) return { gravados: 0, ignorados: [], erro: 'Período longo demais (máx. 62 dias por vez).' };
  ds.diasParados ??= [];
  const ignorados: string[] = [];
  let gravados = 0;
  for (const d of dias) {
    const temAplicacao = [...ds.operacoes, ...(ds.lancamentos ?? [])].some((o) => o.data === d && areaOperacao(o) > 0.005 && (!p.campanhaIds.length || p.campanhaIds.includes(o.campanhaId)));
    if (temAplicacao) { ignorados.push(d); continue; }
    ds.diasParados = ds.diasParados.filter((x) => !(x.data === d && (!x.campanhaIds.length || !p.campanhaIds.length || x.campanhaIds.some((c) => p.campanhaIds.includes(c)))));
    ds.diasParados.push({ id: gerarId('dp'), data: d, motivo: p.motivo, observacao: p.observacao?.trim() || undefined, campanhaIds: [...p.campanhaIds], criadoEm: new Date().toISOString() });
    gravados++;
  }
  ds.diasParados.sort((a, b) => a.data.localeCompare(b.data));
  if (gravados) registrar(ds, { entidade: 'operacao', entidadeId: `parado-${p.de}`, acao: 'criar', resumo: `Dia(s) sem aplicação: ${p.de.split('-').reverse().join('/')}${ate !== p.de ? ` a ${ate.split('-').reverse().join('/')}` : ''} · ${p.motivo} (${gravados} dia(s))${p.observacao ? ` · ${p.observacao}` : ''}` });
  return { gravados, ignorados, erro: null };
}

export function removerDiaParado(ds: Dataset, id: string): string | null {
  const x = (ds.diasParados ?? []).find((p) => p.id === id);
  if (!x) return 'Registro não encontrado.';
  ds.diasParados = ds.diasParados!.filter((p) => p.id !== id);
  registrar(ds, { entidade: 'operacao', entidadeId: `parado-${x.data}`, acao: 'excluir', resumo: `Dia sem aplicação removido: ${x.data.split('-').reverse().join('/')} · ${x.motivo}`, antes: x });
  return null;
}
