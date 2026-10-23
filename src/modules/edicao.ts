/**
 * Edição dos cadastros (Fase 2): criar, editar, excluir ou inativar — sempre com auditoria.
 * Exclusão só é permitida quando o registro não é usado em nenhum outro lugar; caso contrário, inativar.
 */
import { normalizar, referencias, registrar, resolverUnidade } from '../domain/base';
import type { Calda, ClasseProduto, Dataset, EntidadeAuditada, FuncaoColaborador, StatusAeronave, TipoCampanha, UnidadeDose } from '../domain/types';
import { novoId } from '../data/repository';
import { alterar, estado, nome, redesenhar } from '../state';
import { confirmar, esc, fmtNum, hojeISO, toast } from '../ui/dom';
import { aplicacoes, aplicadoPorItem, areaPlanejadaOS, chaveItem, quantidadeTotal, round } from '../domain/calc';
import { abrirLancarAplicado } from './lancarAplicado';
import { acharProduto, classePorTipo, codificarNovo, decodificarNovo, gravarTalhoesOS, lerTalhoes, lerTratamento, limparGeraisSemUso, numeroBR, resolverProdutosNovos, type LeituraTratamento, type LinhaTalhaoOS, type ProdutoNovo } from '../domain/importacao';
import { abrirFormulario, type Valores } from '../ui/form';
import { icone } from '../ui/icons';

const opts = <T extends { id: string }>(xs: T[], rot: (x: T) => string, vazio = 'Selecione…'): [string, string][] => [['', vazio], ...xs.map((x) => [x.id, rot(x)] as [string, string])];
const s = (v: Valores[string]) => String(v ?? '').trim();
const n = (v: Valores[string]) => (typeof v === 'number' ? v : Number(v));
const fim = (msg: string) => { toast(msg, 'ok'); redesenhar(); };
const duplicado = (lista: { id: string }[], id: string | undefined, pred: (x: never) => boolean) => lista.some((x) => x.id !== id && pred(x as never));

/** Salva uma entidade (criar ou editar) com auditoria. */
function gravar<T extends { id: string }>(colecao: (ds: Dataset) => T[], entidade: EntidadeAuditada, id: string | undefined, montar: (atual: T | undefined) => T, resumo: (x: T) => string, verificar?: (ds: Dataset, x: T) => string | null): string | null {
  return alterar((ds) => {
    const lista = colecao(ds);
    const atual = id ? lista.find((x) => x.id === id) : undefined;
    const novo = montar(atual ? JSON.parse(JSON.stringify(atual)) : undefined);
    const erro = verificar?.(ds, novo);
    if (erro) return erro;
    if (atual) lista.splice(lista.indexOf(atual), 1, novo); else lista.push(novo);
    registrar(ds, { entidade, entidadeId: novo.id, acao: atual ? 'editar' : 'criar', resumo: `${atual ? 'Editado' : 'Criado'}: ${resumo(novo)}`, antes: atual, depois: novo });
    return null;
  });
}

/** Exclui se não houver vínculos; senão oferece inativar (quando a entidade permite). */
export async function excluir(entidade: EntidadeAuditada, id: string, rotulo: string, inativar?: (ds: Dataset) => void) {
  const refs = referencias(estado.ds, entidade, id);
  if (refs.length) {
    if (!inativar) { toast(`Não é possível excluir "${rotulo}": usado em ${refs.join(', ')}.`, 'erro'); return; }
    if (!(await confirmar('Registro em uso', `"${rotulo}" é usado em ${refs.join(', ')} e não pode ser excluído sem quebrar o histórico. Deseja INATIVAR (some das listas de seleção, mas o histórico é mantido)?`, 'Inativar'))) return;
    const erro = alterar((ds) => { inativar(ds); registrar(ds, { entidade, entidadeId: id, acao: 'inativar', resumo: `Inativado: ${rotulo}` }); });
    if (erro) toast(erro, 'erro'); else fim(`"${rotulo}" inativado.`);
    return;
  }
  if (!(await confirmar('Excluir registro', `Excluir "${rotulo}"? A ação fica registrada no histórico de auditoria.`, 'Excluir'))) return;
  const erro = alterar((ds) => {
    const mapa: Record<string, { id: string }[]> = { unidade: ds.unidades, fazenda: ds.fazendas, talhao: ds.talhoes, campanha: ds.campanhas, ordem: ds.ordens, aeronave: ds.aeronaves, colaborador: ds.colaboradores, turno: ds.turnos, produto: ds.produtos };
    const lista = mapa[entidade];
    const i = lista.findIndex((x) => x.id === id);
    if (i < 0) return 'Registro não encontrado.';
    const antes = lista[i];
    lista.splice(i, 1);
    registrar(ds, { entidade, entidadeId: id, acao: 'excluir', resumo: `Excluído: ${rotulo}`, antes });
    return null;
  });
  if (erro) toast(erro, 'erro'); else fim(`"${rotulo}" excluído.`);
}

// ---------------- Unidade ----------------
export function editarUnidade(id?: string) {
  const u = estado.ds.unidades.find((x) => x.id === id);
  abrirFormulario({
    titulo: u ? `Editar unidade / empresa · ${u.nome}` : 'Nova unidade / empresa',
    campos: [{ k: 'nome', rot: 'Nome da unidade ou empresa', obrig: true }, { k: 'codigo', rot: 'Código (opcional)' }, { k: 'municipio', rot: 'Município (opcional)' }],
    valores: { nome: u?.nome ?? '', codigo: u?.codigo ?? '', municipio: u?.municipio ?? '' },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.unidades, 'unidade', id, (a) => ({ id: a?.id ?? novoId('un'), nome: s(v.nome), codigo: s(v.codigo), municipio: s(v.municipio) }), (x) => x.nome,
        (ds, x) => (duplicado(ds.unidades, x.id, (y: { nome: string }) => normalizar(y.nome) === normalizar(x.nome)) ? 'Já existe unidade/empresa com este nome.' : x.codigo && duplicado(ds.unidades, x.id, (y: { codigo: string }) => y.codigo.toLowerCase() === x.codigo.toLowerCase()) ? 'Já existe unidade com este código.' : null));
      if (!e) fim('Unidade / empresa salva.');
      return e;
    },
  });
}

