import {
  areaPorDia, areaPorSemana, calcularIndicadores, temposRelogio, desempenhoPor, evolucaoAcumulada, filtrarLancamentos, filtrarOperacoes, minutosPorMotivo,
  ordensNoEscopo, planejadoVsRealizado,
} from '../domain/analytics';
import { addDias, areaOperacao, formatarDuracao, intervaloDatas, safeDiv } from '../domain/calc';
import { metaDiaria, metaPorDia, metaPorSemana } from '../domain/metas';
import { diasEntre, preverTermino, ritmoNecessario } from '../domain/previsao';
import { PREFIXO } from '../data/repository';
import { diasCampanha, resumoDias, resumoSafra } from '../domain/dias';
import { hojeISO, toast } from '../ui/dom';
import { exportarImagem } from '../ui/exportarImagem';
import { descreverFiltros } from '../domain/relatorios';
import { estado, nome } from '../state';
import { barras, barrasH, CORES, legenda, linhas, rosca } from '../ui/charts';
import { aviso, barraFiltros, cabecalhoPagina, seloOperacao } from '../ui/components';
import { abrirModal, esc, fmtData, fmtDataCurta, fmtHa, fmtNum, fmtPct } from '../ui/dom';
import { icone } from '../ui/icons';
import { abrirDetalheOperacao } from './aplicacoes';

function kpi(o: { rotulo: string; valor: string; unidade?: string; sub?: string; icone: string; formula: string; tom?: 'ok' | 'atencao' | 'critico' | '' }) {
  return `<div class="kpi ${o.tom ? `kpi-${o.tom}` : ''}">
    <div class="kpi-topo"><span class="kpi-rot">${esc(o.rotulo)}</span><span class="kpi-ico">${icone(o.icone, 17)}</span></div>
    <div class="kpi-val">${esc(o.valor)}${o.unidade ? `<small>${esc(o.unidade)}</small>` : ''}</div>
    ${o.sub ? `<div class="kpi-sub">${o.sub}</div>` : ''}
    <button class="kpi-formula" title="${esc(o.formula)}" aria-label="Como é calculado: ${esc(o.formula)}">${icone('info', 13)}<span>${esc(o.formula)}</span></button>
  </div>`;
}

function cartaoGrafico(id: string, titulo: string, sub: string, extra = '', classe = '') {
  return `<section class="cartao ${classe}"><header class="cartao-cab"><div><h2>${esc(titulo)}</h2><p>${esc(sub)}</p></div>${extra}</header><div id="${id}"></div></section>`;
}

export function renderDashboard(raiz: HTMLElement) {
  raiz.innerHTML = `
    ${cabecalhoPagina('Dashboard gerencial', 'Situação da operação no período e escopo filtrados.',
      `<button class="btn btn-sec" data-acao="exportar-imagem">${icone('relatorio', 16)} Exportar imagem</button><a class="btn btn-sec" href="#/aplicacoes">${icone('camadas', 16)} Ver aplicações</a><a class="btn btn-pri" href="#/aplicacoes/nova">${icone('mais', 16)} Nova aplicação</a>`)}
    <div id="dash-filtros"></div>
    <div id="dash-corpo"></div>`;
  const corpo = raiz.querySelector('#dash-corpo') as HTMLElement;
  corpo.addEventListener('click', aoClicar);
  corpo.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.acao !== 'base-previsao') return;
    basePrevisao = el.value as BasePrevisao;
    try { localStorage.setItem(CHAVE_BASE, basePrevisao); } catch { /* opcional */ }
    desenhar(corpo);
  });
  raiz.querySelector('[data-acao="exportar-imagem"]')!.addEventListener('click', (e) => void imagemPainel(corpo, e.currentTarget as HTMLButtonElement));
  barraFiltros(raiz.querySelector('#dash-filtros') as HTMLElement, () => desenhar(corpo));
  desenhar(corpo);
}

const CHAVE_BASE = `${PREFIXO}previsao-base`;
type BasePrevisao = 'periodo' | '14' | '7';
let basePrevisao: BasePrevisao = (() => { try { const v = localStorage.getItem(CHAVE_BASE); return v === '14' || v === '7' ? v : 'periodo'; } catch { return 'periodo'; } })();
const maxData = (a: string, b: string) => (a > b ? a : b);
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaSemana = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]; };

