/**
 * Registro de nova aplicação — formulário em 5 etapas + revisão.
 * Na Fase 1 o registro é gravado apenas no armazenamento local do protótipo (este navegador).
 */
import { aplicacoes, aplicadoPorItem, chaveItem, duracaoTotalMin, formatarDuracao, produtividadeEfetiva, produtividadeOperacional, quantidadeTotal, volumeTotalCalda } from '../domain/calc';
import type { LeituraClima, MomentoClima, Operacao, Parada, UnidadeDose } from '../domain/types';
import { MOTIVOS_PARADA } from '../domain/types';
import {
  avaliarLeitura, CONDICOES_CHUVA, deslocamentoMin, paradaParaISO, validarEtapa1, validarEtapa2, validarEtapa3, validarEtapa4, validarEtapa5,
  validarTudo, type ContextoValidacao, type Mensagem, type RascunhoAplicacao, type ResultadoValidacao,
} from '../domain/validation';
import { novoId, PREFIXO } from '../data/repository';
import { atualizarDataset, estado, nome, repo } from '../state';
import { aviso, cabecalhoPagina, rotuloStatusAc } from '../ui/components';
import { confirmar, esc, fmtData, fmtHa, fmtNum, hojeISO, toast } from '../ui/dom';
import { icone } from '../ui/icons';

const ETAPAS = ['Identificação', 'Equipamentos e equipe', 'Dados técnicos', 'Condições climáticas', 'Encerramento', 'Revisão'];
const CHAVE_RASCUNHO = `${PREFIXO}rascunho-aplicacao`;
const UNIDADES_DOSE: UnidadeDose[] = ['L/ha', 'mL/ha', 'kg/ha', 'g/ha'];

let r: RascunhoAplicacao;
let etapa = 0;
let ultimaValidacao: ResultadoValidacao = { erros: [], avisos: [] };

function vazio(): RascunhoAplicacao {
  return {
    data: hojeISO(), horaInicio: '', turnoId: '', liderId: '', unidadeId: '', fazendaId: '', osId: '', campanhaId: '', cultura: '', itens: [],
    aeronaveId: '', pilotoId: '', auxiliarIds: [], equipamentosAuxiliares: '',
    volumeLHa: null, produtos: [], velocidadeMs: null, alturaVooM: null, faixaM: null, observacoesTecnicas: '',
    clima: [], horaFim: '', tempoEfetivoMin: null, paradas: [], observacoesOperador: '', responsavelEncerramento: '',
  };
}

function salvarRascunho() { try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ r, etapa })); } catch { /* opcional */ } }
function descartarRascunho() { try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* opcional */ } }

function ctx(): ContextoValidacao {
  const apl = aplicadoPorItem(aplicacoes(estado.ds));
  return {
    hoje: hojeISO(),
    areaTalhao: (id) => estado.ds.talhoes.find((t) => t.id === id)?.areaHa ?? null,
    saldoItem: (osId, talhaoId) => {
      const it = estado.idx.os.get(osId)?.itens.find((i) => i.talhaoId === talhaoId);
      return it ? it.areaPlanejadaHa - (apl.get(chaveItem(osId, talhaoId)) ?? 0) : null;
    },
    limites: estado.ds.limites,
  };
}

function validarEtapaAtual(): ResultadoValidacao {
  const c = ctx();
  return [() => validarEtapa1(r, c), () => validarEtapa2(r), () => validarEtapa3(r, c), () => validarEtapa4(r, c), () => validarEtapa5(r), () => validarTudo(r, c)][etapa]();
}

export function renderNovaAplicacao(raiz: HTMLElement) {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? 'null');
    if (salvo?.r) { r = { ...vazio(), ...salvo.r }; etapa = Math.min(salvo.etapa ?? 0, 5); } else { r = vazio(); etapa = 0; }
  } catch { r = vazio(); etapa = 0; }
  ultimaValidacao = { erros: [], avisos: [] };
  raiz.innerHTML = `
    ${cabecalhoPagina('Nova aplicação', 'Registro de operação em 5 etapas, com revisão antes de confirmar.', `<button class="btn btn-sec" data-acao="descartar">${icone('lixo', 15)} Descartar rascunho</button>`)}
    ${aviso('info', 'Fase 1: o registro é salvo <b>somente neste navegador</b>, na base de demonstração do protótipo. Não é enviado a nenhum servidor. O rascunho é guardado automaticamente enquanto você preenche.')}
    <div class="wizard cartao">
      <ol class="passos" id="wz-passos"></ol>
      <div id="wz-msgs"></div>
      <form id="wz-form" novalidate></form>
      <div class="wz-nav">
        <button class="btn btn-sec" data-acao="voltar">${icone('esq', 16)} Voltar</button>
        <span class="wz-pos" id="wz-pos"></span>
        <button class="btn btn-pri" data-acao="avancar" id="wz-avancar">Próximo ${icone('dir', 16)}</button>
      </div>
    </div>`;
  const form = raiz.querySelector('#wz-form') as HTMLFormElement;
  form.addEventListener('input', (e) => aoEditar(e, false));
  form.addEventListener('change', (e) => aoEditar(e, true));
  form.addEventListener('submit', (e) => e.preventDefault());
  raiz.addEventListener('click', (e) => aoClicar(e, raiz));
  desenhar(raiz);
}

