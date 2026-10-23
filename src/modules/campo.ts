/**
 * Registro de campo — boletim do turno, no estilo do Acompanhamento Diário usado hoje:
 * botões grandes por drone (iniciar, pausar, retomar, mudar de área, finalizar), horário marcado
 * automaticamente (editável) e tempo efetivo calculado. Ao fechar o turno, gera as operações.
 */
import { aplicacoes, aplicadoPorItem, chaveItem, formatarDuracao, produtividadeEfetiva } from '../domain/calc';
import {
  boletimVazio, fecharBoletim, finalizar, iniciar, metricasDrone, metricasTrecho, mudarArea, pausar, reabrir, rel, retomar,
  type BoletimCampo, type DroneCampo,
} from '../domain/boletim';
import type { LeituraClima, MomentoClima, MotivoParada } from '../domain/types';
import { MOTIVOS_PARADA } from '../domain/types';
import { avaliarLeitura, CONDICOES_CHUVA } from '../domain/validation';
import { novoId, PREFIXO } from '../data/repository';
import { atualizarDataset, estado, nome, repo } from '../state';
import { aviso, cabecalhoPagina } from '../ui/components';
import { abrirModal, confirmar, esc, fmtHa, fmtNum, hojeISO, toast } from '../ui/dom';
import { icone } from '../ui/icons';

const CHAVE = `${PREFIXO}boletim`;
let b: BoletimCampo;
const ui: Record<string, { hora: string; painel: '' | 'pausar' | 'mudar'; osSel: string }> = {};

const agora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const uiDe = (d: DroneCampo) => (ui[d.chave] ??= { hora: agora(), painel: '', osSel: '' });
function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(b)); } catch { /* opcional */ } }

export function renderCampo(raiz: HTMLElement) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); b = s?.versao === 1 ? s : boletimVazio(hojeISO()); } catch { b = boletimVazio(hojeISO()); }
  raiz.innerHTML = `${cabecalhoPagina('Registro de campo', 'Boletim do turno: toque nos botões conforme a operação acontece. O tempo efetivo é calculado sozinho.', `<a class="btn btn-sec" href="#/aplicacoes/nova">${icone('os', 15)} Formulário completo</a>`)}
    ${aviso('info', 'Fase 1: o boletim fica salvo neste aparelho enquanto você preenche (pode fechar o app). Ao <b>fechar o turno</b>, cada drone/área vira uma operação e aparece no Diário e no Dashboard.')}
    <div id="campo"></div>`;
  const host = raiz.querySelector('#campo') as HTMLElement;
  host.addEventListener('click', (e) => void aoClicar(e, host));
  host.addEventListener('input', (e) => aoEditar(e, host, false));
  host.addEventListener('change', (e) => aoEditar(e, host, true));
  desenhar(host);
}

// ---------- Edição genérica ----------
function definir(caminho: string, valor: unknown) {
  const p = caminho.split('.');
  let alvo = b as unknown as Record<string, unknown>;
  for (let i = 0; i < p.length - 1; i++) alvo = alvo[p[i]] as Record<string, unknown>;
  alvo[p[p.length - 1]] = valor;
}

function aoEditar(e: Event, host: HTMLElement, mudou: boolean) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.ui) { // estado de interface (hora da ação, OS escolhida)
    const [chave, campo] = el.dataset.ui.split('.');
    (ui[chave] as unknown as Record<string, string>)[campo] = el.value;
    if (campo === 'hora') atualizarMetricas(host);
    return;
  }
  const k = el.dataset.k;
  if (!k) return;
  let v: unknown = el.value;
  if (el.dataset.tipo === 'num') { const s = el.value.replace(',', '.').trim(); v = s === '' ? null : Number(s); if (typeof v === 'number' && !Number.isFinite(v)) v = null; }
  if (el.dataset.tipo === 'bool') v = el.value === '' ? null : el.value === 'sim';
  definir(k, v);
  if (k === 'turnoId') { const t = estado.ds.turnos.find((x) => x.id === b.turnoId); b.liderId = t?.liderId ?? ''; if (!b.responsavel) b.responsavel = nome.colaborador(b.liderId); }
  salvar();
  const estrutural = ['turnoId', 'liderId', 'campanhaId', 'data'].includes(k) || /\.(aeronaveId|pilotoId|momento|motivo)$/.test(k);
  if (mudou && estrutural) desenhar(host); else atualizarMetricas(host);
}

