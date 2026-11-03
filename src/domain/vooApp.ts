/**
 * Horas em voo informadas pelo app do drone (registro do fabricante): por drone e por período (um dia ou vários).
 * É a base da meta por drone, que é por HORA PULVERIZANDO: ha/h em voo = área ÷ horas em voo.
 * Quando não há registro do app para o drone/dia, usa o tempo em voo medido no KML (op.voo), se houver.
 */
import { registrar } from './base';
import type { Dataset, Operacao } from './types';
import { areaOperacao } from './calc';

export interface RegistroVooApp {
  id: string;
  aeronaveId: string;
  de: string; // AAAA-MM-DD
  ate: string; // AAAA-MM-DD
  horasVoo: number; // horas decimais
  areaHa: number; // área informada pelo app do drone no mesmo período
  voos?: number;
  litros?: number;
  observacao?: string;
  /** Área aplicada que o app do drone NÃO registrou (ex.: perda de sinal). Entra só na conferência com os lançamentos,
   *  não no ha/h em voo (as horas desse trecho também não foram registradas). */
  ajusteHa?: number;
  ajusteMotivo?: string;
  criadoEm: string;
}

/** Confere o registro com o que foi lançado no app (voos do drone no mesmo período). */
export function conferirComLancamentos(ds: Dataset, r: RegistroVooApp): { lancado: number; informado: number; diferenca: number; bate: boolean } {
  const lancado = ds.operacoes.filter((o) => o.aeronaveId === r.aeronaveId && o.data >= r.de && o.data <= r.ate).reduce((s, o) => s + areaOperacao(o), 0);
  const informado = r.areaHa + (r.ajusteHa ?? 0);
  const diferenca = lancado - informado;
  return { lancado, informado, diferenca, bate: Math.abs(diferenca) <= 0.05 };
}

/** "22,62" | "22.62" (horas decimais, como o app mostra) | "22:37" | "22h37" → horas decimais. */
export function lerHoras(txt: string): number | null {
  const t = txt.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const hm = t.match(/^(\d+)(?::|h)(\d{1,2})(?:min)?$/);
  if (hm) { const m = Number(hm[2]); return m < 60 ? Number(hm[1]) + m / 60 : null; }
  const n = Number(t.replace(/h$/, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function gravarRegistroVoo(ds: Dataset, r: Omit<RegistroVooApp, 'id' | 'criadoEm'>, gerarId: (p: string) => string, agora: string): string | null {
  const ac = ds.aeronaves.find((a) => a.id === r.aeronaveId);
  if (!ac) return 'Escolha o drone.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.de) || !/^\d{4}-\d{2}-\d{2}$/.test(r.ate)) return 'Informe o período (de e até).';
  if (r.ate < r.de) return '"Até" precisa ser igual ou depois de "de".';
  if (!(r.horasVoo > 0)) return 'Informe as horas em voo (ex.: 22,62 ou 22:37).';
  if (!(r.areaHa > 0)) return 'Informe a área do app do drone no mesmo período (ha).';
  if (r.ajusteHa !== undefined && (r.ajusteHa < 0 || r.ajusteHa > r.areaHa)) return 'A área sem registro no app do drone precisa ser positiva e menor que a área registrada.';
  const haH = r.areaHa / r.horasVoo;
  if (haH > 80) return `Área ÷ horas = ${haH.toFixed(1).replace('.', ',')} ha/h, alto demais para um drone: confira se as horas estão em horas (22,62) e não em minutos.`;
  ds.voosApp ??= [];
  // períodos do mesmo drone não podem se sobrepor (senão a hora conta duas vezes); o mesmo período exato substitui
  const igual = ds.voosApp.find((x) => x.aeronaveId === r.aeronaveId && x.de === r.de && x.ate === r.ate);
  const sobre = ds.voosApp.find((x) => x !== igual && x.aeronaveId === r.aeronaveId && x.de <= r.ate && r.de <= x.ate);
  if (sobre) return `${ac.identificacao} já tem registro de ${sobre.de.split('-').reverse().join('/')} a ${sobre.ate.split('-').reverse().join('/')} que cruza este período. Exclua ou ajuste aquele antes.`;
  const limpo: RegistroVooApp = { id: igual?.id ?? gerarId('vapp'), criadoEm: agora, aeronaveId: r.aeronaveId, de: r.de, ate: r.ate, horasVoo: r.horasVoo, areaHa: r.areaHa,
    ...(r.voos ? { voos: r.voos } : {}), ...(r.litros ? { litros: r.litros } : {}), ...(r.observacao?.trim() ? { observacao: r.observacao.trim() } : {}),
    ...(r.ajusteHa ? { ajusteHa: r.ajusteHa, ajusteMotivo: r.ajusteMotivo?.trim() || 'perda de sinal' } : {}) };
  ds.voosApp = [...ds.voosApp.filter((x) => x !== igual), limpo];
  registrar(ds, { entidade: 'aeronave', entidadeId: ac.id, acao: igual ? 'editar' : 'criar', resumo: `Horas em voo (app do drone) ${ac.identificacao} ${r.de} a ${r.ate}: ${r.horasVoo.toFixed(2).replace('.', ',')} h · ${r.areaHa.toFixed(2).replace('.', ',')} ha${r.ajusteHa ? ` + ${r.ajusteHa.toFixed(2).replace('.', ',')} ha sem registro (${r.ajusteMotivo?.trim() || 'perda de sinal'})` : ''}` });
  return null;
}

export function removerRegistroVoo(ds: Dataset, id: string): string | null {
  const r = (ds.voosApp ?? []).find((x) => x.id === id);
  if (!r) return 'Registro não encontrado.';
  ds.voosApp = (ds.voosApp ?? []).filter((x) => x.id !== id);
  registrar(ds, { entidade: 'aeronave', entidadeId: r.aeronaveId, acao: 'excluir', resumo: `Horas em voo (app do drone) excluídas: ${r.de} a ${r.ate}` });
  return null;
}

export interface VooPeriodo { area: number; minutos: number; doApp: number; doKml: number; foraDoPeriodo: number }

/**
 * Tempo em voo do período: registros do app TOTALMENTE dentro de [de, ate] (dos drones escolhidos) + KML dos voos
 * de drone/dia que nenhum registro do app cobre (sem contar a mesma hora duas vezes).
 */
export function vooNoPeriodo(ds: Dataset, ops: Operacao[], de: string, ate: string, aeronaveIds: string[] | null): VooPeriodo {
  const regs = (ds.voosApp ?? []).filter((r) => !aeronaveIds || aeronaveIds.includes(r.aeronaveId));
  const dentro = regs.filter((r) => r.de >= de && r.ate <= ate);
  const foraDoPeriodo = regs.filter((r) => !dentro.includes(r) && r.de <= ate && de <= r.ate).length;
  const coberto = (ac: string, d: string) => regs.some((r) => r.aeronaveId === ac && r.de <= d && d <= r.ate);
  let area = 0, minutos = 0, doApp = 0, doKml = 0;
  for (const r of dentro) { area += r.areaHa; minutos += r.horasVoo * 60; doApp++; }
  for (const o of ops) {
    if (!o.voo || !(o.voo.tempoVooMin > 0) || coberto(o.aeronaveId, o.data)) continue;
    area += areaOperacao(o); minutos += o.voo.tempoVooMin; doKml++;
  }
  return { area, minutos, doApp, doKml, foraDoPeriodo };
}