// ---------------- Fazenda ----------------
export function editarFazenda(id?: string) {
  const f = estado.ds.fazendas.find((x) => x.id === id);
  abrirFormulario({
    titulo: f ? `Editar fazenda · ${f.nome}` : 'Nova fazenda',
    campos: [
      { k: 'codigo', rot: 'Nº da fazenda (FN)', dica: 'Usado para casar com as tabelas importadas' },
      { k: 'nome', rot: 'Nome', obrig: true },
      { k: 'unidadeId', rot: 'Unidade / empresa (opcional)', tipo: 'select', opcoes: [...opts(estado.ds.unidades, (x) => x.nome, 'Sem unidade'), ['__nova', '+ Nova unidade / empresa…']] },
      { k: 'novaUnidade', rot: 'Nome da nova unidade / empresa' },
      { k: 'municipio', rot: 'Município' },
      ...(estado.ds.estacoes?.length ? [{ k: 'estacaoId', rot: 'Estação meteorológica de referência', tipo: 'select' as const, opcoes: opts([...estado.ds.estacoes].sort((a, b) => Number(a.pic || 999) - Number(b.pic || 999)), (x) => x.nome, 'Sem estação') }] : []),
    ],
    valores: { codigo: f?.codigo ?? '', nome: f?.nome ?? '', unidadeId: f ? f.unidadeId : estado.ds.unidades.length === 1 ? estado.ds.unidades[0].id : '', novaUnidade: '', municipio: f?.municipio ?? '', estacaoId: f?.estacaoId ?? '' },
    aoMontar: (corpo) => {
      const sel = corpo.querySelector('[name="unidadeId"]') as HTMLSelectElement;
      const campoNova = (corpo.querySelector('[name="novaUnidade"]') as HTMLInputElement).closest('.campo') as HTMLElement;
      const ver = () => { campoNova.style.display = sel.value === '__nova' ? '' : 'none'; };
      sel.addEventListener('change', () => { ver(); if (sel.value === '__nova') (corpo.querySelector('[name="novaUnidade"]') as HTMLInputElement).focus(); }); ver();
    },
    validar: (v) => (s(v.unidadeId) === '__nova' && !s(v.novaUnidade) ? ['Informe o nome da nova unidade / empresa.'] : []),
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.fazendas, 'fazenda', id, (a) => ({ id: a?.id ?? novoId('fz'), codigo: s(v.codigo).replace(/^0+(?=\d)/, ''), nome: s(v.nome), unidadeId: s(v.unidadeId), municipio: s(v.municipio), ...(estado.ds.estacoes?.length ? (s(v.estacaoId) ? { estacaoId: s(v.estacaoId) } : {}) : a?.estacaoId ? { estacaoId: a.estacaoId } : {}) }), (x) => `${x.codigo} ${x.nome}`,
        (ds, x) => {
          if (x.codigo && duplicado(ds.fazendas, x.id, (y: { codigo: string }) => y.codigo === x.codigo)) return `Já existe fazenda com FN ${x.codigo}.`;
          x.unidadeId = resolverUnidade(ds, x.unidadeId === '__nova' ? `nova:${s(v.novaUnidade)}` : x.unidadeId, novoId);
          // mudar a unidade de uma fazenda leva junto as OS dela (mantém consistência dos filtros)
          ds.ordens.filter((o) => o.fazendaId === x.id).forEach((o) => { o.unidadeId = x.unidadeId; });
          return null;
        });
      if (!e) fim('Fazenda salva.');
      return e;
    },
  });
}

// ---------------- Talhão ----------------
export function editarTalhao(id?: string, fazendaId?: string) {
  const t = estado.ds.talhoes.find((x) => x.id === id);
  abrirFormulario({
    titulo: t ? `Editar talhão ${t.codigo} · ${nome.fazenda(t.fazendaId)}` : 'Novo talhão',
    campos: [
      { k: 'fazendaId', rot: 'Fazenda', tipo: 'select', obrig: true, opcoes: opts(estado.ds.fazendas, (x) => `${x.codigo} · ${x.nome}`) },
      { k: 'codigo', rot: 'Código do talhão', obrig: true },
      { k: 'areaHa', rot: 'Área', tipo: 'numero', unidade: 'ha', obrig: true, min: 0.01 },
    ],
    valores: { fazendaId: t?.fazendaId ?? fazendaId ?? '', codigo: t?.codigo ?? '', areaHa: t?.areaHa ?? null },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.talhoes, 'talhao', id, (a) => ({ ...(a ?? {}), id: a?.id ?? novoId('tl'), fazendaId: s(v.fazendaId), codigo: s(v.codigo).padStart(3, '0'), areaHa: n(v.areaHa), geral: a?.geral && s(v.codigo).toUpperCase() === 'GERAL' ? true : undefined }), (x) => `${nome.fazenda(x.fazendaId)} talhão ${x.codigo}`,
        (ds, x) => (duplicado(ds.talhoes, x.id, (y: { fazendaId: string; codigo: string }) => y.fazendaId === x.fazendaId && y.codigo === x.codigo) ? 'Já existe talhão com este código nesta fazenda.' : null));
      if (!e) fim('Talhão salvo.');
      return e;
    },
  });
}

