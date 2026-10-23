/**
 * Meta operacional (área PLANEJADA por dia e por semana).
 *
 * Parâmetros (editáveis em Configurações):
 *   haHoraDrone          produtividade efetiva planejada de UM drone (ha/h)
 *   horasEfetivasTurno   horas efetivas de aplicação em um turno
 *   turnosPorDia         turnos operados por dia
 *   dronesPorTurno       drones voando simultaneamente em cada turno
 *   dronesFrota          drones considerados no plano (dividem os turnos entre si)
 *   diasPorSemana        dias de operação por semana
 *
 * Fórmulas:
 *   ha por turno por drone = haHoraDrone × horasEfetivasTurno
 *   drone-turnos por dia   = turnosPorDia × dronesPorTurno
 *   meta diária (operação) = drone-turnos por dia × ha por turno por drone
 *   meta semanal           = meta diária × diasPorSemana
 * Recortes:
 *   filtro por UM drone ou operador → meta diária ÷ dronesFrota
 *   filtro por UM turno ou líder    → meta diária ÷ turnosPorDia
 */
import { inicioSemana, intervaloDatas, round } from './calc';

export interface MetaOperacional {
  haHoraDrone: number;
  horasEfetivasTurno: number;
  turnosPorDia: number;
  dronesPorTurno: number;
  dronesFrota: number;
  diasPorSemana: number;
}

/** Valores da prévia: 32 ha/h por drone; 192 ha por turno; 1.344 ha/semana por drone; 2 drones em 2 turnos. */
export const META_PADRAO: MetaOperacional = {
  haHoraDrone: 32,
  horasEfetivasTurno: 6,
  turnosPorDia: 2,
  dronesPorTurno: 1,
  dronesFrota: 2,
  diasPorSemana: 7,
};

export interface EscopoMeta {
  umDrone: boolean;
  umTurno: boolean;
}

export function validarMeta(m: MetaOperacional): string[] {
  const e: string[] = [];
  const pos = (v: number) => Number.isFinite(v) && v > 0;
  if (!pos(m.haHoraDrone)) e.push('Produtividade por drone deve ser maior que zero.');
  if (!pos(m.horasEfetivasTurno) || m.horasEfetivasTurno > 24) e.push('Horas efetivas por turno devem estar entre 0 e 24.');
  if (!Number.isInteger(m.turnosPorDia) || m.turnosPorDia < 1 || m.turnosPorDia > 4) e.push('Turnos por dia: número inteiro de 1 a 4.');
  if (!Number.isInteger(m.dronesFrota) || m.dronesFrota < 1) e.push('Drones no plano: número inteiro maior que zero.');
  if (!Number.isInteger(m.dronesPorTurno) || m.dronesPorTurno < 1) e.push('Drones por turno: número inteiro maior que zero.');
  else if (m.dronesPorTurno > m.dronesFrota) e.push('Drones por turno não pode ser maior que os drones no plano.');
  if (!Number.isInteger(m.diasPorSemana) || m.diasPorSemana < 1 || m.diasPorSemana > 7) e.push('Dias por semana: número inteiro de 1 a 7.');
  if (m.horasEfetivasTurno * m.turnosPorDia > 24) e.push('Horas efetivas × turnos por dia passa de 24 h.');
  return e;
}

export const haPorTurnoDrone = (m: MetaOperacional) => m.haHoraDrone * m.horasEfetivasTurno;
export const droneTurnosDia = (m: MetaOperacional) => m.turnosPorDia * m.dronesPorTurno;

/** Meta diária (ha) para o escopo filtrado. */
export function metaDiaria(m: MetaOperacional, escopo: EscopoMeta = { umDrone: false, umTurno: false }): number {
  let v = droneTurnosDia(m) * haPorTurnoDrone(m);
  if (escopo.umDrone) v /= m.dronesFrota;
  if (escopo.umTurno) v /= m.turnosPorDia;
  return v;
}

/** Meta semanal cheia (ha). */
export const metaSemanal = (m: MetaOperacional, escopo?: EscopoMeta) => metaDiaria(m, escopo) * m.diasPorSemana;

/**
 * Meta por dia ao longo do período. Com menos de 7 dias por semana, distribui a meta semanal
 * igualmente pelos 7 dias (fração diasPorSemana/7) — evita escolher arbitrariamente quais dias são folga.
 */
export function metaPorDia(m: MetaOperacional, de: string, ate: string, escopo?: EscopoMeta): { data: string; meta: number }[] {
  const d = metaDiaria(m, escopo) * (m.diasPorSemana / 7);
  return intervaloDatas(de, ate).map((data) => ({ data, meta: d }));
}

/** Meta por semana (segunda a domingo), proporcional aos dias da semana que caem dentro do período. */
export function metaPorSemana(m: MetaOperacional, de: string, ate: string, escopo?: EscopoMeta): { semana: string; meta: number; diasNoPeriodo: number }[] {
  const mapa = new Map<string, number>();
  for (const d of intervaloDatas(de, ate)) { const s = inicioSemana(d); mapa.set(s, (mapa.get(s) ?? 0) + 1); }
  const semanal = metaSemanal(m, escopo);
  return [...mapa.entries()].map(([semana, dias]) => ({ semana, diasNoPeriodo: dias, meta: round((semanal * dias) / 7, 4) }));
}

/** Meta acumulada dia a dia a partir do início, limitada ao total planejado (ritmo planejado). */
export function metaAcumulada(m: MetaOperacional, de: string, ate: string, teto: number, escopo?: EscopoMeta): number[] {
  let acc = 0;
  return metaPorDia(m, de, ate, escopo).map((x) => (acc = Math.min(teto, acc + x.meta)));
}