function cartaoPrevisao(prev: ReturnType<typeof preverTermino>, c: { deBase: string; ate: string; dataMeta: string | null; mDiaMedia: number; prazo: string | null; campanha: string | null; necessario: number | null; folga: number | null; restante: number; multiCampanha: boolean; recortada?: boolean }) {
  const l = (r: string, v: string) => `<div class="campo-l"><span>${esc(r)}</span><b>${v}</b></div>`;
  let status = '';
  if (prev.concluida) status = `<span class="selo selo-ok">${icone('ok', 13)} Área programada concluída</span>`;
  else if (prev.semRitmo) status = `<span class="selo selo-neutro">${icone('info', 13)} Sem aplicação na janela-base</span>`;
  else if (c.folga !== null) status = c.folga >= 0
    ? `<span class="selo selo-ok">${icone('ok', 13)} Dentro do prazo · ${c.folga} dia(s) de folga</span>`
    : `<span class="selo selo-critico">${icone('alerta', 13)} Atraso previsto de ${-c.folga} dia(s)</span>`;
  const principal = prev.concluida
    ? `<div class="prev-data">Concluída</div>`
    : prev.semRitmo || !prev.data
      ? `<div class="prev-data">—</div><p class="prev-sub">Não há área aplicada na janela-base para calcular o ritmo.</p>`
      : `<div class="prev-data">${esc(fmtData(prev.data))}</div>
         <p class="prev-sub">${esc(diaSemana(prev.data))} · em <b>${prev.diasNecessarios}</b> dias corridos após ${esc(fmtData(c.ate))}</p>
         ${prev.faixa ? `<p class="prev-faixa">Faixa provável (~80%): <b>${esc(fmtData(prev.faixa.otimista.data))}</b> a <b>${prev.faixa.pessimista ? esc(fmtData(prev.faixa.pessimista.data)) : 'indefinido'}</b></p>` : '<p class="prev-faixa">Poucos dias na janela para estimar a faixa de incerteza.</p>'}`;
  const opt = (v: BasePrevisao, t: string) => `<option value="${v}" ${basePrevisao === v ? 'selected' : ''}>${t}</option>`;
  return `<section class="cartao previsao">
    <header class="cartao-cab"><div><h2>${icone('calendario', 16)} Previsão de término da área programada</h2><p>Calculada automaticamente pelo ritmo médio real dos dias trabalhados</p></div>${status}</header>
    <div class="prev-grade">
      <div class="prev-principal">${principal}
        <p class="prev-sub">Restante: <b>${esc(fmtHa(Math.max(0, c.restante), 1))}</b></p></div>
      <div><h3 class="sec-tit">Ritmo usado</h3>
        <label class="campo prev-base"><span>Janela-base</span><select data-acao="base-previsao">${opt('periodo', 'Período filtrado')}${opt('14', 'Últimos 14 dias')}${opt('7', 'Últimos 7 dias')}</select></label>
        ${l('Dias corridos na janela', `${prev.diasCorridos} (${esc(fmtData(c.deBase))} a ${esc(fmtData(c.ate))})${c.recortada ? '<small class="bloco">começa no início da campanha</small>' : ''}`)}
        ${l('Dias com aplicação', `${prev.diasComAplicacao} (${esc(fmtPct(prev.fracDiasAplicacao === null ? null : prev.fracDiasAplicacao * 100, 0))})`)}
        ${l('Média por dia de aplicação', `${esc(fmtNum(prev.mediaPorDiaAplicacao, 1))} ha`)}
        ${l('Ritmo corrido (considera folgas/chuva)', `<span class="txt-destaque">${esc(fmtNum(prev.ritmoCorrido, 1))} ha/dia</span>`)}
      </div>
      <div><h3 class="sec-tit">Comparativos</h3>
        ${l(`No ritmo da meta (${fmtNum(c.mDiaMedia, 0)} ha/dia)`, esc(prev.concluida ? 'concluída' : fmtData(c.dataMeta)))}
        ${l('Prazo da campanha', c.prazo ? `${esc(fmtData(c.prazo))}<small class="bloco">${esc(c.campanha ?? '')}</small>` : c.multiCampanha ? '<small>Filtre uma campanha</small>' : '—')}
        ${l('Ritmo necessário até o prazo', c.prazo ? (c.necessario === null ? '<span class="txt-critico">prazo vencido</span>' : `${esc(fmtNum(c.necessario, 1))} ha/dia`) : '—')}
        ${c.prazo && c.necessario !== null && prev.ritmoCorrido ? l('Ritmo real ÷ necessário', `<span class="${prev.ritmoCorrido >= c.necessario ? 'txt-ok' : 'txt-critico'}">${esc(fmtPct((prev.ritmoCorrido / (c.necessario || 1)) * 100, 0))}</span>`) : ''}
      </div>
    </div>
    <p class="nota">Ritmo corrido = área aplicada na janela ÷ dias corridos (dias sem aplicação contam como zero). Dias necessários = área restante ÷ ritmo corrido, arredondado para cima. A faixa usa a variação diária do ritmo (média ± 1,28 × desvio ÷ √n) e supõe que os próximos dias se comportem como a janela-base — mesma frota, escala e padrão de clima.</p>
  </section>`;
}

let alertasAtuais: ReturnType<typeof calcularIndicadores>['alertas'] = [];