// ---------------- Editor de calda / tratamento (campanha e OS) ----------------
const UNIDADES: UnidadeDose[] = ['L/ha', 'mL/ha', 'kg/ha', 'g/ha'];
const br = (x: number, d = 4) => fmtNum(x, d);
function opcoesProduto(sel: string, extra?: ProdutoNovo) {
  const ps = estado.ds.produtos.slice().sort((a, b) => a.nome.localeCompare(b.nome));
  const existe = extra ? acharProduto(estado.ds, extra.nome, extra.codigo) : null;
  const novoOpt = extra ? `<option value="${esc(codificarNovo(extra))}" selected>${existe ? '' : '+ '}${esc(extra.nome)}${extra.codigo ? ` · ${esc(extra.codigo)}` : ''} (${existe ? 'completa o código' : 'novo'})</option>` : '';
  return `<option value="">Produto…</option>${novoOpt}${ps.map((x) => `<option value="${esc(x.id)}" ${sel === x.id ? 'selected' : ''}>${esc(x.nome)}${x.codigo ? ` · ${esc(x.codigo)}` : ''}</option>`).join('')}<option value="__criar">+ Cadastrar outro produto…</option>`;
}
function linhaCalda(p?: { produtoId: string; dosePlanejada: number; unidade: UnidadeDose; lote?: string }, novo?: ProdutoNovo) {
  return `<div class="calda-linha">
    <select data-extra="produtoId" aria-label="Produto">${opcoesProduto(p?.produtoId ?? '', novo)}</select>
    <div class="com-unidade"><input data-extra="dose" inputmode="decimal" placeholder="Dose" aria-label="Dose" value="${esc(p ? br(p.dosePlanejada) : '')}"><select data-extra="unidade" aria-label="Unidade da dose">${UNIDADES.map((u) => `<option ${p?.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    <input data-extra="lote" placeholder="Lote (opcional)" aria-label="Lote" value="${esc(p?.lote ?? '')}">
    <button type="button" class="btn-icone perigo" data-rem-calda aria-label="Remover">${icone('lixo', 15)}</button></div>`;
}
function caldaHTML(c: Calda | undefined) {
  return `<h3 class="sec-tit">${icone('produto', 16)} Tratamento (conjunto de produtos)</h3>
    <div class="form-grade">
      <label class="campo"><span>Nome do tratamento</span><input data-extra="tratamento" placeholder="Ex.: Tratamento 1" value="${esc(c?.tratamento ?? '')}"></label>
      <label class="campo"><span>Taxa de aplicação</span><div class="com-unidade"><input data-extra="volume" inputmode="decimal" value="${esc(c ? String(c.volumeLHa).replace('.', ',') : '')}"><span>L/ha</span></div><small>Volume de calda por hectare (L/ha) — não é dose</small></label>
    </div>
    <div class="calda-acoes"><button type="button" class="btn btn-sec btn-peq" data-colar-trat>${icone('camadas', 14)} Colar tabela do tratamento</button><button type="button" class="btn btn-sec btn-peq" data-add-calda>${icone('mais', 14)} Produto</button></div>
    <div class="colar-trat" data-colar-box hidden>
      <label class="campo"><span>Cole aqui a tabela da OS (tratamento e/ou resumo de insumos)</span><textarea data-colar-txt rows="7" placeholder="TRATAMENTO 1 - 64,4500 HA&#10;AUREO   0,0200 L/ha   1,2890 L&#10;...&#10;CODIGO  RESUMO DE INSUMOS  TOTAL&#10;21162   AUREO   1,2890 L"></textarea></label>
      <div data-colar-prev></div>
      <div class="calda-acoes"><button type="button" class="btn btn-pri btn-peq" data-colar-usar disabled>Usar estes produtos</button><button type="button" class="btn btn-sec btn-peq" data-colar-fechar>Cancelar</button></div>
    </div>
    <div class="colar-trat" data-novo-box hidden>
      <div class="form-grade"><label class="campo"><span>Nome do produto (como aparece na OS)</span><input data-novo-nome></label><label class="campo"><span>Código do insumo (opcional)</span><input data-novo-cod inputmode="numeric"></label></div>
      <div class="calda-acoes"><button type="button" class="btn btn-pri btn-peq" data-novo-ok>Usar na linha</button><button type="button" class="btn btn-sec btn-peq" data-novo-fechar>Cancelar</button></div>
    </div>
    <div class="calda-lista">${(c?.produtos ?? []).map((p) => linhaCalda(p)).join('')}</div>
    <div class="calda-resumo" data-calda-resumo></div>`;
}
/** area(): área de referência para o resumo de insumos (OS: talhões marcados; campanha: área programada). */
function montarCalda(corpo: HTMLElement, area: () => number, tipo: () => TipoCampanha | undefined) {
  const lista = corpo.querySelector('.calda-lista') as HTMLElement;
  const box = corpo.querySelector('[data-colar-box]') as HTMLElement;
  const txt = corpo.querySelector('[data-colar-txt]') as HTMLTextAreaElement;
  const prev = corpo.querySelector('[data-colar-prev]') as HTMLElement;
  const usar = corpo.querySelector('[data-colar-usar]') as HTMLButtonElement;
  const novoBox = corpo.querySelector('[data-novo-box]') as HTMLElement;
  let leitura: LeituraTratamento | null = null;
  let linhaNova: HTMLElement | null = null;

  const atualizarResumo = () => {
    const alvo = corpo.querySelector('[data-calda-resumo]') as HTMLElement;
    const a = area();
    const linhas = [...lista.querySelectorAll('.calda-linha')].map((l) => {
      const sel = l.querySelector('[data-extra="produtoId"]') as HTMLSelectElement;
      const dose = numeroBR((l.querySelector('[data-extra="dose"]') as HTMLInputElement).value) ?? 0;
      const un = (l.querySelector('[data-extra="unidade"]') as HTMLSelectElement).value as UnidadeDose;
      const novo = decodificarNovo(sel.value);
      const p = estado.ds.produtos.find((x) => x.id === sel.value);
      const q = quantidadeTotal(dose, un, a);
      return { codigo: novo?.codigo ?? p?.codigo ?? '', nome: novo?.nome ?? p?.nome ?? '', dose, un, q };
    }).filter((x) => x.nome);
    if (!linhas.length) { alvo.innerHTML = ''; return; }
    alvo.innerHTML = `<table class="tab-trat"><thead><tr><th>Código</th><th>Resumo de insumos</th><th class="num">Dose</th><th class="num">Total</th></tr></thead><tbody>${linhas.map((x) => `<tr><td>${esc(x.codigo || '—')}</td><td>${esc(x.nome)}</td><td class="num">${esc(br(x.dose))} ${esc(x.un)}</td><td class="num">${x.q && a > 0 ? `${esc(br(x.q.valor))} ${x.q.unidade}` : '—'}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">Área de referência</td><td class="num">${a > 0 ? `${esc(fmtNum(a, 2))} ha` : '—'}</td></tr></tfoot></table>`;
  };

  const lerColado = () => {
    leitura = txt.value.trim() ? lerTratamento(txt.value) : null;
    usar.disabled = !leitura?.itens.length;
    if (!leitura) { prev.innerHTML = ''; return; }
    const ds = estado.ds;
    prev.innerHTML = `${leitura.nome || leitura.areaHa ? `<p class="dica-txt"><b>${esc(leitura.nome || 'Tratamento')}</b>${leitura.areaHa ? ` · ${esc(fmtNum(leitura.areaHa, 4))} ha` : ''}</p>` : ''}
      ${leitura.itens.length ? `<table class="tab-trat"><thead><tr><th>Código</th><th>Produto</th><th class="num">Dose</th><th class="num">Total</th><th>Cadastro</th></tr></thead><tbody>${leitura.itens.map((i) => `<tr><td>${esc(i.codigo || '—')}</td><td>${esc(i.produto)}</td><td class="num">${esc(br(i.dose))} ${esc(i.unidade)}</td><td class="num">${i.total === null ? '—' : esc(br(i.total))} ${i.conferido === false ? '<span class="selo selo-critico">não confere</span>' : i.conferido ? '<span class="selo selo-ok">confere</span>' : ''}</td><td>${acharProduto(ds, i.produto, i.codigo) ? 'já cadastrado' + (i.codigo && !ds.produtos.find((x) => x.id === acharProduto(ds, i.produto, i.codigo))!.codigo ? ' (recebe o código)' : '') : `<b>será criado</b> (${esc(classePorTipo(tipo()))})`}</td></tr>`).join('')}</tbody></table>` : ''}
      ${leitura.avisos.map((a) => `<div class="aviso aviso-atencao">${icone('alerta', 16)}<div>${esc(a)}</div></div>`).join('')}`;
  };

  const aplicarLeitura = () => {
    if (!leitura?.itens.length) return;
    const ds = estado.ds;
    lista.innerHTML = leitura.itens.map((i) => {
      const id = acharProduto(ds, i.produto, i.codigo);
      const semCodigo = id && i.codigo && !ds.produtos.find((x) => x.id === id)!.codigo;
      return id && !semCodigo ? linhaCalda({ produtoId: id, dosePlanejada: i.dose, unidade: i.unidade }) : linhaCalda(undefined, { nome: i.produto, codigo: i.codigo, unidade: i.unidade });
    }).join('');
    // linhas de produto novo: preencher dose/unidade
    [...lista.querySelectorAll('.calda-linha')].forEach((l, k) => {
      const i = leitura!.itens[k];
      (l.querySelector('[data-extra="dose"]') as HTMLInputElement).value = br(i.dose);
      (l.querySelector('[data-extra="unidade"]') as HTMLSelectElement).value = i.unidade;
    });
    const nomeT = corpo.querySelector('[data-extra="tratamento"]') as HTMLInputElement;
    if (leitura.nome && !nomeT.value.trim()) nomeT.value = leitura.nome;
    box.hidden = true; txt.value = ''; prev.innerHTML = ''; leitura = null; usar.disabled = true;
    atualizarResumo();
  };

  corpo.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-add-calda]')) { lista.insertAdjacentHTML('beforeend', linhaCalda()); atualizarResumo(); }
    const r = t.closest('[data-rem-calda]'); if (r) { r.closest('.calda-linha')!.remove(); atualizarResumo(); }
    if (t.closest('[data-colar-trat]')) { box.hidden = false; txt.focus(); }
    if (t.closest('[data-colar-fechar]')) { box.hidden = true; }
    if (t.closest('[data-colar-usar]')) aplicarLeitura();
    if (t.closest('[data-novo-fechar]')) { novoBox.hidden = true; linhaNova = null; }
    if (t.closest('[data-novo-ok]') && linhaNova) {
      const nomeI = novoBox.querySelector('[data-novo-nome]') as HTMLInputElement, codI = novoBox.querySelector('[data-novo-cod]') as HTMLInputElement;
      const nomeP = nomeI.value.trim(), codigo = codI.value.trim();
      if (!nomeP) { nomeI.focus(); return; }
      const sel = linhaNova.querySelector('[data-extra="produtoId"]') as HTMLSelectElement;
      const un = (linhaNova.querySelector('[data-extra="unidade"]') as HTMLSelectElement).value as UnidadeDose;
      const existente = acharProduto(estado.ds, nomeP, codigo);
      const completar = existente && codigo && !estado.ds.produtos.find((x) => x.id === existente)!.codigo;
      sel.innerHTML = existente && !completar ? opcoesProduto(existente) : opcoesProduto('', { nome: nomeP, codigo, unidade: un });
      nomeI.value = ''; codI.value = ''; novoBox.hidden = true; linhaNova = null;
      atualizarResumo();
    }
  });
  txt.addEventListener('input', lerColado);
  corpo.addEventListener('input', (e) => { if ((e.target as HTMLElement).closest('.calda-lista, [data-talhoes]')) atualizarResumo(); });
  corpo.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.closest('[data-talhoes]')) { atualizarResumo(); return; }
    if (el.dataset.extra !== 'produtoId') return;
    const linha = el.closest('.calda-linha')!;
    if (el.value === '__criar') {
      linhaNova = linha as HTMLElement; el.value = '';
      novoBox.hidden = false; (novoBox.querySelector('[data-novo-nome]') as HTMLInputElement).focus();
      return;
    }
    const p = estado.ds.produtos.find((x) => x.id === el.value);
    const u = linha.querySelector('[data-extra="unidade"]') as HTMLSelectElement;
    if (p) u.value = p.unidadeDose;
    atualizarResumo();
  });
  atualizarResumo();
}
function lerCalda(corpo: HTMLElement): { calda: Calda; erros: string[] } {
  const erros: string[] = [];
  const vol = numeroBR((corpo.querySelector('[data-extra="volume"]') as HTMLInputElement).value) ?? NaN;
  const tratamento = (corpo.querySelector('[data-extra="tratamento"]') as HTMLInputElement).value.trim();
  const produtos = [...corpo.querySelectorAll('.calda-lista .calda-linha')].map((l) => {
    const g = (k: string) => (l.querySelector(`[data-extra="${k}"]`) as HTMLInputElement).value.trim();
    return { produtoId: g('produtoId'), dosePlanejada: numeroBR(g('dose')) ?? NaN, doseReal: null, unidade: g('unidade') as UnidadeDose, lote: g('lote') || undefined };
  });
  if (!(vol > 0)) erros.push('Taxa de aplicação (L/ha): informe um valor maior que zero.');
  produtos.forEach((p, i) => { if (!p.produtoId || p.produtoId === '__criar') erros.push(`Produto ${i + 1}: selecione o produto.`); if (!(p.dosePlanejada > 0)) erros.push(`Produto ${i + 1}: dose maior que zero.`); });
  const chaves = produtos.map((p) => { const nv = decodificarNovo(p.produtoId); return nv ? `n:${nv.nome.toLowerCase()}` : p.produtoId; }).filter(Boolean);
  if (new Set(chaves).size !== chaves.length) erros.push('O mesmo produto aparece duas vezes no tratamento.');
  if (!produtos.length) erros.push('Inclua ao menos um produto no tratamento.');
  return { calda: { tratamento: tratamento || undefined, volumeLHa: vol, produtos }, erros };
}
/** Cria (dentro da gravação) os produtos novos escolhidos na calda. */
function criarNovos(ds: Dataset, calda: Calda, tipo: TipoCampanha | undefined): string | null {
  resolverProdutosNovos(ds, calda, classePorTipo(tipo), novoId);
  const ids = calda.produtos.map((p) => p.produtoId);
  return new Set(ids).size !== ids.length ? 'O mesmo produto aparece duas vezes no tratamento.' : null;
}

