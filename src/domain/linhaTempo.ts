/**
 * Editar / excluir eventos da linha do tempo do Diário. Os eventos vêm do registro de cada voo:
 *   início/fim  → horário do voo (horaInicio / horaFim)
 *   parada      → parada registrada (início, motivo, observação)
 *   retomada    → fim da parada
 * Ao mudar horários, o tempo efetivo do voo é ajustado pela diferença (sem passar da jornada do voo).
 */
import { registrar } from './base';
import { addDias, areaOperacao, duracaoParadaMin, duracaoTotalMin, hhmmParaMin, isoLocalParaMin } from './calc';
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

export interface NovaParada { hora: string; horaRetomada?: string; motivo: MotivoParada; observacoes?: string; responsavel: string }

/**
 * Adiciona uma parada nos voos escolhidos (um voo por drone). Retomada em branco = parada até o fim do voo
 * (ex.: "Fim de tarefa", "Troca de turno"). Não pode sobrepor outra parada do mesmo voo. Desconta do efetivo.
 */
export function adicionarParada(ds: Dataset, opIds: string[], n: NovaParada, gerarId: (prefixo: string) => string): string | null {
  if (!opIds.length) return 'Escolha ao menos um drone.';
  if (!HORA.test(n.hora)) return 'Informe a hora da parada (HH:MM).';
  if (n.horaRetomada && !HORA.test(n.horaRetomada)) return 'Hora da retomada inválida (HH:MM).';
  const novas: { op: Operacao; ini: string; fim: string; dur: number; ac: string }[] = [];
  for (const id of opIds) {
    const op = ds.operacoes.find((o) => o.id === id);
    if (!op) return 'Voo não encontrado. Atualize a tela.';
    const ac = ds.aeronaves.find((a) => a.id === op.aeronaveId)?.identificacao ?? '—';
    const tot = duracaoTotalMin(op.horaInicio, op.horaFim) ?? 0;
    if (tot <= 0) return `${ac}: o voo não tem início e fim; corrija o horário antes.`;
    const ini = isoNoVoo(op, n.hora);
    const fim = isoNoVoo(op, n.horaRetomada || op.horaFim!);
    const a = relVoo(op, ini), b = relVoo(op, fim);
    if (a < 0 || a >= tot) return `${ac}: a parada tem que estar dentro do voo (${op.horaInicio}–${op.horaFim}).`;
    if (b <= a || b > tot) return `${ac}: a retomada tem que ser depois da parada e até o fim do voo (${op.horaFim}).`;
    for (const p of ds.paradas.filter((x) => x.operacaoId === op.id)) {
      const pa = relVoo(op, p.inicio), pb = p.fim ? relVoo(op, p.fim) : tot;
      if (a < pb && b > pa) return `${ac}: já existe parada ${p.inicio.slice(11, 16)}–${(p.fim ?? '').slice(11, 16) || 'fim'} (${p.motivo}) nesse horário. Edite ou exclua a outra antes.`;
    }
    novas.push({ op, ini, fim, dur: b - a, ac });
  }
  const obs = n.observacoes?.trim();
  for (const x of novas) {
    ds.paradas.push({ id: gerarId('par'), operacaoId: x.op.id, inicio: x.ini, fim: x.fim, motivo: n.motivo, ...(obs ? { observacoes: obs } : {}), responsavel: n.responsavel });
    ajustarEfetivo(x.op, -x.dur);
  }
  registrar(ds, { entidade: 'operacao', entidadeId: novas[0].op.id, acao: 'editar', resumo: `Parada adicionada na linha do tempo: ${novas.map((x) => `${x.ac} ${x.ini.slice(11, 16)}–${x.fim.slice(11, 16)}`).join('; ')} · ${n.motivo}${obs ? ` (${obs})` : ''}` });
  return null;
}