function desenhar(corpo: HTMLElement) {
  const { ds, idx, filtros: f } = estado;
  const ind = calcularIndicadores(ds, f, idx);
  alertasAtuais = ind.alertas;
  const opsPer = filtrarOperacoes(ds, f, idx);
  const opsAcum = filtrarOperacoes(ds, { ...f, status: '' }, idx, true);
  // área para gráficos: voos + lançamentos (sequência/ficha diária)
  const areaPer = [...opsPer, ...filtrarLancamentos(ds, f, idx)];
  const areaAcum = [...opsAcum, ...filtrarLancamentos(ds, { ...f, status: '' }, idx, true)];
  const pct = ind.pctExecutado;
  const pctBarra = Math.max(0, Math.min(100, pct ?? 0));
  const pctParado = safeDiv(ind.minParado, ind.minTotal);
  // no relógio: drones trabalhando/parados ao mesmo tempo contam uma vez
  const rel = temposRelogio(opsPer, idx);
  const somando = (v: number, r: number) => (Math.abs(v - r) >= 1 ? ` · ${esc(formatarDuracao(v))} somando os drones` : '');

  // Meta operacional (planejado por dia/semana) — recortada para 1 drone ou 1 turno quando filtrado
  const escopoMeta = { umDrone: !!(f.aeronaveId || f.pilotoId), umTurno: !!(f.turnoId || f.liderId) };
  const mDia = metaDiaria(ds.metas, escopoMeta);
  const mDiaMedia = mDia * (ds.metas.diasPorSemana / 7);
  // Janela operacional: dias antes do início (ou depois do fim) das campanhas no escopo não têm meta nem
  // entram no ritmo — senão um período que começa antes da campanha "dilui" o ritmo e a meta.
  const campanhasEscopo = [...new Set(ordensNoEscopo(ds, f).map((o) => o.campanhaId))];
  const campsJanela = ds.campanhas.filter((c) => (f.campanhaId ? c.id === f.campanhaId : campanhasEscopo.includes(c.id)));
  const iniOp = campsJanela.length ? campsJanela.map((c) => c.inicio).sort()[0] : null;
  const fimOp = campsJanela.length && campsJanela.every((c) => c.fim) ? campsJanela.map((c) => c.fim).sort().reverse()[0] : null;
  const recorteIni = iniOp && iniOp > f.de && iniOp <= f.ate ? iniOp : null;
  const metasDia = metaPorDia(ds.metas, f.de, f.ate, escopoMeta).map((x) => ((iniOp && x.data < iniOp) || (fimOp && x.data > fimOp) ? { ...x, meta: 0 } : x));
  const metaPeriodo = metasDia.reduce((a, x) => a + x.meta, 0);
  const pctMetaPeriodo = safeDiv(ind.areaPeriodo * 100, metaPeriodo);
  const diasRitmoMeta = ind.areaRestante > 0 ? safeDiv(ind.areaRestante, mDiaMedia) : 0;
  const dataMeta = diasRitmoMeta === null ? null : addDias(f.ate, Math.ceil(diasRitmoMeta));

  // Previsão de término pelo ritmo real (janela-base escolhida pelo usuário)
  const deBase0 = basePrevisao === 'periodo' ? f.de : maxData(f.de, addDias(f.ate, -(Number(basePrevisao) - 1)));
  const deBase = recorteIni ? maxData(deBase0, recorteIni) : deBase0;
  const opsBase = [...filtrarOperacoes(ds, { ...f, status: '', de: deBase }, idx), ...filtrarLancamentos(ds, { ...f, status: '', de: deBase }, idx)];
  const diasBase = areaPorDia(opsBase, deBase, f.ate).map((p) => p.valor);
  const prev = preverTermino(ind.areaRestante, diasBase, f.ate);
  const campanhaPrazo = ds.campanhas.find((c) => c.id === (f.campanhaId || (campanhasEscopo.length === 1 ? campanhasEscopo[0] : '')));
  const prazo = campanhaPrazo?.fim ?? null;
  const necessario = prazo ? ritmoNecessario(ind.areaRestante, f.ate, prazo) : null;
  const folga = prazo && prev.data ? diasEntre(prev.data, prazo) : null;
  const rotEscopo = escopoMeta.umDrone && escopoMeta.umTurno ? '1 drone em 1 turno' : escopoMeta.umDrone ? '1 drone' : escopoMeta.umTurno ? '1 turno' : `${ds.metas.turnosPorDia} turno(s) × ${ds.metas.dronesPorTurno} drone(s)`;

  const avisos: string[] = [];
  if (ind.alertas.length) avisos.push(aviso('atencao', `<b>${ind.alertas.length} ${ind.alertas.length === 1 ? 'item' : 'itens'} de OS com área aplicada acima da planejada.</b> Os dados não foram alterados — confira os registros. <button class="link" data-acao="alertas">Ver itens</button>`));
  if (ind.filtroDeRecursoAtivo) avisos.push(aviso('info', 'Filtro por aeronave, operador ou status ativo: a <b>área planejada</b> considera todo o escopo das OS (não depende de quem aplicou). Área restante e % executado comparam o planejado total com o aplicado <b>apenas pelo recurso filtrado</b>.'));

  corpo.innerHTML = `
    ${avisos.join('')}
    <section class="destaque">
      <div class="destaque-principal">
        <span class="kpi-rot">Área acumulada da campanha</span>
        <div class="destaque-valor">${esc(fmtNum(ind.areaAcumulada, 1))}<small>ha</small></div>
        <div class="progresso" role="progressbar" aria-valuenow="${pctBarra.toFixed(0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pctBarra}%"></div></div>
        <div class="destaque-legenda"><b>${esc(fmtPct(pct))}</b> executado de ${esc(fmtHa(ind.areaPlanejada, 1))} planejados · até ${esc(fmtData(f.ate))}</div>
        <div class="destaque-legenda">Previsão de término no ritmo real: <b>${esc(prev.concluida ? 'concluída' : fmtData(prev.data))}</b> · no ritmo da meta: <b>${esc(prev.concluida ? 'concluída' : fmtData(dataMeta))}</b></div>
      </div>
      <div class="destaque-lado">
        <div><span class="kpi-rot">Área total planejada</span><b>${esc(fmtHa(ind.areaPlanejada, 1))}</b><em>Soma dos itens das OS no escopo (exclui canceladas)</em></div>
        <div><span class="kpi-rot">Área restante</span><b class="${ind.areaRestante < 0 ? 'txt-critico' : ''}">${esc(fmtHa(ind.areaRestante, 1))}</b><em>Planejada − aplicada${ind.areaObstaculos > 0.005 ? ' − obstáculos' : ''}</em></div>
        ${ind.areaObstaculos > 0.005 ? `<div><span class="kpi-rot">Obstáculos / descontos</span><b>${esc(fmtHa(ind.areaObstaculos, 2))}</b><em>Saldo das OS concluídas (não aplicável)</em></div>` : ''}
        <div><span class="kpi-rot">Aplicada no período</span><b>${esc(fmtHa(ind.areaPeriodo, 1))}</b><em>${esc(fmtData(f.de))} a ${esc(fmtData(f.ate))} · meta ${esc(fmtHa(metaPeriodo, 0))} (${esc(fmtPct(pctMetaPeriodo, 0))} atingido)${recorteIni ? ` · meta conta a partir de ${esc(fmtData(recorteIni))} (início da campanha)` : ''}${ind.areaLancada > 0.005 ? ` · inclui ${esc(fmtHa(ind.areaLancada, 2))} lançados na sequência/ficha (fora do ha/h)` : ''}</em></div>
        ${linhaSafra()}
        ${linhaDias(campanhaPrazo?.id ?? null)}
      </div>
    </section>

    ${cartaoPrevisao(prev, { deBase, ate: f.ate, dataMeta, mDiaMedia, prazo, campanha: campanhaPrazo?.nome ?? null, necessario, folga, restante: ind.areaRestante, recortada: !!recorteIni && deBase !== deBase0, multiCampanha: !f.campanhaId && campanhasEscopo.length > 1 })}

    <div class="kpis">
      ${kpi({ rotulo: 'Produtividade efetiva', valor: fmtNum(ind.prodEfetiva, 2), unidade: 'ha/h', icone: 'velocidade', formula: 'Área aplicada ÷ horas efetivas de aplicação', sub: `${esc(formatarDuracao(ind.minEfetivo))} efetivas · meta ${esc(fmtNum(ds.metas.haHoraDrone, 0))} ha/h por drone` })}
      ${kpi({ rotulo: 'Produtividade c/ paradas', valor: fmtNum(ind.prodOperacional, 2), unidade: 'ha/h', icone: 'relogio', formula: 'Área aplicada ÷ horas totais de operação (inclui paradas)', sub: `${esc(formatarDuracao(ind.minTotal))} totais` })}
      ${kpi({ rotulo: 'Produtividade diária', valor: fmtNum(ind.haPorDia, 1), unidade: 'ha/dia', icone: 'calendario', formula: 'Área aplicada no período ÷ dias com aplicação', sub: `${ind.diasComAplicacao} dias com aplicação · meta ${esc(fmtNum(mDia, 0))} ha/dia (${esc(fmtPct(safeDiv((ind.haPorDia ?? 0) * 100, mDia), 0))})` })}
      ${kpi({ rotulo: 'Tempo efetivo de aplicação', valor: formatarDuracao(rel.efetivo), icone: 'aplicacao', formula: 'No relógio: tempo em que algum drone estava aplicando (drones ao mesmo tempo contam uma vez)', sub: `no relógio${somando(ind.minEfetivo, rel.efetivo)}` })}
      ${kpi({ rotulo: 'Tempo total de operação', valor: formatarDuracao(rel.total), icone: 'relogio', formula: 'No relógio: do início ao fim dos voos (drones ao mesmo tempo contam uma vez)', sub: `no relógio${somando(ind.minTotal, rel.total)}` })}
      ${kpi({ rotulo: 'Tempo parado', valor: formatarDuracao(rel.parado), icone: 'parada', formula: 'No relógio: paradas registradas (drones parados ao mesmo tempo contam uma vez). A % é sobre o tempo dos voos somando os drones.', sub: `${pctParado === null ? '' : `${esc(fmtPct(pctParado * 100))} do tempo dos voos`}${somando(ind.minParado, rel.parado)}`, tom: pctParado !== null && pctParado > 0.35 ? 'atencao' : '' })}
      ${kpi({ rotulo: 'OS abertas', valor: String(ind.osAbertas), icone: 'os', formula: 'OS no escopo com status "Aberta"', sub: `${ind.osEmExecucao} em execução` })}
      ${kpi({ rotulo: 'Operações concluídas', valor: String(ind.opsConcluidas), icone: 'ok', formula: 'Operações do período com status "Concluída"', sub: `${ind.opsParciais} parciais · ${ind.opsNoPeriodo} no total` })}
      ${kpi({ rotulo: 'Aeronaves disponíveis', valor: `${ind.aeronavesDisponiveis}`, unidade: `de ${ind.aeronavesTotal}`, icone: 'drone', formula: 'Situação ATUAL do cadastro (não depende do período)' })}
      ${kpi({ rotulo: 'Impedidas por clima', valor: String(ind.opsImpedidasClima), icone: 'vento', formula: 'Operações do período com status "Impedida (clima)" + dias sem aplicação registrados por clima', sub: diasClimaPeriodo(f.de, f.ate, campsJanela.map((c) => c.id)), tom: ind.opsImpedidasClima > 0 ? 'atencao' : '' })}
    </div>

    <div class="grade-graficos">
      ${cartaoGrafico('g-dia', 'Área aplicada × planejado por dia', `Meta: ${fmtNum(mDiaMedia, 0)} ha/dia (${rotEscopo})`, legenda([{ nome: 'Aplicado', cor: CORES.realizado }, { nome: 'Planejado (meta diária)', cor: CORES.planejado, tracejada: true }]), 'largo')}
      ${cartaoGrafico('g-motivos', 'Motivos de parada', 'Tempo parado por motivo no período · no relógio (drones parados juntos contam uma vez)')}
      ${cartaoGrafico('g-evolucao', 'Evolução da campanha e projeção', 'Acumulado real, projeção pelo ritmo real, ritmo planejado e total planejado', legenda([{ nome: 'Aplicada acumulada', cor: CORES.realizado }, { nome: 'Projeção (ritmo real)', cor: CORES.realizado, pontilhada: true }, { nome: 'Ritmo planejado (meta)', cor: CORES.operacional, tracejada: true }, { nome: 'Total planejado', cor: CORES.planejado, tracejada: true }]), 'largo')}
      ${cartaoGrafico('g-semana', 'Área aplicada × planejado por semana', `Meta: ${fmtNum(mDia * ds.metas.diasPorSemana, 0)} ha/semana · semanas parciais proporcionais`, legenda([{ nome: 'Aplicado', cor: CORES.realizado }, { nome: 'Planejado', cor: CORES.planejado, tracejada: true }]))}
      ${cartaoGrafico('g-pr', 'Planejado × realizado por fazenda', 'Hectares acumulados até a data final', legenda([{ nome: 'Planejado', cor: CORES.planejado }, { nome: 'Realizado', cor: CORES.realizado }]), 'total')}
      ${cartaoGrafico('g-unidades', 'Comparativo entre unidades', 'Planejado × realizado por unidade agrícola', legenda([{ nome: 'Planejado', cor: CORES.planejado }, { nome: 'Realizado', cor: CORES.realizado }]))}
      ${cartaoGrafico('g-aeronave', 'Produtividade por aeronave', 'ha/h no período', legenda([{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }]))}
      ${cartaoGrafico('g-operador', 'Produtividade por operador', 'ha/h no período', legenda([{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }]))}
      ${cartaoGrafico('g-turno-area', 'Área aplicada por turno', 'Hectares no período · líder padrão entre parênteses', '', 'meio')}
      ${cartaoGrafico('g-turno-prod', 'Produtividade por turno', 'ha/h no período', legenda([{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }]), 'meio')}
    </div>

    <section class="cartao">
      <header class="cartao-cab"><div><h2>Últimas operações do período</h2><p>As 8 mais recentes · clique para ver o registro completo</p></div><a class="btn btn-sec btn-peq" href="#/aplicacoes">Ver todas</a></header>
      <div class="lista-ops">${[...opsPer].sort((a, b) => (b.data + b.horaInicio).localeCompare(a.data + a.horaInicio)).slice(0, 8).map((op) => `
        <button class="op-linha" data-op="${esc(op.id)}">
          <span class="op-data">${esc(fmtDataCurta(op.data))}<small>${esc(op.horaInicio)}</small></span>
          <span class="op-info"><b>${esc(nome.fazenda(estado.idx.os.get(op.osId)?.fazendaId ?? ''))}</b><small>${esc(nome.os(op.osId))} · ${esc(nome.aeronave(op.aeronaveId))} · ${esc(nome.colaborador(op.pilotoId))}</small></span>
          <span class="op-area">${esc(fmtHa(areaOperacao(op), 1))}</span>
          <span class="op-status">${seloOperacao(op.status)}</span>
        </button>`).join('') || '<p class="vazio-txt">Nenhuma operação no período filtrado.</p>'}</div>
    </section>`;

  // Gráficos
  const passo = (n: number) => Math.max(1, Math.ceil(n / 8));
  const dias = areaPorDia(areaPer, f.de, f.ate);
  barras(corpo.querySelector('#g-dia')!, dias.map((p) => ({ ...p, titulo: fmtData(p.rotulo) })), {
    cor: CORES.realizado, unidade: 'ha', rotuloX: (r, i, n) => (i % passo(n) === 0 ? fmtDataCurta(r) : null),
    meta: { nome: 'Planejado', cor: CORES.planejado, valores: metasDia.map((x) => x.meta) },
  });
  // semanas: meta proporcional só aos dias dentro da janela da campanha
  const naJanela = (d: string) => !((iniOp && d < iniOp) || (fimOp && d > fimOp));
  const metasSem = metaPorSemana(ds.metas, f.de, f.ate, escopoMeta).map((x) => {
    const dias = intervaloDatas(maxData(x.semana, f.de), addDias(x.semana, 6) < f.ate ? addDias(x.semana, 6) : f.ate).filter(naJanela).length;
    return x.diasNoPeriodo ? { ...x, meta: (x.meta * dias) / x.diasNoPeriodo, diasNoPeriodo: dias } : x;
  });
  const semanas = areaPorSemana(areaPer, f.de, f.ate);
  barras(corpo.querySelector('#g-semana')!, semanas.map((p) => ({ ...p, titulo: `Semana de ${fmtData(p.rotulo)} a ${fmtData(addDias(p.rotulo, 6))}` })), {
    cor: CORES.realizado, unidade: 'ha', rotuloX: (r, i, n) => (i % passo(n) === 0 ? fmtDataCurta(r) : null),
    meta: { nome: 'Planejado', cor: CORES.planejado, valores: metasSem.map((x) => x.meta), detalhe: (i) => (metasSem[i] && metasSem[i].diasNoPeriodo < 7 ? `<div class="tl">Semana parcial<b>${metasSem[i].diasNoPeriodo} dia(s) no período</b></div>` : '') },
  });

  const inicioEvol = areaAcum.reduce((m, o) => (o.data < m ? o.data : m), f.de || f.ate);
  const evol = evolucaoAcumulada(areaAcum, inicioEvol, f.ate);
  // Eixo estendido até a maior data prevista (limite de 180 dias à frente)
  const limite = addDias(f.ate, 180);
  const fimGraf = [prev.data, dataMeta].reduce<string>((m, d) => (d && d > m ? (d > limite ? limite : d) : m), f.ate);
  const rotEvol = intervaloDatas(inicioEvol, fimGraf);
  const iBase = evol.length - 1;
  const acumBase = evol[iBase]?.valor ?? 0;
  const ritmo = prev.ritmoCorrido ?? 0;
  linhas(corpo.querySelector('#g-evolucao')!, rotEvol, [
    { nome: 'Aplicada acumulada', cor: CORES.realizado, valores: rotEvol.map((_, i) => (i <= iBase ? evol[i].valor : null)) },
    { nome: 'Projeção (ritmo real)', cor: CORES.realizado, pontilhada: true, valores: rotEvol.map((_, i) => (i < iBase || !ritmo ? null : Math.min(Math.max(ind.areaPlanejada, acumBase), acumBase + ritmo * (i - iBase)))) },
    { nome: 'Ritmo planejado', cor: CORES.operacional, valores: (() => { let acc = 0; return metaPorDia(ds.metas, inicioEvol, fimGraf, escopoMeta).map((x) => (acc = Math.min(ind.areaPlanejada, acc + (naJanela(x.data) ? x.meta : 0)))); })(), tracejada: true },
    { nome: 'Total planejado', cor: CORES.planejado, valores: rotEvol.map(() => ind.areaPlanejada), tracejada: true },
  ], { unidade: 'ha', rotuloX: (r, i, n) => (i % passo(n) === 0 ? fmtDataCurta(r) : null), titulo: (r) => (r > f.ate ? `${fmtData(r)} (projeção)` : fmtData(r)), marcos: [{ indice: iBase, texto: `Último dado ${fmtDataCurta(f.ate)}` }] });

  const pr = planejadoVsRealizado(ds, f, idx, 'fazenda').sort((a, b) => b.planejado - a.planejado);
  barrasH(corpo.querySelector('#g-pr')!, pr.map((c) => ({ rotulo: c.rotulo, valores: [c.planejado, c.realizado], extraTip: `<div class="tl">Executado<b>${esc(fmtPct(safeDiv(c.realizado, c.planejado) === null ? null : (c.realizado / c.planejado) * 100))}</b></div>` })),
    [{ nome: 'Planejado', cor: CORES.planejado }, { nome: 'Realizado', cor: CORES.realizado }], { unidade: 'ha', casas: 0 });
  const un = planejadoVsRealizado(ds, f, idx, 'unidade');
  barrasH(corpo.querySelector('#g-unidades')!, un.map((c) => ({ rotulo: c.rotulo, valores: [c.planejado, c.realizado], extraTip: `<div class="tl">Executado<b>${esc(fmtPct(safeDiv(c.realizado * 100, c.planejado)))}</b></div>` })),
    [{ nome: 'Planejado', cor: CORES.planejado }, { nome: 'Realizado', cor: CORES.realizado }], { unidade: 'ha', casas: 0, larguraRotulo: 120 });

  const opsComArea = opsPer.filter((o) => o.status !== 'impedida_clima');
  const porAc = desempenhoPor(opsComArea, idx, 'aeronaveId', (id) => nome.aeronave(id));
  barrasH(corpo.querySelector('#g-aeronave')!, porAc.map((d) => ({ rotulo: d.rotulo, valores: [d.prodEfetiva, d.prodOperacional], extraTip: `<div class="tl">Área<b>${esc(fmtHa(d.area, 1))}</b></div><div class="tl">Operações<b>${d.ops}</b></div>` })),
    [{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }], { unidade: 'ha/h', casas: 1, larguraRotulo: 70 });
  const porOp = desempenhoPor(opsComArea, idx, 'pilotoId', (id) => nome.colaborador(id));
  barrasH(corpo.querySelector('#g-operador')!, porOp.map((d) => ({ rotulo: d.rotulo, valores: [d.prodEfetiva, d.prodOperacional], extraTip: `<div class="tl">Área<b>${esc(fmtHa(d.area, 1))}</b></div><div class="tl">Operações<b>${d.ops}</b></div>` })),
    [{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }], { unidade: 'ha/h', casas: 1, larguraRotulo: 120 });

  const rotTurno = (id: string) => { const t = ds.turnos.find((x) => x.id === id); return t ? `${t.nome} (${nome.colaborador(t.liderId)})` : id; };
  const lideresDe = (turnoId: string) => [...new Set(opsComArea.filter((o) => o.turnoId === turnoId).map((o) => nome.colaborador(o.liderId)))].join(', ');
  const porTurno = desempenhoPor(opsComArea, idx, 'turnoId', rotTurno);
  barrasH(corpo.querySelector('#g-turno-area')!, porTurno.map((d) => ({ rotulo: d.rotulo, valores: [d.area], extraTip: `<div class="tl">Operações<b>${d.ops}</b></div><div class="tl">Líderes no período<b>${esc(lideresDe(d.id))}</b></div>` })),
    [{ nome: 'Área aplicada', cor: CORES.realizado }], { unidade: 'ha', casas: 1, larguraRotulo: 190 });
  barrasH(corpo.querySelector('#g-turno-prod')!, porTurno.map((d) => ({ rotulo: d.rotulo, valores: [d.prodEfetiva, d.prodOperacional], extraTip: `<div class="tl">Área<b>${esc(fmtHa(d.area, 1))}</b></div>` })),
    [{ nome: 'Efetiva', cor: CORES.efetiva }, { nome: 'Com paradas', cor: CORES.operacional }], { unidade: 'ha/h', casas: 1, larguraRotulo: 190 });

  const motivos = minutosPorMotivo(opsPer, idx);
  const top = motivos.slice(0, 6);
  const resto = motivos.slice(6).reduce((s, m) => s + m.minutos, 0);
  const fatias = top.map((m, i) => ({ rotulo: m.motivo + (m.climatico ? ' ·clima' : ''), valor: m.minutos, cor: CORES.categoricas[i], detalhe: `<div class="tl">Ocorrências<b>${m.ocorrencias}</b></div><div class="tl">Somando os drones<b>${esc(formatarDuracao(m.minutosDrone))}</b></div>` }));
  if (resto > 0) fatias.push({ rotulo: 'Demais motivos', valor: resto, cor: CORES.outros, detalhe: '' });
  rosca(corpo.querySelector('#g-motivos')!, fatias, { centro: formatarDuracao(temposRelogio(opsPer, idx).parado), subCentro: 'parado', formatar: (v) => formatarDuracao(v) });

}

