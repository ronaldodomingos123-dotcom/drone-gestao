/**
 * Regras de cálculo — funções puras, sem dependência de interface.
 * Toda divisão passa por `safeDiv`, que devolve `null` quando o denominador é zero,
 * negativo ou inválido. A interface exibe "—" para `null`, nunca "0" ou "Infinity".
 */
import type { ItemOS, Operacao, OrdemServico, Parada, UnidadeDose } from './types';

export const MIN_POR_DIA = 24 * 60;

/** Divisão protegida. */
export function safeDiv(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador <= 0) return null;
  return numerador / denominador;
}

/** Arredonda para n casas, evitando -0. */
export function round(v: number, casas = 2): number {
  const f = 10 ** casas;
  const r = Math.round((v + Number.EPSILON) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** "HH:MM" → minutos desde 00:00. Retorna null se inválido. */
export function hhmmParaMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function minParaHHMM(min: number): string {
  const m = ((Math.round(min) % MIN_POR_DIA) + MIN_POR_DIA) % MIN_POR_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Formata minutos como "Xh YYmin". */
export function formatarDuracao(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '—';
  const t = Math.max(0, Math.round(min));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
}

/**
 * Duração total de uma operação (minutos), do início ao fim.
 * Se a hora de fim for menor que a de início, considera que a operação cruzou a meia-noite
 * (comum em aplicação noturna). Operação sem hora de fim → null (em andamento).
 */
export function duracaoTotalMin(horaInicio: string, horaFim: string | null): number | null {
  const ini = hhmmParaMin(horaInicio);
  const fim = hhmmParaMin(horaFim);
  if (ini === null || fim === null) return null;
  return fim >= ini ? fim - ini : fim + MIN_POR_DIA - ini;
}

/** Converte "AAAA-MM-DDTHH:MM" em minutos absolutos (UTC fictício, só para diferenças). */
export function isoLocalParaMin(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(ms) ? ms / 60000 : null;
}

/** Duração de uma parada em minutos. Parada sem fim (aberta) → null. Fim antes do início → null. */
export function duracaoParadaMin(p: Pick<Parada, 'inicio' | 'fim'>): number | null {
  if (!p.fim) return null;
  const a = isoLocalParaMin(p.inicio);
  const b = isoLocalParaMin(p.fim);
  if (a === null || b === null || b < a) return null;
  return b - a;
}

/** Soma de minutos parados de uma lista (ignora paradas abertas/inválidas). */
export function somaParadasMin(paradas: Pick<Parada, 'inicio' | 'fim'>[]): number {
  return paradas.reduce((s, p) => s + (duracaoParadaMin(p) ?? 0), 0);
}

/** Área de uma operação = soma dos itens por talhão. Única fonte de área. */
export function areaOperacao(op: Pick<Operacao, 'itens'>): number {
  return op.itens.reduce((s, i) => s + (Number.isFinite(i.areaHa) ? i.areaHa : 0), 0);
}

export function areaPlanejadaOS(os: Pick<OrdemServico, 'itens'>): number {
  return os.itens.reduce((s, i: ItemOS) => s + i.areaPlanejadaHa, 0);
}

/** Área restante = planejada − aplicada acumulada. Pode ser negativa (sinaliza excesso; não é corrigida). */
export function areaRestante(planejadaHa: number, aplicadaAcumHa: number): number {
  return planejadaHa - aplicadaAcumHa;
}

/** Percentual executado = aplicada ÷ planejada × 100. Planejada ≤ 0 → null. */
export function percentualExecutado(aplicadaAcumHa: number, planejadaHa: number): number | null {
  const r = safeDiv(aplicadaAcumHa, planejadaHa);
  return r === null ? null : r * 100;
}

/** Produtividade efetiva (ha/h) = área ÷ horas efetivas de aplicação. */
export function produtividadeEfetiva(areaHa: number, minutosEfetivos: number): number | null {
  return safeDiv(areaHa, minutosEfetivos / 60);
}

/** Produtividade operacional (ha/h) = área ÷ horas totais do período (inclui paradas). */
export function produtividadeOperacional(areaHa: number, minutosTotais: number): number | null {
  return safeDiv(areaHa, minutosTotais / 60);
}

/** Chave única de um item de trabalho: OS × talhão. Evita somar a mesma área duas vezes. */
export const chaveItem = (osId: string, talhaoId: string) => `${osId}|${talhaoId}`;

/** Área aplicada acumulada por (OS × talhão). */
/** Tudo que conta como área aplicada: operações de campo + lançamentos (sequência/ficha diária). */
export function aplicacoes(ds: { operacoes: Pick<Operacao, 'osId' | 'itens'>[]; lancamentos?: Pick<Operacao, 'osId' | 'itens'>[] }): Pick<Operacao, 'osId' | 'itens'>[] {
  return ds.lancamentos?.length ? [...ds.operacoes, ...ds.lancamentos] : ds.operacoes;
}

export function aplicadoPorItem(ops: Pick<Operacao, 'osId' | 'itens'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const op of ops) {
    for (const it of op.itens) {
      const k = chaveItem(op.osId, it.talhaoId);
      m.set(k, (m.get(k) ?? 0) + it.areaHa);
    }
  }
  return m;
}

export interface AlertaExcesso {
  osId: string;
  talhaoId: string;
  planejadaHa: number;
  aplicadaHa: number;
  excessoHa: number;
}

/**
 * Itens em que a área aplicada ultrapassou a planejada (tolerância em ha).
 * Apenas sinaliza para conferência — nenhum dado é alterado.
 */
export function alertasExcesso(
  ordens: Pick<OrdemServico, 'id' | 'itens'>[],
  ops: Pick<Operacao, 'osId' | 'itens'>[],
  toleranciaHa = 0.01,
): AlertaExcesso[] {
  const apl = aplicadoPorItem(ops);
  const out: AlertaExcesso[] = [];
  for (const os of ordens) {
    for (const it of os.itens) {
      const a = apl.get(chaveItem(os.id, it.talhaoId)) ?? 0;
      if (a > it.areaPlanejadaHa + toleranciaHa) {
        out.push({ osId: os.id, talhaoId: it.talhaoId, planejadaHa: it.areaPlanejadaHa, aplicadaHa: a, excessoHa: a - it.areaPlanejadaHa });
      }
    }
  }
  return out;
}

/**
 * Quantidade total de produto = dose × área, convertida para a unidade de estoque.
 * Dose (por ha) e quantidade total são grandezas diferentes e nunca se misturam.
 */
export function quantidadeTotal(dose: number, unidade: UnidadeDose, areaHa: number): { valor: number; unidade: 'L' | 'kg' } | null {
  if (!Number.isFinite(dose) || !Number.isFinite(areaHa) || dose < 0 || areaHa < 0) return null;
  switch (unidade) {
    case 'L/ha': return { valor: dose * areaHa, unidade: 'L' };
    case 'mL/ha': return { valor: (dose * areaHa) / 1000, unidade: 'L' };
    case 'kg/ha': return { valor: dose * areaHa, unidade: 'kg' };
    case 'g/ha': return { valor: (dose * areaHa) / 1000, unidade: 'kg' };
  }
}

/** Volume total de calda (L) = volume de calda (L/ha) × área. */
export function volumeTotalCalda(volumeLHa: number, areaHa: number): number | null {
  if (!Number.isFinite(volumeLHa) || !Number.isFinite(areaHa) || volumeLHa < 0 || areaHa < 0) return null;
  return volumeLHa * areaHa;
}

/** Desvio percentual entre dose real e planejada. */
export function desvioDosePct(planejada: number, real: number | null): number | null {
  if (real === null) return null;
  const r = safeDiv(real - planejada, planejada);
  return r === null ? null : r * 100;
}

/** Segunda-feira da semana de uma data AAAA-MM-DD (semana de segunda a domingo). */
export function inicioSemana(data: string): string {
  const [y, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = segunda
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

export function addDias(data: string, n: number): string {
  const [y, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Lista de datas de `de` até `ate`, inclusive. */
export function intervaloDatas(de: string, ate: string): string[] {
  const out: string[] = [];
  if (de > ate) return out;
  let d = de;
  let guard = 0;
  while (d <= ate && guard++ < 3700) {
    out.push(d);
    d = addDias(d, 1);
  }
  return out;
}

/** Último elemento (compatível com Safari < 15.4, que não tem Array.prototype.at). */
export function ultimo<T>(xs: readonly T[]): T | undefined {
  return xs.length ? xs[xs.length - 1] : undefined;
}

/**
 * Área programada EFETIVA de uma OS: igual à planejada, exceto quando a OS foi concluída manualmente —
 * aí o que não foi aplicado deixa de ser saldo (a área foi encerrada) e a efetiva passa a ser a aplicada.
 */
/**
 * Obstáculo/desconto apurado: numa OS concluída manualmente, o que sobrou da área programada (bruta)
 * sem aplicação. OS em aberto ainda não têm obstáculo (o saldo é trabalho a fazer).
 */
export function areaObstaculo(os: Pick<OrdemServico, 'id' | 'itens' | 'concluidaManual'>, aplicado: Map<string, number>): number {
  if (!os.concluidaManual) return 0;
  const a = os.itens.reduce((s, i) => s + (aplicado.get(chaveItem(os.id, i.talhaoId)) ?? 0), 0);
  return Math.max(0, areaPlanejadaOS(os) - a);
}

/** Área que ainda faz parte do trabalho: programada, menos o obstáculo das OS concluídas. */
export function areaProgramadaEfetiva(os: Pick<OrdemServico, 'id' | 'itens' | 'concluidaManual'>, aplicado: Map<string, number>): number {
  const plan = areaPlanejadaOS(os);
  if (!os.concluidaManual) return plan;
  const a = os.itens.reduce((s, i) => s + (aplicado.get(chaveItem(os.id, i.talhaoId)) ?? 0), 0);
  return Math.min(plan, a);
}