async function aoClicar(e: Event, host: HTMLElement) {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn?.dataset.a) return;
  e.preventDefault();
  const d = b.drones.find((x) => x.chave === btn.dataset.d);
  const u = d ? uiDe(d) : null;
  let erro: string | null = null;
  switch (btn.dataset.a) {
    case 'add-drone': {
      const usados = new Set(b.drones.map((x) => x.aeronaveId));
      const livre = estado.ds.aeronaves.find((a) => !usados.has(a.id) && a.status !== 'manutencao' && a.status !== 'indisponivel');
      b.drones.push({ chave: novoId('d'), aeronaveId: livre?.id ?? '', pilotoId: '', auxiliarIds: [], estado: 'aguardando', trechos: [] });
      break;
    }
    case 'rem-drone':
      if (d && (d.estado === 'aguardando' || await confirmar('Remover drone', 'O registro deste drone no boletim será apagado.', 'Remover'))) b.drones = b.drones.filter((x) => x !== d);
      break;
    case 'agora': if (u) u.hora = agora(); break;
    case 'iniciar': if (d && u) erro = iniciar(d, u.osSel, u.hora); break;
    case 'painel-pausar': if (u) u.painel = u.painel === 'pausar' ? '' : 'pausar'; break;
    case 'painel-mudar': if (u) { u.painel = u.painel === 'mudar' ? '' : 'mudar'; u.osSel = ''; } break;
    case 'pausar': if (d && u) { erro = pausar(d, btn.dataset.m as MotivoParada, u.hora); u.painel = ''; } break;
    case 'retomar': if (d && u) erro = retomar(d, u.hora); break;
    case 'mudar': if (d && u) { erro = mudarArea(d, u.osSel, u.hora); if (!erro) u.painel = ''; } break;
    case 'finalizar': if (d && u) erro = finalizar(d, u.hora); break;
    case 'reabrir': if (d) erro = reabrir(d); break;
    case 'add-talhao': if (d) {
      const t = d.trechos[Number(btn.dataset.t)];
      const saldo = saldoAtual(t.osId, btn.dataset.talhao!);
      t.itens.push({ talhaoId: btn.dataset.talhao!, areaHa: saldo !== null && saldo > 0 ? Math.round(saldo * 100) / 100 : null });
    } break;
    case 'rem-talhao': if (d) d.trechos[Number(btn.dataset.t)].itens.splice(Number(btn.dataset.i), 1); break;
    case 'rem-pausa': if (d) {
      const t = d.trechos[Number(btn.dataset.t)];
      const p = t.pausas[Number(btn.dataset.i)];
      if (p.fim === null) { erro = 'Retome o drone antes de remover a pausa em andamento.'; break; }
      t.pausas.splice(Number(btn.dataset.i), 1);
    } break;
    case 'add-clima': {
      const m = btn.dataset.m as MomentoClima;
      b.clima.push({ momento: m, hora: agora(), temperaturaC: null, umidadePct: null, ventoKmh: null, rajadaKmh: null, direcaoVento: null, chuva: 'sem chuva', orvalho: false, origem: 'Estação portátil' });
      break;
    }
    case 'rem-clima': b.clima.splice(Number(btn.dataset.i), 1); break;
    case 'descartar':
      if (await confirmar('Descartar boletim', 'Todo o boletim deste turno (drones, horários, áreas e clima) será apagado deste aparelho.', 'Descartar')) { b = boletimVazio(hojeISO()); Object.keys(ui).forEach((k) => delete ui[k]); toast('Boletim descartado.', 'info'); }
      break;
    case 'fechar': await fechar(host); return;
  }
  if (erro) toast(erro, 'erro');
  salvar();
  desenhar(host);
}

