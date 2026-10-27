/**
 * Recuperar voos de uma versão anterior (histórico da nuvem): lista os voos que existiam naquela versão e
 * não existem mais, e devolve só os escolhidos (com as paradas deles). Nada do que existe hoje é alterado.
 */
import { registrar } from './base';
import { areaOperacao, round } from './calc';
import type { Dataset, Operacao } from './types';

export interface VooAusente { op: Operacao; area: number }

export function voosAusentes(atual: Dataset, antigo: Dataset): VooAusente[] {
  const ids = new Set(atual.operacoes.map((o) => o.id));
  return (antigo.operacoes ?? []).filter((o) => !ids.has(o.id)).map((op) => ({ op, area: round(areaOperacao(op), 2) }))
    .sort((a, b) => b.op.data.localeCompare(a.op.data) || a.op.horaInicio.localeCompare(b.op.horaInicio));
}

export function recuperarVoos(ds: Dataset, antigo: Dataset, ids: string[], versao: number): string | null {
  const existentes = new Set(ds.operacoes.map((o) => o.id));
  const ops = (antigo.operacoes ?? []).filter((o) => ids.includes(o.id) && !existentes.has(o.id));
  if (!ops.length) return 'Nenhum voo para recuperar (talvez já tenha sido recuperado).';
  const semOS = ops.filter((o) => !ds.ordens.some((x) => x.id === o.osId));
  if (semOS.length) return `${semOS.length} voo(s) são de OS que não existe mais nesta base; recupere a OS antes.`;
  const sel = new Set(ops.map((o) => o.id));
  ds.operacoes.push(...JSON.parse(JSON.stringify(ops)));
  const paradasIds = new Set(ds.paradas.map((p) => p.id));
  ds.paradas.push(...JSON.parse(JSON.stringify((antigo.paradas ?? []).filter((p) => sel.has(p.operacaoId) && !paradasIds.has(p.id)))));
  const area = round(ops.reduce((s, o) => s + areaOperacao(o), 0), 2);
  const datas = [...new Set(ops.map((o) => o.data.split('-').reverse().join('/')))].join(', ');
  registrar(ds, { entidade: 'operacao', entidadeId: ops[0].id, acao: 'corrigir', resumo: `Recuperados ${ops.length} voo(s) (${String(area).replace('.', ',')} ha · ${datas}) da versão ${versao} do histórico.`, depois: ops.map((o) => o.id) });
  return null;
}