function aoClicar(e: Event) {
  const { ds } = estado;
  const t = e.target as HTMLElement;
  const b = t.closest('[data-op]') as HTMLElement | null;
  if (b) { const op = ds.operacoes.find((o) => o.id === b.dataset.op); if (op) abrirDetalheOperacao(op); }
  if (t.closest('[data-acao="alertas"]')) {
    abrirModal('Itens com área aplicada acima da planejada', `
      <p class="muted">Sinalização para conferência. Nenhum valor foi alterado automaticamente.</p>
      <table class="tabela tabela-simples"><thead><tr><th>OS</th><th>Fazenda</th><th>Talhão</th><th class="dir">Planejada</th><th class="dir">Aplicada</th><th class="dir">Excesso</th></tr></thead><tbody>
      ${alertasAtuais.map((a) => `<tr><td>${esc(nome.os(a.osId))}</td><td>${esc(nome.fazenda(nome.fazendaDoTalhao(a.talhaoId)))}</td><td>${esc(nome.talhao(a.talhaoId))}</td><td class="dir">${esc(fmtHa(a.planejadaHa))}</td><td class="dir">${esc(fmtHa(a.aplicadaHa))}</td><td class="dir txt-critico">+${esc(fmtHa(a.excessoHa))}</td></tr>`).join('')}
      </tbody></table>`, { largura: 'lg' });
  }
}