function saldoAtual(osId: string, talhaoId: string, ignorarBoletim = false): number | null {
  const plan = estado.idx.os.get(osId)?.itens.find((i) => i.talhaoId === talhaoId)?.areaPlanejadaHa;
  if (plan === undefined) return null;
  const apl = aplicadoPorItem(aplicacoes(estado.ds)).get(chaveItem(osId, talhaoId)) ?? 0;
  const noBoletim = ignorarBoletim ? 0 : b.drones.flatMap((d) => d.trechos).filter((t) => t.osId === osId).flatMap((t) => t.itens).filter((i) => i.talhaoId === talhaoId).reduce((s, i) => s + (i.areaHa ?? 0), 0);
  return plan - apl - noBoletim;
}

async function fechar(host: HTMLElement) {
  const ds = estado.ds;
  const ctx = {
    hoje: hojeISO(),
    areaTalhao: (id: string) => ds.talhoes.find((t) => t.id === id)?.areaHa ?? null,
    saldoItem: () => null,
    limites: ds.limites,
  };
  const r = fecharBoletim(JSON.parse(JSON.stringify(b)), ds, estado.idx, ctx, novoId, new Date().toISOString().slice(0, 19));
  const box = host.querySelector('#campo-msgs') as HTMLElement;
  if (r.erros.length) {
    box.innerHTML = aviso('critico', `<b>Antes de fechar o turno, corrija:</b><ul>${r.erros.map((m) => `<li>${esc(m.msg)}</li>`).join('')}</ul>`);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const area = r.ops.reduce((s, o) => s + o.itens.reduce((a, i) => a + i.areaHa, 0), 0);
  const m = abrirModal('Fechar turno', `
    <p>Serão gravadas <b>${r.ops.length}</b> operação(ões) e <b>${r.paradas.length}</b> parada(s), somando <b>${esc(fmtHa(area, 2))}</b>.</p>
    <table class="tabela tabela-simples"><thead><tr><th>Drone</th><th>Fazenda / OS</th><th>Horário</th><th class="dir">Área</th><th class="dir">Efetivo</th></tr></thead><tbody>
    ${r.ops.map((o) => `<tr><td>${esc(nome.aeronave(o.aeronaveId))}</td><td>${esc(nome.fazenda(estado.idx.os.get(o.osId)?.fazendaId ?? ''))}<small class="bloco">${esc(nome.os(o.osId))}${o.status === 'impedida_clima' ? ' · impedida (clima)' : ''}</small></td><td>${esc(o.horaInicio)}–${esc(o.horaFim ?? '')}</td><td class="dir">${esc(fmtHa(o.itens.reduce((a, i) => a + i.areaHa, 0), 2))}</td><td class="dir">${esc(formatarDuracao(o.tempoEfetivoMin))}</td></tr>`).join('')}
    </tbody></table>
    ${r.avisos.length ? aviso('atencao', `<b>Pontos para conferência:</b><ul>${r.avisos.map((x) => `<li>${esc(x.msg)}</li>`).join('')}</ul>`) : ''}`,
    { largura: 'lg', rodapeHTML: `<button class="btn btn-sec" data-fechar>Voltar e revisar</button><button class="btn btn-pri" data-ok>${icone('ok', 16)} Gravar turno</button>` });
  m.el.querySelector('[data-ok]')!.addEventListener('click', () => {
    try {
      atualizarDataset(repo.adicionarOperacoes(r.ops, r.paradas));
      const dataDiario = b.data;
      try { localStorage.setItem(`${PREFIXO}diario`, JSON.stringify({ dia: dataDiario, filtro: { turnoId: '', liderId: '', campanhaId: '' } })); } catch { /* opcional */ }
      b = boletimVazio(hojeISO());
      Object.keys(ui).forEach((k) => delete ui[k]);
      salvar();
      m.fechar();
      toast(`Turno gravado: ${r.ops.length} operação(ões).`, 'ok');
      location.hash = '#/relatorios/diario';
    } catch (err) {
      toast((err as Error).message, 'erro');
    }
  });
}

// ---------- Desenho ----------
const opt = (v: string, t: string, sel: string | null | undefined, dis = false) => `<option value="${esc(v)}" ${v === (sel ?? '') ? 'selected' : ''} ${dis ? 'disabled' : ''}>${esc(t)}</option>`;
const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const campo = (rot: string, html: string, cls = '') => `<label class="campo ${cls}"><span>${esc(rot)}</span>${html}</label>`;
const SELO: Record<string, string> = { aguardando: 'selo-neutro', aplicando: 'selo-ok', pausado: 'selo-atencao', finalizado: 'selo-info' };
const ROT: Record<string, string> = { aguardando: 'Aguardando início', aplicando: 'Aplicando', pausado: 'Pausado', finalizado: 'Finalizado' };

function opcoesOS(sel: string, excluir = '') {
  const ordens = estado.ds.ordens.filter((o) => o.status !== 'cancelada' && (!b.campanhaId || o.campanhaId === b.campanhaId) && o.id !== excluir);
  const comSaldo = ordens.map((o) => ({ o, saldo: o.itens.reduce((s, it) => s + Math.max(0, saldoAtual(o.id, it.talhaoId, true) ?? 0), 0) }))
    .sort((a, z) => Number(z.saldo > 0.01) - Number(a.saldo > 0.01));
  return opt('', 'Escolha fazenda / OS…', sel) + comSaldo.map(({ o, saldo }) =>
    opt(o.id, `${nome.fazenda(o.fazendaId)} — ${o.numero} (${saldo > 0.01 ? `saldo ${fmtNum(saldo, 0)} ha` : 'concluída'})`, sel)).join('');
}

function desenhar(host: HTMLElement) {
  const ds = estado.ds;
  const lideres = ds.colaboradores.filter((c) => c.funcao === 'Líder de turno');
  const pilotos = ds.colaboradores.filter((c) => c.funcao === 'Piloto' && c.ativo);
  const produtosOS = (() => { const o = ds.ordens.find((x) => x.campanhaId === b.campanhaId && x.status !== 'cancelada'); return o ? o.calda : null; })();

  host.innerHTML = `
    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('calendario', 16)} Boletim do turno</h2></div><div class="campo-resumo" data-met="turno"></div></header>
      <div class="form-grade">
        ${campo('Data do turno', `<input type="date" data-k="data" value="${esc(b.data)}" max="${hojeISO()}">`)}
        ${campo('Turno', `<select data-k="turnoId">${opt('', 'Selecione…', b.turnoId)}${ds.turnos.filter((t) => t.ativo).map((t) => opt(t.id, `${t.nome} · ${t.periodo}`, b.turnoId)).join('')}</select>`)}
        ${campo('Líder do turno', `<select data-k="liderId">${opt('', 'Selecione…', b.liderId)}${lideres.map((l) => opt(l.id, l.nome, b.liderId)).join('')}</select>`)}
        ${campo('Campanha', `<select data-k="campanhaId">${opt('', 'Todas', b.campanhaId)}${ds.campanhas.map((c) => opt(c.id, c.nome, b.campanhaId)).join('')}</select>`)}
        ${campo('Responsável pelo fechamento', `<input data-k="responsavel" value="${esc(b.responsavel)}" placeholder="Nome">`)}
      </div>
      ${produtosOS ? `<div class="chips-info"><span>Calda da OS <b>${esc(fmtNum(produtosOS.volumeLHa, 0))} L/ha</b></span>${produtosOS.produtos.map((p) => `<span>${esc(nome.produto(p.produtoId))} <b>${esc(fmtNum(p.dosePlanejada, 3))} ${esc(p.unidade)}</b></span>`).join('')}</div>` : ''}
    </section>

    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('clima', 16)} Condições climáticas</h2><p>Limites: vento ${ds.limites.ventoMinKmh}–${ds.limites.ventoMaxKmh} km/h · UR ≥ ${ds.limites.umidadeMinPct}% · temp. ≤ ${ds.limites.temperaturaMaxC} °C</p></div>
        <div class="pag-acoes"><button class="btn btn-sec btn-peq" data-a="add-clima" data-m="inicio">${icone('mais', 14)} Inicial</button><button class="btn btn-sec btn-peq" data-a="add-clima" data-m="durante">${icone('mais', 14)} Durante</button><button class="btn btn-sec btn-peq" data-a="add-clima" data-m="fim">${icone('mais', 14)} Final</button></div></header>
      <div class="campo-clima">${b.clima.map((l, i) => linhaClima(l, i)).join('') || '<p class="vazio-txt">Nenhuma leitura. Toque em "Inicial" ao começar o turno.</p>'}</div>
    </section>

    <div class="campo-drones">${b.drones.map((d) => cartaoDrone(d, pilotos)).join('')}
      <button class="campo-add" data-a="add-drone">${icone('mais', 22)}<span>Adicionar drone ao turno</span></button>
    </div>

    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('info', 16)} Observações</h2></div></header>
      <textarea class="campo-obs" data-k="observacoes" rows="3" placeholder="Ocorrências, orientações, pendências…">${esc(b.observacoes)}</textarea>
    </section>

    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('historico', 16)} Linha do tempo do turno</h2></div></header>
      <div class="dia-tempo" data-met="tempo"></div>
    </section>

    <div id="campo-msgs"></div>
    <div class="campo-rodape">
      <button class="btn btn-sec" data-a="descartar">${icone('lixo', 15)} Descartar</button>
      <span data-met="rodape" class="muted"></span>
      <button class="btn btn-pri" data-a="fechar">${icone('ok', 16)} Fechar turno e gravar</button>
    </div>`;
  atualizarMetricas(host);
}

function linhaClima(l: LeituraClima, i: number) {
  const k = (c: string) => `clima.${i}.${c}`;
  const fora = avaliarLeitura(l, estado.ds.limites);
  return `<div class="campo-clima-linha ${fora.length ? 'fora' : ''}">
    <select data-k="${k('momento')}">${opt('inicio', 'Inicial', l.momento)}${opt('durante', 'Durante', l.momento)}${opt('fim', 'Final', l.momento)}</select>
    <label><small>Hora</small><input type="time" data-k="${k('hora')}" value="${esc(l.hora)}"></label>
    <label><small>Temp. °C</small><input data-k="${k('temperaturaC')}" data-tipo="num" inputmode="decimal" value="${esc(num(l.temperaturaC))}"></label>
    <label><small>UR %</small><input data-k="${k('umidadePct')}" data-tipo="num" inputmode="decimal" value="${esc(num(l.umidadePct))}"></label>
    <label><small>Vento km/h</small><input data-k="${k('ventoKmh')}" data-tipo="num" inputmode="decimal" value="${esc(num(l.ventoKmh))}"></label>
    <label><small>Chuva</small><select data-k="${k('chuva')}">${CONDICOES_CHUVA.map((c) => opt(c, c, l.chuva)).join('')}</select></label>
    <label><small>Orvalho</small><select data-k="${k('orvalho')}" data-tipo="bool">${opt('nao', 'Não', l.orvalho ? 'sim' : 'nao')}${opt('sim', 'Sim', l.orvalho ? 'sim' : 'nao')}</select></label>
    <span class="clima-sit" data-met="clima-${i}"></span>
    <button class="btn-icone perigo" data-a="rem-clima" data-i="${i}" aria-label="Remover leitura">${icone('lixo', 15)}</button>
  </div>`;
}

function cartaoDrone(d: DroneCampo, pilotos: { id: string; nome: string }[]) {
  const ds = estado.ds;
  const u = uiDe(d);
  const di = b.drones.indexOf(d);
  const outros = new Set(b.drones.filter((x) => x !== d).map((x) => x.aeronaveId));
  const trechoAtual = d.trechos[d.trechos.length - 1];
  const pausaAberta = trechoAtual?.pausas.find((p) => p.fim === null);
  const acoes: Record<string, string> = {
    aguardando: `<select class="campo-os" data-ui="${d.chave}.osSel">${opcoesOS(u.osSel)}</select><button class="btn-acao verde" data-a="iniciar" data-d="${d.chave}">${icone('dir', 22)}<span>Iniciar</span></button>`,
    aplicando: `<button class="btn-acao laranja" data-a="painel-pausar" data-d="${d.chave}">${icone('parada', 22)}<span>Pausar</span></button><button class="btn-acao azul" data-a="painel-mudar" data-d="${d.chave}">${icone('rota', 22)}<span>Mudar de área</span></button><button class="btn-acao escuro" data-a="finalizar" data-d="${d.chave}">${icone('ok', 22)}<span>Finalizar</span></button>`,
    pausado: `<button class="btn-acao verde" data-a="retomar" data-d="${d.chave}">${icone('restaurar', 22)}<span>Retomar</span></button><button class="btn-acao azul" data-a="painel-mudar" data-d="${d.chave}">${icone('rota', 22)}<span>Mudar de área</span></button><button class="btn-acao escuro" data-a="finalizar" data-d="${d.chave}">${icone('ok', 22)}<span>Finalizar</span></button>`,
    finalizado: `<button class="btn btn-sec" data-a="reabrir" data-d="${d.chave}">${icone('restaurar', 15)} Reabrir</button>`,
  };
  const painel = u.painel === 'pausar'
    ? `<div class="campo-painel"><b>Motivo da pausa</b><div class="motivos">${MOTIVOS_PARADA.map((m) => `<button class="chip-motivo" data-a="pausar" data-d="${d.chave}" data-m="${esc(m)}">${esc(m)}</button>`).join('')}</div></div>`
    : u.painel === 'mudar'
      ? `<div class="campo-painel"><b>Nova área</b><div class="campo-mudar"><select class="campo-os" data-ui="${d.chave}.osSel">${opcoesOS(u.osSel, trechoAtual?.osId)}</select><button class="btn btn-pri" data-a="mudar" data-d="${d.chave}">Confirmar mudança</button></div></div>`
      : '';

  return `<section class="cartao campo-drone est-${d.estado}">
    <header class="campo-drone-cab">
      <span class="dia-ic">${icone('drone', 18)}</span>
      <select data-k="drones.${di}.aeronaveId" ${d.estado !== 'aguardando' ? 'disabled' : ''}>${opt('', 'Aeronave…', d.aeronaveId)}${ds.aeronaves.map((a) => opt(a.id, `${a.identificacao} · ${a.modelo}${a.status === 'manutencao' ? ' (manutenção)' : ''}`, d.aeronaveId, outros.has(a.id))).join('')}</select>
      <select data-k="drones.${di}.pilotoId">${opt('', 'Piloto…', d.pilotoId)}${pilotos.map((p) => opt(p.id, p.nome, d.pilotoId)).join('')}</select>
      <span class="selo ${SELO[d.estado]}">${ROT[d.estado]}${pausaAberta ? ` · ${esc(pausaAberta.motivo)} desde ${esc(pausaAberta.inicio)}` : ''}</span>
      <button class="btn-icone perigo" data-a="rem-drone" data-d="${d.chave}" aria-label="Remover drone">${icone('lixo', 16)}</button>
    </header>
    <div class="campo-acoes">
      ${d.estado !== 'finalizado' ? `<div class="campo-hora"><small>Hora da ação</small><div><input type="time" data-ui="${d.chave}.hora" value="${esc(u.hora)}"><button class="btn btn-sec btn-peq" data-a="agora" data-d="${d.chave}">Agora</button></div></div>` : ''}
      ${acoes[d.estado]}
    </div>
    ${painel}
    ${d.trechos.map((t, ti) => {
      const os = estado.idx.os.get(t.osId);
      const adicionados = new Set(t.itens.map((i) => i.talhaoId));
      const disponiveis = (os?.itens ?? []).filter((it) => !adicionados.has(it.talhaoId));
      return `<div class="campo-trecho">
        <div class="campo-trecho-cab"><b>${d.trechos.length > 1 ? `Trecho ${ti + 1} · ` : ''}${esc(nome.fazenda(os?.fazendaId ?? ''))}</b><small>${esc(os?.numero ?? '')}</small>
          <label><small>Início</small><input type="time" data-k="drones.${di}.trechos.${ti}.inicio" value="${esc(t.inicio)}"></label>
          <label><small>Fim</small><input type="time" data-k="drones.${di}.trechos.${ti}.fim" value="${esc(t.fim ?? '')}" ${t.fim === null ? 'disabled placeholder="em curso"' : ''}></label>
          <span class="muted" data-met="trecho-${d.chave}-${ti}"></span></div>
        ${t.pausas.length ? `<div class="campo-pausas">${t.pausas.map((p, pi) => `<div class="campo-pausa"><span class="ev-ic mini">${icone('parada', 12)}</span>
          <select data-k="drones.${di}.trechos.${ti}.pausas.${pi}.motivo">${MOTIVOS_PARADA.map((m) => opt(m, m, p.motivo)).join('')}</select>
          <input type="time" data-k="drones.${di}.trechos.${ti}.pausas.${pi}.inicio" value="${esc(p.inicio)}">
          <span>–</span><input type="time" data-k="drones.${di}.trechos.${ti}.pausas.${pi}.fim" value="${esc(p.fim ?? '')}" ${p.fim === null ? 'disabled' : ''}>
          <button class="btn-icone perigo" data-a="rem-pausa" data-d="${d.chave}" data-t="${ti}" data-i="${pi}" aria-label="Remover pausa">${icone('lixo', 14)}</button></div>`).join('')}</div>` : ''}
        <div class="campo-talhoes">
          ${t.itens.map((it, ii) => `<div class="campo-talhao"><span>Talhão <b>${esc(nome.talhao(it.talhaoId))}</b></span><div class="com-unidade"><input data-k="drones.${di}.trechos.${ti}.itens.${ii}.areaHa" data-tipo="num" inputmode="decimal" value="${esc(num(it.areaHa))}"><span>ha</span></div><button class="btn-icone perigo" data-a="rem-talhao" data-d="${d.chave}" data-t="${ti}" data-i="${ii}" aria-label="Remover talhão">${icone('fechar', 14)}</button></div>`).join('')}
          ${disponiveis.length ? `<details class="campo-add-talhao"><summary>${icone('mais', 14)} Talhão aplicado</summary><div class="motivos">${disponiveis.map((it) => { const s = saldoAtual(t.osId, it.talhaoId) ?? 0; return `<button class="chip-motivo ${s <= 0.009 ? 'concl' : ''}" data-a="add-talhao" data-d="${d.chave}" data-t="${ti}" data-talhao="${esc(it.talhaoId)}">${esc(nome.talhao(it.talhaoId))} <small>${s <= 0.009 ? 'concluído' : `${fmtNum(s, 1)} ha`}</small></button>`; }).join('')}</div></details>` : ''}
        </div>
      </div>`;
    }).join('')}
    <div class="campo-drone-met" data-met="drone-${d.chave}"></div>
  </section>`;
}

/** Atualiza números e linha do tempo sem redesenhar (mantém o foco do campo em edição). */
function atualizarMetricas(host: HTMLElement) {
  const set = (k: string, html: string) => { const el = host.querySelector(`[data-met="${k}"]`); if (el) el.innerHTML = html; };
  let area = 0, efet = 0, parado = 0;
  for (const d of b.drones) {
    // parciais até a "hora da ação" do cartão (não o relógio): funciona também em lançamento retroativo
    const agoraH = uiDe(d).hora || agora();
    const m = metricasDrone(d, agoraH);
    area += m.area; efet += m.efetivo; parado += m.parado;
    set(`drone-${d.chave}`, `<span>Área <b>${esc(fmtHa(m.area, 2))}</b></span><span>Jornada <b>${esc(formatarDuracao(m.total))}</b></span><span>Parado <b>${esc(formatarDuracao(m.parado))}</b></span><span>Efetivo <b>${esc(formatarDuracao(m.efetivo))}</b></span><span>ha/h efetivo <b>${esc(fmtNum(produtividadeEfetiva(m.area, m.efetivo), 1))}</b></span>${d.estado !== 'finalizado' && d.estado !== 'aguardando' ? `<small class="muted">· parciais até ${esc(agoraH)}</small>` : ''}`);
    d.trechos.forEach((t, ti) => { const mt = metricasTrecho(t, agoraH); set(`trecho-${d.chave}-${ti}`, `${esc(fmtHa(mt.area, 2))} · efetivo ${esc(formatarDuracao(mt.efetivo))}`); });
  }
  b.clima.forEach((l, i) => { const f = avaliarLeitura(l, estado.ds.limites); set(`clima-${i}`, f.length ? `<span class="selo selo-atencao">Fora: ${esc(f.join(', '))}</span>` : '<span class="selo selo-neutro">Dentro</span>'); });
  set('turno', `<span>${b.drones.length} drone(s)</span><span>Área <b>${esc(fmtHa(area, 2))}</b></span><span>Efetivo <b>${esc(formatarDuracao(efet))}</b></span><span>Parado <b>${esc(formatarDuracao(parado))}</b></span>`);
  set('rodape', `${esc(fmtHa(area, 2))} no turno`);

  // linha do tempo do boletim
  const origem = b.drones.flatMap((d) => d.trechos.map((t) => t.inicio)).sort((x, y) => x.localeCompare(y))[0] ?? '00:00';
  const evs: { m: number; hora: string; tipo: string; txt: string; ac: string }[] = [];
  for (const d of b.drones) {
    const ac = nome.aeronave(d.aeronaveId);
    d.trechos.forEach((t, ti) => {
      evs.push({ m: rel(origem, t.inicio) ?? 0, hora: t.inicio, tipo: ti === 0 ? 'inicio' : 'retomada', txt: ti === 0 ? `Início · ${nome.fazenda(estado.idx.os.get(t.osId)?.fazendaId ?? '')}` : `Mudança de área · ${nome.fazenda(estado.idx.os.get(t.osId)?.fazendaId ?? '')}`, ac });
      t.pausas.forEach((p) => {
        evs.push({ m: rel(origem, p.inicio) ?? 0, hora: p.inicio, tipo: 'pausa', txt: p.motivo, ac });
        // pausa encerrada junto com o fim do trecho não é retomada (o drone não voltou a aplicar)
        if (p.fim && p.fim !== t.fim) evs.push({ m: rel(origem, p.fim) ?? 0, hora: p.fim, tipo: 'retomada', txt: 'Retomada', ac });
      });
      if (t.fim && ti === d.trechos.length - 1) evs.push({ m: rel(origem, t.fim) ?? 0, hora: t.fim, tipo: 'fim', txt: 'Fim da aplicação', ac });
    });
  }
  evs.sort((x, y) => x.m - y.m);
  set('tempo', evs.map((ev) => `<div class="ev ev-${ev.tipo}"><span class="ev-ic">${icone(ev.tipo === 'inicio' ? 'dir' : ev.tipo === 'fim' ? 'ok' : ev.tipo === 'retomada' ? 'restaurar' : 'parada', 15)}</span><b>${esc(ev.hora)}</b><small>${esc(ev.ac)}</small><span class="ev-txt">${esc(ev.txt)}</span></div>`).join('') || '<p class="vazio-txt">Os eventos aparecem aqui conforme você toca nos botões.</p>');
}
