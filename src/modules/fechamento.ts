/**
 * Fechamento do dia: registra o dia a partir da ficha diária (janela, pausas, área por drone, real por
 * fazenda/OS, clima). Toda área vira voo. O que a ficha não traz é estimado e marcado na prévia.
 */
import { round } from '../domain/calc';
import { aplicacoes, aplicadoPorItem, chaveItem } from '../domain/calc';
import { fichaVazia, gravarFechamento, previaFechamento, type FichaDia, type PreviaFechamento } from '../domain/fechamentoDia';
import { numeroBR } from '../domain/importacao';
import { MOTIVOS_PARADA, type MotivoParada } from '../domain/types';
import { novoId, PREFIXO } from '../data/repository';
import { alterar, estado, nome } from '../state';
import { aviso, cabecalhoPagina } from '../ui/components';
import { esc, fmtData, fmtNum, hojeISO, toast } from '../ui/dom';
import { icone } from '../ui/icons';
import { formatarDuracao } from '../domain/calc';
import { responsavelAtual } from './relatorios';
import { fichaDoDiaAcomp, lerCodigoAcomp, type LeituraAcomp } from '../domain/acomp';
import { abrirModal } from '../ui/dom';
import { registrarDiasParados, removerDiaParado } from '../domain/dias';
import { aeronaveDaSerie, agruparVoos, aplicarKmlNaFicha, lerKmlVoos, sugerirOS, type GrupoKml } from '../domain/kmlVoo';
import { volumeCalda } from '../domain/fechamentoDia';
import { aplicarCoberturaNaFicha, cruzarCobertura, linhasPadrao, type AcaoFora, type ResultadoCobertura } from '../domain/cobertura';

const CHAVE_ACOMP = `${PREFIXO}acomp-codigo`;
let leituraAcomp: LeituraAcomp | null = null;
const CHAVE_DATAS = `${PREFIXO}acomp-datas`;
/** Datas corrigidas: data registrada no app → data real (fica salva para reimportações). */
let memDatas: Record<string, string> = {};
function datasCorrigidas(): Record<string, string> { try { const v = localStorage.getItem(CHAVE_DATAS); return v ? JSON.parse(v) : { ...memDatas }; } catch { return { ...memDatas }; } }
const dataReal = (d: string) => datasCorrigidas()[d] ?? d;

const CHAVE = `${PREFIXO}fechamento-rascunho`;
let f: FichaDia = fichaVazia('');
let carregado = false;
let timer: number | undefined;

function carregar(): FichaDia {
  try { const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); if (s && s.versao === 1) return { ...fichaVazia(hojeISO()), ...s }; } catch { /* opcional */ }
  return novaFicha();
}
function novaFicha(): FichaDia {
  const x = fichaVazia(hojeISO());
  const t = estado.ds.turnos.find((y) => y.ativo);
  x.turnoId = t?.id ?? ''; x.liderId = t?.liderId ?? ''; x.responsavel = responsavelAtual();
  return x;
}
/** Texto de ajuda do volume do dia: volume da(s) OS do dia, se houver. */
function volOSTexto(): string {
  const vs = [...new Set(f.fazendas.map((z) => estado.ds.ordens.find((o) => o.id === z.osId)?.calda.volumeLHa).filter((v): v is number => !!v && v > 0))];
  return vs.length === 1 ? `${fmtNum(vs[0], 1)} (da OS)` : vs.length ? 'varia por OS' : 'informe';
}
function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(f)); } catch { /* opcional */ } }

const opt = (v: string, t: string, sel: string) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
const num = (v: number | null | undefined, c = 2) => (v === null || v === undefined ? '' : fmtNum(v, c));
const motivos = (sel: string) => MOTIVOS_PARADA.map((m) => opt(m, m, sel)).join('');

function saldoOS(): Map<string, number> {
  const apl = aplicadoPorItem(aplicacoes(estado.ds));
  return new Map(estado.ds.ordens.map((o) => [o.id, round(o.itens.reduce((s, i) => s + Math.max(0, i.areaPlanejadaHa - (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0)), 0), 4)]));
}

