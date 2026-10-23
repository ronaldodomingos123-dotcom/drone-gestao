/**
 * Sequência de aplicação — no formato do painel de Sequência do app atual:
 * grupos Concluídas / Em andamento / A seguir, próxima destacada, Concluir, copiar resumo e salvar imagem.
 * Inclui os importadores por "colar do Excel" (sequência e talhões).
 */
import { registrar } from '../domain/base';
import { aplicacoes, aplicadoPorItem, areaPlanejadaOS, chaveItem, percentualExecutado, round } from '../domain/calc';
import { EXEMPLO_SEQUENCIA, importarSequencia, moverNaSequencia, importarTalhoes, lerSequencia, lerTalhoes, numeroBR, type OpcoesImportacao } from '../domain/importacao';
import type { OrdemServico, TipoCampanha } from '../domain/types';
import { novoId, PREFIXO } from '../data/repository';
import { alterar, estado, nome, redesenhar } from '../state';
import { aviso, cabecalhoPagina, lerUnidade, ligarSeletorUnidade, seletorUnidade } from '../ui/components';
import { abrirModal, esc, fmtData, fmtHa, fmtNum, fmtPct, hojeISO, toast } from '../ui/dom';
import { exportarPNG } from '../ui/exportar';
import { carregarMotorPdf } from '../ui/pdf';
import { botoesExportar, exportarRelatorio, responsavelAtual } from './relatorios';
import type { Relatorio } from '../domain/relatorios';
import { importarOSPdf, lerOSdoPdf, type DadosOSPdf } from '../domain/importacaoPdf';
import { icone } from '../ui/icons';
import { alternarConclusaoOS } from './edicao';
import { abrirLancarAplicado } from './lancarAplicado';

const CHAVE = `${PREFIXO}sequencia`;
let campanhaId = '';
let busca = '';

interface LinhaSeq { os: OrdemServico; plan: number; apl: number; saldo: number; obst: number; pct: number | null; grupo: 'concluida' | 'andamento' | 'seguir' }

/** plan = programado BRUTO; obst = saldo de OS concluída (obstáculo/desconto apurado). */
function linhasDaCampanha(cid: string): LinhaSeq[] {
  const ds = estado.ds;
  const apl = aplicadoPorItem(aplicacoes(ds));
  return ds.ordens.filter((o) => o.campanhaId === cid && o.status !== 'cancelada')
    .sort((a, b) => (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }))
    .map((os) => {
      const plan = areaPlanejadaOS(os);
      const a = os.itens.reduce((s, i) => s + (apl.get(chaveItem(os.id, i.talhaoId)) ?? 0), 0);
      const grupo = os.status === 'concluida' ? 'concluida' : os.status === 'em_execucao' ? 'andamento' : 'seguir';
      const saldo = plan - a;
      return { os, plan, apl: a, saldo, obst: grupo === 'concluida' ? Math.max(0, saldo) : 0, pct: percentualExecutado(a, plan), grupo };
    });
}

function totaisSeq(linhas: LinhaSeq[]) {
  const plan = linhas.reduce((s, l) => s + l.plan, 0);
  const apl = linhas.reduce((s, l) => s + l.apl, 0);
  const obst = linhas.reduce((s, l) => s + l.obst, 0);
  const falta = linhas.filter((l) => l.grupo !== 'concluida').reduce((s, l) => s + Math.max(0, l.saldo), 0);
  return { plan, apl, obst, falta, pct: percentualExecutado(apl, plan) };
}

export function renderSequencia(raiz: HTMLElement) {
  const ds = estado.ds;
  try { const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); if (s?.campanhaId) campanhaId = s.campanhaId; } catch { /* opcional */ }
  if (!ds.campanhas.some((c) => c.id === campanhaId)) {
    // campanha com operação mais recente, ou a primeira
    const ultima = [...ds.operacoes].sort((a, b) => b.data.localeCompare(a.data))[0];
    campanhaId = ultima?.campanhaId ?? ds.campanhas[0]?.id ?? '';
  }
  raiz.innerHTML = `${cabecalhoPagina('Sequência de aplicação', 'Ordem de execução das fazendas/OS da campanha, com saldo e andamento.',
    `<button class="btn btn-pri" data-acao="importar">${icone('camadas', 16)} Importar sequência</button>`)}<div id="seq"></div>`;
  const host = raiz.querySelector('#seq') as HTMLElement;
  host.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.k === 'campanha') { campanhaId = el.value; try { localStorage.setItem(CHAVE, JSON.stringify({ campanhaId })); } catch { /* opcional */ } desenhar(host); }
  });
  host.addEventListener('input', (e) => { const el = e.target as HTMLInputElement; if (el.dataset.k === 'busca') { busca = el.value; desenharTabela(host); } });
  // posição digitada: aplica ao confirmar (Enter ou sair do campo)
  host.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.pos) return;
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 1) { redesenhar(); return; }
    moverPara(el.dataset.pos, v);
  });
  host.addEventListener('keydown', (e) => { const el = e.target as HTMLInputElement; if (el.dataset.pos && e.key === 'Enter') el.blur(); });
  ativarArrastar(host);
  raiz.addEventListener('click', (e) => void aoClicar(e, host));
  desenhar(host);
}

async function aoClicar(e: Event, host: HTMLElement) {
  const ex = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
  if (ex) { const r = relSequencia(); if (r) void exportarRelatorio(r, ex.dataset.exp as 'csv' | 'xlsx' | 'pdf', ex); return; }
  const b = (e.target as HTMLElement).closest('[data-acao]') as HTMLButtonElement | null;
  if (!b) return;
  const acao = b.dataset.acao;
  if (acao === 'importar') abrirImportarSequencia(campanhaId);
  if (acao === 'copiar') await copiarResumo();
  if (acao === 'imagem') void exportarPNG(host, `sequencia-${(estado.ds.campanhas.find((c) => c.id === campanhaId)?.nome ?? 'campanha').replace(/\W+/g, '-').toLowerCase()}-${hojeISO()}.png`, 'Sequência de aplicação', b, ['seq-barra', 'seq-acoes']);
  if (acao === 'concluir') await alternarConclusaoOS(b.dataset.id!);
  if (acao === 'aplicado') abrirLancarAplicado(b.dataset.id!);
  if (acao === 'subir' || acao === 'descer') mover(b.dataset.id!, acao === 'subir' ? -1 : 1);
}

function mover(osId: string, delta: number) {
  const atual = estado.ds.ordens.find((x) => x.id === osId)?.sequencia ?? 0;
  moverPara(osId, atual + delta);
}

/** Leva a OS para a posição informada e renumera a campanha (com auditoria). */
function moverPara(osId: string, posicao: number) {
  let r: ReturnType<typeof moverNaSequencia> = null;
  const erro = alterar((ds) => {
    r = moverNaSequencia(ds, campanhaId, osId, posicao);
    if (!r) return null;
    const o = ds.ordens.find((x) => x.id === osId)!;
    registrar(ds, { entidade: 'ordem', entidadeId: osId, acao: 'reordenar', resumo: `${o.numero} · ${nome.fazenda(o.fazendaId)}: posição ${r.de} → ${r.para}` });
    return null;
  });
  if (erro) toast(erro, 'erro'); else redesenhar();
}