/** Meta fixa da safra (independente das campanhas e dos filtros). */
function linhaSafra(): string {
  const sf = resumoSafra(estado.ds, hojeISO());
  return `<div data-safra-painel><span class="kpi-rot">${esc(sf.safra.nome)} — meta da safra</span><b>${esc(fmtHa(sf.aplicado, 1))} de ${esc(fmtHa(sf.safra.metaHa, 0))}</b><em>${esc(fmtPct(sf.pct, 1))} atingido · falta ${esc(fmtHa(sf.falta, 0))} · ${sf.diasRestantes} dias restantes${sf.necessarioDia !== null ? ` · ${esc(fmtHa(sf.necessarioDia, 1))}/dia necessário` : ''} · todas as campanhas · <a href="#/planejamento">definir meta</a></em></div>`;
}

/** Dias corridos desde o início da campanha × dias com aplicação × dias parados. */
function linhaDias(campanhaId: string | null): string {
  if (!campanhaId) return '';
  const d = diasCampanha(estado.ds, campanhaId, hojeISO());
  if (!d || !d.corridos) return '';
  return `<div data-dias-painel><span class="kpi-rot">Dias da campanha</span><b>${d.comAplicacao} com aplicação de ${d.corridos} corridos</b><em>desde ${esc(fmtData(d.de))} · parados ${d.parados}${d.parados ? ` (${Object.entries(d.porMotivo).map(([m, n]) => `${esc(m)} ${n}`).join(', ')})` : ''} · sem registro ${d.semRegistro} · ${esc(fmtHa(d.haDiaEfetivo, 1))}/dia com aplicação · ${esc(fmtHa(d.haDiaCorrido, 1))}/dia corrido</em></div>`;
}