export function renderFechamento(raiz: HTMLElement) {
  if (!carregado) { f = carregar(); carregado = true; }
  const ds = estado.ds;
  const saldo = saldoOS();
  const ordens = ds.ordens.filter((o) => o.status !== 'cancelada').sort((a, b) => a.campanhaId.localeCompare(b.campanhaId) || (a.sequencia ?? 0) - (b.sequencia ?? 0));
  const rotOS = (id: string) => { const o = ds.ordens.find((x) => x.id === id); return o ? `${nome.fazenda(o.fazendaId)} · OS ${o.numero} · saldo ${fmtNum(saldo.get(o.id) ?? 0, 2)} ha` : ''; };
  const optsOS = (sel: string) => `<option value="">Escolha a fazenda / OS…</option>${ds.campanhas.map((c) => { const os = ordens.filter((o) => o.campanhaId === c.id && ((saldo.get(o.id) ?? 0) > 0.005 || o.id === sel)); return os.length ? `<optgroup label="${esc(c.nome)}">${os.map((o) => opt(o.id, rotOS(o.id), sel)).join('')}</optgroup>` : ''; }).join('')}`;
  const acs = ds.aeronaves.filter((a) => a.status !== 'indisponivel');
  const pilotos = ds.colaboradores.filter((c) => c.funcao === 'Piloto' && c.ativo);
  const lideres = ds.colaboradores.filter((c) => c.funcao === 'Líder de turno' && c.ativo);
  const tal = (id: string) => ds.talhoes.find((t) => t.id === id);

  raiz.innerHTML = `${cabecalhoPagina('Fechamento do dia', 'Registre o dia pela ficha diária: toda área vira voo, com drone, piloto e horário. O que a ficha não traz (área de cada drone em cada fazenda, horário de cada trecho) é estimado por proporção e pode ser editado.', `<button class="btn btn-pri" data-acao="importar-acomp">${icone('camadas', 15)} Importar do app de acompanhamento</button><button class="btn btn-sec" data-acao="importar-kml">${icone('rota', 15)} Importar KML de voo</button>${ultimoKml ? `<button class="btn btn-sec" data-acao="cruzamento">${icone('camadas', 15)} Cruzamento com os talhões</button>` : ''}<button class="btn btn-sec" data-acao="dia-parado">${icone('clima', 15)} Dia/turno sem aplicação</button><button class="btn btn-sec" data-acao="limpar">${icone('lixo', 15)} Limpar</button>`)}
  <div class="fch">
  <section class="cartao"><header class="cartao-cab"><h2>${icone('relogio', 16)} Dia</h2></header>
    <div class="form-grade compacta">
      <label class="campo"><span>Data</span><input type="date" data-f="data" value="${esc(f.data)}"></label>
      <label class="campo"><span>Hora inicial</span><input type="time" data-f="inicio" value="${esc(f.inicio)}"></label>
      <label class="campo"><span>Hora final</span><input type="time" data-f="fim" value="${esc(f.fim)}"></label>
      <label class="campo"><span>Turno</span><select data-f="turnoId">${opt('', 'Selecione…', f.turnoId)}${ds.turnos.filter((t) => t.ativo).map((t) => opt(t.id, `${t.nome} (${t.horaInicio}–${t.horaFim})`, f.turnoId)).join('')}</select><button type="button" class="link" data-acao="turno-parado" title="O turno não aplicou (vento, chuva…) — o outro turno pode ter aplicado">Este turno não aplicou? Lançar parada</button></label>
      <label class="campo"><span>Líder</span><select data-f="liderId">${opt('', 'Selecione…', f.liderId)}${lideres.map((c) => opt(c.id, c.nome, f.liderId)).join('')}</select></label>
      <label class="campo"><span>Responsável</span><input data-f="responsavel" value="${esc(f.responsavel)}" placeholder="Nome"></label>
      <label class="campo"><span>Taxa de aplicação (L/ha)</span><input class="num" inputmode="decimal" data-f="volumeLHa" value="${esc(num(f.volumeLHa, 1))}" placeholder="${esc(volOSTexto())}"><small>Vale para todas as fazendas do dia</small></label>
    </div>
  </section>

  <section class="cartao"><header class="cartao-cab"><div><h2>${icone('parada', 16)} Paradas do dia (linha do tempo)</h2><p>Valem para todos os drones. Ex.: aguardando umidade, mudança de área.</p></div><button class="btn btn-sec btn-peq" data-acao="add-pausa">${icone('mais', 14)} Parada</button></header>
    ${f.pausas.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples fch-tab"><thead><tr><th>Início</th><th>Fim</th><th>Motivo</th><th>Observação</th><th></th></tr></thead><tbody>
    ${f.pausas.map((p, i) => `<tr><td><input type="time" data-p="${i}" data-k="inicio" value="${esc(p.inicio)}"></td><td><input type="time" data-p="${i}" data-k="fim" value="${esc(p.fim ?? '')}"></td><td><select data-p="${i}" data-k="motivo">${motivos(p.motivo)}</select></td><td><input data-p="${i}" data-k="observacoes" value="${esc(p.observacoes ?? '')}"></td><td><button class="btn-icone" data-acao="rm-pausa" data-i="${i}" aria-label="Remover">${icone('fechar', 14)}</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="vazio-txt">Nenhuma parada no dia.</p>'}
  </section>

  <section class="cartao"><header class="cartao-cab"><div><h2>${icone('drone', 16)} Drones</h2><p>Área de cada drone (resumo operacional da ficha). Horário próprio e paradas só se o drone parou à parte (ex.: quebrou).</p></div><button class="btn btn-sec btn-peq" data-acao="add-drone">${icone('mais', 14)} Drone</button></header>
    ${f.drones.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples fch-tab"><thead><tr><th>Drone</th><th>Piloto</th><th class="dir">Área (ha)</th><th>Início próprio</th><th>Fim próprio</th><th></th></tr></thead><tbody>
    ${f.drones.map((d, j) => `<tr><td><select data-d="${j}" data-k="aeronaveId">${opt('', 'Selecione…', d.aeronaveId)}${acs.map((a) => opt(a.id, a.identificacao, d.aeronaveId)).join('')}</select></td>
      <td><select data-d="${j}" data-k="pilotoId">${opt('', 'Selecione…', d.pilotoId)}${pilotos.map((c) => opt(c.id, c.nome, d.pilotoId)).join('')}</select></td>
      <td class="dir"><input class="num" inputmode="decimal" data-d="${j}" data-k="area" value="${esc(num(d.area))}" placeholder="0,00"></td>
      <td><input type="time" data-d="${j}" data-k="inicio" value="${esc(d.inicio)}" title="Vazio = hora inicial do dia"></td><td><input type="time" data-d="${j}" data-k="fim" value="${esc(d.fim)}" title="Vazio = hora final do dia"></td>
      <td class="nowrap"><button class="btn btn-sec btn-peq" data-acao="add-pausa-drone" data-j="${j}">${icone('parada', 13)} Parada</button> <button class="btn-icone" data-acao="rm-drone" data-j="${j}" aria-label="Remover drone">${icone('fechar', 14)}</button></td></tr>
      ${d.pausas.map((p, i) => `<tr class="fch-sub"><td colspan="2"><small>Parada só do ${esc(nome.aeronave(d.aeronaveId) || 'drone')}</small></td><td><select data-dp="${j}:${i}" data-k="motivo">${motivos(p.motivo)}</select></td><td><input type="time" data-dp="${j}:${i}" data-k="inicio" value="${esc(p.inicio)}"></td><td><input type="time" data-dp="${j}:${i}" data-k="fim" value="${esc(p.fim ?? '')}"></td><td><button class="btn-icone" data-acao="rm-pausa-drone" data-j="${j}" data-i="${i}" aria-label="Remover">${icone('fechar', 14)}</button></td></tr>`).join('')}`).join('')}
    </tbody><tfoot><tr><td colspan="2">Total dos drones</td><td class="dir"><b data-tot="drones">—</b></td><td colspan="3"></td></tr></tfoot></table></div>` : '<p class="vazio-txt">Adicione os drones do dia.</p>'}
  </section>

  <section class="cartao"><header class="cartao-cab"><div><h2>${icone('fazenda', 16)} Fazendas / OS — real aplicado</h2><p>A soma tem de fechar com o total dos drones. Ao concluir uma OS com saldo, marque o talhão do desconto (obstáculo).</p></div><button class="btn btn-sec btn-peq" data-acao="add-faz">${icone('mais', 14)} Fazenda</button></header>
    ${f.fazendas.length ? `<div class="fch-faz">${f.fazendas.map((z, i) => {
      const os = ds.ordens.find((o) => o.id === z.osId);
      const sd = saldo.get(z.osId) ?? 0;
      const obst = z.concluir && z.real !== null ? round(sd - z.real, 4) : 0;
      return `<div class="fch-z">
        <div class="form-grade compacta">
          <label class="campo largo"><span>Fazenda / OS</span><select data-z="${i}" data-k="osId">${optsOS(z.osId)}</select></label>
          <label class="campo"><span>Real aplicado (ha)</span><input class="num" inputmode="decimal" data-z="${i}" data-k="real" value="${esc(num(z.real))}" placeholder="0,00"></label>
          <label class="campo"><span>Taxa (L/ha)</span><input class="num" inputmode="decimal" data-z="${i}" data-k="volumeLHa" value="${esc(num(z.volumeLHa, 1))}" placeholder="${esc(f.volumeLHa ? `${fmtNum(f.volumeLHa, 1)} (do dia)` : os && os.calda.volumeLHa > 0 ? `${fmtNum(os.calda.volumeLHa, 1)} (da OS)` : 'informe')}" title="Só se esta fazenda teve volume diferente do dia"></label>
          <label class="chk campo"><input type="checkbox" data-z="${i}" data-k="concluir" ${z.concluir ? 'checked' : ''} ${os ? '' : 'disabled'}><span>Concluir a OS<small>${os ? `saldo ${esc(fmtNum(sd, 2))} ha` : ''}</small></span></label>
          <div class="campo"><span>&nbsp;</span><button class="btn btn-sec btn-peq" data-acao="rm-faz" data-i="${i}">${icone('lixo', 13)} Remover</button></div>
        </div>
        ${os && z.concluir && obst > 0.005 ? `<div class="fch-desc"><span>Obstáculo de <b>${esc(fmtNum(obst, 2))} ha</b> — em qual talhão?</span>${os.itens.filter((it) => it.areaPlanejadaHa > 0).map((it) => `<label class="chk"><input type="checkbox" data-desc="${i}" value="${esc(it.talhaoId)}" ${z.descontoEm.includes(it.talhaoId) ? 'checked' : ''}><span>${esc(tal(it.talhaoId)?.zona ? `${tal(it.talhaoId)!.zona} · ` : '')}${esc(tal(it.talhaoId)?.codigo ?? '—')} <small>${esc(fmtNum(it.areaPlanejadaHa, 2))} ha</small></span></label>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>
    <div class="dia-total"><span>Total das fazendas</span><b data-tot="faz">—</b></div>` : '<p class="vazio-txt">Adicione as fazendas/OS aplicadas no dia.</p>'}
  </section>

  <section class="cartao"><header class="cartao-cab"><h2>${icone('clima', 16)} Clima da ficha</h2></header>
    <div class="form-grade compacta">
      ${([['tIni', 'Temp. inicial (°C)'], ['urIni', 'Umidade inicial (%)'], ['vIni', 'Vento inicial (km/h)'], ['tFim', 'Temp. final (°C)'], ['urFim', 'Umidade final (%)'], ['vFim', 'Vento final (km/h)']] as const).map(([k, r]) => `<label class="campo"><span>${r}</span><input class="num" inputmode="decimal" data-c="${k}" value="${esc(num(f.clima[k], 1))}"></label>`).join('')}
    </div>
    <div data-clima-acao></div>
  </section>

  <section class="cartao" id="fch-previa"></section>
  </div>`;
  if (!raiz.dataset.fchLigado) { raiz.dataset.fchLigado = '1'; ligar(raiz); }
  desenharPrevia(raiz);
}

function desenharPrevia(raiz: HTMLElement) {
  const host = raiz.querySelector('#fch-previa') as HTMLElement | null;
  if (!host) return;
  const ds = estado.ds;
  const p: PreviaFechamento = previaFechamento(ds, f, novoId, new Date().toISOString().slice(0, 19));
  const td = raiz.querySelector('[data-tot="drones"]'), tf = raiz.querySelector('[data-tot="faz"]');
  const fecha = Math.abs(p.totalDrones - p.totalFazendas) <= 0.0105;
  if (td) td.textContent = `${fmtNum(p.totalDrones, 2)} ha`;
  if (tf) tf.innerHTML = `${esc(fmtNum(p.totalFazendas, 2))} ha ${f.drones.length && f.fazendas.length ? (fecha ? '<span class="selo selo-ok">fecha com os drones</span>' : `<span class="selo selo-critico">${p.totalFazendas < p.totalDrones ? 'faltam' : 'sobram'} ${esc(fmtNum(Math.abs(p.totalDrones - p.totalFazendas), 2))} ha</span>`) : ''}`;
  const ca = raiz.querySelector('[data-clima-acao]') as HTMLElement | null;
  if (ca) ca.innerHTML = p.erros.some((e) => e.includes('parecem trocadas')) ? `<button class="btn btn-sec btn-peq" data-acao="trocar-clima">${icone('config', 13)} Trocar temperatura e umidade</button>` : '';
  const nomeAc = (j: number) => nome.aeronave(f.drones[j].aeronaveId) || `Drone ${j + 1}`;
  const temMatriz = p.rateio.m.length && !p.rateio.erros.length && f.fazendas.every((z) => z.osId);
  const matriz = temMatriz ? `<h3 class="sec-tit">${icone('area', 16)} Área de cada drone em cada fazenda</h3>
    <p class="nota"><span class="selo selo-neutro">est.</span> = estimado pela proporção do dia; digite um valor para fixar a célula (as demais se ajustam para manter os totais).</p>
    <div class="tabela-rolagem"><table class="tabela tabela-simples fch-mat"><thead><tr><th>Fazenda / OS</th>${f.drones.map((_, j) => `<th class="dir">${esc(nomeAc(j))}</th>`).join('')}<th class="dir">Real</th></tr></thead><tbody>
    ${f.fazendas.map((z, i) => { const os = ds.ordens.find((o) => o.id === z.osId); return `<tr><td>${esc(nome.fazenda(os?.fazendaId ?? ''))}<small class="bloco muted">OS ${esc(os?.numero ?? '')}</small></td>${f.drones.map((d, j) => `<td class="dir"><div class="fch-cel ${p.rateio.estimada[i][j] ? 'est' : 'fixa'}"><input class="num" inputmode="decimal" data-cel="${esc(z.osId)}|${esc(d.aeronaveId)}" value="${esc(fmtNum(p.rateio.m[i][j], 2))}" aria-label="Área ${esc(nomeAc(j))}">${p.rateio.estimada[i][j] ? '<span class="selo selo-neutro">est.</span>' : `<button class="btn-icone" data-acao="cel-limpar" data-cel-k="${esc(z.osId)}|${esc(d.aeronaveId)}" title="Voltar a estimar">${icone('fechar', 12)}</button>`}</div></td>`).join('')}<td class="dir"><b>${esc(fmtNum(z.real, 2))}</b></td></tr>`; }).join('')}
    </tbody><tfoot><tr><td>Total</td>${f.drones.map((d, j) => { const s = round(p.rateio.m.reduce((a, l) => a + l[j], 0), 2); const ok = Math.abs(s - (d.area ?? 0)) <= 0.0105; return `<td class="dir"><b>${esc(fmtNum(s, 2))}</b> ${ok ? '✔' : `<span class="txt-critico">≠ ${esc(fmtNum(d.area, 2))}</span>`}</td>`; }).join('')}<td class="dir"><b>${esc(fmtNum(p.totalFazendas, 2))}</b></td></tr></tfoot></table></div>` : '';
  const tempos = p.tempos.some(Boolean) ? `<h3 class="sec-tit">${icone('relogio', 16)} Tempo e produtividade por drone</h3>
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Drone</th><th>Janela</th><th class="dir">Jornada</th><th class="dir">Parado</th><th class="dir">Efetivo</th><th class="dir">Área</th><th class="dir">ha/h efetivo</th><th class="dir">ha/h jornada</th>${p.tempoVoo?.some((x) => x !== null) ? '<th class="dir">Em voo (KML)</th><th class="dir">ha/h em voo</th>' : ''}</tr></thead><tbody>
    ${p.tempos.map((t, j) => t ? `<tr><td>${esc(nomeAc(j))}</td><td>${esc(t.inicio)}–${esc(t.fim)}</td><td class="dir">${esc(formatarDuracao(t.total))}</td><td class="dir">${esc(formatarDuracao(t.parado))}</td><td class="dir"><b>${esc(formatarDuracao(t.efetivo))}</b></td><td class="dir">${esc(fmtNum(f.drones[j].area, 2))}</td><td class="dir"><b>${t.efetivo > 0 ? esc(fmtNum((f.drones[j].area ?? 0) / (t.efetivo / 60), 2)) : '—'}</b></td><td class="dir">${t.total > 0 ? esc(fmtNum((f.drones[j].area ?? 0) / (t.total / 60), 2)) : '—'}</td>${p.tempoVoo?.some((x) => x !== null) ? `<td class="dir">${p.tempoVoo[j] !== null ? esc(formatarDuracao(Math.round(p.tempoVoo[j]!))) : '—'}</td><td class="dir">${p.tempoVoo[j] ? esc(fmtNum((f.drones[j].area ?? 0) / (p.tempoVoo[j]! / 60), 2)) : '—'}</td>` : ''}</tr>` : '').join('')}
    </tbody></table></div>` : '';
  const voos = p.ops.length ? `<h3 class="sec-tit">${icone('aplicacao', 16)} Voos que serão gravados (${p.ops.length})</h3>
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Drone</th><th>Piloto</th><th>Fazenda / OS</th><th>Horário (estimado)</th><th class="dir">Área</th><th class="dir">Efetivo</th><th class="dir">Calda</th><th>Talhões</th></tr></thead><tbody>
    ${p.ops.map((o) => `<tr><td>${esc(nome.aeronave(o.aeronaveId))}</td><td>${esc(nome.colaborador(o.pilotoId))}</td><td>${esc(nome.fazenda(ds.ordens.find((x) => x.id === o.osId)?.fazendaId ?? ''))}<small class="bloco muted">OS ${esc(nome.os(o.osId))}</small></td><td>${esc(o.horaInicio)}–${esc(o.horaFim ?? '')}</td><td class="dir">${esc(fmtNum(o.itens.reduce((s, i) => s + i.areaHa, 0), 2))}</td><td class="dir">${esc(formatarDuracao(o.tempoEfetivoMin))}</td><td class="dir">${esc(fmtNum(o.calda.volumeLHa, 1))} L/ha</td><td><small>${o.itens.map((i) => `${esc(ds.talhoes.find((t) => t.id === i.talhaoId)?.codigo ?? '?')} ${esc(fmtNum(i.areaHa, 2))}`).join(' · ')}</small></td></tr>`).join('')}
    </tbody></table></div>` : '';
  host.innerHTML = `<header class="cartao-cab"><div><h2>${icone('ok', 16)} Prévia e conferência</h2><p>${esc(fmtData(f.data))} · nada é gravado antes de confirmar</p></div></header>
    ${p.erros.length ? aviso('critico', `<b>Para gravar, corrija:</b><ul>${p.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : aviso('info', `Pronto para gravar: <b>${p.ops.length}</b> voo(s) e <b>${p.paradas.length}</b> parada(s), ${esc(fmtNum(p.totalFazendas, 2))} ha.`)}
    ${p.substitui.length ? aviso('atencao', `Já existe fechamento de ${esc(fmtData(f.data))} para estes drones (${p.substitui.length} voo(s)). Ao gravar, ele é <b>substituído</b> (não soma).`) : ''}
    ${p.avisos.length ? aviso('atencao', `<b>Conferir:</b><ul>${p.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`) : ''}
    ${matriz}${tempos}${voos}
    <div class="fch-rod"><button class="btn btn-pri" data-acao="gravar" ${p.erros.length ? 'disabled' : ''}>${icone('ok', 16)} Gravar fechamento do dia</button></div>`;
}

function ligar(raiz: HTMLElement) {
  const agendar = () => { salvar(); window.clearTimeout(timer); timer = window.setTimeout(() => desenharPrevia(raiz), 200); };
  const redesenhar = () => { salvar(); renderFechamento(raiz); };
  const val = (el: HTMLInputElement | HTMLSelectElement) => el.value;
  raiz.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.f === 'volumeLHa') { f.volumeLHa = numeroBR(el.value); agendar(); return; }
    if (el.dataset.f && el.tagName === 'INPUT') { (f as unknown as Record<string, string>)[el.dataset.f] = val(el); agendar(); return; }
    if (el.dataset.p && el.tagName === 'INPUT') { const p = f.pausas[Number(el.dataset.p)]; (p as unknown as Record<string, string>)[el.dataset.k!] = val(el); agendar(); return; }
    if (el.dataset.dp && el.tagName === 'INPUT') { const [j, i] = el.dataset.dp.split(':').map(Number); (f.drones[j].pausas[i] as unknown as Record<string, string>)[el.dataset.k!] = val(el); agendar(); return; }
    if (el.dataset.d && el.tagName === 'INPUT') { const d = f.drones[Number(el.dataset.d)]; if (el.dataset.k === 'area') d.area = numeroBR(el.value); else (d as unknown as Record<string, string>)[el.dataset.k!] = val(el); agendar(); return; }
    if (el.dataset.z && el.dataset.k === 'real') { f.fazendas[Number(el.dataset.z)].real = numeroBR(el.value); agendar(); return; }
    if (el.dataset.z && el.dataset.k === 'volumeLHa') { f.fazendas[Number(el.dataset.z)].volumeLHa = numeroBR(el.value); agendar(); return; }
    if (el.dataset.c) { (f.clima as unknown as Record<string, number | null>)[el.dataset.c] = numeroBR(el.value); agendar(); }
  });
  raiz.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.cel) { const v = numeroBR(el.value); if (v === null) delete f.fixas[el.dataset.cel]; else f.fixas[el.dataset.cel] = v; salvar(); desenharPrevia(raiz); return; }
    if (el.dataset.f === 'turnoId') { f.turnoId = el.value; f.liderId = estado.ds.turnos.find((t) => t.id === el.value)?.liderId ?? f.liderId; redesenhar(); return; }
    if (el.dataset.f && el.tagName === 'SELECT') { (f as unknown as Record<string, string>)[el.dataset.f] = el.value; agendar(); return; }
    if (el.dataset.f === 'data') { redesenhar(); return; }
    if (el.dataset.p && el.tagName === 'SELECT') { f.pausas[Number(el.dataset.p)].motivo = el.value as MotivoParada; agendar(); return; }
    if (el.dataset.dp && el.tagName === 'SELECT') { const [j, i] = el.dataset.dp.split(':').map(Number); f.drones[j].pausas[i].motivo = el.value as MotivoParada; agendar(); return; }
    if (el.dataset.d && el.tagName === 'SELECT') {
      const d = f.drones[Number(el.dataset.d)];
      if (el.dataset.k === 'aeronaveId') { d.aeronaveId = el.value; const pp = estado.ds.aeronaves.find((a) => a.id === el.value)?.pilotoPadraoId; if (pp) d.pilotoId = pp; redesenhar(); }
      else { d.pilotoId = el.value; agendar(); }
      return;
    }
    if (el.dataset.z && el.dataset.k === 'osId') { const z = f.fazendas[Number(el.dataset.z)]; z.osId = el.value; z.descontoEm = []; redesenhar(); return; }
    if (el.dataset.z && el.dataset.k === 'concluir') { f.fazendas[Number(el.dataset.z)].concluir = el.checked; redesenhar(); return; }
    if (el.dataset.desc) { const z = f.fazendas[Number(el.dataset.desc)]; z.descontoEm = el.checked ? [...new Set([...z.descontoEm, el.value])] : z.descontoEm.filter((t) => t !== el.value); agendar(); }
  });
  raiz.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-acao]') as HTMLElement | null;
    if (!b) return;
    const a = b.dataset.acao, i = Number(b.dataset.i), j = Number(b.dataset.j);
    const ultimo = f.pausas[f.pausas.length - 1];
    switch (a) {
      case 'add-pausa': f.pausas.push({ motivo: 'Umidade abaixo do limite', inicio: ultimo?.fim ?? '', fim: '' }); break;
      case 'rm-pausa': f.pausas.splice(i, 1); break;
      case 'add-drone': { const usados = new Set(f.drones.map((d) => d.aeronaveId)); const ac = estado.ds.aeronaves.find((x) => x.status !== 'indisponivel' && !usados.has(x.id)); f.drones.push({ aeronaveId: ac?.id ?? '', pilotoId: ac?.pilotoPadraoId ?? '', area: null, inicio: '', fim: '', pausas: [] }); break; }
      case 'rm-drone': { const id = f.drones[j].aeronaveId; f.drones.splice(j, 1); Object.keys(f.fixas).filter((k) => k.endsWith(`|${id}`)).forEach((k) => delete f.fixas[k]); break; }
      case 'add-pausa-drone': f.drones[j].pausas.push({ motivo: 'Falha de equipamento', inicio: '', fim: '' }); break;
      case 'rm-pausa-drone': f.drones[j].pausas.splice(i, 1); break;
      case 'add-faz': f.fazendas.push({ osId: '', real: null, concluir: false, descontoEm: [] }); break;
      case 'rm-faz': { const id = f.fazendas[i].osId; f.fazendas.splice(i, 1); Object.keys(f.fixas).filter((k) => k.startsWith(`${id}|`)).forEach((k) => delete f.fixas[k]); break; }
      case 'cel-limpar': delete f.fixas[b.dataset.celK!]; salvar(); desenharPrevia(raiz); return;
      case 'trocar-clima': {
        const c = f.clima;
        if (c.tFim !== null && c.tFim > 50) [c.tFim, c.urFim] = [c.urFim, c.tFim];
        if (c.tIni !== null && c.tIni > 50) [c.tIni, c.urIni] = [c.urIni, c.tIni];
        break;
      }
      case 'limpar': f = novaFicha(); break;
      case 'importar-acomp': abrirImportAcomp(raiz); return;
      case 'dia-parado': abrirDiaParado(); return;
      case 'turno-parado': abrirDiaParado(f.turnoId || undefined); return;
      case 'importar-kml': abrirImportKml(raiz); return;
      case 'cruzamento': abrirCruzamento(raiz); return;
      case 'gravar': {
        const erro = alterar((ds) => gravarFechamento(ds, f, novoId, new Date().toISOString().slice(0, 19)));
        if (erro) { toast(erro, 'erro'); desenharPrevia(raiz); return; }
        const dia = f.data;
        try { localStorage.setItem(`${PREFIXO}diario`, JSON.stringify({ dia, filtro: { turnoId: '', liderId: '', campanhaId: '' } })); } catch { /* opcional */ }
        const vol = f.volumeLHa ?? null;
        f = novaFicha(); f.volumeLHa = vol; salvar();
        toast(`Fechamento de ${fmtData(dia)} gravado.`, 'ok');
        const faltam = leituraAcomp?.dias.some((d) => !estado.ds.operacoes.some((o) => o.fechamentoDia === dataReal(d.data)));
        if (faltam) { renderFechamento(raiz); abrirImportAcomp(raiz); return; }
        location.hash = '#/relatorios/diario';
        return;
      }
      default: return;
    }
    redesenhar();
  });
}