// ---------------- Campanha ----------------
export function editarCampanha(id?: string) {
  const c = estado.ds.campanhas.find((x) => x.id === id);
  const tipos: TipoCampanha[] = ['Maturador', 'Inseticida', 'Fungicida', 'Herbicida', 'Dessecação', 'Fertilizante foliar'];
  abrirFormulario({
    titulo: c ? `Editar campanha · ${c.nome}` : 'Nova campanha',
    largura: 'lg',
    campos: [
      { k: 'nome', rot: 'Nome', obrig: true }, { k: 'tipo', rot: 'Tipo', tipo: 'select', opcoes: tipos.map((t) => [t, t]) },
      { k: 'cultura', rot: 'Cultura', obrig: true }, { k: 'inicio', rot: 'Início', tipo: 'data', obrig: true }, { k: 'fim', rot: 'Prazo final', tipo: 'data', obrig: true },
      { k: 'aplicarOS', rot: 'Aplicar este tratamento a todas as OS abertas da campanha', tipo: 'check', largo: true, dica: 'OS abertas ainda sem produtos recebem sempre. OS em execução ou concluídas não são alteradas.' },
    ],
    valores: { nome: c?.nome ?? '', tipo: c?.tipo ?? 'Maturador', cultura: c?.cultura ?? 'Cana-de-açúcar', inicio: c?.inicio ?? hojeISO(), fim: c?.fim ?? '', aplicarOS: !c },
    extraHTML: caldaHTML(c?.calda ?? estado.ds.ordens.find((o) => o.campanhaId === id)?.calda),
    aoMontar: (corpo) => montarCalda(corpo, () => (id ? estado.ds.ordens.filter((o) => o.campanhaId === id && o.status !== 'cancelada').reduce((t, o) => t + o.itens.reduce((u, i) => u + i.areaPlanejadaHa, 0), 0) : 0), () => (corpo.querySelector('[name="tipo"]') as HTMLSelectElement).value as TipoCampanha),
    lerExtra: lerCalda,
    validar: (v, ex) => [...(ex as ReturnType<typeof lerCalda>).erros, ...(s(v.fim) && s(v.inicio) && s(v.fim) < s(v.inicio) ? ['O prazo final deve ser depois do início.'] : [])],
    aoSalvar: (v, ex) => {
      const calda = (ex as ReturnType<typeof lerCalda>).calda;
      const e = gravar((ds) => ds.campanhas, 'campanha', id, (a) => ({ id: a?.id ?? novoId('cp'), nome: s(v.nome), tipo: s(v.tipo) as TipoCampanha, cultura: s(v.cultura), inicio: s(v.inicio), fim: s(v.fim), calda }), (x) => x.nome,
        (ds, x) => {
          const dup = criarNovos(ds, x.calda!, x.tipo); if (dup) return dup;
          // OS abertas sem produtos sempre recebem o tratamento; as demais só se marcado
          ds.ordens.filter((o) => o.campanhaId === x.id && o.status === 'aberta' && (v.aplicarOS || !o.calda?.produtos.length)).forEach((o) => { o.calda = JSON.parse(JSON.stringify(x.calda)); });
          return null;
        });
      if (!e) fim('Campanha salva.');
      return e;
    },
  });
}