/** Para cada drone escolhido, o voo do dia que contém a hora (o drone pode ter mais de um voo no dia). */
export function voosNaHora(ds: Dataset, opsDia: Operacao[], aeronaveIds: string[], hora: string): { opIds: string[]; erro: string | null } {
  if (!aeronaveIds.length) return { opIds: [], erro: 'Escolha ao menos um drone.' };
  if (!HORA.test(hora)) return { opIds: [], erro: 'Informe a hora da parada (HH:MM).' };
  const opIds: string[] = [];
  for (const aid of aeronaveIds) {
    const ac = ds.aeronaves.find((a) => a.id === aid)?.identificacao ?? '—';
    const cand = opsDia.filter((o) => o.aeronaveId === aid && o.status !== 'impedida_clima');
    const op = cand.find((o) => { const tot = duracaoTotalMin(o.horaInicio, o.horaFim) ?? 0; const a = relVoo(o, isoNoVoo(o, hora)); return a >= 0 && a < tot; });
    if (!op) return { opIds: [], erro: `${ac}: nenhum voo deste drone passa pelas ${hora} (${cand.map((o) => `${o.horaInicio}–${o.horaFim}`).join(', ') || 'sem voo no dia'}).` };
    opIds.push(op.id);
  }
  return { opIds, erro: null };
}

/** Exclui os voos inteiros (área e paradas) dos drones escolhidos — pelo início/fim da linha do tempo. Fica na auditoria (com o antes). */
export function excluirVoos(ds: Dataset, opIds: string[], motivo: string): string | null {
  if (!opIds.length) return 'Escolha ao menos um drone.';
  if (!motivo.trim()) return 'Informe o motivo da exclusão.';
  for (const id of opIds) {
    const op = ds.operacoes.find((o) => o.id === id);
    if (!op) return 'Voo não encontrado. Atualize a tela.';
    const antes = { operacao: op, paradas: ds.paradas.filter((p) => p.operacaoId === id) };
    ds.operacoes = ds.operacoes.filter((o) => o.id !== id);
    ds.paradas = ds.paradas.filter((p) => p.operacaoId !== id);
    const ac = ds.aeronaves.find((a) => a.id === op.aeronaveId)?.identificacao ?? '—';
    registrar(ds, { entidade: 'operacao', entidadeId: id, acao: 'excluir', resumo: `Voo excluído pela linha do tempo: ${ac} ${op.data} ${op.horaInicio}–${op.horaFim ?? '…'} · ${areaOperacao(op).toFixed(2).replace('.', ',')} ha`, motivo: motivo.trim(), antes });
  }
  return null;
}

/** O que sai ao excluir um turno de um dia: voos do turno que começaram na data, suas paradas e o "turno sem aplicação" do mesmo turno/data. */
export function conteudoTurnoDia(ds: Dataset, data: string, turnoId: string) {
  const ops = ds.operacoes.filter((o) => o.data === data && (o.turnoId ?? '') === turnoId);
  const ids = new Set(ops.map((o) => o.id));
  const paradas = ds.paradas.filter((p) => ids.has(p.operacaoId));
  const diasParados = (ds.diasParados ?? []).filter((d) => d.data === data && !!turnoId && d.turnoId === turnoId);
  return { ops, paradas, diasParados, area: ops.reduce((s, o) => s + areaOperacao(o), 0) };
}

/** Exclui o turno inteiro de um dia (para refazer o fechamento). Fica na auditoria com tudo o que saiu. */
export function excluirTurnoDia(ds: Dataset, data: string, turnoId: string, motivo: string): string | null {
  if (!motivo.trim()) return 'Informe o motivo da exclusão.';
  const c = conteudoTurnoDia(ds, data, turnoId);
  if (!c.ops.length && !c.diasParados.length) return 'Nada lançado neste turno nesta data.';
  const ids = new Set(c.ops.map((o) => o.id)), dps = new Set(c.diasParados.map((d) => d.id));
  ds.operacoes = ds.operacoes.filter((o) => !ids.has(o.id));
  ds.paradas = ds.paradas.filter((p) => !ids.has(p.operacaoId));
  if (ds.diasParados) ds.diasParados = ds.diasParados.filter((d) => !dps.has(d.id));
  const turno = ds.turnos.find((t) => t.id === turnoId)?.nome ?? 'sem turno';
  registrar(ds, { entidade: 'operacao', entidadeId: c.ops[0]?.id ?? data, acao: 'excluir', resumo: `Turno excluído: ${turno} em ${data} · ${c.ops.length} voo(s), ${c.area.toFixed(2).replace('.', ',')} ha, ${c.paradas.length} parada(s)${c.diasParados.length ? `, ${c.diasParados.length} registro(s) de turno sem aplicação` : ''}`, motivo: motivo.trim(), antes: { operacoes: c.ops, paradas: c.paradas, diasParados: c.diasParados } });
  return null;
}
