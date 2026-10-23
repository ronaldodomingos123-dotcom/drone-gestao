/**
 * Planejamento e metas (Fase 3): para cada campanha, quanto falta, quanto tempo há até o prazo,
 * em quanto tempo termina no ritmo da meta e no ritmo real, e quantos drone-turnos por dia seriam
 * necessários para cumprir o prazo. Mesmas regras do painel (obstáculo fora do "falta aplicar").
 */
import { addDias, aplicacoes, aplicadoPorItem, areaObstaculo, areaOperacao, areaPlanejadaOS, chaveItem, safeDiv } from './calc';
import { haPorTurnoDrone, metaDiaria } from './metas';
import { diasEntre, preverTermino } from './previsao';
import type { Dataset } from './types';

export interface PlanoCampanha {
  campanhaId: string; nome: string; tipo: string; inicio: string; prazo: string;
  programado: number; aplicado: number; obstaculos: number; falta: number; pct: number | null;
  diasAtePrazo: number; // dias corridos de hoje (inclusive) até o prazo
  metaDia: number; // capacidade planejada (ha/dia corrido)
  diasNaMeta: number | null; dataNaMeta: string | null;
  ritmoReal: number | null; dataNoRitmo: string | null; faixaPessimista: string | null;
  necessarioDia: number | null; // ha/dia corrido para terminar no prazo
  droneTurnosNecessarios: number | null; // por dia, para cumprir o prazo
  situacao: 'concluida' | 'no_prazo' | 'apertado' | 'atrasada' | 'sem_ritmo';
}

export function planejarCampanhas(ds: Dataset, hoje: string, janelaDias = 14): PlanoCampanha[] {
  const apl = aplicadoPorItem(aplicacoes(ds));
  const meta = metaDiaria(ds.metas) * (ds.metas.diasPorSemana / 7);
  const porTurno = haPorTurnoDrone(ds.metas) * (ds.metas.diasPorSemana / 7);
  return ds.campanhas.map((c) => {
    const ordens = ds.ordens.filter((o) => o.campanhaId === c.id && o.status !== 'cancelada');
    const programado = ordens.reduce((s, o) => s + areaPlanejadaOS(o), 0);
    const aplicado = ordens.reduce((s, o) => s + o.itens.reduce((a, i) => a + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0), 0);
    const obstaculos = ordens.reduce((s, o) => s + areaObstaculo(o, apl), 0);
    const falta = Math.max(0, programado - aplicado - obstaculos);
    const diasAtePrazo = Math.max(0, diasEntre(hoje, c.fim) + 1);
    const diasNaMeta = falta <= 0.005 ? 0 : safeDiv(falta, meta);
    // ritmo real: média por dia corrido na janela (até ontem e hoje)
    // a janela não começa antes do início da campanha (dias sem campanha não diluem o ritmo)
    const de0 = addDias(hoje, -(janelaDias - 1));
    const de = c.inicio > de0 && c.inicio <= hoje ? c.inicio : de0;
    const nDias = diasEntre(de, hoje) + 1;
    const reg = [...ds.operacoes, ...(ds.lancamentos ?? [])].filter((o) => o.campanhaId === c.id && o.data >= de && o.data <= hoje);
    const porDia = new Map<string, number>(); for (const o of reg) porDia.set(o.data, (porDia.get(o.data) ?? 0) + areaOperacao(o));
    const serie = Array.from({ length: nDias }, (_, i) => porDia.get(addDias(de, i)) ?? 0);
    const prev = preverTermino(falta, serie, hoje);
    const necessarioDia = falta <= 0.005 ? 0 : diasAtePrazo > 0 ? falta / diasAtePrazo : null;
    const dataNaMeta = diasNaMeta === null ? null : addDias(hoje, Math.max(0, Math.ceil(diasNaMeta) - 1));
    let situacao: PlanoCampanha['situacao'];
    if (falta <= 0.005) situacao = 'concluida';
    else if (!prev.data) situacao = 'sem_ritmo';
    else if (prev.data <= c.fim) situacao = prev.faixa?.pessimista && prev.faixa.pessimista.data > c.fim ? 'apertado' : 'no_prazo';
    else situacao = 'atrasada';
    return {
      campanhaId: c.id, nome: c.nome, tipo: c.tipo, inicio: c.inicio, prazo: c.fim,
      programado, aplicado, obstaculos, falta, pct: safeDiv(aplicado * 100, programado),
      diasAtePrazo, metaDia: meta, diasNaMeta, dataNaMeta,
      ritmoReal: prev.ritmoCorrido, dataNoRitmo: prev.data, faixaPessimista: prev.faixa?.pessimista?.data ?? null,
      necessarioDia, droneTurnosNecessarios: necessarioDia === null ? null : necessarioDia / porTurno,
      situacao,
    };
  }).sort((a, b) => a.prazo.localeCompare(b.prazo));
}