// ---------------- Ordem de serviço ----------------
export function editarOS(id?: string, campanhaId?: string) {
  const ds = estado.ds;
  const o = ds.ordens.find((x) => x.id === id);
  const temOps = !!o && ds.operacoes.some((op) => op.osId === o.id);
  const br2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '' : fmtNum(x, 2));
  const linhaTal = (r: { tid?: string; zona: string; codigo: string; area: number | null; nao: number; usar: boolean; geral?: boolean; aplicado?: boolean }) => `<tr data-tal-linha ${r.tid ? `data-tid="${esc(r.tid)}"` : ''} class="${r.usar ? '' : 'tal-off'}">
      <td class="centro"><input type="checkbox" data-c="usar" ${r.usar ? 'checked' : ''} ${r.aplicado ? 'data-aplicado="1"' : ''} aria-label="Usar talhão"></td>
      <td><input data-c="zona" value="${esc(r.zona)}" ${r.geral ? 'disabled' : ''} aria-label="Zona"></td>
      <td>${r.tid ? `<b>${esc(r.codigo)}</b>${r.geral ? ' <small class="muted">(geral)</small>' : ''}<input type="hidden" data-c="codigo" value="${esc(r.codigo)}">` : `<input data-c="codigo" value="${esc(r.codigo)}" inputmode="numeric" placeholder="Tn" aria-label="Talhão">`}</td>
      <td><input data-c="area" inputmode="decimal" value="${esc(br2(r.area))}" aria-label="Área do talhão (ha)"></td>
      <td><input data-c="nao" inputmode="decimal" value="${r.nao ? esc(br2(r.nao)) : ''}" placeholder="0,00" aria-label="Área não aplicada (ha)"></td>
      <td class="num"><b data-c="real"></b></td>
      <td>${r.tid ? '' : `<button type="button" class="btn-icone perigo" data-tal-rem aria-label="Remover">${icone('lixo', 14)}</button>`}</td>
    </tr>`;
  const talhoesHTML = (fazendaId: string) => {
    if (!fazendaId) return '<p class="vazio-txt">Escolha a fazenda.</p>';
    const ts = ds.talhoes.filter((t) => t.fazendaId === fazendaId)
      .sort((a, b) => Number(!!b.geral) - Number(!!a.geral) || (a.zona ?? '').localeCompare(b.zona ?? '', 'pt-BR', { numeric: true }) || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    const aplicados = new Set(o ? ds.operacoes.filter((op) => op.osId === o.id).flatMap((op) => op.itens.map((i) => i.talhaoId)) : []);
    const rows = ts.map((t) => {
      const it = o?.fazendaId === fazendaId ? o.itens.find((i) => i.talhaoId === t.id) : undefined;
      const nao = it ? (it.naoAplicadoHa ?? Math.max(0, round(t.areaHa - it.areaPlanejadaHa, 4))) : 0;
      return linhaTal({ tid: t.id, zona: t.zona ?? '', codigo: t.codigo, area: t.areaHa, nao, usar: !!it, geral: t.geral, aplicado: aplicados.has(t.id) });
    }).join('');
    return `<div class="tal-acoes"><button type="button" class="btn btn-sec btn-peq" data-tal-colar>${icone('camadas', 14)} Colar talhões da planilha</button><button type="button" class="btn btn-sec btn-peq" data-tal-add>${icone('mais', 14)} Talhão</button></div>
      <div class="colar-trat" data-tal-box hidden>
        <label class="campo"><span>Cole as linhas (Fazenda · ZONA · Tn · há · ñ aplicado · real) — "ñ aplicado" entra como desconto previsto</span><textarea data-tal-txt rows="6" placeholder="Fazenda&#9;ZONA&#9;Tn&#9;há&#9;ñ aplicado&#9;real&#10;1023&#9;90&#9;19&#9;7,36&#9;&#9;7,36&#10;1023&#9;90&#9;20&#9;12,33&#9;0,53&#9;11,80"></textarea></label>
        <div data-tal-prev></div>
        <div class="calda-acoes"><button type="button" class="btn btn-pri btn-peq" data-tal-usar disabled>Usar estes talhões</button><button type="button" class="btn btn-sec btn-peq" data-tal-fechar>Cancelar</button></div>
      </div>
      <div class="tabela-rolagem"><table class="tab-talhoes"><thead><tr><th class="centro">Usar</th><th>Zona</th><th>Talhão</th><th class="num">Área (ha)</th><th class="num">Desc. previsto</th><th class="num">A aplicar (prev.)</th><th></th></tr></thead>
      <tbody data-tal-corpo>${rows}</tbody>
      <tfoot><tr><td></td><td colspan="2" data-tal-qtd></td><td class="num" data-tal-tarea></td><td class="num" data-tal-tnao></td><td class="num" data-tal-treal></td><td></td></tr></tfoot></table></div>
      <p class="nota">A soma da <b>área</b> (bruta) é o programado da OS. O desconto previsto é só referência: ao <b>concluir</b> a OS, o que faltar aplicar fica registrado como <b>obstáculo</b> (programado − aplicado).</p>`;
  };
  const lerLinhasTal = (corpo: HTMLElement): LinhaTalhaoOS[] => [...corpo.querySelectorAll<HTMLTableRowElement>('[data-tal-linha]')].map((tr) => {
    const g = (c: string) => (tr.querySelector(`[data-c="${c}"]`) as HTMLInputElement).value.trim();
    return { talhaoId: tr.dataset.tid, zona: g('zona'), codigo: g('codigo'), areaHa: numeroBR(g('area')) ?? NaN, naoAplicadoHa: numeroBR(g('nao')) ?? 0, usar: (tr.querySelector('[data-c="usar"]') as HTMLInputElement).checked };
  });
  const montarTalhoes = (corpo: HTMLElement, aoMudar: () => void) => {
    const host = corpo.querySelector('[data-talhoes]') as HTMLElement;
    let leitura: ReturnType<typeof lerTalhoes> | null = null;
    const fzSel = () => ds.fazendas.find((f) => f.id === (corpo.querySelector('[name="fazendaId"]') as HTMLSelectElement).value);
    const daFazenda = (l: { fn: string; fazenda: string }) => { const f = fzSel(); if (!f) return false; return (l.fn && f.codigo && f.codigo.replace(/^0+/, '') === l.fn) || (!!l.fazenda && f.nome.toLowerCase() === l.fazenda.toLowerCase()) || (!l.fn && !l.fazenda); };
    const totais = () => {
      let qtd = 0, area = 0, nao = 0, real = 0;
      host.querySelectorAll<HTMLTableRowElement>('[data-tal-linha]').forEach((tr) => {
        const g = (c: string) => numeroBR((tr.querySelector(`[data-c="${c}"]`) as HTMLInputElement).value);
        const usar = (tr.querySelector('[data-c="usar"]') as HTMLInputElement).checked;
        const a = g('area') ?? 0, na = g('nao') ?? 0, r = a - na;
        (tr.querySelector('[data-c="real"]') as HTMLElement).textContent = a ? br2(r) : '—';
        (tr.querySelector('[data-c="real"]') as HTMLElement).classList.toggle('txt-critico', na > a);
        tr.classList.toggle('tal-off', !usar);
        if (usar) { qtd++; area += a; nao += na; real += r; }
      });
      const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
      if (!q('[data-tal-qtd]')) return;
      q('[data-tal-qtd]')!.innerHTML = `<b>Total</b> · ${qtd} talhão(ões)`;
      q('[data-tal-tarea]')!.textContent = br2(area); q('[data-tal-tnao]')!.textContent = nao ? br2(nao) : '—'; q('[data-tal-treal]')!.innerHTML = `<b>${esc(br2(real))}</b>`;
      aoMudar();
    };
    const prever = () => {
      const txt = (host.querySelector('[data-tal-txt]') as HTMLTextAreaElement).value;
      leitura = txt.trim() ? lerTalhoes(txt) : null;
      const prev = host.querySelector('[data-tal-prev]') as HTMLElement;
      const usar = host.querySelector('[data-tal-usar]') as HTMLButtonElement;
      if (!leitura) { prev.innerHTML = ''; usar.disabled = true; return; }
      const boas = leitura.linhas.filter((l) => !l.erros.length && daFazenda(l));
      const outras = leitura.linhas.filter((l) => !daFazenda(l));
      const ruins = leitura.linhas.filter((l) => l.erros.length && daFazenda(l));
      usar.disabled = !boas.length;
      const tot = boas.reduce((t, l) => ({ a: t.a + (l.area ?? 0), n: t.n + l.naoAplicado, r: t.r + (l.real ?? 0) }), { a: 0, n: 0, r: 0 });
      prev.innerHTML = `${boas.length ? `<table class="tab-trat"><thead><tr><th>Zona</th><th>Talhão</th><th class="num">há</th><th class="num">Ñ aplicado</th><th class="num">Real</th></tr></thead><tbody>${boas.map((l) => `<tr><td>${esc(l.zona || '—')}</td><td>${esc(l.talhao)}</td><td class="num">${esc(br2(l.area))}</td><td class="num">${l.naoAplicado ? esc(br2(l.naoAplicado)) : '—'}</td><td class="num">${esc(br2(l.real))}${l.avisos.length ? ` <span class="selo selo-atencao" title="${esc(l.avisos.join('; '))}">conferir</span>` : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">${boas.length} talhão(ões)</td><td class="num">${esc(br2(tot.a))}</td><td class="num">${tot.n ? esc(br2(tot.n)) : '—'}</td><td class="num">${esc(br2(tot.r))}</td></tr></tfoot></table>` : ''}
        ${outras.length ? `<div class="aviso aviso-atencao">${icone('alerta', 16)}<div>${outras.length} linha(s) de outra fazenda serão ignoradas (${esc([...new Set(outras.map((l) => l.fn || l.fazenda))].join(', '))}).</div></div>` : ''}
        ${ruins.length ? `<div class="aviso aviso-critico">${icone('alerta', 16)}<div>${ruins.map((l) => `Linha ${l.linha}: ${esc(l.erros.join(', '))}`).join('<br>')}</div></div>` : ''}
        ${boas.some((l) => l.avisos.length) ? `<div class="aviso aviso-atencao">${icone('info', 16)}<div>${boas.flatMap((l) => l.avisos.map((a) => `Talhão ${esc(l.talhao)}: ${esc(a)}`)).join('<br>')}</div></div>` : ''}`;
    };
    const usarColados = () => {
      if (!leitura) return;
      const boas = leitura.linhas.filter((l) => !l.erros.length && daFazenda(l));
      const corpoT = host.querySelector('[data-tal-corpo]') as HTMLElement;
      // talhão geral sai quando entram talhões reais
      corpoT.querySelectorAll<HTMLTableRowElement>('[data-tal-linha]').forEach((tr) => { const t = ds.talhoes.find((x) => x.id === tr.dataset.tid); if (t?.geral && !tr.querySelector('[data-aplicado]')) (tr.querySelector('[data-c="usar"]') as HTMLInputElement).checked = false; });
      for (const l of boas) {
        const tr = [...corpoT.querySelectorAll<HTMLTableRowElement>('[data-tal-linha]')].find((x) => { const c = (x.querySelector('[data-c="codigo"]') as HTMLInputElement).value; return c.replace(/^0+/, '').toUpperCase() === l.talhao.replace(/^0+/, '').toUpperCase(); });
        if (tr) {
          (tr.querySelector('[data-c="usar"]') as HTMLInputElement).checked = true;
          (tr.querySelector('[data-c="area"]') as HTMLInputElement).value = br2(l.area);
          (tr.querySelector('[data-c="nao"]') as HTMLInputElement).value = l.naoAplicado ? br2(l.naoAplicado) : '';
          if (l.zona) (tr.querySelector('[data-c="zona"]') as HTMLInputElement).value = l.zona;
        } else corpoT.insertAdjacentHTML('beforeend', linhaTal({ zona: l.zona, codigo: l.talhao, area: l.area, nao: l.naoAplicado, usar: true }));
      }
      (host.querySelector('[data-tal-box]') as HTMLElement).hidden = true;
      (host.querySelector('[data-tal-txt]') as HTMLTextAreaElement).value = ''; leitura = null;
      (host.querySelector('[data-tal-prev]') as HTMLElement).innerHTML = '';
      totais();
    };
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-tal-add]')) { (host.querySelector('[data-tal-corpo]') as HTMLElement).insertAdjacentHTML('beforeend', linhaTal({ zona: '', codigo: '', area: null, nao: 0, usar: true })); totais(); ((host.querySelector('[data-tal-corpo] tr:last-child [data-c="codigo"]') as HTMLInputElement)).focus(); }
      const rem = t.closest('[data-tal-rem]'); if (rem) { rem.closest('tr')!.remove(); totais(); }
      if (t.closest('[data-tal-colar]')) { (host.querySelector('[data-tal-box]') as HTMLElement).hidden = false; (host.querySelector('[data-tal-txt]') as HTMLTextAreaElement).focus(); }
      if (t.closest('[data-tal-fechar]')) (host.querySelector('[data-tal-box]') as HTMLElement).hidden = true;
      if (t.closest('[data-tal-usar]')) usarColados();
    });
    host.addEventListener('input', (e) => { if ((e.target as HTMLElement).dataset.talTxt !== undefined) prever(); else totais(); });
    host.addEventListener('change', totais);
    totais();
    return { redesenhar: (fazendaId: string) => { host.innerHTML = talhoesHTML(fazendaId); totais(); } };
  };
  abrirFormulario({
    titulo: o ? `Editar ${o.numero}` : 'Nova ordem de serviço',
    largura: 'lg',
    campos: [
      { k: 'numero', rot: 'Nº da OS', obrig: true },
      { k: 'campanhaId', rot: 'Campanha', tipo: 'select', obrig: true, opcoes: opts(ds.campanhas, (x) => x.nome) },
      { k: 'fazendaId', rot: 'Fazenda', tipo: 'select', obrig: true, opcoes: opts(ds.fazendas, (x) => `${x.codigo} · ${x.nome}`) },
      { k: 'tipo', rot: 'Tipo de aplicação', tipo: 'select', opcoes: [['Pulverização', 'Pulverização'], ['Aplicação de sólidos', 'Aplicação de sólidos'], ['Semeadura', 'Semeadura']] },
      { k: 'sequencia', rot: 'Sequência', tipo: 'numero', inteiro: true, min: 1 },
      { k: 'titulo', rot: 'Título' },
      { k: 'emissao', rot: 'Emissão', tipo: 'data', obrig: true },
      { k: 'observacoes', rot: 'Observações', tipo: 'textarea', largo: true },
    ],
    valores: { numero: o?.numero ?? '', campanhaId: o?.campanhaId ?? campanhaId ?? '', fazendaId: o?.fazendaId ?? '', tipo: o?.tipo ?? 'Pulverização', sequencia: o?.sequencia ?? null, titulo: o?.titulo ?? '', emissao: o?.emissao ?? hojeISO(), observacoes: o?.observacoes ?? '' },
    extraHTML: `${temOps ? '<div class="aviso aviso-info">' + icone('info', 18) + '<div>Esta OS já tem aplicações: não é possível trocar a fazenda nem remover talhões já aplicados.</div></div>' : ''}<h3 class="sec-tit">${icone('area', 16)} Talhões e área programada</h3><div data-talhoes>${talhoesHTML(o?.fazendaId ?? '')}</div>${caldaHTML(o?.calda ?? ds.campanhas.find((c) => c.id === (o?.campanhaId ?? campanhaId))?.calda)}`,
    aoMontar: (corpo) => {
      const areaMarcada = () => lerLinhasTal(corpo).filter((l) => l.usar).reduce((t, l) => t + (l.areaHa || 0), 0);
      let recalcCalda = () => { /* definido abaixo */ };
      const tal = montarTalhoes(corpo, () => recalcCalda());
      recalcCalda = () => corpo.querySelector('.calda-lista')?.dispatchEvent(new Event('input', { bubbles: true }));
      montarCalda(corpo, areaMarcada, () => ds.campanhas.find((c) => c.id === (corpo.querySelector('[name="campanhaId"]') as HTMLSelectElement).value)?.tipo);
      const fz = corpo.querySelector('[name="fazendaId"]') as HTMLSelectElement;
      if (temOps) fz.disabled = true;
      fz.addEventListener('change', () => tal.redesenhar(fz.value));
      const cp = corpo.querySelector('[name="campanhaId"]') as HTMLSelectElement;
      cp.addEventListener('change', () => {
        const calda = ds.campanhas.find((c) => c.id === cp.value)?.calda;
        if (calda && !o && (corpo.querySelector('.calda-lista') as HTMLElement).children.length === 0) {
          (corpo.querySelector('[data-extra="volume"]') as HTMLInputElement).value = String(calda.volumeLHa).replace('.', ',');
          (corpo.querySelector('[data-extra="tratamento"]') as HTMLInputElement).value = calda.tratamento ?? '';
          (corpo.querySelector('.calda-lista') as HTMLElement).innerHTML = calda.produtos.map((p) => linhaCalda(p)).join('');
        }
      });
    },
    lerExtra: (corpo) => ({ talhoes: lerLinhasTal(corpo), ...lerCalda(corpo) }),
    validar: (v, ex) => {
      const x = ex as { talhoes: LinhaTalhaoOS[]; erros: string[] };
      const e = [...x.erros];
      // validação dos talhões numa cópia (nada é gravado aqui)
      const copia = JSON.parse(JSON.stringify(estado.ds)) as Dataset;
      e.push(...gravarTalhoesOS(copia, temOps && o ? o.fazendaId : s(v.fazendaId), x.talhoes, () => 'tmp').erros);
      if (o && temOps) {
        const aplicados = new Set(ds.operacoes.filter((op) => op.osId === o.id).flatMap((op) => op.itens.map((i) => i.talhaoId)));
        aplicados.forEach((t) => { if (!x.talhoes.some((l) => l.talhaoId === t && l.usar)) e.push(`Talhão ${nome.talhao(t)} já tem aplicação nesta OS e não pode ser desmarcado.`); });
      }
      return [...new Set(e)];
    },
    aoSalvar: (v, ex) => {
      const x = ex as { talhoes: LinhaTalhaoOS[]; calda: Calda };
      const e = gravar((d) => d.ordens, 'ordem', id, (a) => {
        const fazendaId = temOps && a ? a.fazendaId : s(v.fazendaId);
        return {
          ...(a ?? { status: 'aberta' as const }), id: a?.id ?? novoId('os'), numero: s(v.numero), campanhaId: s(v.campanhaId), fazendaId,
          unidadeId: estado.ds.fazendas.find((f) => f.id === fazendaId)?.unidadeId ?? '', tipo: s(v.tipo) as never, sequencia: v.sequencia === null ? undefined : n(v.sequencia),
          titulo: s(v.titulo) || undefined, emissao: s(v.emissao), observacoes: s(v.observacoes) || undefined, itens: [], calda: x.calda,
        };
      }, (y) => `${y.numero} · ${nome.fazenda(y.fazendaId)}`,
      (d, y) => {
        if (duplicado(d.ordens, y.id, (z: { numero: string; campanhaId: string; fazendaId: string; status: string }) => z.numero === y.numero && z.campanhaId === y.campanhaId && z.fazendaId === y.fazendaId && z.status !== 'cancelada')) return 'Já existe esta OS para a mesma fazenda e campanha.';
        const t = gravarTalhoesOS(d, y.fazendaId, x.talhoes, novoId);
        if (t.erros.length) return t.erros[0];
        y.itens = t.itens;
        return criarNovos(d, y.calda!, d.campanhas.find((c) => c.id === y.campanhaId)?.tipo);
      });
      if (!e) {
        // talhão GERAL que deixou de ser usado é removido (fazenda passou a ter talhões reais)
        const fzId = estado.ds.ordens.find((q) => q.numero === s(v.numero) && q.campanhaId === s(v.campanhaId))?.fazendaId ?? s(v.fazendaId);
        if (estado.ds.talhoes.some((t) => t.fazendaId === fzId && t.geral)) alterar((d) => { const k = limparGeraisSemUso(d, fzId); if (k) registrar(d, { entidade: 'talhao', entidadeId: fzId, acao: 'excluir', resumo: `Talhão geral removido de ${nome.fazenda(fzId)} (substituído pelos talhões reais)` }); });
        fim('Ordem de serviço salva.');
      }
      return e;
    },
  });
}

export async function alternarConclusaoOS(id: string) {
  const o = estado.ds.ordens.find((x) => x.id === id);
  if (!o) return;
  const concluir = !o.concluidaManual && o.status !== 'concluida';
  if (concluir) {
    const apl = aplicadoPorItem(aplicacoes(estado.ds));
    const plan = areaPlanejadaOS(o);
    const feito = o.itens.reduce((t, i) => t + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0);
    // com saldo: abre o lançamento do aplicado para dizer quanto foi aplicado e onde ficou o desconto
    if (plan - feito > 0.01) { abrirLancarAplicado(o.id, { concluir: true }); return; }
    if (!(await confirmar('Concluir OS', `${o.numero} · ${nome.fazenda(o.fazendaId)}\n\nÁrea programada aplicada por completo (${fmtNum(feito, 2)} ha). Fica registrado no histórico.`, 'Concluir'))) return;
  } else if (!(await confirmar('Reabrir OS', `Reabrir ${o.numero} · ${nome.fazenda(o.fazendaId)}? O saldo volta a contar como "falta aplicar" e deixa de ser obstáculo.`, 'Reabrir'))) return;
  const erro = alterar((ds) => {
    const x = ds.ordens.find((y) => y.id === id)!;
    const apl = aplicadoPorItem(aplicacoes(ds));
    const feito = x.itens.reduce((t, i) => t + (apl.get(chaveItem(x.id, i.talhaoId)) ?? 0), 0);
    const obst = Math.max(0, areaPlanejadaOS(x) - feito);
    x.concluidaManual = concluir ? true : undefined;
    registrar(ds, { entidade: 'ordem', entidadeId: id, acao: concluir ? 'concluir' : 'reabrir', resumo: concluir ? `Concluída: ${x.numero} · ${nome.fazenda(x.fazendaId)} — aplicado ${fmtNum(feito, 2)} ha, obstáculo ${fmtNum(obst, 2)} ha` : `Reaberta: ${x.numero} · ${nome.fazenda(x.fazendaId)}` });
  });
  if (erro) toast(erro, 'erro'); else fim(concluir ? 'OS concluída.' : 'OS reaberta.');
}

export async function cancelarOS(id: string) {
  const o = estado.ds.ordens.find((x) => x.id === id);
  if (!o) return;
  if (estado.ds.operacoes.some((op) => op.osId === id)) { toast('OS com aplicações não pode ser cancelada. Conclua-a manualmente.', 'erro'); return; }
  if (!(await confirmar('Cancelar OS', `Cancelar ${o.numero}? Ela deixa de contar na área planejada.`, 'Cancelar OS'))) return;
  const erro = alterar((ds) => { const x = ds.ordens.find((y) => y.id === id)!; x.status = 'cancelada'; registrar(ds, { entidade: 'ordem', entidadeId: id, acao: 'inativar', resumo: `Cancelada: ${x.numero}` }); });
  if (erro) toast(erro, 'erro'); else fim('OS cancelada.');
}

// ---------------- Aeronave ----------------
export function editarAeronave(id?: string) {
  const a = estado.ds.aeronaves.find((x) => x.id === id);
  const st: [StatusAeronave, string][] = [['disponivel', 'Disponível'], ['em_operacao', 'Em operação'], ['manutencao', 'Em manutenção'], ['indisponivel', 'Indisponível']];
  abrirFormulario({
    titulo: a ? `Editar aeronave · ${a.identificacao}` : 'Nova aeronave',
    campos: [
      { k: 'identificacao', rot: 'Identificação', obrig: true, dica: 'Ex.: T70 D, DR-01' }, { k: 'modelo', rot: 'Modelo', obrig: true }, { k: 'numeroSerie', rot: 'Nº de série' },
      { k: 'status', rot: 'Status', tipo: 'select', opcoes: st }, { k: 'unidadeId', rot: 'Unidade / empresa (opcional)', tipo: 'select', opcoes: opts(estado.ds.unidades, (x) => x.nome, 'Sem unidade') },
      { k: 'horasAnteriores', rot: 'Horas de voo anteriores', tipo: 'numero', unidade: 'h', min: 0 },
      { k: 'pilotoPadraoId', rot: 'Piloto fixo (opcional)', tipo: 'select', opcoes: opts(estado.ds.colaboradores.filter((c) => c.funcao === 'Piloto' && c.ativo), (x) => x.nome, 'Sem piloto fixo'), dica: 'Vem preenchido no Fechamento do dia' },
    ],
    valores: { identificacao: a?.identificacao ?? '', modelo: a?.modelo ?? 'Agras T70', numeroSerie: a?.numeroSerie ?? '', status: a?.status ?? 'disponivel', unidadeId: a?.unidadeId ?? estado.ds.unidades[0]?.id ?? '', horasAnteriores: a?.horasAnteriores ?? 0, pilotoPadraoId: a?.pilotoPadraoId ?? '' },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.aeronaves, 'aeronave', id, (x) => ({ id: x?.id ?? novoId('ac'), identificacao: s(v.identificacao), modelo: s(v.modelo), numeroSerie: s(v.numeroSerie), status: s(v.status) as StatusAeronave, unidadeId: s(v.unidadeId), horasAnteriores: n(v.horasAnteriores ?? 0) || 0, ...(s(v.pilotoPadraoId) ? { pilotoPadraoId: s(v.pilotoPadraoId) } : {}) }), (x) => x.identificacao,
        (ds, x) => (duplicado(ds.aeronaves, x.id, (y: { identificacao: string }) => y.identificacao.toLowerCase() === x.identificacao.toLowerCase()) ? 'Já existe aeronave com esta identificação.' : null));
      if (!e) fim('Aeronave salva.');
      return e;
    },
  });
}

// ---------------- Colaborador ----------------
export function editarColaborador(id?: string) {
  const c = estado.ds.colaboradores.find((x) => x.id === id);
  const funcoes: FuncaoColaborador[] = ['Piloto', 'Auxiliar de campo', 'Técnico de calda', 'Líder de turno', 'Supervisor'];
  abrirFormulario({
    titulo: c ? `Editar colaborador · ${c.nome}` : 'Novo colaborador',
    campos: [{ k: 'nome', rot: 'Nome', obrig: true }, { k: 'funcao', rot: 'Função', tipo: 'select', opcoes: funcoes.map((f) => [f, f]) }, { k: 'unidadeId', rot: 'Unidade / empresa (opcional)', tipo: 'select', opcoes: opts(estado.ds.unidades, (x) => x.nome, 'Sem unidade') }, { k: 'ativo', rot: 'Ativo', tipo: 'check' }],
    valores: { nome: c?.nome ?? '', funcao: c?.funcao ?? 'Piloto', unidadeId: c?.unidadeId ?? estado.ds.unidades[0]?.id ?? '', ativo: c?.ativo ?? true },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.colaboradores, 'colaborador', id, (x) => ({ id: x?.id ?? novoId('cb'), nome: s(v.nome), funcao: s(v.funcao) as FuncaoColaborador, unidadeId: s(v.unidadeId), ativo: !!v.ativo }), (x) => x.nome);
      if (!e) fim('Colaborador salvo.');
      return e;
    },
  });
}

// ---------------- Turno ----------------
export function editarTurno(id?: string) {
  const t = estado.ds.turnos.find((x) => x.id === id);
  const lideres = estado.ds.colaboradores.filter((c) => c.funcao === 'Líder de turno' || c.funcao === 'Supervisor');
  abrirFormulario({
    titulo: t ? `Editar ${t.nome}` : 'Novo turno',
    campos: [
      { k: 'nome', rot: 'Nome', obrig: true }, { k: 'periodo', rot: 'Período', tipo: 'select', opcoes: [['Noturno', 'Noturno'], ['Diurno', 'Diurno']] },
      { k: 'horaInicio', rot: 'Início', tipo: 'hora', obrig: true }, { k: 'horaFim', rot: 'Fim', tipo: 'hora', obrig: true },
      { k: 'liderId', rot: 'Líder padrão', tipo: 'select', obrig: true, opcoes: opts(lideres, (x) => x.nome), dica: lideres.length ? '' : 'Cadastre um colaborador com função "Líder de turno"' },
      { k: 'ativo', rot: 'Ativo', tipo: 'check' },
    ],
    valores: { nome: t?.nome ?? '', periodo: t?.periodo ?? 'Noturno', horaInicio: t?.horaInicio ?? '17:00', horaFim: t?.horaFim ?? '05:00', liderId: t?.liderId ?? '', ativo: t?.ativo ?? true },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.turnos, 'turno', id, (x) => ({ id: x?.id ?? novoId('tn'), nome: s(v.nome), periodo: s(v.periodo) as 'Diurno' | 'Noturno', horaInicio: s(v.horaInicio), horaFim: s(v.horaFim), liderId: s(v.liderId), ativo: !!v.ativo }), (x) => x.nome);
      if (!e) fim('Turno salvo.');
      return e;
    },
  });
}

// ---------------- Produto ----------------
export function editarProduto(id?: string) {
  const p = estado.ds.produtos.find((x) => x.id === id);
  const classes: ClasseProduto[] = ['Maturador', 'Inseticida', 'Fungicida', 'Herbicida', 'Adjuvante', 'Fertilizante foliar'];
  abrirFormulario({
    titulo: p ? `Editar produto · ${p.nome}` : 'Novo produto',
    campos: [
      { k: 'nome', rot: 'Nome comercial', obrig: true }, { k: 'codigo', rot: 'Código do insumo', dica: 'Coluna CÓDIGO do resumo de insumos da OS' }, { k: 'classe', rot: 'Classe', tipo: 'select', opcoes: classes.map((c) => [c, c]) },
      { k: 'unidadeDose', rot: 'Unidade da dose', tipo: 'select', opcoes: [['L/ha', 'L/ha'], ['mL/ha', 'mL/ha'], ['kg/ha', 'kg/ha'], ['g/ha', 'g/ha']] },
      { k: 'unidadeTotal', rot: 'Unidade de estoque', tipo: 'select', opcoes: [['L', 'L'], ['kg', 'kg']], dica: 'Usada na quantidade total aplicada' },
    ],
    valores: { nome: p?.nome ?? '', codigo: p?.codigo ?? '', classe: p?.classe ?? 'Maturador', unidadeDose: p?.unidadeDose ?? 'L/ha', unidadeTotal: p?.unidadeTotal ?? 'L' },
    validar: (v) => {
      const ud = s(v.unidadeDose), ut = s(v.unidadeTotal);
      return (ud.startsWith('L') || ud.startsWith('mL')) !== (ut === 'L') ? ['Unidade de estoque incompatível com a dose (L/mL → L; kg/g → kg).'] : [];
    },
    aoSalvar: (v) => {
      const e = gravar((ds) => ds.produtos, 'produto', id, (x) => ({ id: x?.id ?? novoId('pr'), nome: s(v.nome), codigo: s(v.codigo) || undefined, classe: s(v.classe) as ClasseProduto, unidadeDose: s(v.unidadeDose) as UnidadeDose, unidadeTotal: s(v.unidadeTotal) as 'L' | 'kg' }), (x) => x.nome,
        (ds, x) => (duplicado(ds.produtos, x.id, (y: { nome: string }) => y.nome.toLowerCase() === x.nome.toLowerCase()) ? 'Já existe produto com este nome.' : x.codigo && duplicado(ds.produtos, x.id, (y: { codigo?: string }) => y.codigo === x.codigo) ? `Já existe produto com o código ${x.codigo}.` : null));
      if (!e) fim('Produto salvo.');
      return e;
    },
  });
}

/** Botões padrão de ação numa linha de tabela. */
export const acoesLinha = (entidade: string, id: string, extra = '') => `<span class="acoes-linha">${extra}<button class="btn-icone" data-editar="${entidade}" data-id="${esc(id)}" aria-label="Editar" title="Editar">${icone('config', 15)}</button><button class="btn-icone perigo" data-excluir="${entidade}" data-id="${esc(id)}" aria-label="Excluir" title="Excluir ou inativar">${icone('lixo', 15)}</button></span>`;