function desenhar(raiz: HTMLElement) {
  (raiz.querySelector('#wz-passos') as HTMLElement).innerHTML = ETAPAS.map((t, i) =>
    `<li class="${i === etapa ? 'atual' : i < etapa ? 'feito' : ''}"><button data-ir="${i}" ${i > etapa ? 'disabled' : ''} aria-current="${i === etapa ? 'step' : 'false'}"><span class="passo-n">${i < etapa ? icone('ok', 14) : i + 1}</span><span class="passo-t">${t}</span></button></li>`).join('');
  (raiz.querySelector('#wz-pos') as HTMLElement).textContent = `Etapa ${etapa + 1} de ${ETAPAS.length}`;
  const av = raiz.querySelector('#wz-avancar') as HTMLElement;
  av.innerHTML = etapa === 5 ? `${icone('ok', 16)} Confirmar e salvar` : `Próximo ${icone('dir', 16)}`;
  (raiz.querySelector('[data-acao="voltar"]') as HTMLButtonElement).disabled = etapa === 0;
  const form = raiz.querySelector('#wz-form') as HTMLElement;
  form.innerHTML = [etapa1, etapa2, etapa3, etapa4, etapa5, revisao][etapa]();
  mostrarMensagens(raiz);
  atualizarCalculos(raiz);
}

function mostrarMensagens(raiz: HTMLElement) {
  const { erros, avisos } = ultimaValidacao;
  const box = raiz.querySelector('#wz-msgs') as HTMLElement;
  box.innerHTML = (erros.length ? aviso('critico', `<b>Corrija antes de continuar:</b><ul>${erros.map((m) => `<li>${esc(m.msg)}</li>`).join('')}</ul>`) : '')
    + (avisos.length && etapa !== 5 ? aviso('atencao', `<b>Confira:</b><ul>${avisos.map((m) => `<li>${esc(m.msg)}</li>`).join('')}</ul>`) : '');
  raiz.querySelectorAll('[data-v].invalido').forEach((el) => el.classList.remove('invalido'));
  erros.forEach((m: Mensagem) => raiz.querySelectorAll(`[data-v="${m.campo}"]`).forEach((el) => el.classList.add('invalido')));
}

// ---------- Edição genérica por caminho (ex.: "produtos.1.doseReal") ----------
function definir(caminho: string, valor: unknown) {
  const partes = caminho.split('.');
  let alvo: Record<string, unknown> = r as unknown as Record<string, unknown>;
  for (let i = 0; i < partes.length - 1; i++) alvo = alvo[partes[i]] as Record<string, unknown>;
  alvo[partes[partes.length - 1]] = valor;
}

function aoEditar(e: Event, mudou: boolean) {
  const el = e.target as HTMLInputElement;
  const raiz = el.closest('main') as HTMLElement;
  const k = el.dataset.k;
  if (k) {
    let v: unknown = el.value;
    if (el.dataset.tipo === 'num') { const s = el.value.replace(',', '.').trim(); v = s === '' ? null : Number(s); if (typeof v === 'number' && !Number.isFinite(v)) v = null; }
    if (el.dataset.tipo === 'bool') v = el.value === '' ? null : el.value === 'sim';
    definir(k, v);
    const mProd = /^produtos\.(\d+)\.produtoId$/.exec(k);
    if (mProd) { const pr = estado.ds.produtos.find((x) => x.id === v); if (pr) r.produtos[Number(mProd[1])].unidade = pr.unidadeDose; }
    // Cascatas da etapa 1
    if (k === 'turnoId') { const t = estado.ds.turnos.find((x) => x.id === r.turnoId); r.liderId = t?.liderId ?? ''; }
    if (k === 'unidadeId') { r.fazendaId = ''; r.osId = ''; r.itens = []; }
    if (k === 'fazendaId' && r.fazendaId && !r.unidadeId) r.unidadeId = estado.ds.fazendas.find((f) => f.id === r.fazendaId)?.unidadeId ?? '';
    if (k === 'fazendaId') { r.osId = ''; r.itens = []; }
    if (k === 'osId') aplicarOS();
    salvarRascunho();
    const redesenha = ['turnoId', 'unidadeId', 'fazendaId', 'osId', 'aeronaveId', 'pilotoId'].includes(k) || k.endsWith('.classeFiltro') || k.endsWith('.produtoId') || k.endsWith('.momento');
    if (mudou && redesenha) { desenhar(raiz); return; }
  }
  if (el.dataset.talhao && mudou) {
    const id = el.dataset.talhao;
    if (el.checked) {
      const saldo = ctx().saldoItem(r.osId, id);
      r.itens.push({ talhaoId: id, areaHa: saldo !== null && saldo > 0 ? Math.round(saldo * 100) / 100 : null });
    } else r.itens = r.itens.filter((i) => i.talhaoId !== id);
    salvarRascunho();
    desenhar(raiz);
    return;
  }
  if (el.dataset.aux && mudou) {
    const id = el.dataset.aux;
    r.auxiliarIds = el.checked ? [...r.auxiliarIds, id] : r.auxiliarIds.filter((x) => x !== id);
    salvarRascunho();
  }
  atualizarCalculos(raiz);
}