/** Dias sem aplicação por clima no período (registrados no Fechamento do dia). */
function diasClimaPeriodo(de: string, ate: string, campanhaIds: string[]): string {
  const r = resumoDias(estado.ds, de, ate, campanhaIds.length ? campanhaIds : null);
  return r.paradosClima ? `${r.paradosClima} dia(s) sem aplicação por clima` : '';
}

async function imagemPainel(corpo: HTMLElement, b: HTMLButtonElement) {
  const { ds, filtros: f } = estado;
  const agora = new Date();
  const cab = `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:6px 16px;margin:0 0 14px"><div><div style="font-size:22px;font-weight:700">Dashboard gerencial</div><div style="color:var(--texto-2);font-size:13px">Período ${esc(fmtData(f.de))} a ${esc(fmtData(f.ate))} · ${esc(descreverFiltros(ds, f, true).join(' · '))}</div></div><div style="color:var(--texto-2);font-size:12px;text-align:right">Gerado em ${esc(agora.toLocaleDateString('pt-BR'))} ${esc(agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}${ds.origemBase === 'propria' ? '' : '<br><b>DADOS DE DEMONSTRAÇÃO — fictícios</b>'}</div></div>`;
  b.disabled = true;
  try {
    await exportarImagem(corpo, { nomeArquivo: `dashboard-${f.de}-a-${f.ate}.png`, cabecalhoHTML: cab, remover: '[data-sem-imagem], .kpi-formula, button.link', cortarApos: '#g-semana', cssExtra: CSS_IMAGEM });
    toast('Imagem do painel baixada.', 'ok');
  } catch (e) { toast((e as Error).message, 'erro'); } finally { b.disabled = false; }
}

