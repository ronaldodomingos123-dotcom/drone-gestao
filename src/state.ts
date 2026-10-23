/** Estado da aplicação: dataset carregado, índices, filtros globais e consultas de nomes. */
import { recalcularStatusOS } from './domain/base';
import { criarIndices, type Filtros, type Indices } from './domain/analytics';
import type { Dataset } from './domain/types';
import { criarRepositorio, PREFIXO, type Repositorio } from './data/repository';
import { addDias } from './domain/calc';
import { hojeISO } from './ui/dom';

export const repo: Repositorio = criarRepositorio();

export const estado = {
  ds: null as unknown as Dataset,
  idx: null as unknown as Indices,
  filtros: null as unknown as Filtros,
};

const CHAVE_FILTROS = `${PREFIXO}filtros`;

/** Período padrão: da primeira data da base (operação ou início de campanha) até hoje. */
export function filtrosPadrao(): Filtros {
  const hoje = hojeISO();
  const ds = estado.ds;
  const datas = ds ? [...ds.operacoes.map((o) => o.data), ...ds.campanhas.map((c) => c.inicio)].filter((d) => d && d <= hoje).sort() : [];
  const ultimaOp = ds ? ds.operacoes.reduce((m, o) => (o.data > m ? o.data : m), '') : '';
  return { de: datas[0] ?? addDias(hoje, -30), ate: ultimaOp > hoje ? ultimaOp : hoje, campanhaId: '', unidadeId: '', fazendaId: '', osId: '', aeronaveId: '', pilotoId: '', turnoId: '', liderId: '', status: '' };
}

export function carregarEstado() {
  estado.ds = repo.carregar();
  recalcularStatusOS(estado.ds);
  estado.idx = criarIndices(estado.ds);
  try {
    const f = JSON.parse(localStorage.getItem(CHAVE_FILTROS) ?? 'null');
    estado.filtros = f && typeof f === 'object' ? { ...filtrosPadrao(), ...f } : filtrosPadrao();
  } catch {
    estado.filtros = filtrosPadrao();
  }
}

export function atualizarDataset(ds: Dataset) {
  recalcularStatusOS(ds);
  const trocouBase = !!estado.ds && (estado.ds.origemBase !== ds.origemBase || estado.ds.geradoEm !== ds.geradoEm);
  estado.ds = ds;
  if (trocouBase) { estado.filtros = filtrosPadrao(); salvarFiltros(); }
  estado.idx = criarIndices(ds);
}

export function salvarFiltros() {
  try { localStorage.setItem(CHAVE_FILTROS, JSON.stringify(estado.filtros)); } catch { /* sem persistência de filtros */ }
}

export function contarFiltrosAtivos(): number {
  const p = filtrosPadrao();
  return (Object.keys(p) as (keyof Filtros)[]).filter((k) => estado.filtros[k] !== p[k]).length;
}

/** Consultas de nomes (para exibição). */
export const nome = {
  fazenda: (id: string) => { const f = estado.ds.fazendas.find((x) => x.id === id); return f ? (f.codigo ? `${f.codigo} · ${f.nome}` : f.nome) : '—'; },
  fazendaDoTalhao: (talhaoId: string) => estado.ds.talhoes.find((t) => t.id === talhaoId)?.fazendaId ?? '',
  talhao: (id: string) => estado.ds.talhoes.find((x) => x.id === id)?.codigo ?? '—',
  unidade: (id: string) => estado.ds.unidades.find((x) => x.id === id)?.nome ?? '—',
  os: (id: string) => estado.ds.ordens.find((x) => x.id === id)?.numero ?? '—',
  campanha: (id: string) => estado.ds.campanhas.find((x) => x.id === id)?.nome ?? '—',
  aeronave: (id: string) => { const a = estado.ds.aeronaves.find((x) => x.id === id); return a ? a.identificacao : '—'; },
  turno: (id: string) => estado.ds.turnos.find((x) => x.id === id)?.nome ?? '—',
  colaborador: (id: string) => estado.ds.colaboradores.find((x) => x.id === id)?.nome ?? '—',
  produto: (id: string) => estado.ds.produtos.find((x) => x.id === id)?.nome ?? '—',
};

/**
 * Aplica uma alteração com segurança: trabalha numa CÓPIA, grava, e só então troca a base em uso.
 * Se a função devolver texto (erro) ou a gravação falhar, nada muda. Retorna a mensagem de erro ou null.
 */
export function alterar(fn: (ds: Dataset) => string | null | void): string | null {
  const copia: Dataset = JSON.parse(JSON.stringify(estado.ds));
  const erro = fn(copia);
  if (typeof erro === 'string' && erro) return erro;
  try {
    repo.salvar(copia);
  } catch (e) {
    return (e as Error).message;
  }
  atualizarDataset(copia);
  return null;
}

/** Redesenha a tela atual (após uma alteração feita num modal). */
export function redesenhar() {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