/** Janela: cola o código ACOMP1 do app de acompanhamento e escolhe o dia para abrir na ficha. */
function abrirImportAcomp(raiz: HTMLElement) {
  let codigo = '';
  try { codigo = localStorage.getItem(CHAVE_ACOMP) ?? ''; } catch { /* opcional */ }
  const m = abrirModal('Importar do app de acompanhamento', `
    <p class="nota">No app de acompanhamento: <b>Configurações → Exportar dados</b>, copie o código (começa com <code>ACOMP1:</code>) e cole aqui. O app de acompanhamento não é alterado. Cada dia fechado abre na ficha para você conferir e gravar.</p>
    <label class="campo"><span>Código de exportação</span><textarea data-ac="txt" rows="4" placeholder="ACOMP1:…">${esc(codigo)}</textarea></label>
    <label class="btn btn-sec btn-peq">${icone('camadas', 13)} Abrir arquivo .txt<input type="file" accept=".txt,text/plain" data-ac="arq" hidden></label>
    <div data-ac="res"></div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Fechar</button>' });
  const r = m.el;
  const res = r.querySelector('[data-ac="res"]') as HTMLElement;
  const base = () => ({ turnoId: f.turnoId || novaFicha().turnoId, liderId: f.liderId || novaFicha().liderId, responsavel: f.responsavel || responsavelAtual(), volumeLHa: f.volumeLHa ?? null });
  const mostrar = () => {
    const txt = (r.querySelector('[data-ac="txt"]') as HTMLTextAreaElement).value;
    if (!txt.trim()) { res.innerHTML = ''; return; }
    const l = lerCodigoAcomp(txt);
    if (l.erro && !l.dias.length) { res.innerHTML = aviso('critico', esc(l.erro)); return; }
    leituraAcomp = l;
    try { localStorage.setItem(CHAVE_ACOMP, txt); } catch { /* opcional */ }
    const fichas = l.dias.map((d) => ({ d, a: fichaDoDiaAcomp(estado.ds, l, d, base(), dataReal(d.data)) }));
    const total = l.dias.reduce((s, d) => s + (d.t70d ?? 0) + (d.t70a ?? 0), 0);
    res.innerHTML = `<div class="chips-info"><span>Campanha <b>${esc(l.campanha || '—')}</b></span><span>Dias fechados <b>${l.dias.length}</b></span><span>Área dos dias <b>${esc(fmtNum(total, 2))} ha</b></span>${l.meta ? `<span>Meta da campanha <b>${esc(fmtNum(l.meta, 2))} ha</b></span>` : ''}${l.diaAberto ? `<span>Dia em andamento <b>${esc(fmtData(l.diaAberto))}</b> (não importado)</span>` : ''}</div>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Data (corrigível)</th><th>Janela</th><th class="dir">T70 D</th><th class="dir">T70 A</th><th>Fazendas</th><th>Situação</th><th></th></tr></thead><tbody>
      ${fichas.map(({ d, a }) => `<tr data-acomp-dia="${esc(d.data)}"><td><input type="date" data-ac-data="${esc(d.data)}" value="${esc(dataReal(d.data))}" aria-label="Data real do dia">${dataReal(d.data) !== d.data ? `<small class="bloco muted">no app: ${esc(fmtData(d.data))}</small>` : ''}</td><td>${esc(d.horaIni)}–${esc(d.horaFim)}</td><td class="dir">${esc(fmtNum(d.t70d, 2))}</td><td class="dir">${esc(fmtNum(d.t70a, 2))}</td><td>${d.fazendas.map((z) => `${esc(z.nome)} <small>${esc(fmtNum(z.area, 2))}</small>`).join('<br>')}</td>
        <td>${a.jaGravado ? `<span class="selo selo-ok">gravado (${a.jaGravado} voos)</span>` : a.pendencias.length ? `<span class="selo selo-atencao">${a.pendencias.length} pendência(s)</span>` : '<span class="selo selo-info">pronto para conferir</span>'}</td>
        <td><button class="btn btn-${a.jaGravado ? 'sec' : 'pri'} btn-peq" data-ac-abrir="${esc(d.data)}">${a.jaGravado ? 'Abrir de novo' : 'Abrir na ficha'}</button></td></tr>
        ${a.pendencias.length || a.avisos.length ? `<tr class="fch-sub"><td colspan="7">${a.pendencias.map((x) => `<div class="txt-critico">• ${esc(x)}</div>`).join('')}${a.avisos.map((x) => `<div>• ${esc(x)}</div>`).join('')}</td></tr>` : ''}`).join('')}
      </tbody></table></div>
      <p class="nota">Abrir na ficha substitui o que estiver na tela. As pendências podem ser resolvidas e o dia aberto de novo. Gravar um dia já gravado substitui os voos dele (não soma).</p>`;
    res.querySelectorAll<HTMLButtonElement>('[data-ac-abrir]').forEach((b) => b.addEventListener('click', () => {
      const x = fichas.find((y) => y.d.data === b.dataset.acAbrir)!;
      f = fichaDoDiaAcomp(estado.ds, l, x.d, base(), dataReal(x.d.data)).ficha;
      salvar(); m.fechar(); renderFechamento(raiz);
      toast(`Dia ${fmtData(f.data)} aberto na ficha. Confira e grave.`, 'ok');
    }));
    res.querySelectorAll<HTMLInputElement>('[data-ac-data]').forEach((inp) => inp.addEventListener('change', () => {
      const orig = inp.dataset.acData!, nova = inp.value;
      const mapa = datasCorrigidas();
      if (!nova || nova === orig) delete mapa[orig]; else mapa[orig] = nova;
      memDatas = mapa;
      try { localStorage.setItem(CHAVE_DATAS, JSON.stringify(mapa)); } catch { /* opcional: fica só nesta sessão */ }
      mostrar();
    }));
  };
  r.querySelector('[data-ac="txt"]')!.addEventListener('input', mostrar);
  r.querySelector('[data-ac="arq"]')!.addEventListener('change', async (e) => {
    const arq = (e.target as HTMLInputElement).files?.[0];
    if (!arq) return;
    (r.querySelector('[data-ac="txt"]') as HTMLTextAreaElement).value = (await arq.text()).trim();
    mostrar();
  });
  mostrar();
}

// ---------------- KML de voo ----------------
const CORES_SERIE = ['#1f6feb', '#e8590c', '#2f9e44', '#9c36b5'];
/** Mapa simples (sem internet): trajetórias por drone e o número de cada grupo. */
function mapaKml(grupos: GrupoKml[], series: string[]): string {
  const pts = grupos.flatMap((g) => g.voos.flatMap((v) => v.trajeto));
  if (!pts.length) return '';
  const lon0 = Math.min(...pts.map((p) => p[0])), lon1 = Math.max(...pts.map((p) => p[0]));
  const lat0 = Math.min(...pts.map((p) => p[1])), lat1 = Math.max(...pts.map((p) => p[1]));
  const kx = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const w = Math.max(1e-6, (lon1 - lon0) * kx), h = Math.max(1e-6, lat1 - lat0);
  const L = 1000, H = Math.round((L * h) / w), pad = 24;
  const X = (lon: number) => pad + ((lon - lon0) * kx / w) * (L - 2 * pad), Y = (lat: number) => pad + ((lat1 - lat) / h) * (H - 2 * pad);
  const linhas = grupos.flatMap((g) => g.voos.map((v) => `<polyline fill="none" stroke="${CORES_SERIE[series.indexOf(v.serie) % CORES_SERIE.length]}" stroke-width="1.4" stroke-opacity=".75" points="${v.trajeto.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`)).join('');
  const rotulos = grupos.map((g) => `<g><circle cx="${X(g.cx).toFixed(1)}" cy="${Y(g.cy).toFixed(1)}" r="16" fill="var(--surface)" stroke="var(--texto)" stroke-width="1.5"/><text x="${X(g.cx).toFixed(1)}" y="${(Y(g.cy) + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--texto)">${esc(g.id)}</text></g>`).join('');
  const escala = (() => { const m = (w * 111320) / (L - 2 * pad); const km = [0.5, 1, 2, 5, 10].find((k) => (k * 1000) / m > 80) ?? 10; return `<g><line x1="${pad}" y1="${H - 8}" x2="${(pad + (km * 1000) / m).toFixed(1)}" y2="${H - 8}" stroke="var(--texto-2)" stroke-width="2"/><text x="${pad}" y="${H - 12}" font-size="12" fill="var(--texto-2)">${String(km).replace('.', ',')} km</text></g>`; })();
  return `<svg class="kml-mapa" viewBox="0 0 ${L} ${H + 4}" role="img" aria-label="Trajetórias dos voos">${linhas}${rotulos}${escala}</svg>
    <div class="kml-leg">${series.map((s, i) => `<span><i style="background:${CORES_SERIE[i % CORES_SERIE.length]}"></i>${esc(s)}</span>`).join('')}</div>`;
}

function abrirImportKml(raiz: HTMLElement) {
  const ds = estado.ds;
  const m = abrirModal('Importar KML de voo', `
    <p class="nota">Arquivo de trajetórias dos drones (um voo/carga por linha). A área de cada drone em cada fazenda passa a ser a <b>medida</b> no KML, e os voos ganham cargas, tempo em voo, volume, taxa real, altura, velocidade e espaçamento. O KML não traz data/hora: os voos entram no dia aberto na ficha (${esc(fmtData(f.data))}).</p>
    <label class="btn btn-pri">${icone('rota', 15)} Escolher arquivo .kml<input type="file" accept=".kml,application/vnd.google-earth.kml+xml" data-kml="arq" hidden></label>
    <div data-kml="res"></div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Fechar</button><button class="btn btn-pri" data-kml="aplicar" disabled>Aplicar na ficha</button>' });
  const r = m.el;
  const res = r.querySelector('[data-kml="res"]') as HTMLElement;
  let grupos: GrupoKml[] = [];
  let atrib: Record<string, string[]> = {};
  let acPorSerie: Record<string, string> = {};
  let series: string[] = [];
  const osOpcoes = ds.ordens.filter((o) => o.status !== 'cancelada').sort((a, b) => (a.sequencia ?? 0) - (b.sequencia ?? 0));
  const rotOS = (id: string) => { const o = ds.ordens.find((x) => x.id === id); return o ? `${nome.fazenda(o.fazendaId)} · OS ${o.numero}` : '?'; };
  const desenhar = (unidades: string, avisosLeitura: string[]) => {
    const totArea = grupos.reduce((s, g) => s + g.areaHa, 0), totVol = grupos.reduce((s, g) => s + g.volumeL, 0);
    const fora = grupos.reduce((s, g) => s + g.foraTaxa.length, 0), exced = grupos.reduce((s, g) => s + g.volumeExcedente, 0);
    const doDia = f.fazendas.filter((z) => z.osId).map((z) => z.osId);
    res.innerHTML = `<div class="chips-info"><span>Voos <b>${grupos.reduce((s, g) => s + g.voos.length, 0)}</b></span><span>Drones <b>${series.length}</b></span><span>Área <b>${esc(fmtNum(totArea, 2))} ha</b></span><span>Volume <b>${esc(fmtNum(totVol, 0))} L</b></span><span>Taxa média <b>${esc(fmtNum(totArea ? totVol / totArea : null, 2))} L/ha</b></span><span>Fora da taxa <b>${fora}</b>${exced ? ` (≈ ${esc(fmtNum(exced, 0))} L a mais)` : ''}</span><span>Unidades <b>${esc(unidades)}</b></span></div>
      ${avisosLeitura.length ? aviso('atencao', avisosLeitura.map(esc).join('<br>')) : ''}
      ${mapaKml(grupos, series)}
      <h3 class="sec-tit">${icone('drone', 16)} Drones do arquivo</h3>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Série no KML</th><th class="dir">Área</th><th class="dir">Cargas</th><th class="dir">Em voo</th><th>Aeronave do protótipo</th></tr></thead><tbody>
      ${series.map((s) => { const area = grupos.reduce((a, g) => a + (g.porSerie[s]?.areaHa ?? 0), 0), carg = grupos.reduce((a, g) => a + (g.porSerie[s]?.cargas ?? 0), 0), tmp = grupos.reduce((a, g) => a + (g.porSerie[s]?.tempoMin ?? 0), 0);
        return `<tr><td><b>${esc(s)}</b></td><td class="dir">${esc(fmtNum(area, 2))}</td><td class="dir">${carg}</td><td class="dir">${esc(formatarDuracao(Math.round(tmp)))}</td><td><select data-kml-serie="${esc(s)}"><option value="">Escolha…</option>${ds.aeronaves.map((a) => `<option value="${esc(a.id)}" ${acPorSerie[s] === a.id ? 'selected' : ''}>${esc(a.identificacao)}${a.numeroSerie ? ` · ${esc(a.numeroSerie)}` : ''}</option>`).join('')}</select></td></tr>`; }).join('')}
      </tbody></table></div>
      <h3 class="sec-tit">${icone('fazenda', 16)} Grupos de voos (por local) → fazenda / OS</h3>
      <p class="nota">Sugerido pela área real da ficha ou pelo local já conhecido da fazenda. Deixe sem OS os grupos que não são deste dia.</p>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Grupo</th><th class="dir">Área</th><th>Por drone</th><th class="dir">Cargas</th><th class="dir">Taxa</th><th>Fora da taxa</th><th>Fazenda / OS</th></tr></thead><tbody>
      ${grupos.map((g) => `<tr data-kml-grupo="${esc(g.id)}"><td><b>${esc(g.id)}</b></td><td class="dir">${esc(fmtNum(g.areaHa, 2))}</td><td>${Object.entries(g.porSerie).map(([s, x]) => `<span class="kml-pt" style="border-color:${CORES_SERIE[series.indexOf(s) % CORES_SERIE.length]}">${esc(s.slice(-4))} ${esc(fmtNum(x.areaHa, 2))}</span>`).join(' ')}</td><td class="dir">${g.voos.length}</td><td class="dir">${esc(fmtNum(g.areaHa ? g.volumeL / g.areaHa : null, 2))}</td><td>${g.foraTaxa.length ? `<span class="selo selo-atencao">${g.foraTaxa.length} voo(s) · +${esc(fmtNum(g.volumeExcedente, 0))} L</span>` : '<span class="selo selo-ok">ok</span>'}</td>
        <td>${(atrib[g.id] ?? []).map((os) => `<span class="selo selo-info">${esc(rotOS(os))} <button class="btn-icone" data-kml-rm="${esc(g.id)}|${esc(os)}" aria-label="Tirar">${icone('fechar', 11)}</button></span>`).join(' ')}
          <select data-kml-add="${esc(g.id)}"><option value="">${(atrib[g.id] ?? []).length ? '+ outra OS (vizinha)…' : 'Não é deste dia — ou escolha a OS…'}</option>${[...doDia.map((id) => ds.ordens.find((o) => o.id === id)!).filter(Boolean), ...osOpcoes.filter((o) => !doDia.includes(o.id))].filter((o) => !(atrib[g.id] ?? []).includes(o.id)).map((o) => `<option value="${esc(o.id)}">${esc(rotOS(o.id))}${doDia.includes(o.id) ? ' (na ficha)' : ''}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>
      <div data-kml="msgs"></div>`;
    (r.querySelector('[data-kml="aplicar"]') as HTMLButtonElement).disabled = !grupos.some((g) => (atrib[g.id] ?? []).length);
  };
  let unidadesTxt = '', avisosLeitura: string[] = [];
  r.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.kml === 'arq') {
      const arq = (el as HTMLInputElement).files?.[0]; if (!arq) return;
      if (/\.kmz$/i.test(arq.name)) { res.innerHTML = aviso('critico', 'Arquivo .kmz (compactado): exporte como .kml ou descompacte e envie o .kml.'); return; }
      const l = lerKmlVoos(await arq.text());
      if (l.erros.length) { res.innerHTML = aviso('critico', l.erros.map(esc).join('<br>')); return; }
      const ref = f.fazendas.map((z) => volumeCalda(f, z, ds.ordens.find((o) => o.id === z.osId)?.calda.volumeLHa)).find((v) => v !== null) ?? f.volumeLHa ?? null;
      grupos = agruparVoos(l.voos, ref);
      series = [...new Set(l.voos.map((v) => v.serie))];
      acPorSerie = Object.fromEntries(series.map((s) => [s, aeronaveDaSerie(ds, s) || Object.entries(f.kmlSeries ?? {}).find(([, x]) => x === s)?.[0] || '']));
      atrib = sugerirOS(ds, f, grupos);
      unidadesTxt = l.unidades; avisosLeitura = l.avisos;
      desenhar(unidadesTxt, avisosLeitura);
      return;
    }
    if (el.dataset.kmlSerie) { acPorSerie[el.dataset.kmlSerie] = el.value; return; }
    if (el.dataset.kmlAdd && el.value) { (atrib[el.dataset.kmlAdd] ??= []).push(el.value); for (const g of grupos) if (g.id !== el.dataset.kmlAdd) atrib[g.id] = (atrib[g.id] ?? []).filter((x) => x !== el.value); desenhar(unidadesTxt, avisosLeitura); }
  });
  r.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-kml-rm],[data-kml="aplicar"]') as HTMLElement | null;
    if (!b) return;
    if (b.dataset.kmlRm) { const [g, os] = b.dataset.kmlRm.split('|'); atrib[g] = (atrib[g] ?? []).filter((x) => x !== os); desenhar(unidadesTxt, avisosLeitura); return; }
    const ap = aplicarKmlNaFicha(estado.ds, f, grupos, atrib, acPorSerie);
    const msgs = r.querySelector('[data-kml="msgs"]') as HTMLElement;
    if (ap.erros.length) { msgs.innerHTML = aviso('critico', `<ul>${ap.erros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); return; }
    f = { ...ap.ficha, kmlAvisos: ap.avisos };
    salvar(); m.fechar(); renderFechamento(raiz);
    toast(`KML aplicado: ${f.drones.length} drone(s), ${Object.keys(f.kml ?? {}).length} combinação(ões) fazenda × drone medidas.`, 'ok');
    // passo 2: cruzamento com os talhões (quando as fazendas têm contorno)
    const usados = grupos.filter((g) => (atrib[g.id] ?? []).length);
    ultimoKml = { voos: usados.flatMap((g) => g.voos), osIds: usados.flatMap((g) => atrib[g.id]), acPorSerie: { ...acPorSerie } };
    if (ultimoKml.osIds.some((os) => temContorno(os))) abrirCruzamento(raiz);
  });
}

// ---------------- Cruzamento com os talhões ----------------
let ultimoKml: { voos: import('../domain/kmlVoo').VooKml[]; osIds: string[]; acPorSerie: Record<string, string> } | null = null;
const temContorno = (osId: string) => { const o = estado.ds.ordens.find((x) => x.id === osId); return !!o && estado.ds.talhoes.some((t) => t.fazendaId === o.fazendaId && t.poligono?.length); };

function resumoConferencia(c: ResultadoCobertura, valores: Record<string, number> | null): string[] {
  const ds = estado.ds; const out: string[] = [];
  for (const fz of c.fazendas) {
    const med = fz.talhoes.reduce((s2, t) => s2 + t.medidoHa, 0), rep = fz.talhoes.reduce((s2, t) => s2 + t.repasseHa, 0), fal = fz.talhoes.reduce((s2, t) => s2 + Math.max(0, t.falhaHa), 0);
    const nomeF = nome.fazenda(fz.fazendaId);
    const reais = fz.osIds.map((os) => f.fazendas.find((z) => z.osId === os)?.real ?? null).filter((x): x is number => x !== null);
    out.push(`Cruzamento ${nomeF}: medido ${fmtNum(med, 2)} ha${reais.length ? ` × real ${fmtNum(reais.reduce((a, b) => a + b, 0), 2)} ha` : ''}; falha ${fmtNum(fal, 2)} ha; repasse ${fmtNum(rep, 2)} ha${fz.fora.length ? `; fora da OS: ${fz.fora.map((t) => `${t.codigo} (${fmtNum(t.cobertoHa, 2)} ha, ${Math.round(t.pct * 100)}%)`).join(', ')}` : ''}.`);
  }
  if (valores) { const ed = Object.keys(valores).length; if (ed) out.push(`${ed} talhão(ões) com aplicado definido no cruzamento.`); }
  void ds;
  return out;
}

function abrirCruzamento(raiz: HTMLElement) {
  if (!ultimoKml) { toast('Importe o KML de voo primeiro.', 'erro'); return; }
  const ds = estado.ds;
  const { voos, osIds, acPorSerie } = ultimoKml;
  const c = cruzarCobertura(ds, voos, osIds);
  const padrao = linhasPadrao(ds, c, f.data);
  const valores: Record<string, number> = Object.fromEntries(padrao.map((x) => [`${x.osId}|${x.talhaoId}`, x.padrao]));
  const acoes: Record<string, AcaoFora> = {};
  let modo: 'medido' | 'ficha' = 'medido';
  const series = [...new Set(voos.map((v) => v.serie))];
  const nomeSerie = (s: string) => ds.aeronaves.find((a) => a.id === acPorSerie[s])?.identificacao ?? s.slice(-4);
  const m = abrirModal('Cruzamento com os talhões', '<div data-cz="corpo"></div>', { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Fechar</button><button class="btn btn-sec" data-cz="restaurar">Restaurar medido</button><button class="btn btn-pri" data-cz="aplicar">Aplicar na ficha</button>' });
  const corpo = m.el.querySelector('[data-cz="corpo"]') as HTMLElement;
  const desenhar = () => {
    const tal = (id: string) => ds.talhoes.find((t) => t.id === id);
    corpo.innerHTML = `<p class="nota">Faixa pulverizada de cada carga (largura = espaçamento) sobre o contorno de cada talhão, grade de 1 m. <b>Medido</b> = % do talhão coberto × área plantada (desconta o carreador na mesma proporção). <b>Repasse</b> = área coberta por 2+ cargas.</p>
      <fieldset class="imp-ordem"><legend>O que vale como aplicado</legend>
        <label class="chk"><input type="radio" name="cz-modo" value="medido" ${modo === 'medido' ? 'checked' : ''}><span>Medido pelo cruzamento (editável)<small>Você pode corrigir o aplicado de cada talhão antes de aplicar.</small></span></label>
        <label class="chk"><input type="radio" name="cz-modo" value="ficha" ${modo === 'ficha' ? 'checked' : ''}><span>Manter o real da ficha<small>O cruzamento fica só como conferência (avisos na prévia).</small></span></label>
      </fieldset>
      ${c.semContorno.length ? aviso('atencao', `Sem contorno em talhões de: ${c.semContorno.map((id) => esc(nome.fazenda(id))).join(', ')}. Importe o mapa de talhões (Fazendas e talhões → Importar mapa de talhões).`) : ''}
      ${c.fazendas.map((fz) => {
        const linhas = padrao.filter((x) => fz.osIds.includes(x.osId));
        const somaMed = linhas.reduce((s2, x) => s2 + x.medido, 0), somaApl = linhas.reduce((s2, x) => s2 + (valores[`${x.osId}|${x.talhaoId}`] ?? 0), 0);
        const ct = (id: string) => fz.talhoes.find((t) => t.talhaoId === id)!;
        return `<h3 class="sec-tit">${icone('fazenda', 16)} ${esc(nome.fazenda(fz.fazendaId))} · OS ${esc(fz.osIds.map((o) => nome.os(o)).join(', '))}</h3>
        ${fz.mapa ? `<figure class="cz-fig"><canvas class="cz-mapa" data-cz-mapa="${esc(fz.fazendaId)}" width="${fz.mapa.w}" height="${fz.mapa.h}" role="img" aria-label="Mapa de cobertura"></canvas><figcaption><span><i style="background:#2f9e44"></i>aplicado</span><span><i style="background:#f08c00"></i>repasse (2+ cargas)</span><span><i style="background:#e03131"></i>falha (talhão da OS sem aplicação)</span><span><i style="background:#ced4da"></i>talhão fora da OS</span><span><i style="border:2px solid #343a40;background:transparent"></i>contorno da OS</span></figcaption></figure>` : ''}
        <div class="tabela-rolagem"><table class="tabela tabela-simples cz-tab"><thead><tr><th>Talhão</th><th class="dir">Plantada</th><th class="dir">Coberto</th><th class="dir">Repasse</th><th>Por drone</th><th class="dir">Medido</th><th class="dir">Aplicado</th></tr></thead><tbody>
        ${linhas.map((x) => { const t = ct(x.talhaoId); const k = `${x.osId}|${x.talhaoId}`; const v = valores[k]; const ed = Math.abs((v ?? 0) - x.padrao) > 0.005;
          return `<tr><td><b>${esc(t.codigo)}</b>${t.restricao ? ` <small class="muted">${esc(t.restricao)}</small>` : ''}</td><td class="dir">${esc(fmtNum(t.plantadaHa, 2))}</td><td class="dir">${esc(fmtNum(t.pct * 100, 1))}%</td><td class="dir">${t.repasseHa >= 0.01 ? esc(fmtNum(t.repasseHa, 2)) : '—'}</td><td>${Object.entries(t.porSerie).map(([s2, a]) => `<span class="kml-pt" style="border-color:${CORES_SERIE[series.indexOf(s2) % CORES_SERIE.length]}">${esc(nomeSerie(s2))} ${esc(fmtNum(a, 2))}</span>`).join(' ') || '—'}</td><td class="dir">${esc(fmtNum(x.medido, 2))}${x.limitado ? ' <span class="selo selo-atencao" title="Limitado ao saldo do talhão na OS">saldo</span>' : ''}</td>
            <td class="dir"><input class="num ${ed ? 'cz-editado' : ''}" inputmode="decimal" data-cz-v="${esc(k)}" value="${esc(fmtNum(v, 2))}" ${modo === 'ficha' ? 'disabled' : ''} aria-label="Aplicado no talhão ${esc(t.codigo)}">${ed ? '<small class="bloco muted">editado</small>' : ''}</td></tr>`; }).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="dir">${esc(fmtNum(linhas.reduce((s2, x) => s2 + ct(x.talhaoId).plantadaHa, 0), 2))}</td><td></td><td class="dir">${esc(fmtNum(linhas.reduce((s2, x) => s2 + ct(x.talhaoId).repasseHa, 0), 2))}</td><td></td><td class="dir"><b>${esc(fmtNum(somaMed, 2))}</b></td><td class="dir"><b>${esc(fmtNum(somaApl, 2))}</b></td></tr></tfoot></table></div>
        ${fz.fora.length ? `<p class="nota"><b>Talhões fora da OS com cobertura ≥ 10%:</b></p><div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Talhão</th><th class="dir">Coberto</th><th class="dir">Medido</th><th>O que fazer</th></tr></thead><tbody>
          ${fz.fora.map((t) => { const a = acoes[t.talhaoId] ?? { tipo: 'ignorar' }; const val = a.tipo === 'mover' ? `mover:${a.destino}` : a.tipo === 'adicionar' ? `add:${a.osId}` : 'ignorar';
            return `<tr><td><b>${esc(t.codigo)}</b>${t.restricao ? ` <small class="muted">${esc(t.restricao)}</small>` : ''}</td><td class="dir">${esc(fmtNum(t.cobertoHa, 2))} ha · ${Math.round(t.pct * 100)}%</td><td class="dir">${esc(fmtNum(t.medidoHa, 2))}</td><td><select data-cz-fora="${esc(t.talhaoId)}" ${modo === 'ficha' ? 'disabled' : ''}><option value="ignorar" ${val === 'ignorar' ? 'selected' : ''}>Não lançar</option>${fz.osIds.map((o) => `<option value="add:${esc(o)}" ${val === `add:${o}` ? 'selected' : ''}>Adicionar o talhão à OS ${esc(nome.os(o))}</option>`).join('')}${linhas.map((x) => `<option value="mover:${esc(x.talhaoId)}" ${val === `mover:${x.talhaoId}` ? 'selected' : ''}>Lançar no talhão ${esc(tal(x.talhaoId)?.codigo ?? '')} da OS</option>`).join('')}</select></td></tr>`; }).join('')}
          </tbody></table></div>` : ''}
        ${fz.passagem.length ? `<p class="nota">Passagem/deslocamento (&lt; 10%, não lançado): ${fz.passagem.map((t) => `${esc(t.codigo)} (${esc(fmtNum(t.cobertoHa, 2))} ha)`).join(', ')}.</p>` : ''}`;
      }).join('')}
      <div data-cz="msgs"></div>`;
  };
  const pintar = () => {
    for (const fz of c.fazendas) {
      const cv = m.el.querySelector(`[data-cz-mapa="${fz.fazendaId}"]`) as HTMLCanvasElement | null;
      const mp = fz.mapa; if (!cv || !mp) continue;
      const ctx = cv.getContext('2d'); if (!ctx) continue;
      const img = ctx.createImageData(mp.w, mp.h);
      // 1 falha · 2 aplicado · 3 repasse (fora da OS: tons neutros) | 4,5,6 = idem na OS
      const COR: Record<number, [number, number, number]> = { 1: [233, 236, 239], 2: [178, 242, 187], 3: [255, 216, 168], 4: [224, 49, 49], 5: [47, 158, 68], 6: [240, 140, 0] };
      for (let i = 0; i < mp.dados.length; i++) { const cor = COR[mp.dados[i]]; if (!cor) continue; img.data[i * 4] = cor[0]; img.data[i * 4 + 1] = cor[1]; img.data[i * 4 + 2] = cor[2]; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      const X = (x: number) => (x - mp.x0) / mp.celM, Y = (y: number) => mp.h - (y - mp.y0) / mp.celM;
      ctx.lineWidth = Math.max(1, mp.w / 500);
      for (const ct of mp.contornos) {
        ctx.strokeStyle = ct.naOS ? '#343a40' : '#adb5bd'; ctx.beginPath(); ct.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.stroke();
        if (ct.naOS) { const cx = ct.pts.reduce((a, p) => a + p[0], 0) / ct.pts.length, cy = ct.pts.reduce((a, p) => a + p[1], 0) / ct.pts.length; const fs = Math.max(10, mp.w / 45); ctx.font = `700 ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#212529'; ctx.strokeStyle = '#fff'; ctx.lineWidth = fs / 4; ctx.strokeText(ct.codigo, X(cx), Y(cy)); ctx.fillText(ct.codigo, X(cx), Y(cy)); ctx.lineWidth = Math.max(1, mp.w / 500); }
      }
    }
  };
  const desenharOrig = desenhar;
  const desenharTudo = () => { desenharOrig(); pintar(); };
  desenharTudo();
  m.el.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.name === 'cz-modo') { modo = el.value as 'medido' | 'ficha'; desenharTudo(); return; }
    if (el.dataset.czV) { const v = numeroBR(el.value); if (v === null) delete valores[el.dataset.czV]; else valores[el.dataset.czV] = v; desenharTudo(); return; }
    if (el.dataset.czFora) { const v = el.value; acoes[el.dataset.czFora] = v === 'ignorar' ? { tipo: 'ignorar' } : v.startsWith('add:') ? { tipo: 'adicionar', osId: v.slice(4) } : { tipo: 'mover', destino: v.slice(6) }; }
  });
  m.el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-cz]') as HTMLElement | null;
    if (!b) return;
    if (b.dataset.cz === 'restaurar') { for (const x of padrao) valores[`${x.osId}|${x.talhaoId}`] = x.padrao; for (const k of Object.keys(acoes)) delete acoes[k]; desenharTudo(); return; }
    if (b.dataset.cz !== 'aplicar') return;
    if (modo === 'ficha') {
      f = { ...f, kmlAvisos: [...(f.kmlAvisos ?? []), ...resumoConferencia(c, null)] };
      salvar(); m.fechar(); renderFechamento(raiz); toast('Cruzamento guardado como conferência; vale o real da ficha.', 'ok'); return;
    }
    const r = aplicarCoberturaNaFicha(estado.ds, f, c, valores, acoes, acPorSerie);
    if (r.erros.length) { (m.el.querySelector('[data-cz="msgs"]') as HTMLElement).innerHTML = aviso('critico', `<ul>${r.erros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); return; }
    // o cruzamento resolve a divisão entre OS vizinhas: some o aviso do passo do KML
    f = { ...r.ficha, kmlAvisos: [...(r.ficha.kmlAvisos ?? []).filter((a) => !/OS vizinhas/.test(a)), ...r.avisos, ...resumoConferencia(c, null)] };
    salvar(); m.fechar(); renderFechamento(raiz);
    toast('Aplicado por talhão levado para a ficha. Confira a prévia e grave.', 'ok');
  });
}

/** Registrar dia(s) sem aplicação (chuva, vento…) — entram na contagem de dias da campanha e da safra. */
function abrirDiaParado(turnoInicial?: string) {
  const hoje = hojeISO();
  const ref = f.data && f.data <= hoje ? f.data : hoje;
  const ds = estado.ds;
  const ativas = (d: string) => ds.campanhas.filter((c) => c.inicio <= d && (!c.fim || c.fim >= d));
  const turnos = ds.turnos.filter((t) => t.ativo || t.id === turnoInicial);
  const m = abrirModal('Dia ou turno sem aplicação', `
    <p class="nota">Lançamento manual de parada. <b>Dia inteiro</b>: ninguém aplicou (o dia conta como parado na campanha e na safra; dias com aplicação gravada não são marcados). <b>Só um turno</b>: um turno não aplicou (ex.: vento no seu turno) e o outro pode ter aplicado — o dia continua com a área do outro turno e o motivo aparece no gráfico como ½.</p>
    <div class="form-grade">
      <label class="campo"><span>Abrangência</span><select data-dp="turno">${opt('', 'Dia inteiro (todos os turnos)', turnoInicial ?? '')}${turnos.map((t) => opt(t.id, `Só o ${t.nome} (${t.horaInicio}–${t.horaFim})`, turnoInicial ?? '')).join('')}</select></label>
      <label class="campo"><span>De</span><input type="date" data-dp="de" value="${esc(ref)}" max="${esc(hoje)}"></label>
      <label class="campo"><span>Até</span><input type="date" data-dp="ate" value="${esc(ref)}" max="${esc(hoje)}"></label>
      <label class="campo"><span>Motivo</span><select data-dp="motivo">${motivos('Chuva')}</select></label>
      <label class="campo"><span>Observação</span><input data-dp="obs" placeholder="Ex.: chuva desde a madrugada, 18 mm"></label>
    </div>
    <fieldset class="campo"><legend>Campanhas</legend><div data-dp="camps"></div></fieldset>
    <div data-dp="msg"></div>
    <h3 class="sec-tit">Dias sem aplicação registrados</h3>
    <div data-dp="lista"></div>`, { largura: 'lg', rodapeHTML: `<button class="btn btn-sec" data-fechar>Fechar</button><button class="btn btn-pri" data-dp="gravar">${icone('ok', 15)} Registrar</button>` });
  const r = m.el;
  const q = <T extends HTMLElement>(k: string) => r.querySelector(`[data-dp="${k}"]`) as T;
  const camps = () => {
    const de = q<HTMLInputElement>('de').value || ref;
    const at = ativas(de);
    q<HTMLElement>('camps').innerHTML = ds.campanhas.length ? ds.campanhas.map((c) => `<label class="chk"><input type="checkbox" data-dp-camp="${esc(c.id)}" ${at.some((x) => x.id === c.id) ? 'checked' : ''}> ${esc(c.nome)} <small class="muted">${esc(fmtData(c.inicio))} a ${esc(fmtData(c.fim))}</small></label>`).join('') + '<p class="nota">Nenhuma marcada = vale para todas as campanhas.</p>' : '<p class="nota">Sem campanhas cadastradas: vale para todas.</p>';
  };
  const lista = () => {
    const ps = [...(estado.ds.diasParados ?? [])].sort((a, b) => b.data.localeCompare(a.data));
    q<HTMLElement>('lista').innerHTML = ps.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Data</th><th>Abrangência</th><th>Motivo</th><th>Campanhas</th><th>Observação</th><th></th></tr></thead><tbody>
      ${ps.map((p) => `<tr data-dp-linha="${esc(p.data)}"${p.turnoId ? ` data-dp-turno="${esc(p.turnoId)}"` : ''}><td>${esc(fmtData(p.data))}</td><td>${p.turnoId ? esc(nome.turno(p.turnoId)) : 'Dia inteiro'}</td><td>${esc(p.motivo)}</td><td>${p.campanhaIds.length ? p.campanhaIds.map((id) => esc(estado.ds.campanhas.find((c) => c.id === id)?.nome ?? '?')).join(', ') : 'todas'}</td><td>${esc(p.observacao ?? '')}</td><td><button class="btn-icone" data-dp-rm="${esc(p.id)}" title="Remover">${icone('lixo', 13)}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="nota">Nenhum dia sem aplicação registrado.</p>';
  };
  camps(); lista();
  q<HTMLInputElement>('de').addEventListener('change', () => { const de = q<HTMLInputElement>('de'), at = q<HTMLInputElement>('ate'); if (!at.value || at.value < de.value) at.value = de.value; camps(); });
  r.addEventListener('click', (e) => {
    const rm = (e.target as HTMLElement).closest('[data-dp-rm]') as HTMLElement | null;
    if (rm) { const erro = alterar((d) => removerDiaParado(d, rm.dataset.dpRm!)); if (erro) toast(erro, 'erro'); else { toast('Registro removido.', 'ok'); lista(); } return; }
    if (!(e.target as HTMLElement).closest('[data-dp="gravar"]')) return;
    const campanhaIds = [...r.querySelectorAll<HTMLInputElement>('[data-dp-camp]:checked')].map((x) => x.dataset.dpCamp!);
    let res: ReturnType<typeof registrarDiasParados> | null = null;
    const erro = alterar((d) => { res = registrarDiasParados(d, { de: q<HTMLInputElement>('de').value, ate: q<HTMLInputElement>('ate').value, motivo: q<HTMLSelectElement>('motivo').value as MotivoParada, observacao: q<HTMLInputElement>('obs').value, campanhaIds, turnoId: q<HTMLSelectElement>('turno').value || undefined }, novoId, hojeISO()); return res.erro; });
    const rr = res as ReturnType<typeof registrarDiasParados> | null;
    if (erro || !rr) { q<HTMLElement>('msg').innerHTML = aviso('critico', esc(erro ?? 'Erro.')); return; }
    const doTurno = q<HTMLSelectElement>('turno').value;
    q<HTMLElement>('msg').innerHTML = aviso(rr.gravados ? 'info' : 'atencao', `${rr.gravados} ${doTurno ? `dia(s) com o ${esc(nome.turno(doTurno))} parado` : 'dia(s) registrado(s) como sem aplicação'}.${rr.ignorados.length ? ` Não marcados (${doTurno ? 'esse turno já tem aplicação gravada' : 'já têm aplicação'}): ${rr.ignorados.map((d) => esc(fmtData(d))).join(', ')}.` : ''}`);
    if (rr.gravados) toast(doTurno ? `Parada do ${nome.turno(doTurno)} registrada.` : `${rr.gravados} dia(s) sem aplicação registrado(s).`, 'ok');
    lista();
  });
}