/** Arrastar pela alça (mouse e toque, com pointer events). */
function ativarArrastar(tabela: HTMLElement) {
  tabela.addEventListener('pointerdown', (ev) => {
    const alca = (ev.target as HTMLElement).closest('[data-arrastar]') as HTMLElement | null;
    if (!alca) return;
    ev.preventDefault();
    const origem = alca.closest('tr') as HTMLTableRowElement;
    const de = Number(origem.dataset.seq);
    origem.classList.add('seq-arrastando');
    alca.setPointerCapture(ev.pointerId);
    let alvo: HTMLTableRowElement | null = null;
    let depois = false;
    const limpar = () => tabela.querySelectorAll('.seq-alvo-acima, .seq-alvo-abaixo').forEach((x) => x.classList.remove('seq-alvo-acima', 'seq-alvo-abaixo'));
    const mov = (e: PointerEvent) => {
      const linhas = [...tabela.querySelectorAll<HTMLTableRowElement>('tr[data-os]')];
      limpar(); alvo = null;
      for (const tr of linhas) {
        const r = tr.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { alvo = tr; depois = e.clientY > r.top + r.height / 2; break; }
      }
      if (!alvo && linhas.length) {
        const pri = linhas[0].getBoundingClientRect(), ult = linhas[linhas.length - 1].getBoundingClientRect();
        if (e.clientY < pri.top) { alvo = linhas[0]; depois = false; } else if (e.clientY > ult.bottom) { alvo = linhas[linhas.length - 1]; depois = true; }
      }
      if (alvo && alvo !== origem) alvo.classList.add(depois ? 'seq-alvo-abaixo' : 'seq-alvo-acima');
      // rolagem automática perto das bordas da tela
      if (e.clientY < 70) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    };
    const fim = () => {
      alca.removeEventListener('pointermove', mov); alca.removeEventListener('pointerup', fim); alca.removeEventListener('pointercancel', fim);
      origem.classList.remove('seq-arrastando'); limpar();
      if (!alvo || alvo === origem) return;
      const t = Number(alvo.dataset.seq);
      const para = de < t ? (depois ? t : t - 1) : (depois ? t + 1 : t);
      if (para !== de) moverPara(origem.dataset.os!, para);
    };
    alca.addEventListener('pointermove', mov); alca.addEventListener('pointerup', fim); alca.addEventListener('pointercancel', fim);
  });
}

