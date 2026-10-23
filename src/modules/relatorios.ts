/**
 * Central de relatórios (Fase 3): lista, visualização com filtros e exportação CSV / Excel / PDF.
 * Todos os formatos saem do MESMO objeto de relatório (domain/relatorios.ts).
 */
import { paraCSV, nomeArquivo, geradoEmBR } from '../domain/exportar';
import { RELATORIOS, formatarValor, gerarRelatorio, opcoesTecnico, type IdRelatorio, type Relatorio } from '../domain/relatorios';
import { PREFIXO } from '../data/repository';
import { estado, nome } from '../state';
import { aviso, barraFiltros, cabecalhoPagina } from '../ui/components';
import { esc, fmtData, toast } from '../ui/dom';
import { icone } from '../ui/icons';
import { carregarMotor, entregarArquivo } from '../ui/motores';

const CHAVE_RESP = `${PREFIXO}responsavel`;
export const responsavelAtual = () => { try { return localStorage.getItem(CHAVE_RESP) || 'Gestor (demo)'; } catch { return 'Gestor (demo)'; } };
let operacaoTecnico = '';

interface MotorExport { xlsx(r: Relatorio): Promise<Blob>; pdf(r: Relatorio): Promise<Uint8Array> }

export function renderCentralRelatorios(raiz: HTMLElement) {
  const item = (titulo: string, desc: string, href: string, ic = 'relatorio') => `<a class="rel-item" href="${href}">${icone(ic, 18)}<div><b>${esc(titulo)}</b><small>${esc(desc)}</small></div>${icone('dir', 16)}</a>`;
  raiz.innerHTML = `${cabecalhoPagina('Relatórios', 'Relatórios técnicos e gerenciais montados a partir dos registros, com exportação em CSV, Excel e PDF.')}
    <section class="cartao rel-lista">
      <h3 class="sec-tit">Operação do dia a dia</h3>
      ${item('Sequência de aplicação', 'Ordem das fazendas/OS com saldo, andamento, obstáculos e importação (Excel ou PDF da OS)', '#/relatorios/sequencia', 'camadas')}
      ${item('Diário de aplicações', 'Boletim de um dia: horários, clima, fazendas, produtos, drones, progresso e linha do tempo', '#/relatorios/diario')}
      <h3 class="sec-tit">Gerenciais e técnicos</h3>
      ${RELATORIOS.map((r) => item(r.titulo, r.desc, `#/relatorios/ver?id=${r.id}`)).join('')}
    </section>
    ${aviso('info', 'Cada relatório traz período, filtros usados, data de geração e responsável. Exportações são geradas no próprio aparelho (nada é enviado).')}`;
}

export function renderVerRelatorio(raiz: HTMLElement) {
  const id = (new URLSearchParams(location.hash.split('?')[1] ?? '').get('id') ?? 'os') as IdRelatorio;
  const def = RELATORIOS.find((r) => r.id === id) ?? RELATORIOS[0];
  raiz.innerHTML = `${cabecalhoPagina(def.titulo, def.desc, `<a class="btn btn-sec" href="#/relatorios">${icone('esq', 15)} Relatórios</a>`)}
    <div id="rel-filtros"></div>
    <section class="cartao rel-barra">
      ${def.id === 'tecnico' ? '<label class="f-campo rel-op"><span>Operação</span><select data-k="op"></select></label>' : ''}
      <label class="f-campo"><span>Responsável</span><input data-k="resp" value="${esc(responsavelAtual())}" maxlength="80"></label>
      <div class="rel-export">
        <button class="btn btn-sec btn-peq" data-exp="csv">${icone('relatorio', 15)} CSV</button>
        <button class="btn btn-sec btn-peq" data-exp="xlsx">${icone('relatorio', 15)} Excel</button>
        <button class="btn btn-pri btn-peq" data-exp="pdf">${icone('relatorio', 15)} PDF</button>
      </div>
    </section>
    <div id="rel-corpo"></div>`;
  let atual: Relatorio | null = null;
  const corpo = raiz.querySelector('#rel-corpo') as HTMLElement;
  const selOp = raiz.querySelector('[data-k="op"]') as HTMLSelectElement | null;
  const desenhar = () => {
    if (selOp) {
      const ops = opcoesTecnico(estado.ds, estado.filtros);
      if (!ops.some((o) => o.id === operacaoTecnico)) operacaoTecnico = ops[0]?.id ?? '';
      selOp.innerHTML = ops.length ? ops.slice(0, 300).map((o) => `<option value="${esc(o.id)}" ${o.id === operacaoTecnico ? 'selected' : ''}>${esc(fmtData(o.data))} ${esc(o.horaInicio)} · OS ${esc(nome.os(o.osId))} · ${esc(nome.fazenda(estado.ds.ordens.find((x) => x.id === o.osId)?.fazendaId ?? ''))} · ${esc(nome.aeronave(o.aeronaveId))}</option>`).join('') : '<option value="">Nenhuma operação no período</option>';
    }
    atual = gerarRelatorio(estado.ds, def.id, estado.filtros, responsavelAtual(), new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(), { operacaoId: operacaoTecnico }, estado.idx);
    corpo.innerHTML = htmlRelatorio(atual);
  };
  barraFiltros(raiz.querySelector('#rel-filtros') as HTMLElement, desenhar, def.usaPeriodo ? undefined : ['de', 'ate', 'campanhaId', 'unidadeId', 'fazendaId', 'osId', 'aeronaveId', 'pilotoId']);
  raiz.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === 'op') { operacaoTecnico = el.value; desenhar(); }
    if (el.dataset.k === 'resp') { try { localStorage.setItem(CHAVE_RESP, el.value.trim() || 'Gestor (demo)'); } catch { /* opcional */ } desenhar(); }
  });
  raiz.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
    if (b && atual) void exportarRelatorio(atual, b.dataset.exp as 'csv' | 'xlsx' | 'pdf', b);
  });
  desenhar();
}

/** Visualização na tela (mesmos números dos arquivos). */
export function htmlRelatorio(r: Relatorio): string {
  const un = (t: string) => (t === 'ha' ? ' ha' : t === 'hah' ? ' ha/h' : '');
  const dir = (t: string) => t !== 'texto' && t !== 'data';
  return `<article class="cartao rel-doc">
    <header class="rel-cab"><h2>${esc(r.titulo)}</h2>
      <p>${r.periodo ? `Período: <b>${esc(fmtData(r.periodo.de))} a ${esc(fmtData(r.periodo.ate))}</b> · ` : ''}Filtros: ${esc(r.filtros.join(' · '))}</p>
      <p>Gerado em ${esc(geradoEmBR(r.geradoEm))} · Responsável: <b>${esc(r.responsavel)}</b></p></header>
    ${r.indicadores.length ? `<div class="rel-kpis">${r.indicadores.map((i) => `<div><span>${esc(i.rotulo)}</span><b>${esc(formatarValor(i.valor, i.tipo))}${un(i.tipo)}</b></div>`).join('')}</div>` : ''}
    ${r.secoes.map((s) => `<section class="rel-sec"><h3>${esc(s.titulo)}</h3>
      ${s.ficha ? `<dl class="rel-ficha">${s.linhas.map((l) => `<dt>${esc(String(l[0]))}</dt><dd>${esc(String(l[1] ?? '—'))}</dd>`).join('')}</dl>` : `<div class="tabela-rolagem"><table class="tabela tabela-simples rel-t">
        <thead><tr>${s.colunas.map((c) => `<th class="${dir(c.tipo) ? 'dir' : ''}">${esc(c.titulo)}</th>`).join('')}</tr></thead>
        <tbody>${s.linhas.length ? s.linhas.map((l) => `<tr>${l.map((v, i) => `<td class="${dir(s.colunas[i].tipo) ? 'dir' : ''}">${esc(formatarValor(v, s.colunas[i].tipo, s.colunas[i].casas))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${s.colunas.length}" class="vazio-txt">Sem registros para os filtros escolhidos.</td></tr>`}</tbody>
        ${s.totais ? `<tfoot><tr>${s.totais.map((v, i) => `<td class="${dir(s.colunas[i].tipo) ? 'dir' : ''}">${v === null ? '' : esc(formatarValor(v, s.colunas[i].tipo, s.colunas[i].casas))}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>`}
      ${s.nota ? `<p class="nota">${esc(s.nota)}</p>` : ''}</section>`).join('')}
    ${r.notas.length ? `<footer class="rel-notas">${r.notas.map((n) => `<p>${esc(n)}</p>`).join('')}</footer>` : ''}
  </article>`;
}

/** Exporta um relatório (usado pela central, pela Sequência e pelo Diário). */
export async function exportarRelatorio(r: Relatorio, fmt: 'csv' | 'xlsx' | 'pdf', b?: HTMLButtonElement) {
  const rotulo = b?.innerHTML ?? '';
  if (b) { b.disabled = true; b.textContent = 'Gerando…'; }
  try {
    let blob: Blob;
    if (fmt === 'csv') blob = new Blob([paraCSV(r)], { type: 'text/csv;charset=utf-8' });
    else {
      const m = await carregarMotor<MotorExport>('motor-export', '__motorExport');
      blob = fmt === 'xlsx' ? await m.xlsx(r) : new Blob([(await m.pdf(r)) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    }
    const nomeArq = nomeArquivo(r, fmt);
    const como = await entregarArquivo(blob, nomeArq);
    toast(`${fmt === 'xlsx' ? 'Excel' : fmt.toUpperCase()} ${como === 'baixado' ? 'baixado' : 'pronto'}: ${nomeArq}`, 'ok');
  } catch (err) {
    toast(`Não foi possível gerar o arquivo: ${(err as Error).message}`, 'erro');
  } finally { if (b) { b.disabled = false; b.innerHTML = rotulo; } }
}

/** Botões de exportação padrão. */
export const botoesExportar = (extraClasse = '') => `<span class="rel-export ${extraClasse}"><button class="btn btn-sec btn-peq" data-exp="csv">${icone('relatorio', 15)} CSV</button><button class="btn btn-sec btn-peq" data-exp="xlsx">${icone('relatorio', 15)} Excel</button><button class="btn btn-sec btn-peq" data-exp="pdf">${icone('relatorio', 15)} PDF</button></span>`;
