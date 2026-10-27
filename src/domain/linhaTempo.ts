/**
 * Editar / excluir eventos da linha do tempo do Diário. Os eventos vêm do registro de cada voo:
 *   início/fim  → horário do voo (horaInicio / horaFim)
 *   parada      → parada registrada (início, motivo, observação)
 *   retomada    → fim da parada
 * Ao mudar horários, o tempo efetivo do voo é ajustado pela diferença (sem passar da jornada do voo).
 */
import { registrar } from './base';
import { addDias, duracaoParadaMin, duracaoTotalMin, hhmmParaMin, isoLocalParaMin } from './calc';
import type { Dataset, MotivoParada, Operacao } from './types';

export type TipoEvento = 'inicio' | 'pausa' | 'retomada' | 'fim' | 'impedida';
export interface RefEvento { opId: string; paradaId?: string }
export interface EdicaoEvento { hora?: string; motivo?: MotivoParada; observacoes?: string }

const HORA = /^\d{1,2}:\d{2}$/;

/** "HH:MM" dentro do voo → ISO local (vira o dia se for antes do início de um voo que passa da meia-noite). */
function isoNoVoo(op: Operacao, hora: string): string {
  const h = hhmmParaMin(hora)!, ini = hhmmParaMin(op.horaInicio) ?? 0;
  const data = h < ini ? addDias(op.data, 1) : op.data;
  return `${data}T${hora.padStart(5, '0')}`;
}
/** minutos desde o início do voo */
function relVoo(op: Operacao, iso: string): number {
  const base = isoLocalParaMin(`${op.data}T${(op.horaInicio || '00:00').padStart(5, '0')}`) ?? 0;
  return (isoLocalParaMin(iso) ?? base) - base;
}
const ajustarEfetivo = (op: Operacao, delta: number) => {
  const tot = duracaoTotalMin(op.horaInicio, op.horaFim) ?? op.tempoEfetivoMin;
  op.tempoEfetivoMin = Math.max(0, Math.min(tot, Math.round(op.tempoEfetivoMin + delta)));
};

export function editarEvento(ds: Dataset, tipo: TipoEvento, refs: RefEvento[], e: EdicaoEvento): string | null {
  if (!refs.length) return 'Escolha ao menos um drone.';
  if (e.hora !== undefined && !HORA.test(e.hora)) return 'Informe a hora (HH:MM).';
  const resumo: string[] = [];
  for (const r of refs) {
    const op = ds.operacoes.find((o) => o.id === r.opId);
    if (!op) return 'Voo não encontrado. Atualize a tela.';
    const ac = ds.aeronaves.find((a) => a.id === op.aeronaveId)?.identificacao ?? '—';
    const paradas = ds.paradas.filter((p) => p.operacaoId === op.id);
    if (tipo === 'inicio' || tipo === 'fim') {
      if (!e.hora) continue;
      const totAntes = duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0;
      const novoIni = tipo === 'inicio' ? e.hora : op.horaInicio, novoFim = tipo === 'fim' ? e.hora : op.horaFim;
      const totDepois = duracaoTotalMin(novoIni, novoFim) ?? 0;
      if (totDepois <= 0) return `${ac}: o fim precisa ser depois do início.`;
      // paradas precisam caber no novo horário
      const opNovo = { ...op, horaInicio: novoIni, horaFim: novoFim };
      for (const p of paradas) {
        const a = relVoo(opNovo, p.inicio), b = p.fim ? relVoo(opNovo, p.fim) : a;
        if (a < 0 || b > totDepois) return `${ac}: a parada das ${p.inicio.slice(11, 16)} ficaria fora do novo horário (${novoIni}–${novoFim}). Ajuste ou exclua a parada antes.`;
      }
      const antes = tipo === 'inicio' ? op.horaInicio : op.horaFim;
      if (tipo === 'inicio') op.horaInicio = e.hora; else op.horaFim = e.hora;
      ajustarEfetivo(op, totDepois - totAntes);
      resumo.push(`${ac}: ${tipo === 'inicio' ? 'início' : 'fim'} ${antes} → ${e.hora}`);
      continue;
    }
    const p = ds.paradas.find((x) => x.id === r.paradaId);
    if (!p) return 'Parada não encontrada. Atualize a tela.';
    const durAntes = duracaoParadaMin(p) ?? 0;
    const novoIni = tipo === 'pausa' && e.hora ? isoNoVoo(op, e.hora) : p.inicio;
    const novoFim = tipo === 'retomada' && e.hora ? isoNoVoo(op, e.hora) : p.fim;
    const tot = duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0;
    const a = relVoo(op, novoIni), b = novoFim ? relVoo(op, novoFim) : a;
    if (a < 0 || a > tot) return `${ac}: a parada tem que estar dentro do voo (${op.horaInicio}–${op.horaFim}).`;
    if (novoFim && (b <= a || b > tot)) return `${ac}: a retomada tem que ser depois da parada e até o fim do voo (${op.horaFim}).`;
    const antes = `${p.inicio.slice(11, 16)}${p.fim ? `–${p.fim.slice(11, 16)}` : ''} ${p.motivo}`;
    p.inicio = novoIni; p.fim = novoFim;
    if (e.motivo) p.motivo = e.motivo;
    if (e.observacoes !== undefined) { const o = e.observacoes.trim(); if (o) p.observacoes = o; else delete p.observacoes; }
    ajustarEfetivo(op, durAntes - (duracaoParadaMin(p) ?? 0));
    resumo.push(`${ac}: parada ${antes} → ${p.inicio.slice(11, 16)}${p.fim ? `–${p.fim.slice(11, 16)}` : ''} ${p.motivo}`);
  }
  if (!resumo.length) return 'Nada para alterar.';
  registrar(ds, { entidade: 'operacao', entidadeId: refs[0].opId, acao: 'editar', resumo: `Linha do tempo editada: ${resumo.join('; ')}` });
  return null;
}

/** Exclui a parada (parada + retomada) nos drones escolhidos; início e fim do voo não se excluem aqui. */
export function excluirEvento(ds: Dataset, tipo: TipoEvento, refs: RefEvento[]): string | null {
  if (tipo !== 'pausa' && tipo !== 'retomada') return 'Início e fim do voo não se excluem pela linha do tempo; corrija o horário ou exclua o voo em Aplicações.';
  if (!refs.length) return 'Escolha ao menos um drone.';
  const resumo: string[] = [];
  for (const r of refs) {
    const p = ds.paradas.find((x) => x.id === r.paradaId);
    const op = ds.operacoes.find((o) => o.id === r.opId);
    if (!p || !op) return 'Parada não encontrada. Atualize a tela.';
    ajustarEfetivo(op, duracaoParadaMin(p) ?? 0);
    ds.paradas = ds.paradas.filter((x) => x.id !== p.id);
    resumo.push(`${ds.aeronaves.find((a) => a.id === op.aeronaveId)?.identificacao ?? '—'}: ${p.inicio.slice(11, 16)}${p.fim ? `–${p.fim.slice(11, 16)}` : ''} ${p.motivo}`);
  }
  registrar(ds, { entidade: 'operacao', entidadeId: refs[0].opId, acao: 'excluir', resumo: `Parada excluída da linha do tempo: ${resumo.join('; ')}` });
  return null;
}