function desenhar(host: HTMLElement) {
  const ds = estado.ds;
  const camp = ds.campanhas.find((c) => c.id === campanhaId);
  const linhas = linhasDaCampanha(campanhaId);
  const T = totaisSeq(linhas);
  const proxima = linhas.find((l) => l.grupo === 'andamento') ?? linhas.find((l) => l.grupo === 'seguir');
  const fzTxt = (l: LinhaSeq) => { const f = ds.fazendas.find((x) => x.id === l.os.fazendaId); return `${f?.codigo ? `<b>${esc(f.codigo)}</b> ` : ''}<span>${esc(f?.nome ?? '—')}</span>`; };
  const cartao = (g: LinhaSeq['grupo'], titulo: string, cls: string, rodRot: string, rodVal: number, valor: (l: LinhaSeq) => number) => {
    const ls = linhas.filter((l) => l.grupo === g);
    return `<section class="seq-card ${cls}"><header><span>${titulo}</span><b>${ls.length}</b></header>
      <div class="seq-card-lista">${ls.map((l) => `<div class="seq-card-it ${l.os.id === proxima?.os.id ? 'prox' : ''}">${l.os.id === proxima?.os.id ? `<span class="seq-tag-prox">Próxima · S${l.os.sequencia ?? '-'}</span>` : `<span class="seq-tag">S${l.os.sequencia ?? '-'}</span>`}<span class="seq-card-faz">${fzTxt(l)}</span><span class="seq-card-ha">${esc(fmtNum(valor(l), 2))} ha${g === 'concluida' && l.obst > 0.005 ? `<small>obst. ${esc(fmtNum(l.obst, 2))}</small>` : ''}</span></div>`).join('') || '<p class="seq-card-vazio">Nenhuma fazenda neste grupo.</p>'}</div>
      <footer><span>${rodRot}</span><b>${esc(fmtNum(rodVal, 2))} ha</b></footer></section>`;
  };
  const conc = linhas.filter((l) => l.grupo === 'concluida'), and = linhas.filter((l) => l.grupo === 'andamento'), seg = linhas.filter((l) => l.grupo === 'seguir');
  host.innerHTML = `
    <div class="seq-barra">
      <label class="f-campo"><span>Campanha</span><select data-k="campanha">${ds.campanhas.map((c) => `<option value="${esc(c.id)}" ${c.id === campanhaId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('') || '<option value="">Nenhuma campanha</option>'}</select></label>
      <label class="busca">${icone('busca', 16)}<input data-k="busca" type="search" placeholder="Pesquisar por fazenda ou FN…" value="${esc(busca)}"></label>
      <button class="btn btn-sec btn-peq" data-acao="copiar">${icone('relatorio', 15)} Copiar resumo</button>
      <button class="btn btn-sec btn-peq" data-acao="imagem">${icone('camadas', 15)} Salvar imagem</button>
      ${botoesExportar('seq-exp')}
      ${campanhaId ? `<button class="btn btn-sec btn-peq" data-novo="ordem" data-campanha="${esc(campanhaId)}">${icone('mais', 15)} Nova OS</button>` : ''}
    </div>
    ${!camp ? aviso('info', 'Nenhuma campanha cadastrada. Use <b>Importar sequência</b> para colar a tabela do Excel — a campanha, as fazendas e as OS são criadas automaticamente.') : `
    <section class="seq-topo">
      <div class="seq-tit"><small>Sequência de aplicação</small><h2>${esc(camp.nome)}</h2><p>${esc(camp.tipo)} · prazo ${esc(fmtData(camp.fim))} · gerado em ${esc(fmtData(hojeISO()))}</p></div>
      <div class="seq-nums">
        <div><span>Programado</span><b>${esc(fmtHa(T.plan, 2))}</b></div>
        <div><span>Aplicado</span><b class="txt-ok">${esc(fmtHa(T.apl, 2))}</b></div>
        <div><span>Obstáculos</span><b class="txt-obst">${esc(fmtHa(T.obst, 2))}</b></div>
        <div><span>Falta aplicar</span><b>${esc(fmtHa(T.falta, 2))}</b></div>
        <div><span>Executado</span><b>${esc(fmtPct(T.pct, 1))}</b></div>
      </div>
      <div class="progresso seq-prog seq-prog-duplo" title="Verde: aplicado · Laranja: obstáculos"><div style="width:${Math.max(0, Math.min(100, T.plan ? (T.apl / T.plan) * 100 : 0))}%"></div><div class="obst" style="width:${Math.max(0, Math.min(100, T.plan ? (T.obst / T.plan) * 100 : 0))}%"></div></div>
    </section>
    ${camp.calda?.produtos.length ? '' : aviso('atencao', `Campanha sem calda definida. <button class="link" data-editar="campanha" data-id="${esc(camp.id)}">Definir produtos e doses</button> — sem isso as aplicações não podem ser registradas.`)}
    <div class="seq-cards">
      ${cartao('concluida', 'Concluídas', 'c-conc', 'Aplicado', conc.reduce((s, l) => s + l.apl, 0), (l) => l.apl)}
      ${cartao('andamento', 'Em andamento', 'c-and', 'Falta', and.reduce((s, l) => s + Math.max(0, l.saldo), 0), (l) => Math.max(0, l.saldo))}
      ${cartao('seguir', 'A seguir', 'c-seg', 'A aplicar', seg.reduce((s, l) => s + l.plan, 0), (l) => l.plan)}
    </div>
    <section class="cartao seq-tabela" id="seq-tab"></section>
    ${conc.length ? `<section class="cartao seq-fech"><h3 class="sec-tit">${icone('ok', 16)} Fechamento — aplicado × obstáculos (${conc.length} concluída${conc.length > 1 ? 's' : ''})</h3>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Seq.</th><th>Fazenda</th><th class="dir">Programado</th><th class="dir">Aplicado</th><th class="dir">Obstáculo</th><th class="dir">Aproveitamento</th></tr></thead><tbody>
      ${conc.map((l) => `<tr><td>S${l.os.sequencia ?? '-'}</td><td>${fzTxt(l)}</td><td class="dir">${esc(fmtNum(l.plan, 2))}</td><td class="dir"><b>${esc(fmtNum(l.apl, 2))}</b></td><td class="dir">${l.obst > 0.005 ? esc(fmtNum(l.obst, 2)) : '—'}</td><td class="dir">${esc(fmtPct(l.pct, 1))}</td></tr>`).join('')}
      </tbody><tfoot>${(() => { const p = conc.reduce((s, l) => s + l.plan, 0), a2 = conc.reduce((s, l) => s + l.apl, 0), o2 = conc.reduce((s, l) => s + l.obst, 0); return `<tr><td></td><td>Total</td><td class="dir">${esc(fmtNum(p, 2))}</td><td class="dir"><b>${esc(fmtNum(a2, 2))}</b></td><td class="dir">${esc(fmtNum(o2, 2))}</td><td class="dir">${esc(fmtPct(percentualExecutado(a2, p), 1))}</td></tr>`; })()}</tfoot></table></div>
      <p class="nota">Obstáculo = programado − aplicado nas OS concluídas (carreadores, APP, falhas, desvios). Não entra no "falta aplicar" nem na previsão de término.</p></section>` : ''}`}`;
  if (camp) desenharTabela(host);
}

function desenharTabela(host: HTMLElement) {
  const el = host.querySelector('#seq-tab');
  if (!el) return;
  const ds = estado.ds;
  const linhas = linhasDaCampanha(campanhaId);
  const proximaId = (linhas.find((l) => l.grupo === 'andamento') ?? linhas.find((l) => l.grupo === 'seguir'))?.os.id;
  const t = busca.trim().toLowerCase();
  const filtradas = t ? linhas.filter((l) => { const f = ds.fazendas.find((x) => x.id === l.os.fazendaId); return `${f?.codigo} ${f?.nome} ${l.os.numero} ${l.os.titulo ?? ''}`.toLowerCase().includes(t); }) : linhas;
  const etapa = (ativo: boolean, tipo: 'ok' | 'and') => (ativo ? `<span class="seq-pill ${tipo === 'ok' ? 'p-ok' : 'p-and'}">${tipo === 'ok' ? 'OK' : 'EM AND.'}</span>` : '<span class="seq-pill p-nao">—</span>');
  const linhaHTML = (l: LinhaSeq) => {
    const f = ds.fazendas.find((x) => x.id === l.os.fazendaId);
    const prox = l.os.id === proximaId;
    const geral = l.os.itens.some((i) => ds.talhoes.find((x) => x.id === i.talhaoId)?.geral);
    const pctBar = Math.max(0, Math.min(100, l.pct ?? 0));
    return `<tr class="${prox ? 'seq-proxima' : ''} seq-${l.grupo}" data-os="${esc(l.os.id)}" data-seq="${l.os.sequencia ?? 0}">
      <td class="seq-pos-cel"><span class="seq-alca" data-arrastar title="Arrastar para mudar a ordem" aria-hidden="true">⠿</span><span class="seq-s">S</span><input class="seq-pos" type="number" min="1" max="${linhas.length}" inputmode="numeric" value="${l.os.sequencia ?? ''}" data-pos="${esc(l.os.id)}" aria-label="Posição de ${esc(f?.nome ?? '')} na sequência" title="Digite a nova posição e tecle Enter"><span class="seq-setas"><button class="btn-icone" data-acao="subir" data-id="${esc(l.os.id)}" aria-label="Subir" title="Subir na sequência">▲</button><button class="btn-icone" data-acao="descer" data-id="${esc(l.os.id)}" aria-label="Descer" title="Descer na sequência">▼</button></span></td>
      <td class="m-oculta">${esc(f?.codigo ?? '')}</td>
      <td><b>${esc(f?.nome ?? '—')}</b>${prox ? ' <span class="selo selo-ok">Próxima</span>' : ''}<small class="bloco">OS ${esc(l.os.numero)}${l.os.titulo ? ` · ${esc(l.os.titulo)}` : ''}${geral ? ' · talhão geral' : ` · ${l.os.itens.length} talhão(ões)`}</small></td>
      <td class="dir">${esc(fmtNum(l.plan, 2))}</td>
      <td class="dir"><button type="button" class="seq-apl" data-acao="aplicado" data-id="${esc(l.os.id)}" title="Lançar/editar o aplicado e o desconto">${esc(fmtNum(l.apl, 2))} <span class="seq-lapis">${icone('config', 12)}</span></button></td>
      <td class="dir ${l.saldo < -0.01 ? 'txt-critico' : ''}"><b>${esc(fmtNum(l.saldo, 2))}</b>${l.obst > 0.005 ? '<small class="bloco seq-obst">obstáculo</small>' : ''}</td>
      <td class="centro m-oculta">${etapa(true, 'ok')}</td>
      <td class="centro m-oculta">${etapa(l.grupo === 'andamento', 'and')}</td>
      <td class="centro m-oculta">${etapa(l.grupo === 'concluida', 'ok')}</td>
      <td class="seq-prog-cel"><div class="mini-prog"><div style="width:${pctBar}%" class="${(l.pct ?? 0) > 100.05 ? 'excesso' : ''}"></div></div><small>${esc(fmtPct(l.pct, 0))}</small></td>
      <td class="seq-acoes"><span class="acoes-linha">
        ${l.grupo === 'concluida'
          ? (l.os.concluidaManual ? `<button class="btn btn-conc btn-peq" data-acao="concluir" data-id="${esc(l.os.id)}" title="Concluída — clique para reabrir">Concluída</button>` : '<span class="btn btn-conc btn-peq sem-acao" title="Área programada aplicada por completo">Concluída</span>')
          : `<button class="btn btn-sec btn-peq" data-acao="concluir" data-id="${esc(l.os.id)}">Concluir</button>`}
        <button class="btn-icone" data-editar="ordem" data-id="${esc(l.os.id)}" aria-label="Editar OS" title="Editar OS">${icone('config', 15)}</button></span></td>
    </tr>`;
  };
  const tot = totaisSeq(filtradas);
  el.innerHTML = filtradas.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples seq-t">
    <thead><tr><th>Sequência</th><th class="m-oculta">FN</th><th>Fazenda</th><th class="dir">Área (ha)</th><th class="dir">Aplicado (ha)</th><th class="dir">Saldo (ha)</th><th class="centro m-oculta">Programada</th><th class="centro m-oculta">Em and.</th><th class="centro m-oculta">Concluída</th><th>Progresso</th><th class="seq-acoes">Ação</th></tr></thead>
    <tbody>${filtradas.map(linhaHTML).join('')}</tbody>
    <tfoot><tr><td></td><td class="m-oculta"></td><td>Total (${filtradas.length})</td><td class="dir">${esc(fmtNum(tot.plan, 2))}</td><td class="dir">${esc(fmtNum(tot.apl, 2))}</td><td class="dir">${esc(fmtNum(tot.plan - tot.apl, 2))}<small class="bloco seq-obst">${tot.obst > 0.005 ? `obst. ${esc(fmtNum(tot.obst, 2))} · falta ${esc(fmtNum(tot.falta, 2))}` : ''}</small></td><td class="m-oculta" colspan="3"></td><td colspan="2"></td></tr></tfoot>
  </table></div>` : `<p class="vazio-txt">${t ? 'Nenhuma OS para a busca.' : 'Campanha sem OS. Importe a sequência ou crie uma OS.'}</p>`;
}