function aplicarOS() {
  const os = estado.idx.os.get(r.osId);
  r.itens = [];
  if (!os) { r.campanhaId = ''; r.cultura = ''; return; }
  r.campanhaId = os.campanhaId;
  r.cultura = estado.ds.campanhas.find((c) => c.id === os.campanhaId)?.cultura ?? '';
  r.volumeLHa = os.calda.volumeLHa;
  r.produtos = os.calda.produtos.map((p) => ({ produtoId: p.produtoId, dosePlanejada: p.dosePlanejada, doseReal: null, unidade: p.unidade, lote: p.lote ?? '' }));
}

async function aoClicar(e: Event, raiz: HTMLElement) {
  const t = e.target as HTMLElement;
  const b = t.closest('button') as HTMLButtonElement | null;
  if (!b) return;
  const acao = b.dataset.acao;
  if (b.dataset.ir !== undefined) { etapa = Number(b.dataset.ir); ultimaValidacao = { erros: [], avisos: [] }; salvarRascunho(); desenhar(raiz); return; }
  if (!acao) return;
  e.preventDefault();
  switch (acao) {
    case 'voltar': if (etapa > 0) { etapa--; ultimaValidacao = { erros: [], avisos: [] }; salvarRascunho(); desenhar(raiz); window.scrollTo({ top: 0 }); } break;
    case 'avancar': {
      ultimaValidacao = validarEtapaAtual();
      if (ultimaValidacao.erros.length) { mostrarMensagens(raiz); (raiz.querySelector('#wz-msgs') as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (etapa === 5) { await gravar(); return; }
      const avisosAnteriores = ultimaValidacao.avisos;
      etapa++;
      ultimaValidacao = { erros: [], avisos: [] };
      salvarRascunho();
      desenhar(raiz);
      if (avisosAnteriores.length) toast(`${avisosAnteriores.length} aviso(s) para conferência — serão listados na revisão.`, 'info');
      window.scrollTo({ top: 0 });
      break;
    }
    case 'descartar':
      if (await confirmar('Descartar rascunho', 'Todos os dados preenchidos neste formulário serão apagados. Deseja continuar?', 'Descartar')) {
        descartarRascunho(); r = vazio(); etapa = 0; ultimaValidacao = { erros: [], avisos: [] }; desenhar(raiz); toast('Rascunho descartado.', 'info');
      }
      break;
    case 'add-produto': r.produtos.push({ produtoId: '', dosePlanejada: null, doseReal: null, unidade: 'L/ha', lote: '' }); salvarRascunho(); desenhar(raiz); break;
    case 'rem-produto': r.produtos.splice(Number(b.dataset.i), 1); salvarRascunho(); desenhar(raiz); break;
    case 'add-clima': {
      const momento: MomentoClima = r.clima.length === 0 ? 'inicio' : 'durante';
      r.clima.push({ momento, hora: momento === 'inicio' ? r.horaInicio : '', temperaturaC: null, umidadePct: null, ventoKmh: null, rajadaKmh: null, direcaoVento: null, chuva: null, orvalho: null, origem: '' });
      salvarRascunho(); desenhar(raiz); break;
    }
    case 'rem-clima': r.clima.splice(Number(b.dataset.i), 1); salvarRascunho(); desenhar(raiz); break;
    case 'add-parada': r.paradas.push({ motivo: 'Abastecimento/reabastecimento', inicio: '', fim: '', observacoes: '' }); salvarRascunho(); desenhar(raiz); break;
    case 'rem-parada': r.paradas.splice(Number(b.dataset.i), 1); salvarRascunho(); desenhar(raiz); break;
  }
}

async function gravar() {
  const c = ctx();
  const v = validarTudo(r, c);
  if (v.erros.length) { toast('Há erros pendentes. Revise as etapas.', 'erro'); return; }
  const opId = novoId('op');
  const area = r.itens.reduce((s, i) => s + (i.areaHa ?? 0), 0);
  const op: Operacao = {
    id: opId, data: r.data, horaInicio: r.horaInicio, horaFim: r.horaFim, osId: r.osId, campanhaId: r.campanhaId, cultura: r.cultura,
    turnoId: r.turnoId, liderId: r.liderId,
    aeronaveId: r.aeronaveId, pilotoId: r.pilotoId, auxiliarIds: r.auxiliarIds, equipamentosAuxiliares: r.equipamentosAuxiliares,
    status: area > 0 ? 'concluida' : 'impedida_clima',
    itens: r.itens.map((i) => ({ talhaoId: i.talhaoId, areaHa: i.areaHa ?? 0 })),
    tempoEfetivoMin: r.tempoEfetivoMin ?? 0,
    calda: { volumeLHa: r.volumeLHa ?? 0, produtos: r.produtos.map((p) => ({ produtoId: p.produtoId, dosePlanejada: p.dosePlanejada ?? 0, doseReal: p.doseReal, unidade: p.unidade, lote: p.lote })) },
    velocidadeMs: r.velocidadeMs, alturaVooM: r.alturaVooM, faixaM: r.faixaM, clima: r.clima,
    observacoesTecnicas: r.observacoesTecnicas, observacoesOperador: r.observacoesOperador, responsavelEncerramento: r.responsavelEncerramento,
    origem: 'registro_prototipo', criadoEm: new Date().toISOString().slice(0, 19),
  };
  const paradas: Parada[] = r.paradas.map((p) => ({
    id: novoId('pa'), operacaoId: opId, inicio: paradaParaISO(r.data, r.horaInicio, p.inicio), fim: paradaParaISO(r.data, r.horaInicio, p.fim),
    motivo: p.motivo, observacoes: p.observacoes, responsavel: r.responsavelEncerramento,
  }));
  try {
    const ds = repo.adicionarOperacao(op, paradas);
    atualizarDataset(ds);
    descartarRascunho();
    toast('Aplicação registrada no protótipo.', 'ok');
    location.hash = '#/aplicacoes';
  } catch (err) {
    toast((err as Error).message, 'erro');
  }
}

// ---------- Campos ----------
const opt = (v: string, t: string, sel: string | null | undefined, dis = false) => `<option value="${esc(v)}" ${v === (sel ?? '') ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(t)}</option>`;
const numStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
function campo(rot: string, html: string, o: { v?: string; dica?: string; classe?: string; obrig?: boolean } = {}) {
  return `<label class="campo ${o.classe ?? ''}" ${o.v ? `data-v="${o.v}"` : ''}><span>${esc(rot)}${o.obrig ? ' <em class="obrig">*</em>' : ''}</span>${html}${o.dica ? `<small>${esc(o.dica)}</small>` : ''}</label>`;
}
const inNum = (k: string, v: number | null, attrs = '') => `<input data-k="${k}" data-tipo="num" inputmode="decimal" value="${esc(numStr(v))}" ${attrs}>`;
const comUnidade = (input: string, un: string) => `<div class="com-unidade">${input}<span>${esc(un)}</span></div>`;

function etapa1(): string {
  const ds = estado.ds;
  const fazendas = ds.fazendas.filter((f) => !r.unidadeId || f.unidadeId === r.unidadeId);
  const ordens = ds.ordens.filter((o) => o.fazendaId === r.fazendaId && o.status !== 'cancelada');
  const os = estado.idx.os.get(r.osId);
  const c = ctx();
  const planejadaOS = os ? os.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0) : 0;
  return `
    <div class="form-grade">
      ${campo('Data', `<input type="date" data-k="data" value="${esc(r.data)}" max="${hojeISO()}">`, { v: 'data', obrig: true })}
      ${campo('Hora de início', `<input type="time" data-k="horaInicio" value="${esc(r.horaInicio)}">`, { v: 'horaInicio', obrig: true })}
      ${campo('Turno', `<select data-k="turnoId">${opt('', 'Selecione…', r.turnoId)}${ds.turnos.filter((t) => t.ativo).map((t) => opt(t.id, `${t.nome} · ${t.periodo} (${t.horaInicio}–${t.horaFim})`, r.turnoId)).join('')}</select>`, { v: 'turnoId', obrig: true })}
      ${campo('Líder do turno', `<select data-k="liderId">${opt('', r.turnoId ? 'Selecione…' : 'Escolha o turno primeiro', r.liderId)}${ds.colaboradores.filter((c) => c.funcao === 'Líder de turno' && c.ativo).map((c) => opt(c.id, c.nome + (ds.turnos.find((t) => t.id === r.turnoId)?.liderId === c.id ? ' (líder do turno)' : ''), r.liderId)).join('')}</select>`, { v: 'liderId', obrig: true, dica: 'Preenchido pelo turno; altere em caso de substituição' })}
      ${campo('Unidade / empresa', `<select data-k="unidadeId">${opt('', 'Todas (opcional)', r.unidadeId)}${ds.unidades.map((u) => opt(u.id, u.nome, r.unidadeId)).join('')}</select>`, { v: 'unidadeId' })}
      ${campo('Fazenda', `<select data-k="fazendaId">${opt('', 'Selecione…', r.fazendaId)}${fazendas.map((f) => opt(f.id, `${f.codigo} · ${f.nome}`, r.fazendaId)).join('')}</select>`, { v: 'fazendaId', obrig: true })}
      ${campo('Ordem de serviço', `<select data-k="osId" ${r.fazendaId ? '' : 'disabled'}>${opt('', r.fazendaId ? (ordens.length ? 'Selecione…' : 'Nenhuma OS para esta fazenda') : 'Escolha a fazenda primeiro', r.osId)}${ordens.map((o) => opt(o.id, `${o.numero} · ${nome.campanha(o.campanhaId)}`, r.osId)).join('')}</select>`, { v: 'osId', obrig: true })}
      ${campo('Campanha agrícola', `<input value="${esc(r.campanhaId ? nome.campanha(r.campanhaId) : '')}" readonly placeholder="Definida pela OS">`)}
      ${campo('Cultura', `<input data-k="cultura" value="${esc(r.cultura)}" placeholder="Definida pela OS">`)}
      ${campo('Área prevista na OS', `<input value="${os ? esc(fmtHa(planejadaOS)) : ''}" readonly placeholder="—">`, { dica: 'Soma dos talhões da OS' })}
    </div>
    ${os ? `
    <h3 class="sec-tit" data-v="itens">Talhões desta operação <span class="muted">— marque os talhões aplicados</span></h3>
    <div class="lista-talhoes">${os.itens.map((it) => {
      const saldo = c.saldoItem(os.id, it.talhaoId) ?? 0;
      const marcado = r.itens.some((x) => x.talhaoId === it.talhaoId);
      const concl = saldo <= 0.009;
      return `<label class="talhao-op ${marcado ? 'marcado' : ''} ${concl ? 'concluido' : ''}"><input type="checkbox" data-talhao="${esc(it.talhaoId)}" ${marcado ? 'checked' : ''}>
        <span class="t-cod">Talhão ${esc(nome.talhao(it.talhaoId))}</span><span class="t-num">Plan. ${esc(fmtNum(it.areaPlanejadaHa, 2))} ha</span><span class="t-num ${concl ? 'txt-ok' : ''}">${concl ? 'Concluído' : `Saldo ${esc(fmtNum(saldo, 2))} ha`}</span></label>`;
    }).join('')}</div>` : ''}`;
}

function etapa2(): string {
  const ds = estado.ds;
  const ac = ds.aeronaves.find((a) => a.id === r.aeronaveId);
  const pilotos = ds.colaboradores.filter((c) => c.funcao === 'Piloto' && c.ativo);
  const outros = ds.colaboradores.filter((c) => c.id !== r.pilotoId && c.ativo);
  return `
    <div class="form-grade">
      ${campo('Aeronave utilizada', `<select data-k="aeronaveId">${opt('', 'Selecione…', r.aeronaveId)}${ds.aeronaves.map((a) => opt(a.id, `${a.identificacao} · ${a.modelo} — ${rotuloStatusAc(a.status)}`, r.aeronaveId)).join('')}</select>`, { v: 'aeronaveId', obrig: true })}
      ${campo('Identificação individual', `<input value="${esc(ac ? `${ac.identificacao} · nº de série ${ac.numeroSerie}` : '')}" readonly placeholder="Preenchido pela aeronave">`)}
      ${campo('Operador responsável (piloto)', `<select data-k="pilotoId">${opt('', 'Selecione…', r.pilotoId)}${pilotos.map((p) => opt(p.id, `${p.nome} · ${nome.unidade(p.unidadeId)}`, r.pilotoId)).join('')}</select>`, { v: 'pilotoId', obrig: true })}
      ${campo('Equipamentos auxiliares', `<input data-k="equipamentosAuxiliares" value="${esc(r.equipamentosAuxiliares)}" placeholder="Ex.: gerador, misturador, base RTK">`, { dica: 'Opcional' })}
    </div>
    ${ac && (ac.status === 'manutencao' || ac.status === 'indisponivel') ? aviso('atencao', `A aeronave ${esc(ac.identificacao)} está cadastrada como <b>${esc(rotuloStatusAc(ac.status))}</b>. Confirme se o registro está correto.`) : ''}
    <h3 class="sec-tit" data-v="auxiliarIds">Demais colaboradores</h3>
    <div class="lista-check">${outros.map((c) => `<label class="chk"><input type="checkbox" data-aux="${esc(c.id)}" ${r.auxiliarIds.includes(c.id) ? 'checked' : ''}><span>${esc(c.nome)}<small>${esc(c.funcao)}</small></span></label>`).join('')}</div>`;
}

function etapa3(): string {
  const ds = estado.ds;
  const classes = [...new Set(ds.produtos.map((p) => p.classe))];
  return `
    <h3 class="sec-tit">Área aplicada por talhão</h3>
    ${r.itens.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples tabela-form"><thead><tr><th>Talhão</th><th class="dir">Área do talhão</th><th class="dir">Saldo na OS</th><th>Área aplicada (ha) *</th></tr></thead><tbody>
      ${r.itens.map((it, i) => {
        const at = ds.talhoes.find((t) => t.id === it.talhaoId)?.areaHa ?? null;
        const saldo = ctx().saldoItem(r.osId, it.talhaoId);
        return `<tr data-v="area_${i}"><td data-label="Talhão">${esc(nome.talhao(it.talhaoId))}</td><td class="dir" data-label="Área do talhão">${esc(fmtHa(at))}</td><td class="dir" data-label="Saldo na OS">${esc(fmtHa(saldo))}</td><td data-label="Área aplicada">${comUnidade(inNum(`itens.${i}.areaHa`, it.areaHa, 'min="0"'), 'ha')}</td></tr>`;
      }).join('')}
    </tbody><tfoot><tr><td colspan="3">Área total aplicada</td><td><b id="calc-area">—</b></td></tr></tfoot></table></div>` : aviso('atencao', 'Nenhum talhão selecionado. Volte à etapa 1.')}

    <h3 class="sec-tit">Calda</h3>
    <div class="form-grade">
      ${campo('Taxa de aplicação', comUnidade(inNum('volumeLHa', r.volumeLHa), 'L/ha'), { v: 'volumeLHa', obrig: true, dica: 'Volume de mistura por hectare — não é dose de produto' })}
      ${campo('Volume total de calda', `<output id="calc-vol" class="saida">—</output>`, { dica: 'Volume de calda × área aplicada' })}
    </div>

    <h3 class="sec-tit" data-v="produtos">Produtos <span class="muted">— cada produto com classe, dose e unidade próprias</span></h3>
    <div class="produtos-lista">${r.produtos.map((p, i) => {
      const pr = ds.produtos.find((x) => x.id === p.produtoId);
      const classe = p.classeFiltro ?? pr?.classe ?? '';
      return `<div class="produto-linha" data-v="prod_${i}">
        ${campo('Classe', `<select data-k="produtos.${i}.classeFiltro">${opt('', 'Todas', classe)}${classes.map((c) => opt(c, c, classe)).join('')}</select>`)}
        ${campo('Produto', `<select data-k="produtos.${i}.produtoId">${opt('', 'Selecione…', p.produtoId)}${ds.produtos.filter((x) => !classe || x.classe === classe || x.id === p.produtoId).map((x) => opt(x.id, `${x.nome} (${x.classe})`, p.produtoId)).join('')}</select>`, { obrig: true })}
        ${campo('Dose planejada', inNum(`produtos.${i}.dosePlanejada`, p.dosePlanejada), { obrig: true })}
        ${campo('Dose utilizada', inNum(`produtos.${i}.doseReal`, p.doseReal), { dica: 'Se diferente da planejada' })}
        ${campo('Unidade da dose', `<select data-k="produtos.${i}.unidade">${UNIDADES_DOSE.map((u) => opt(u, u, p.unidade)).join('')}</select>`)}
        ${campo('Lote', `<input data-k="produtos.${i}.lote" value="${esc(p.lote)}" placeholder="Opcional">`)}
        <div class="produto-calc"><span>Quantidade total</span><b data-qtd="${i}">—</b></div>
        <button class="btn-icone perigo" data-acao="rem-produto" data-i="${i}" aria-label="Remover produto">${icone('lixo', 16)}</button>
      </div>`;
    }).join('')}</div>
    <button class="btn btn-sec btn-peq" data-acao="add-produto">${icone('mais', 15)} Adicionar produto</button>

    <h3 class="sec-tit">Parâmetros de voo <span class="muted">— quando disponíveis</span></h3>
    <div class="form-grade">
      ${campo('Velocidade operacional', comUnidade(inNum('velocidadeMs', r.velocidadeMs), 'm/s'), { v: 'velocidadeMs' })}
      ${campo('Altura de voo', comUnidade(inNum('alturaVooM', r.alturaVooM), 'm'), { v: 'alturaVooM' })}
      ${campo('Espaçamento entre faixas', comUnidade(inNum('faixaM', r.faixaM), 'm'), { v: 'faixaM' })}
      ${campo('Observações técnicas', `<textarea data-k="observacoesTecnicas" rows="2">${esc(r.observacoesTecnicas)}</textarea>`, { classe: 'largo' })}
    </div>`;
}

function etapa4(): string {
  const lim = estado.ds.limites;
  return `
    ${aviso('info', `Registre as leituras disponíveis no <b>início</b>, <b>durante</b> e no <b>encerramento</b>. Os valores são comparados com os limites configurados (vento ${lim.ventoMinKmh}–${lim.ventoMaxKmh} km/h, UR ≥ ${lim.umidadeMinPct}%, temperatura ≤ ${lim.temperaturaMaxC} °C), que devem seguir a bula e a recomendação técnica. O sistema não declara a aplicação "segura".`)}
    <div class="clima-lista">${r.clima.map((l, i) => leituraHTML(l, i)).join('') || '<p class="vazio-txt">Nenhuma leitura registrada.</p>'}</div>
    <button class="btn btn-sec btn-peq" data-acao="add-clima">${icone('mais', 15)} Adicionar leitura</button>`;
}

function leituraHTML(l: LeituraClima, i: number): string {
  const k = (c: string) => `clima.${i}.${c}`;
  const fora = avaliarLeitura(l, estado.ds.limites);
  return `<div class="clima-cartao" data-v="clima_${i}">
    <div class="clima-cab"><select data-k="${k('momento')}">${opt('inicio', 'Início', l.momento)}${opt('durante', 'Durante', l.momento)}${opt('fim', 'Encerramento', l.momento)}</select>
      <span class="clima-status" data-clima="${i}">${fora.length ? `<span class="selo selo-atencao">Fora dos limites: ${esc(fora.join(', '))}</span>` : '<span class="selo selo-neutro">Dentro dos limites configurados</span>'}</span>
      <button class="btn-icone perigo" data-acao="rem-clima" data-i="${i}" aria-label="Remover leitura">${icone('lixo', 16)}</button></div>
    <div class="form-grade compacta">
      ${campo('Horário', `<input type="time" data-k="${k('hora')}" value="${esc(l.hora)}">`, { obrig: true })}
      ${campo('Temperatura', comUnidade(inNum(k('temperaturaC'), l.temperaturaC), '°C'))}
      ${campo('Umidade relativa', comUnidade(inNum(k('umidadePct'), l.umidadePct), '%'))}
      ${campo('Vento', comUnidade(inNum(k('ventoKmh'), l.ventoKmh), 'km/h'))}
      ${campo('Rajada', comUnidade(inNum(k('rajadaKmh'), l.rajadaKmh), 'km/h'))}
      ${campo('Direção do vento', `<select data-k="${k('direcaoVento')}">${opt('', '—', l.direcaoVento)}${['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].map((d) => opt(d, d, l.direcaoVento)).join('')}</select>`)}
      ${campo('Chuva', `<select data-k="${k('chuva')}">${opt('', '—', l.chuva)}${CONDICOES_CHUVA.map((c) => opt(c, c, l.chuva)).join('')}</select>`)}
      ${campo('Orvalho', `<select data-k="${k('orvalho')}" data-tipo="bool">${opt('', '—', l.orvalho === null ? '' : l.orvalho ? 'sim' : 'nao')}${opt('sim', 'Sim', l.orvalho === null ? '' : l.orvalho ? 'sim' : 'nao')}${opt('nao', 'Não', l.orvalho === null ? '' : l.orvalho ? 'sim' : 'nao')}</select>`)}
      ${campo('Origem da informação', `<input data-k="${k('origem')}" value="${esc(l.origem)}" placeholder="Ex.: estação portátil" list="origens-clima">`, { obrig: true })}
      ${campo('Observações', `<input data-k="${k('observacoes')}" value="${esc(l.observacoes ?? '')}">`)}
    </div>
    <datalist id="origens-clima"><option value="Estação portátil"><option value="Estação meteorológica fixa"><option value="Aplicativo de previsão"><option value="Observação visual"></datalist>
  </div>`;
}

function etapa5(): string {
  return `
    <div class="form-grade">
      ${campo('Hora de término', `<input type="time" data-k="horaFim" value="${esc(r.horaFim)}">`, { v: 'horaFim', obrig: true, dica: 'Se menor que o início, considera a virada do dia' })}
      ${campo('Tempo total da operação', `<output id="calc-total" class="saida">—</output>`)}
      ${campo('Tempo efetivo de aplicação', comUnidade(inNum('tempoEfetivoMin', r.tempoEfetivoMin, 'min="0"'), 'min'), { v: 'tempoEfetivoMin', obrig: true, dica: 'Somente tempo aplicando — sem paradas nem deslocamento' })}
      ${campo('Área total aplicada', `<output class="saida">${esc(fmtHa(r.itens.reduce((s, i) => s + (i.areaHa ?? 0), 0)))}</output>`)}
    </div>
    <h3 class="sec-tit" data-v="paradas">Paradas</h3>
    <div class="paradas-lista">${r.paradas.map((p, i) => `<div class="parada-linha" data-v="parada_${i}">
      ${campo('Motivo', `<select data-k="paradas.${i}.motivo">${MOTIVOS_PARADA.map((m) => opt(m, m, p.motivo)).join('')}</select>`)}
      ${campo('Início', `<input type="time" data-k="paradas.${i}.inicio" value="${esc(p.inicio)}">`, { obrig: true })}
      ${campo('Fim', `<input type="time" data-k="paradas.${i}.fim" value="${esc(p.fim)}">`, { obrig: true })}
      ${campo('Observações', `<input data-k="paradas.${i}.observacoes" value="${esc(p.observacoes)}">`)}
      <div class="produto-calc"><span>Duração</span><b data-dur="${i}">—</b></div>
      <button class="btn-icone perigo" data-acao="rem-parada" data-i="${i}" aria-label="Remover parada">${icone('lixo', 16)}</button>
    </div>`).join('') || '<p class="vazio-txt">Nenhuma parada registrada.</p>'}</div>
    <button class="btn btn-sec btn-peq" data-acao="add-parada">${icone('mais', 15)} Adicionar parada</button>

    <div class="resumo-tempos" id="resumo-tempos"></div>

    <div class="form-grade">
      ${campo('Observações do operador', `<textarea data-k="observacoesOperador" rows="2">${esc(r.observacoesOperador)}</textarea>`, { classe: 'largo' })}
      ${campo('Responsável pelo encerramento', `<input data-k="responsavelEncerramento" value="${esc(r.responsavelEncerramento)}" placeholder="Nome">`, { v: 'responsavelEncerramento', obrig: true })}
    </div>`;
}

function revisao(): string {
  const c = ctx();
  const v = validarTudo(r, c);
  const area = r.itens.reduce((s, i) => s + (i.areaHa ?? 0), 0);
  const total = duracaoTotalMin(r.horaInicio, r.horaFim);
  const parado = somaParadasRascunho();
  const os = estado.idx.os.get(r.osId);
  const l = (k: string, val: string) => `<div class="campo-l"><span>${esc(k)}</span><b>${val}</b></div>`;
  return `
    ${v.erros.length ? aviso('critico', `<b>Ainda há ${v.erros.length} erro(s):</b><ul>${v.erros.map((m) => `<li>${esc(m.msg)}</li>`).join('')}</ul>`) : aviso('info', 'Revise os dados abaixo. Ao confirmar, o registro será salvo no protótipo.')}
    ${v.avisos.length ? aviso('atencao', `<b>${v.avisos.length} ponto(s) para conferência:</b><ul>${v.avisos.map((m) => `<li>${esc(m.msg)}</li>`).join('')}</ul>`) : ''}
    <div class="detalhe-grade">
      <section><h3>Identificação</h3>${l('Data', `${esc(fmtData(r.data))} · ${esc(r.horaInicio)}–${esc(r.horaFim)}`)}${l('Turno', esc(nome.turno(r.turnoId)))}${l('Líder do turno', esc(nome.colaborador(r.liderId)))}${l('Fazenda', esc(nome.fazenda(r.fazendaId)))}${l('OS', esc(os?.numero ?? '—'))}${l('Campanha', esc(nome.campanha(r.campanhaId)))}${l('Talhões', esc(r.itens.map((i) => nome.talhao(i.talhaoId)).join(', ')))}</section>
      <section><h3>Equipe</h3>${l('Aeronave', esc(nome.aeronave(r.aeronaveId)))}${l('Operador', esc(nome.colaborador(r.pilotoId)))}${l('Colaboradores', esc(r.auxiliarIds.map(nome.colaborador).join(', ') || '—'))}</section>
      <section><h3>Técnico</h3>${l('Área total aplicada', esc(fmtHa(area)))}${l('Taxa de aplicação', `${esc(fmtNum(r.volumeLHa, 1))} L/ha`)}${r.produtos.map((p) => l(nome.produto(p.produtoId), `${esc(fmtNum(p.doseReal ?? p.dosePlanejada, 3))} ${esc(p.unidade)}`)).join('')}</section>
      <section><h3>Tempos</h3>${l('Total', esc(formatarDuracao(total)))}${l('Efetivo', esc(formatarDuracao(r.tempoEfetivoMin)))}${l('Parado', esc(formatarDuracao(parado)))}${l('Produtividade efetiva', `${esc(fmtNum(produtividadeEfetiva(area, r.tempoEfetivoMin ?? 0), 2))} ha/h`)}${l('Leituras de clima', String(r.clima.length))}${l('Responsável', esc(r.responsavelEncerramento || '—'))}</section>
    </div>`;
}

function somaParadasRascunho(): number {
  return r.paradas.reduce((s, p) => {
    const a = deslocamentoMin(r.horaInicio, p.inicio);
    const b = deslocamentoMin(r.horaInicio, p.fim);
    return a !== null && b !== null && b > a ? s + (b - a) : s;
  }, 0);
}

/** Atualiza saídas calculadas sem redesenhar o formulário (mantém o foco do campo). */
function atualizarCalculos(raiz: HTMLElement) {
  const area = r.itens.reduce((s, i) => s + (i.areaHa && i.areaHa > 0 ? i.areaHa : 0), 0);
  const set = (sel: string, txt: string) => { const el = raiz.querySelector(sel); if (el) el.textContent = txt; };
  set('#calc-area', fmtHa(area));
  const vol = r.volumeLHa === null ? null : volumeTotalCalda(r.volumeLHa, area);
  set('#calc-vol', vol === null ? '—' : `${fmtNum(vol, 0)} L`);
  r.produtos.forEach((p, i) => {
    const dose = p.doseReal ?? p.dosePlanejada;
    const q = dose === null ? null : quantidadeTotal(dose, p.unidade, area);
    set(`[data-qtd="${i}"]`, q ? `${fmtNum(q.valor, 2)} ${q.unidade}` : '—');
  });
  r.clima.forEach((l, i) => {
    const el = raiz.querySelector(`[data-clima="${i}"]`);
    if (!el) return;
    const fora = avaliarLeitura(l, estado.ds.limites);
    el.innerHTML = fora.length ? `<span class="selo selo-atencao">Fora dos limites: ${esc(fora.join(', '))}</span>` : '<span class="selo selo-neutro">Dentro dos limites configurados</span>';
  });
  const total = duracaoTotalMin(r.horaInicio, r.horaFim);
  set('#calc-total', total === null ? (r.horaInicio ? '—' : 'Informe a hora de início na etapa 1') : formatarDuracao(total));
  r.paradas.forEach((p, i) => {
    const a = deslocamentoMin(r.horaInicio, p.inicio), b = deslocamentoMin(r.horaInicio, p.fim);
    set(`[data-dur="${i}"]`, a !== null && b !== null && b > a ? formatarDuracao(b - a) : '—');
  });
  const rt = raiz.querySelector('#resumo-tempos');
  if (rt) {
    const parado = somaParadasRascunho();
    const efet = r.tempoEfetivoMin ?? 0;
    const nao = total === null ? null : total - efet - parado;
    rt.innerHTML = `
      <div><span>Tempo total</span><b>${esc(formatarDuracao(total))}</b></div>
      <div><span>Efetivo</span><b>${esc(formatarDuracao(efet))}</b></div>
      <div><span>Parado</span><b>${esc(formatarDuracao(parado))}</b></div>
      <div class="${nao !== null && nao < 0 ? 'txt-critico' : ''}"><span>Não atribuído</span><b>${nao === null ? '—' : nao < 0 ? `excede em ${esc(formatarDuracao(-nao))}` : esc(formatarDuracao(nao))}</b></div>
      <div><span>ha/h efetivo</span><b>${esc(fmtNum(produtividadeEfetiva(area, efet), 2))}</b></div>
      <div><span>ha/h c/ paradas</span><b>${esc(fmtNum(total === null ? null : produtividadeOperacional(area, total), 2))}</b></div>`;
  }
}
