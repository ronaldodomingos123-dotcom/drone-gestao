/** Componentes compartilhados: selos de status, barra de filtros globais, cabeçalho de página, estados vazios. */
import type { Filtros } from '../domain/analytics';
import type { StatusAeronave, StatusOperacao, StatusOS } from '../domain/types';
import { contarFiltrosAtivos, estado, filtrosPadrao, salvarFiltros } from '../state';
import { esc, fmtData } from './dom';
import { icone } from './icons';

const SEL_OP: Record<StatusOperacao, [string, string]> = {
  concluida: ['Concluída', 'ok'], parcial: ['Parcial', 'atencao'], impedida_clima: ['Impedida (clima)', 'critico'], em_andamento: ['Em andamento', 'info'],
};
const SEL_OS: Record<StatusOS, [string, string]> = {
  aberta: ['Aberta', 'neutro'], em_execucao: ['Em execução', 'info'], concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'apagado'],
};
const SEL_AC: Record<StatusAeronave, [string, string]> = {
  disponivel: ['Disponível', 'ok'], em_operacao: ['Em operação', 'info'], manutencao: ['Em manutenção', 'atencao'], indisponivel: ['Indisponível', 'critico'],
};
const selo = ([t, c]: [string, string]) => `<span class="selo selo-${c}">${esc(t)}</span>`;
export const seloOperacao = (s: StatusOperacao) => selo(SEL_OP[s]);
export const seloOS = (s: StatusOS) => selo(SEL_OS[s]);
export const seloAeronave = (s: StatusAeronave) => selo(SEL_AC[s]);
export const rotuloStatusOp = (s: StatusOperacao) => SEL_OP[s][0];
export const rotuloStatusOS = (s: StatusOS) => SEL_OS[s][0];
export const rotuloStatusAc = (s: StatusAeronave) => SEL_AC[s][0];

export function cabecalhoPagina(titulo: string, subtitulo: string, acoesHTML = ''): string {
  return `<div class="pag-cab"><div><h1>${esc(titulo)}</h1><p>${esc(subtitulo)}</p></div><div class="pag-acoes">${acoesHTML}</div></div>`;
}

export function aviso(tipo: 'info' | 'atencao' | 'critico', html: string): string {
  const ic = tipo === 'info' ? 'info' : 'alerta';
  return `<div class="aviso aviso-${tipo}" role="${tipo === 'info' ? 'note' : 'alert'}">${icone(ic, 18)}<div>${html}</div></div>`;
}

const opt = (v: string, t: string, sel: string) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;