/** A Sequência como relatório exportável (mesmos números da tela). */
function relSequencia(): Relatorio | null {
  const ds = estado.ds;
  const camp = ds.campanhas.find((c) => c.id === campanhaId);
  if (!camp) return null;
  const linhas = linhasDaCampanha(campanhaId);
  const T = totaisSeq(linhas);
  const fz = (l: LinhaSeq) => ds.fazendas.find((x) => x.id === l.os.fazendaId);
  const GR: Record<string, string> = { concluida: 'Concluída', andamento: 'Em andamento', seguir: 'A seguir' };
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();
  const r: Relatorio = {
    id: 'sequencia', titulo: `Sequência de aplicação — ${camp.nome}`, periodo: null, filtros: [`Campanha: ${camp.nome} (${camp.tipo}, prazo ${fmtData(camp.fim)})`], geradoEm: agora, responsavel: responsavelAtual(),
    indicadores: [{ rotulo: 'Programado', valor: T.plan, tipo: 'ha' }, { rotulo: 'Aplicado', valor: T.apl, tipo: 'ha' }, { rotulo: 'Obstáculos', valor: T.obst, tipo: 'ha' }, { rotulo: 'Falta aplicar', valor: T.falta, tipo: 'ha' }, { rotulo: 'Executado', valor: T.pct, tipo: 'pct' }],
    secoes: [{ titulo: 'Sequência', colunas: [{ titulo: 'Seq.', tipo: 'int' }, { titulo: 'FN', tipo: 'texto' }, { titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'OS', tipo: 'texto' }, { titulo: 'Situação', tipo: 'texto' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Saldo (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Obstáculo (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Progresso', tipo: 'pct' }],
      linhas: linhas.map((l) => [l.os.sequencia ?? null, fz(l)?.codigo ?? '', fz(l)?.nome ?? '', l.os.numero, GR[l.grupo], round(l.plan, 4), round(l.apl, 4), round(l.saldo, 4), round(l.obst, 4), l.pct]) }],
    notas: ['Obstáculo = programado − aplicado nas OS concluídas; não entra no "falta aplicar".'],
  };
  const s0 = r.secoes[0];
  s0.totais = ['Total', null, `${linhas.length} OS`, null, null, round(T.plan, 4), round(T.apl, 4), round(T.plan - T.apl, 4), round(T.obst, 4), T.pct];
  return r;
}

async function copiarResumo() {
  const ds = estado.ds;
  const camp = ds.campanhas.find((c) => c.id === campanhaId);
  if (!camp) return;
  const linhas = linhasDaCampanha(campanhaId);
  const T = totaisSeq(linhas);
  const fz = (l: LinhaSeq) => { const f = ds.fazendas.find((x) => x.id === l.os.fazendaId); return `${f?.codigo ? `${f.codigo} ` : ''}${f?.nome ?? ''}`; };
  const prox = linhas.find((l) => l.grupo === 'andamento') ?? linhas.find((l) => l.grupo === 'seguir');
  const txt = [
    `*SEQUÊNCIA — ${camp.nome.toUpperCase()}* (${fmtData(hojeISO())})`,
    `Programado: ${fmtHa(T.plan, 2)} | Aplicado: ${fmtHa(T.apl, 2)} (${fmtPct(T.pct, 1)})`,
    `Obstáculos: ${fmtHa(T.obst, 2)} | Falta aplicar: ${fmtHa(T.falta, 2)}`,
    '',
    `✅ Concluídas (${linhas.filter((l) => l.grupo === 'concluida').length})`,
    ...linhas.filter((l) => l.grupo === 'concluida').map((l) => `S${l.os.sequencia ?? '-'} ${fz(l)} — ${fmtNum(l.apl, 2)} de ${fmtNum(l.plan, 2)} ha${l.obst > 0.005 ? ` (obst. ${fmtNum(l.obst, 2)})` : ''}`),
    '',
    `🔄 Em andamento (${linhas.filter((l) => l.grupo === 'andamento').length})`,
    ...linhas.filter((l) => l.grupo === 'andamento').map((l) => `S${l.os.sequencia ?? '-'} ${fz(l)} — ${fmtNum(l.apl, 2)} de ${fmtNum(l.plan, 2)} ha (saldo ${fmtNum(l.saldo, 2)})`),
    '',
    prox ? `➡️ Próxima: S${prox.os.sequencia ?? '-'} ${fz(prox)} (${fmtNum(Math.max(0, prox.saldo), 2)} ha)` : '',
    `⏳ A seguir (${linhas.filter((l) => l.grupo === 'seguir').length})`,
    ...linhas.filter((l) => l.grupo === 'seguir').map((l) => `S${l.os.sequencia ?? '-'} ${fz(l)} — ${fmtNum(l.plan, 2)} ha`),
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  try {
    await navigator.clipboard.writeText(txt);
    toast('Resumo copiado. Cole no WhatsApp ou e-mail.', 'ok');
  } catch {
    abrirModal('Resumo da sequência', `<p class="muted">Não foi possível copiar automaticamente. Selecione o texto abaixo e copie:</p><textarea class="campo-obs" rows="14" readonly>${esc(txt)}</textarea>`);
  }
}

// ---------------- Importar sequência ----------------
export function abrirImportarSequencia(campanhaPadrao = '') {
  const ds = estado.ds;
  const tipos: TipoCampanha[] = ['Maturador', 'Inseticida', 'Fungicida', 'Herbicida', 'Dessecação', 'Fertilizante foliar'];
  let leitura = lerSequencia('');
  let selecionados = new Set<string>();
  const m = abrirModal('Importar sequência (colar do Excel)', `
    <div class="imp">
      <div class="imp-abas" role="tablist"><button type="button" class="ativo" role="tab" aria-selected="true">Colar tabela (Excel)</button><button type="button" role="tab" data-imp="aba-pdf">${icone('relatorio', 14)} PDF da OS</button></div>
      <p class="muted">Copie as linhas no Excel e cole abaixo. Colunas no formato do app atual: <b>Sequência · Fazenda · O.S · Área · Título</b> (com cabeçalho, aceita também <b>FN</b>). Linhas de Total/Realizado são ignoradas.</p>
      <textarea class="campo-obs imp-texto" rows="7" placeholder="Cole aqui (Ctrl+V / colar)…"></textarea>
      <div class="pag-acoes"><button class="btn btn-sec btn-peq" data-imp="exemplo">Colar exemplo</button></div>
      <div class="form-grade">
        <label class="campo"><span>Campanha de destino</span><select data-imp="campanha"><option value="">+ Nova campanha…</option>${ds.campanhas.map((c) => `<option value="${esc(c.id)}" ${c.id === campanhaPadrao ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="campo imp-nova"><span>Nome da nova campanha</span><input data-imp="nome" placeholder="Ex.: Maturador 26/27"></label>
        <label class="campo imp-nova"><span>Tipo</span><select data-imp="tipo">${tipos.map((t) => `<option>${t}</option>`).join('')}</select></label>
        <label class="campo imp-nova"><span>Início da campanha</span><input type="date" data-imp="inicio" value="${esc(hojeISO())}"></label>
        <label class="campo imp-nova"><span>Prazo final</span><input type="date" data-imp="fim"></label>
        <label class="campo"><span>Taxa de aplicação (L/ha)</span><input data-imp="taxa" inputmode="decimal" placeholder="Ex.: 15"><small>Volume de calda por hectare — vale para todas as OS importadas</small></label>
        ${seletorUnidade('imp', '', 'Unidade / empresa das fazendas novas (opcional)')}
      </div>
      <fieldset class="imp-ordem"><legend>Ordem da sequência</legend>
        <label class="chk"><input type="radio" name="imp-ordem" value="manter" checked><span>Manter a ordem atual da campanha<small>Seus ajustes manuais são preservados; OS novas entram no fim.</small></span></label>
        <label class="chk"><input type="radio" name="imp-ordem" value="tabela"><span>Usar a ordem da tabela<small>A sequência passa a ser a da planilha colada.</small></span></label>
      </fieldset>
      <div class="imp-titulos"></div>
      <div class="imp-previa"></div>
    </div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-imp="confirmar" disabled>Importar</button>' });
  const raiz = m.el;
  ligarSeletorUnidade(raiz, () => atualizar());
  const q = <T extends HTMLElement>(s: string) => raiz.querySelector(s) as T;
  const opcoes = (): OpcoesImportacao => ({
    campanhaId: q<HTMLSelectElement>('[data-imp="campanha"]').value,
    novaCampanha: { nome: q<HTMLInputElement>('[data-imp="nome"]').value, tipo: q<HTMLSelectElement>('[data-imp="tipo"]').value as TipoCampanha, inicio: q<HTMLInputElement>('[data-imp="inicio"]').value || hojeISO(), fim: q<HTMLInputElement>('[data-imp="fim"]').value },
    taxaLHa: numeroBR(q<HTMLInputElement>('[data-imp="taxa"]').value),
    unidadeId: lerUnidade(raiz, 'imp'),
    titulos: leitura.titulos.length ? [...selecionados] : [],
    ordem: (raiz.querySelector('input[name="imp-ordem"]:checked') as HTMLInputElement | null)?.value === 'tabela' ? 'tabela' : 'manter',
  });
  const atualizar = () => {
    const nova = !q<HTMLSelectElement>('[data-imp="campanha"]').value;
    raiz.querySelectorAll<HTMLElement>('.imp-nova').forEach((e) => { e.style.display = nova ? '' : 'none'; });
    const temOS = !nova && estado.ds.ordens.some((o) => o.campanhaId === q<HTMLSelectElement>('[data-imp="campanha"]').value && o.status !== 'cancelada');
    q<HTMLElement>('.imp-ordem').style.display = temOS ? '' : 'none';
    const tbox = q<HTMLElement>('.imp-titulos');
    tbox.innerHTML = leitura.titulos.length > 1 ? `<div class="sec-tit">Títulos encontrados — marque o que importar</div><div class="lista-check">${leitura.titulos.map((t) => `<label class="chk"><input type="checkbox" data-titulo="${esc(t)}" ${selecionados.has(t) ? 'checked' : ''}><span>${esc(t)}<small>${leitura.linhas.filter((l) => l.titulo === t).length} linha(s) · ${esc(fmtHa(leitura.linhas.filter((l) => l.titulo === t).reduce((s, l) => s + (l.area ?? 0), 0), 2))}</small></span></label>`).join('')}</div>` : '';
    const prev = q<HTMLElement>('.imp-previa');
    const btn = q<HTMLButtonElement>('[data-imp="confirmar"]');
    if (!leitura.linhas.length) { prev.innerHTML = leitura.ignoradas.length ? aviso('atencao', 'Nenhuma linha válida reconhecida.') : ''; btn.disabled = true; return; }
    const r = importarSequencia(estado.ds, leitura.linhas, opcoes(), novoId, false, hojeISO());
    btn.disabled = r.erros.length > 0;
    btn.textContent = r.erros.length ? 'Importar' : `Importar ${r.acoes.length} linha(s) · ${fmtHa(r.total, 2)}`;
    prev.innerHTML = `
      ${r.erros.length ? aviso('critico', `<b>Corrija antes de importar:</b><ul>${r.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${r.avisos.length ? aviso('atencao', `<ul>${r.avisos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${leitura.ignoradas.length ? `<p class="nota">Ignoradas: ${leitura.ignoradas.map((x) => `linha ${x.linha} (${esc(x.motivo)})`).join(', ')}.</p>` : ''}
      ${r.acoes.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Seq.</th><th>Fazenda</th><th>OS</th><th class="dir">Área</th><th>O que acontece</th></tr></thead><tbody>
        ${r.acoes.map((a) => `<tr><td>${a.seq}</td><td>${esc(a.fazenda)}</td><td>${esc(a.os)}</td><td class="dir">${esc(fmtNum(a.area, 2))}</td><td>${esc(a.acao)}${a.aviso ? `<small class="bloco txt-critico">${esc(a.aviso)}</small>` : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td></td><td>Total</td><td></td><td class="dir">${esc(fmtNum(r.total, 2))}</td><td></td></tr></tfoot></table></div>` : ''}`;
  };
  const ler = () => {
    leitura = lerSequencia(q<HTMLTextAreaElement>('.imp-texto').value);
    selecionados = new Set(leitura.titulos);
    atualizar();
  };
  q<HTMLTextAreaElement>('.imp-texto').addEventListener('input', ler);
  raiz.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.titulo !== undefined) { if (el.checked) selecionados.add(el.dataset.titulo); else selecionados.delete(el.dataset.titulo); }
    atualizar();
  });
  raiz.addEventListener('input', (e) => { const k = (e.target as HTMLElement).dataset.imp; if (k === 'nome' || k === 'taxa') atualizar(); });
  raiz.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-imp]') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.imp === 'aba-pdf') { m.fechar(); abrirImportarPdf(q<HTMLSelectElement>('[data-imp="campanha"]').value || campanhaPadrao); return; }
    if (b.dataset.imp === 'exemplo') { q<HTMLTextAreaElement>('.imp-texto').value = EXEMPLO_SEQUENCIA; ler(); }
    if (b.dataset.imp === 'confirmar') {
      let res: ReturnType<typeof importarSequencia> | null = null;
      const erro = alterar((d) => { res = importarSequencia(d, leitura.linhas, opcoes(), novoId, true, hojeISO()); return res.erros.length ? res.erros[0] : null; });
      if (erro) { toast(erro, 'erro'); return; }
      const r = res! as ReturnType<typeof importarSequencia>;
      campanhaId = r.campanhaId;
      try { localStorage.setItem(CHAVE, JSON.stringify({ campanhaId })); } catch { /* opcional */ }
      m.fechar();
      toast(`Sequência importada: ${r.acoes.length} OS · ${fmtHa(r.total, 2)}.`, 'ok');
      if (location.hash !== '#/relatorios/sequencia') location.hash = '#/relatorios/sequencia'; else redesenhar();
    }
  });
  atualizar();
}

// ---------------- Importar PDF da OS ----------------
interface ArquivoPdf { nome: string; estado: 'lendo' | 'ok' | 'erro'; linhas: string[]; caixas?: { x0: number; x1: number }[][]; paginas: number; dados: DadosOSPdf | null; msg?: string }

export function abrirImportarPdf(campanhaPadrao = '') {
  const ds = estado.ds;
  const tipos: TipoCampanha[] = ['Maturador', 'Inseticida', 'Fungicida', 'Herbicida', 'Dessecação', 'Fertilizante foliar'];
  const arquivos: ArquivoPdf[] = [];
  const m = abrirModal('Importar sequência — PDF da OS', `
    <div class="imp">
      <div class="imp-abas" role="tablist"><button type="button" role="tab" data-imp="aba-tabela">Colar tabela (Excel)</button><button type="button" class="ativo" role="tab" aria-selected="true">${icone('relatorio', 14)} PDF da OS</button></div>
      <p class="muted">Selecione um ou mais PDFs de OS. O aplicativo extrai <b>nº da OS, FN, talhões (zona, talhão, área)</b>, o <b>total</b> (e confere com a soma) e o <b>tratamento</b>. A leitura é feita neste aparelho — o arquivo não é enviado a lugar nenhum.</p>
      <label class="pdf-zona"><input type="file" accept="application/pdf,.pdf" multiple data-imp="arquivos"><span>${icone('relatorio', 22)}<b>Escolher PDF(s)</b><small>ou arraste os arquivos aqui</small></span></label>
      <div class="pdf-resumo"></div>
      <div class="pdf-lista"></div>
      <div class="form-grade">
        <label class="campo"><span>Campanha de destino</span><select data-imp="campanha"><option value="">+ Nova campanha…</option>${ds.campanhas.map((c) => `<option value="${esc(c.id)}" ${c.id === campanhaPadrao ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
        <label class="campo imp-nova"><span>Nome da nova campanha</span><input data-imp="nome" placeholder="Ex.: Fungicida 26/27"></label>
        <label class="campo imp-nova"><span>Tipo</span><select data-imp="tipo">${tipos.map((t) => `<option>${t}</option>`).join('')}</select></label>
        <label class="campo imp-nova"><span>Início da campanha</span><input type="date" data-imp="inicio" value="${esc(hojeISO())}"></label>
        <label class="campo imp-nova"><span>Prazo final</span><input type="date" data-imp="fim"></label>
        <label class="campo"><span>Taxa de aplicação (L/ha)</span><input data-imp="taxa" inputmode="decimal" placeholder="Ex.: 15"><small>Volume de calda por hectare — vale para todas as OS importadas</small></label>
        ${seletorUnidade('imp', '', 'Unidade / empresa das fazendas novas (opcional)')}
        <label class="chk campo-largo"><input type="checkbox" data-imp="tratamento" checked><span>Usar o tratamento do PDF como calda da OS<small>Produtos que não existem são criados com o código.</small></span></label>
      </div>
      <div class="imp-previa"></div>
    </div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-imp="confirmar" disabled>Importar</button>' });
  const raiz = m.el;
  ligarSeletorUnidade(raiz, () => atualizar());
  const q = <T extends HTMLElement>(sel: string) => raiz.querySelector(sel) as T;
  const opcoes = () => ({
    campanhaId: q<HTMLSelectElement>('[data-imp="campanha"]').value,
    novaCampanha: { nome: q<HTMLInputElement>('[data-imp="nome"]').value, tipo: q<HTMLSelectElement>('[data-imp="tipo"]').value as TipoCampanha, inicio: q<HTMLInputElement>('[data-imp="inicio"]').value || hojeISO(), fim: q<HTMLInputElement>('[data-imp="fim"]').value },
    taxaLHa: numeroBR(q<HTMLInputElement>('[data-imp="taxa"]').value),
    unidadeId: lerUnidade(raiz, 'imp'),
    usarTratamento: q<HTMLInputElement>('[data-imp="tratamento"]').checked,
  });
  const prontos = () => arquivos.filter((a) => a.estado === 'ok' && a.dados).map((a) => a.dados!);
  const cartao = (a: ArquivoPdf, i: number) => {
    const d = a.dados;
    if (a.estado === 'lendo') return `<div class="pdf-item"><div class="pdf-cab"><b>${esc(a.nome)}</b><span class="selo selo-info">lendo…</span></div></div>`;
    if (!d) return `<div class="pdf-item erro"><div class="pdf-cab"><b>${esc(a.nome)}</b><span class="selo selo-critico">erro</span><button type="button" class="btn-icone perigo" data-pdf-rem="${i}" aria-label="Remover">${icone('lixo', 14)}</button></div><p class="txt-critico">${esc(a.msg ?? 'Não foi possível ler.')}</p></div>`;
    const confere = d.totalDeclarado === null ? null : Math.abs(d.somaTalhoes - d.totalDeclarado) <= 0.011;
    return `<div class="pdf-item ${d.erros.length ? 'erro' : ''}">
      <div class="pdf-cab"><b>${esc(a.nome)}</b><small>${a.paginas} pág.</small>${d.erros.length ? '<span class="selo selo-critico">corrigir</span>' : confere === false ? '<span class="selo selo-atencao">conferir</span>' : '<span class="selo selo-ok">lido</span>'}<button type="button" class="btn-icone perigo" data-pdf-rem="${i}" aria-label="Remover">${icone('lixo', 14)}</button></div>
      <div class="chips-info"><span>OS <b>${esc(d.os || '—')}</b></span><span>FN <b>${esc(d.fns.join(', ') || '—')}</b></span><span>Talhões <b>${d.talhoes.length}</b></span><span>Soma <b>${esc(fmtNum(d.somaTalhoes, 2))} ha</b></span><span>Total do PDF <b>${d.totalDeclarado === null ? '—' : `${esc(fmtNum(d.totalDeclarado, 2))} ha`}</b> ${confere === null ? '' : confere ? '<span class="selo selo-ok">confere</span>' : '<span class="selo selo-atencao">difere</span>'}</span><span>Tratamento <b>${d.tratamento.itens.length ? `${esc(d.tratamento.nome || '—')} · ${d.tratamento.itens.length} produto(s)` : '—'}</b></span></div>
      ${d.talhoes.length ? `<details class="pdf-det"><summary>Talhões extraídos</summary><div class="tabela-rolagem"><table class="tab-trat"><thead><tr><th>FN</th><th>Fazenda</th><th>Zona</th><th>Talhão</th><th class="num">Área</th><th class="num">Ñ aplic.</th></tr></thead><tbody>${d.talhoes.map((t) => `<tr><td>${esc(t.fn || '—')}</td><td>${esc(t.fazenda || '—')}</td><td>${esc(t.zona || '—')}</td><td>${esc(t.talhao)}</td><td class="num">${esc(fmtNum(t.area ?? 0, 2))}</td><td class="num">${t.naoAplicado ? esc(fmtNum(t.naoAplicado, 2)) : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="4">${d.talhoes.length} talhão(ões)</td><td class="num">${esc(fmtNum(d.somaTalhoes, 2))}</td><td></td></tr></tfoot></table></div></details>` : ''}
      ${confere === false ? aviso('atencao', `<b>Soma dos talhões (${esc(fmtNum(d.somaTalhoes, 2))} ha) ≠ total do PDF (${esc(fmtNum(d.totalDeclarado ?? 0, 2))} ha).</b> Pode faltar talhão: abra "Talhões extraídos" e confira; se preciso, corrija o texto e clique em Reler.`) : ''}
      ${d.erros.length ? aviso('critico', `<ul>${d.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${d.avisos.filter((x) => !/difere do total/.test(x)).length ? aviso('atencao', `<ul>${d.avisos.filter((x) => !/difere do total/.test(x)).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      <details class="pdf-det"><summary>Texto extraído (corrigir e reler)</summary><textarea class="campo-obs pdf-texto" rows="8" data-pdf-txt="${i}">${esc(a.linhas.join('\n'))}</textarea><button type="button" class="btn btn-sec btn-peq" data-pdf-reler="${i}">Reler texto</button></details>
    </div>`;
  };
  const atualizar = () => {
    const nova = !q<HTMLSelectElement>('[data-imp="campanha"]').value;
    raiz.querySelectorAll<HTMLElement>('.imp-nova').forEach((e) => { e.style.display = nova ? '' : 'none'; });
    const nOk = arquivos.filter((a) => a.estado === 'ok' && a.dados && !a.dados.erros.length && !(a.dados.totalDeclarado !== null && Math.abs(a.dados.somaTalhoes - a.dados.totalDeclarado) > 0.011)).length;
    const nErro = arquivos.filter((a) => a.estado === 'erro' || (a.dados && a.dados.erros.length)).length;
    const nConf = arquivos.filter((a) => a.dados && !a.dados.erros.length && a.dados.totalDeclarado !== null && Math.abs(a.dados.somaTalhoes - a.dados.totalDeclarado) > 0.011).length;
    const nLendo = arquivos.filter((a) => a.estado === 'lendo').length;
    q<HTMLElement>('.pdf-resumo').innerHTML = arquivos.length ? `<span><b>${arquivos.length}</b> arquivo(s)</span><span class="txt-ok"><b>${nOk}</b> lido(s)</span>${nErro ? `<span class="txt-critico"><b>${nErro}</b> com erro</span>` : ''}${nConf ? `<span class="txt-atencao"><b>${nConf}</b> para conferir (soma ≠ total)</span>` : ''}${nLendo ? `<span class="selo selo-info">lendo ${arquivos.length - nLendo + 1} de ${arquivos.length}…</span>` : ''}<span class="pdf-resumo-acoes">${nErro && !nLendo ? '<button type="button" class="btn btn-sec btn-peq" data-pdf-limpar="erro">Remover os com erro</button>' : ''}${!nLendo ? '<button type="button" class="btn btn-sec btn-peq" data-pdf-limpar="todos">Limpar lista</button>' : ''}</span>` : '';
    q<HTMLElement>('.pdf-lista').innerHTML = arquivos.map(cartao).join('');
    const btn = q<HTMLButtonElement>('[data-imp="confirmar"]');
    const prev = q<HTMLElement>('.imp-previa');
    const lista = prontos();
    if (!lista.length || arquivos.some((a) => a.estado === 'lendo')) { prev.innerHTML = ''; btn.disabled = true; btn.textContent = 'Importar'; return; }
    const r = importarOSPdf(estado.ds, lista, opcoes(), novoId, false, hojeISO());
    btn.disabled = r.erros.length > 0;
    btn.textContent = r.erros.length ? 'Importar' : `Importar ${r.acoes.length} OS · ${fmtHa(r.total, 2)}`;
    prev.innerHTML = `${r.erros.length ? aviso('critico', `<b>Corrija antes de importar:</b><ul>${r.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${r.avisos.length ? aviso('atencao', `<ul>${r.avisos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${r.acoes.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Seq.</th><th>Fazenda</th><th>OS</th><th class="dir">Área</th><th>O que acontece</th></tr></thead><tbody>${r.acoes.map((a) => `<tr><td>${a.seq}</td><td>${esc(a.fazenda)}</td><td>${esc(a.os)}</td><td class="dir">${esc(fmtNum(a.area, 2))}</td><td>${esc(a.acao)}</td></tr>`).join('')}</tbody><tfoot><tr><td></td><td>Total</td><td></td><td class="dir">${esc(fmtNum(r.total, 2))}</td><td></td></tr></tfoot></table></div>` : ''}`;
  };
  const ler = async (files: FileList | File[]) => {
    const novos = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!novos.length) { toast('Selecione arquivos PDF.', 'erro'); return; }
    const itens = novos.map((f) => { const a: ArquivoPdf = { nome: f.name, estado: 'lendo', linhas: [], paginas: 0, dados: null }; arquivos.push(a); return { f, a }; });
    atualizar();
    let motor: Awaited<ReturnType<typeof carregarMotorPdf>>;
    try { motor = await carregarMotorPdf(); } catch (e) { itens.forEach(({ a }) => { a.estado = 'erro'; a.msg = (e as Error).message; }); atualizar(); return; }
    for (const { f, a } of itens) {
      try {
        const r = await motor.extrair(await f.arrayBuffer());
        a.linhas = r.linhas; a.caixas = r.caixas; a.paginas = r.paginas;
        a.dados = lerOSdoPdf(r.linhas, f.name, r.caracteres < 20, r.caixas);
        a.estado = 'ok';
      } catch (e) { a.estado = 'erro'; a.msg = `Não foi possível ler o PDF (${(e as Error).message}).`; }
      atualizar();
    }
  };
  q<HTMLInputElement>('[data-imp="arquivos"]').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; if (el.files?.length) void ler(el.files); el.value = ''; });
  const zona = q<HTMLElement>('.pdf-zona');
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('sobre'); if (e.dataTransfer?.files.length) void ler(e.dataTransfer.files); });
  raiz.addEventListener('change', (e) => { if ((e.target as HTMLElement).dataset.imp !== 'arquivos') atualizar(); });
  raiz.addEventListener('input', (e) => { const k = (e.target as HTMLElement).dataset.imp; if (k === 'nome' || k === 'taxa') atualizar(); });
  raiz.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const limp = t.closest('[data-pdf-limpar]') as HTMLElement | null;
    if (limp) { for (let i = arquivos.length - 1; i >= 0; i--) if (limp.dataset.pdfLimpar === 'todos' || arquivos[i].estado === 'erro' || arquivos[i].dados?.erros.length) arquivos.splice(i, 1); atualizar(); return; }
    const rem = t.closest('[data-pdf-rem]') as HTMLElement | null;
    if (rem) { arquivos.splice(Number(rem.dataset.pdfRem), 1); atualizar(); return; }
    const rel = t.closest('[data-pdf-reler]') as HTMLElement | null;
    if (rel) {
      const i = Number(rel.dataset.pdfReler); const a = arquivos[i];
      const novo = (q<HTMLTextAreaElement>(`[data-pdf-txt="${i}"]`).value).split('\n');
      if (novo.join('\n') !== a.linhas.join('\n')) a.caixas = undefined; // texto editado: posições deixam de valer
      a.linhas = novo;
      a.dados = lerOSdoPdf(a.linhas, a.nome, false, a.caixas); a.estado = 'ok'; atualizar(); return;
    }
    const b = t.closest('[data-imp]') as HTMLElement | null;
    if (!b) return;
    if (b.dataset.imp === 'aba-tabela') { m.fechar(); abrirImportarSequencia(q<HTMLSelectElement>('[data-imp="campanha"]').value || campanhaPadrao); return; }
    if (b.dataset.imp === 'confirmar') {
      let res: ReturnType<typeof importarOSPdf> | null = null;
      const erro = alterar((d) => { res = importarOSPdf(d, prontos(), opcoes(), novoId, true, hojeISO()); return res.erros[0] ?? null; });
      if (erro) { toast(erro, 'erro'); return; }
      const r = res! as ReturnType<typeof importarOSPdf>;
      campanhaId = r.campanhaId;
      try { localStorage.setItem(CHAVE, JSON.stringify({ campanhaId })); } catch { /* opcional */ }
      m.fechar();
      toast(`PDF importado: ${r.acoes.length} OS · ${fmtHa(r.total, 2)}.`, 'ok');
      if (location.hash !== '#/relatorios/sequencia') location.hash = '#/relatorios/sequencia'; else redesenhar();
    }
  });
  atualizar();
}

// ---------------- Importar talhões ----------------
export function abrirImportarTalhoes() {
  let leitura = lerTalhoes('');
  const m = abrirModal('Importar talhões (colar do Excel)', `
    <p class="muted">Colunas: <b>FN (ou Fazenda) · Talhão · Área</b>. Talhões existentes têm a área atualizada; novos são criados. Se a fazenda tinha um <b>talhão geral</b> vindo da sequência e a soma dos talhões bate com a área programada (±1 ha), a OS passa a usar os talhões reais.</p>
    <textarea class="campo-obs imp-texto" rows="8" placeholder="FN;Talhão;Área&#10;064;001;12,5&#10;064;002;17,5"></textarea>
    <div class="form-grade">${seletorUnidade('imp', '', 'Unidade / empresa das fazendas novas (opcional)')}</div>
    <div class="imp-previa"></div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-imp="confirmar" disabled>Importar</button>' });
  const q = <T extends HTMLElement>(s: string) => m.el.querySelector(s) as T;
  ligarSeletorUnidade(m.el, () => atualizar());
  const atualizar = () => {
    leitura = lerTalhoes(q<HTMLTextAreaElement>('.imp-texto').value);
    const btn = q<HTMLButtonElement>('[data-imp="confirmar"]');
    if (!leitura.linhas.length) { q<HTMLElement>('.imp-previa').innerHTML = ''; btn.disabled = true; return; }
    const r = importarTalhoes(estado.ds, leitura.linhas, lerUnidade(m.el, 'imp'), novoId, false);
    btn.disabled = r.erros.length > 0;
    btn.textContent = `Importar ${leitura.linhas.length} talhão(ões)`;
    q<HTMLElement>('.imp-previa').innerHTML = `
      ${r.erros.length ? aviso('critico', `<ul>${r.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      ${r.avisos.length ? aviso('atencao', `<ul>${r.avisos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : ''}
      <div class="chips-info"><span>Novos <b>${r.criados}</b></span><span>Área atualizada <b>${r.atualizados}</b></span><span>OS que passam a usar talhões reais <b>${r.osAjustadas}</b></span><span>Soma <b>${esc(fmtHa(round(leitura.linhas.reduce((s, l) => s + (l.area ?? 0), 0), 2), 2))}</b></span></div>`;
  };
  q<HTMLTextAreaElement>('.imp-texto').addEventListener('input', atualizar);
  m.el.addEventListener('change', atualizar);
  q<HTMLButtonElement>('[data-imp="confirmar"]').addEventListener('click', () => {
    const erro = alterar((d) => { const r = importarTalhoes(d, leitura.linhas, lerUnidade(m.el, 'imp'), novoId, true); return r.erros[0] ?? null; });
    if (erro) { toast(erro, 'erro'); return; }
    m.fechar();
    toast('Talhões importados.', 'ok');
    redesenhar();
  });
}