/** Letras maiores só na imagem exportada (a tela não muda): textos pequenos ficam legíveis no celular. */
const CSS_IMAGEM = `
.img-exp .nota, .img-exp .destaque-lado em, .img-exp .kpi-sub, .img-exp .legenda, .img-exp .legenda-lista, .img-exp .cartao-cab p, .img-exp .prev-faixa, .img-exp .selo { font-size: 14.5px !important; line-height: 1.4; }
.img-exp .kpi-rot, .img-exp .destaque-legenda, .img-exp .campo-l, .img-exp .prev-sub, .img-exp .kpi-val small { font-size: 15px !important; }
.img-exp .cartao-cab h2 { font-size: 17px !important; }
.img-exp .destaque-lado b { font-size: 22px !important; }
.img-exp .kpi-val { font-size: 25px !important; }
.img-exp .destaque-lado em, .img-exp .kpi-sub, .img-exp .nota, .img-exp .cartao-cab p { color: var(--texto-2) !important; }
.img-exp .destaque .destaque-lado em { color: rgba(255,255,255,.82) !important; }
.img-exp .g-eixo { font-size: 13.5px !important; fill: var(--texto-2) !important; }
.img-exp .g-cat { font-size: 14.5px !important; }
.img-exp .g-rotulo { font-size: 14.5px !important; }
.img-exp .g-rotulo-s { font-size: 13.5px !important; }
.img-exp .r-sub { font-size: 13px !important; }
`;