/** Barra de filtros globais. Os filtros valem para todas as telas que os exibem. */
export function barraFiltros(host: HTMLElement, aoMudar: () => void, campos: (keyof Filtros)[] = ['de', 'ate', 'campanhaId', 'unidadeId', 'fazendaId', 'osId', 'turnoId', 'liderId', 'aeronaveId', 'pilotoId', 'status']) {
  const desenhar = () => {
    const f = estado.filtros;
    const ds = estado.ds;
    const fazendas = ds.fazendas.filter((x) => !f.unidadeId || x.unidadeId === f.unidadeId);
    const ordens = ds.ordens.filter((o) => (!f.campanhaId || o.campanhaId === f.campanhaId) && (!f.unidadeId || o.unidadeId === f.unidadeId) && (!f.fazendaId || o.fazendaId === f.fazendaId));
    const aeronaves = ds.aeronaves.filter((a) => !f.unidadeId || a.unidadeId === f.unidadeId);
    const pilotos = ds.colaboradores.filter((c) => c.funcao === 'Piloto' && (!f.unidadeId || c.unidadeId === f.unidadeId));
    const lideres = ds.colaboradores.filter((c) => c.funcao === 'Líder de turno');
    const n = contarFiltrosAtivos();
    const campo: Record<keyof Filtros, string> = {
      de: `<label class="f-campo"><span>De</span><input type="date" data-f="de" value="${esc(f.de)}"></label>`,
      ate: `<label class="f-campo"><span>Até</span><input type="date" data-f="ate" value="${esc(f.ate)}"></label>`,
      campanhaId: `<label class="f-campo"><span>Campanha</span><select data-f="campanhaId">${opt('', 'Todas', f.campanhaId)}${ds.campanhas.map((c) => opt(c.id, c.nome, f.campanhaId)).join('')}</select></label>`,
      unidadeId: `<label class="f-campo"><span>Unidade agrícola</span><select data-f="unidadeId">${opt('', 'Todas', f.unidadeId)}${ds.unidades.map((u) => opt(u.id, u.nome, f.unidadeId)).join('')}</select></label>`,
      fazendaId: `<label class="f-campo"><span>Fazenda</span><select data-f="fazendaId">${opt('', 'Todas', f.fazendaId)}${fazendas.map((x) => opt(x.id, `${x.codigo} · ${x.nome}`, f.fazendaId)).join('')}</select></label>`,
      osId: `<label class="f-campo"><span>Ordem de serviço</span><select data-f="osId">${opt('', 'Todas', f.osId)}${ordens.map((o) => opt(o.id, o.numero, f.osId)).join('')}</select></label>`,
      aeronaveId: `<label class="f-campo"><span>Aeronave</span><select data-f="aeronaveId">${opt('', 'Todas', f.aeronaveId)}${aeronaves.map((a) => opt(a.id, `${a.identificacao} (${a.modelo})`, f.aeronaveId)).join('')}</select></label>`,
      turnoId: `<label class="f-campo"><span>Turno</span><select data-f="turnoId">${opt('', 'Todos', f.turnoId)}${ds.turnos.map((t) => opt(t.id, `${t.nome} (${t.periodo.toLowerCase()})`, f.turnoId)).join('')}</select></label>`,
      liderId: `<label class="f-campo"><span>Líder do turno</span><select data-f="liderId">${opt('', 'Todos', f.liderId)}${lideres.map((l) => opt(l.id, l.nome, f.liderId)).join('')}</select></label>`,
      pilotoId: `<label class="f-campo"><span>Operador</span><select data-f="pilotoId">${opt('', 'Todos', f.pilotoId)}${pilotos.map((p) => opt(p.id, p.nome, f.pilotoId)).join('')}</select></label>`,
      status: `<label class="f-campo"><span>Status da operação</span><select data-f="status">${opt('', 'Todos', f.status)}${(['concluida', 'parcial', 'impedida_clima', 'em_andamento'] as const).map((s) => opt(s, rotuloStatusOp(s), f.status)).join('')}</select></label>`,
    };
    const aberto = host.classList.contains('aberto');
    host.className = aberto ? 'filtros aberto' : 'filtros';
    host.innerHTML = `
      <button class="filtros-toggle" aria-expanded="${aberto}">${icone('filtro', 16)} Filtros ${n ? `<span class="contador">${n}</span>` : ''}<span class="f-resumo">${esc(fmtData(f.de))} – ${esc(fmtData(f.ate))}</span>${icone('baixo', 16)}</button>
      <div class="filtros-campos">${campos.map((c) => campo[c]).join('')}
        <button class="btn btn-sec btn-limpar" ${n ? '' : 'disabled'}>${icone('restaurar', 15)} Limpar</button></div>`;
  };
  host.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.f as keyof Filtros | undefined;
    if (!k) return;
    const f = estado.filtros as unknown as Record<string, string>;
    f[k] = el.value;
    // Mantém coerência em cascata
    if (k === 'unidadeId') { estado.filtros.fazendaId = ''; estado.filtros.osId = ''; estado.filtros.aeronaveId = ''; estado.filtros.pilotoId = ''; }
    if (k === 'fazendaId' || k === 'campanhaId') estado.filtros.osId = '';
    if (estado.filtros.de && estado.filtros.ate && estado.filtros.de > estado.filtros.ate) {
      if (k === 'de') estado.filtros.ate = estado.filtros.de; else estado.filtros.de = estado.filtros.ate;
    }
    salvarFiltros();
    desenhar();
    aoMudar();
  });
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.filtros-toggle')) {
      const aberto = host.classList.toggle('aberto');
      t.closest('.filtros-toggle')!.setAttribute('aria-expanded', String(aberto));
    }
    if (t.closest('.btn-limpar')) { estado.filtros = filtrosPadrao(); salvarFiltros(); desenhar(); aoMudar(); }
  });
  desenhar();
}

export function estadoVazio(titulo: string, texto: string, acaoHTML = ''): string {
  return `<div class="vazio-bloco">${icone('camadas', 28)}<h3>${esc(titulo)}</h3><p>${esc(texto)}</p>${acaoHTML}</div>`;
}

/**
 * Seletor de unidade/empresa OPCIONAL, com "+ Nova unidade / empresa…" (digitada na hora).
 * Valor lido por lerUnidade(): '' (sem unidade) · id existente · 'nova:<Nome>'.
 */
export function seletorUnidade(attr: string, selecionado = '', rotulo = 'Unidade / empresa (opcional)'): string {
  const us = [...estado.ds.unidades].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const sel = selecionado || (us.length === 1 ? us[0].id : '');
  return `<label class="campo un-sel"><span>${esc(rotulo)}</span><select data-un="${esc(attr)}"><option value="">Sem unidade</option>${us.map((u) => `<option value="${esc(u.id)}" ${u.id === sel ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}<option value="__nova">+ Nova unidade / empresa…</option></select>
    <input data-un-nova="${esc(attr)}" placeholder="Nome da unidade / empresa" maxlength="80" hidden></label>`;
}
export function ligarSeletorUnidade(root: HTMLElement, aoMudar?: () => void) {
  root.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement;
    if (s.dataset.un === undefined) return;
    const inp = root.querySelector(`[data-un-nova="${s.dataset.un}"]`) as HTMLInputElement;
    inp.hidden = s.value !== '__nova';
    if (!inp.hidden) inp.focus();
  });
  root.addEventListener('input', (e) => { if ((e.target as HTMLElement).dataset.unNova !== undefined) aoMudar?.(); });
}
export function lerUnidade(root: HTMLElement, attr: string): string {
  const s = root.querySelector(`[data-un="${attr}"]`) as HTMLSelectElement | null;
  if (!s) return '';
  if (s.value !== '__nova') return s.value;
  const n = (root.querySelector(`[data-un-nova="${attr}"]`) as HTMLInputElement).value.trim();
  return n ? `nova:${n}` : '';
}
