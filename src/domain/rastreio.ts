/**
 * Rastreabilidade (Fase 3): linha do tempo de uma OS ou de um talhão, juntando o que foi feito em
 * campo (voos, paradas, lançamentos de área) com o histórico de alterações (auditoria): importação,
 * edições, correções, reordenação, conclusão. Inclui o aplicado acumulado após cada evento de área.
 */
import { areaPlanejadaOS, duracaoParadaMin, round } from './calc';
import type { Dataset } from './types';

export type TipoEvento = 'cadastro' | 'importacao' | 'edicao' | 'voo' | 'parada' | 'lancamento' | 'conclusao' | 'reabertura' | 'correcao' | 'reordenacao' | 'exclusao';
export interface EventoRastreio { quando: string; tipo: TipoEvento; titulo: string; detalhe: string; area: number | null; acumulado: number | null; usuario: string | null; fonte: 'campo' | 'auditoria' }
export interface Rastreio { titulo: string; programado: number; aplicado: number; eventos: EventoRastreio[] }

const ACAO: Record<string, TipoEvento> = { criar: 'cadastro', editar: 'edicao', importar: 'importacao', concluir: 'conclusao', reabrir: 'reabertura', corrigir: 'correcao', reordenar: 'reordenacao', excluir: 'exclusao', inativar: 'edicao', reativar: 'edicao', base: 'importacao' };
/** ISO (UTC) da auditoria → data/hora local "AAAA-MM-DDTHH:MM". */
const local = (q: string) => { const d = new Date(q); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const br = (x: number) => x.toFixed(2).replace('.', ',');

export function rastrear(ds: Dataset, alvo: { tipo: 'os' | 'talhao'; id: string }): Rastreio {
  const ev: EventoRastreio[] = [];
  const aero = (id: string) => ds.aeronaves.find((a) => a.id === id)?.identificacao ?? '—';
  const pessoa = (id: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? '—';
  const talhao = (id: string) => { const t = ds.talhoes.find((x) => x.id === id); return t ? (t.geral ? 'GERAL' : t.codigo) : '—'; };
  const fazenda = (id: string) => { const f = ds.fazendas.find((x) => x.id === id); return f ? `${f.codigo ? `${f.codigo} · ` : ''}${f.nome}` : '—'; };
  let titulo = '', programado = 0;
  let osIds: string[];
  let pertence: (talhaoId: string) => boolean;
  if (alvo.tipo === 'os') {
    const os = ds.ordens.find((o) => o.id === alvo.id);
    titulo = os ? `OS ${os.numero} · ${fazenda(os.fazendaId)}` : 'OS não encontrada';
    programado = os ? areaPlanejadaOS(os) : 0;
    osIds = [alvo.id]; pertence = () => true;
  } else {
    const t = ds.talhoes.find((x) => x.id === alvo.id);
    titulo = t ? `Talhão ${t.geral ? 'GERAL' : t.codigo}${t.zona ? ` (zona ${t.zona})` : ''} · ${fazenda(t.fazendaId)}` : 'Talhão não encontrado';
    const ordens = ds.ordens.filter((o) => o.itens.some((i) => i.talhaoId === alvo.id));
    osIds = ordens.map((o) => o.id);
    programado = ordens.filter((o) => o.status !== 'cancelada').reduce((s, o) => s + (o.itens.find((i) => i.talhaoId === alvo.id)?.areaPlanejadaHa ?? 0), 0);
    pertence = (tid) => tid === alvo.id;
  }
  const numOS = (id: string) => ds.ordens.find((o) => o.id === id)?.numero ?? '—';
  // campo: voos e paradas
  for (const op of ds.operacoes.filter((o) => osIds.includes(o.osId))) {
    const itens = op.itens.filter((i) => pertence(i.talhaoId));
    if (!itens.length && alvo.tipo === 'talhao') continue;
    const area = itens.reduce((s, i) => s + i.areaHa, 0);
    ev.push({ quando: `${op.data}T${op.horaInicio}`, tipo: 'voo', titulo: op.status === 'impedida_clima' ? 'Operação impedida por clima' : `Voo · ${aero(op.aeronaveId)} · ${pessoa(op.pilotoId)}`,
      detalhe: `${alvo.tipo === 'talhao' ? `OS ${numOS(op.osId)} · ` : ''}${op.horaInicio}–${op.horaFim ?? '…'} · talhões ${itens.map((i) => `${talhao(i.talhaoId)} (${br(i.areaHa)})`).join(', ') || '—'}${op.calda.produtos.length ? ` · calda ${op.calda.tratamento ?? `${op.calda.produtos.length} produto(s)`}` : ''}`,
      area: round(area, 4), acumulado: null, usuario: op.responsavelEncerramento ?? null, fonte: 'campo' });
    for (const p of ds.paradas.filter((x) => x.operacaoId === op.id)) {
      const d = duracaoParadaMin(p);
      ev.push({ quando: p.inicio, tipo: 'parada', titulo: `Parada · ${p.motivo}`, detalhe: `${aero(op.aeronaveId)} · ${p.inicio.slice(11, 16)}–${p.fim ? p.fim.slice(11, 16) : 'em aberto'}${d !== null ? ` (${d} min)` : ''}${p.observacoes ? ` · ${p.observacoes}` : ''}`, area: null, acumulado: null, usuario: p.responsavel || null, fonte: 'campo' });
    }
  }
  // lançamentos (sequência/ficha diária)
  for (const l of (ds.lancamentos ?? []).filter((x) => osIds.includes(x.osId))) {
    const itens = l.itens.filter((i) => pertence(i.talhaoId));
    if (!itens.length && alvo.tipo === 'talhao') continue;
    ev.push({ quando: `${l.data}T23:59`, tipo: 'lancamento', titulo: `Aplicado lançado (${l.origem === 'ficha_diaria' ? 'ficha diária' : 'sequência'})`, detalhe: `${alvo.tipo === 'talhao' ? `OS ${numOS(l.osId)} · ` : ''}talhões ${itens.map((i) => `${talhao(i.talhaoId)} (${br(i.areaHa)})`).join(', ')}${l.observacao ? ` · ${l.observacao}` : ''}`, area: round(itens.reduce((s, i) => s + i.areaHa, 0), 4), acumulado: null, usuario: null, fonte: 'campo' });
  }
  // auditoria
  const idsAud = new Set([...osIds, alvo.id]);
  const campanhas = new Set(ds.ordens.filter((o) => osIds.includes(o.id)).map((o) => o.campanhaId));
  for (const a of ds.auditoria) {
    const direto = idsAud.has(a.entidadeId) && (a.entidade === 'ordem' || a.entidade === 'lancamento' || a.entidade === 'talhao' || a.entidade === 'operacao');
    const importacao = a.entidade === 'base' && a.acao === 'importar' && campanhas.has(a.entidadeId);
    const operacao = a.entidade === 'operacao' && ds.operacoes.some((o) => o.id === a.entidadeId && osIds.includes(o.osId));
    if (!direto && !importacao && !operacao) continue;
    const tipo = a.entidade === 'lancamento' ? (a.acao === 'corrigir' ? 'correcao' : 'lancamento') : (ACAO[a.acao] ?? 'edicao');
    ev.push({ quando: local(a.quando), tipo: tipo === 'lancamento' ? 'edicao' : tipo, titulo: a.resumo, detalhe: a.motivo ? `Motivo: ${a.motivo}` : importacao ? 'Importação da campanha' : '', area: null, acumulado: null, usuario: a.usuario, fonte: 'auditoria' });
  }
  ev.sort((x, y) => x.quando.localeCompare(y.quando) || (x.fonte === 'campo' ? -1 : 1));
  let acc = 0;
  for (const e of ev) if (e.area !== null && (e.tipo === 'voo' || e.tipo === 'lancamento')) { acc += e.area; e.acumulado = round(acc, 4); }
  return { titulo, programado: round(programado, 4), aplicado: round(acc, 4), eventos: ev };
}
