/**
 * Diário de aplicações — mesma organização da tela de Acompanhamento Diário já usada em campo,
 * mas montada automaticamente a partir dos registros de operação.
 */
import { ultimo, formatarDuracao, intervaloDatas, produtividadeEfetiva, produtividadeOperacional, safeDiv } from '../domain/calc';
import { datasComOperacao, editarObservacao, resumoDia, type FiltroDia } from '../domain/diario';
import { editarEvento, excluirEvento } from '../domain/linhaTempo';
import { MOTIVOS_PARADA, type MotivoParada } from '../domain/types';
import { podeGravar } from '../data/nuvem';
import { metaDiaria } from '../domain/metas';
import { preverTermino } from '../domain/previsao';
import type { LeituraClima, Operacao } from '../domain/types';
import { contextoClima } from '../domain/estacao';
import { avaliarLeitura } from '../domain/validation';
import { PREFIXO } from '../data/repository';
import { alterar, estado, nome } from '../state';
import { aviso } from '../ui/components';
import { abrirModal, confirmar, esc, fmtData, fmtHa, fmtNum, fmtPct, toast } from '../ui/dom';
import { exportarPNG } from '../ui/exportar';
import { icone } from '../ui/icons';
import { botoesExportar, exportarRelatorio, responsavelAtual } from './relatorios';
import type { Relatorio } from '../domain/relatorios';

const CHAVE = `${PREFIXO}diario`;
let dia = '';
let evAtuais: import('../domain/diario').EventoLinhaTempo[] = [];
let obsAtuais: { aeronave: string; texto: string; opIds: string[] }[] = [];
let filtro: FiltroDia = { turnoId: '', liderId: '', campanhaId: '' };

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const diaSemana = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return DIAS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]; };
const hhmm = (min: number | null) => (min === null ? '—' : `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

export function renderDiario(raiz: HTMLElement) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); if (s) { filtro = { ...filtro, ...s.filtro }; dia = s.dia ?? ''; } } catch { /* opcional */ }
  const datas = datasComOperacao(estado.ds, filtro);
  if (!dia || !datas.includes(dia)) dia = ultimo(datas) ?? estado.filtros.ate;
  raiz.innerHTML = `<div id="diario"></div>`;
  const host = raiz.querySelector('#diario') as HTMLElement;
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
    if (b) {
      const ds = datasComOperacao(estado.ds, filtro);
      const i = ds.indexOf(dia);
      if (b.dataset.nav === 'ant') dia = i > 0 ? ds[i - 1] : (ultimo(ds.filter((d) => d < dia)) ?? dia);
      if (b.dataset.nav === 'prox') dia = i >= 0 && i < ds.length - 1 ? ds[i + 1] : (ds.find((d) => d > dia) ?? dia);
      if (b.dataset.nav === 'ultimo') dia = ultimo(ds) ?? dia;
      desenhar(host);
    }
    if ((e.target as HTMLElement).closest('[data-acao="imprimir"]')) window.print();
    const ex = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
    if (ex) void exportarRelatorio(relDiario(), ex.dataset.exp as 'csv' | 'xlsx' | 'pdf', ex);
    const bev = (e.target as HTMLElement).closest('[data-ev-editar]') as HTMLElement | null;
    if (bev) { editarEventoTela(host, evAtuais[Number(bev.dataset.evEditar)]); return; }
    const be = (e.target as HTMLElement).closest('[data-obs-editar],[data-obs-excluir]') as HTMLElement | null;
    if (be) { void acaoObservacao(host, be); return; }
    const bi = (e.target as HTMLElement).closest('[data-acao="imagem"]') as HTMLButtonElement | null;
    if (bi) void exportarPNG(host, `diario-aplicacoes-${dia}.png`, `Diário de aplicações ${fmtData(dia)}`, bi, ['dia-barra']);
  });
  host.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === 'dia' && el.value) dia = el.value;
    if (el.dataset.k === 'turnoId') { filtro.turnoId = el.value; filtro.liderId = ''; }
    if (el.dataset.k === 'liderId') filtro.liderId = el.value;
    if (el.dataset.k === 'campanhaId') filtro.campanhaId = el.value;
    desenhar(host);
  });
  desenhar(host);
}

/** O Diário como relatório exportável (mesmos números da tela). */
function relDiario(): Relatorio {
  const { ds, idx } = estado;
  const r = resumoDia(ds, idx, dia, filtro);
  obsAtuais = r.observacoes; evAtuais = r.eventos;
  const meta = metaDiaria(ds.metas, { umDrone: false, umTurno: !!(filtro.turnoId || filtro.liderId) });
  const filtros = [filtro.campanhaId ? `Campanha: ${nome.campanha(filtro.campanhaId)}` : '', filtro.turnoId ? `Turno: ${nome.turno(filtro.turnoId)}` : '', filtro.liderId ? `Líder: ${nome.colaborador(filtro.liderId)}` : ''].filter(Boolean);
  const leitura = (l: LeituraClima | null) => (l ? `${l.hora} · ${l.temperaturaC ?? '—'} °C · UR ${l.umidadePct ?? '—'}% · vento ${l.ventoKmh ?? '—'} km/h` : '—');
  return {
    id: 'diario', titulo: `Diário de aplicações — ${fmtData(dia)}`, periodo: { de: dia, ate: dia }, filtros: filtros.length ? filtros : ['Sem filtros'],
    geradoEm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(), responsavel: responsavelAtual(),
    indicadores: [{ rotulo: 'Área do dia', valor: r.areaDia, tipo: 'ha' }, { rotulo: 'Meta do dia', valor: meta, tipo: 'ha' }, { rotulo: 'ha/h efetivo', valor: produtividadeEfetiva(r.areaDia - r.areaLancadaDia, r.minEfetivoSoma), tipo: 'hah' }, { rotulo: 'Jornada', valor: r.jornadaMin, tipo: 'min' }, { rotulo: 'Acumulado da campanha', valor: r.acumuladoAteDia, tipo: 'ha' }, { rotulo: 'Executado', valor: safeDiv(r.acumuladoAteDia * 100, r.planejadoEscopo), tipo: 'pct' }],
    secoes: [
      { titulo: 'Resumo do dia', ficha: true, colunas: [{ titulo: 'Campo', tipo: 'texto' }, { titulo: 'Valor', tipo: 'texto' }], linhas: [
        ['Início / fim', `${hhmm(r.inicioMin)} – ${hhmm(r.fimMin)}`], ['Turnos', r.turnos.map(nome.turno).join(', ') || '—'], ['Líderes', r.lideres.map(nome.colaborador).join(', ') || '—'],
        ['Clima inicial', leitura(r.climaInicial)], ['Clima final', leitura(r.climaFinal)], ['Operações impedidas por clima', String(r.impedidas)],
        ...(r.areaLancadaDia > 0.005 ? [['Lançado sem voo (sequência/ficha)', `${fmtNum(r.areaLancadaDia, 2)} ha`]] : []),
      ] },
      { titulo: 'Fazendas aplicadas', colunas: [{ titulo: 'Fazenda', tipo: 'texto' }, { titulo: 'OS', tipo: 'texto' }, { titulo: 'Talhões', tipo: 'int', total: 'soma' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' }],
        linhas: r.fazendas.map((f) => [nome.fazenda(f.fazendaId), f.os.join(', '), f.talhoes, f.area]), totais: ['Total', null, r.fazendas.reduce((s, f) => s + f.talhoes, 0), r.fazendas.reduce((s, f) => s + f.area, 0)] },
      { titulo: 'Produtos', colunas: [{ titulo: 'Produto', tipo: 'texto' }, { titulo: 'Dose', tipo: 'dose' }, { titulo: 'Unidade', tipo: 'texto' }, { titulo: 'Quantidade total', tipo: 'num', casas: 2 }, { titulo: 'Un.', tipo: 'texto' }, { titulo: 'Lotes', tipo: 'texto' }],
        linhas: r.produtos.map((p) => [nome.produto(p.produtoId), p.dose, p.unidade, p.quantidade?.valor ?? null, p.quantidade?.unidade ?? '', p.lotes.join(', ')]) },
      { titulo: 'Por drone', colunas: [{ titulo: 'Drone', tipo: 'texto' }, { titulo: 'Operações', tipo: 'int', total: 'soma' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Tempo efetivo', tipo: 'min', total: 'soma' }, { titulo: 'Tempo total', tipo: 'min', total: 'soma' }, { titulo: 'ha/h efetivo', tipo: 'hah' }],
        linhas: r.porAeronave.map((a) => [nome.aeronave(a.aeronaveId), a.ops, a.area, a.minEfetivo, a.minTotal, produtividadeEfetiva(a.area, a.minEfetivo)]) },
      { titulo: 'Linha do tempo', colunas: [{ titulo: 'Hora', tipo: 'texto' }, { titulo: 'Drone', tipo: 'texto' }, { titulo: 'Evento', tipo: 'texto' }], linhas: r.eventos.map((ev) => [ev.hora, ev.aeronave, ev.texto]) },
      { titulo: 'Observações', colunas: [{ titulo: 'Drone', tipo: 'texto' }, { titulo: 'Observação', tipo: 'texto' }], linhas: r.observacoes.map((o) => [o.aeronave, o.texto]) },
    ],
    notas: ['Dia da operação = dia em que começou (aplicação noturna que passa da meia-noite conta no dia de início).'],
  };
}

function climaCard(rot: string, valor: number | null, un: string, ic: string, fora: boolean, sub: string) {
  return `<div class="dia-mini ${fora ? 'fora' : ''}"><span class="dia-ic">${icone(ic, 16)}</span><div><span class="dia-rot">${esc(rot)}</span><b>${valor === null ? '—' : esc(fmtNum(valor, valor % 1 ? 1 : 0))}<small>${esc(un)}</small></b><small>${esc(sub)}${fora ? ' · fora do limite' : ''}</small></div></div>`;
}

function desenhar(host: HTMLElement) {
  try { localStorage.setItem(CHAVE, JSON.stringify({ dia, filtro })); } catch { /* opcional */ }
  const { ds, idx } = estado;
  const r = resumoDia(ds, idx, dia, filtro);
  obsAtuais = r.observacoes; evAtuais = r.eventos;
  const lim = ds.limites;
  const datas = datasComOperacao(ds, filtro);
  const iDia = datas.indexOf(dia);
  const opt = (v: string, t: string, sel: string) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  const lideres = ds.colaboradores.filter((c) => c.funcao === 'Líder de turno');

  const prodEf = produtividadeEfetiva(r.areaDia, r.minEfetivoSoma);
  const prodJornada = produtividadeOperacional(r.areaDia, r.jornadaMin);
  const meta = metaDiaria(ds.metas, { umDrone: false, umTurno: !!(filtro.turnoId || filtro.liderId) });
  const pctMeta = safeDiv(r.areaDia * 100, meta);

  // Progresso e previsão até o dia
  const pct = safeDiv(r.acumuladoAteDia * 100, r.planejadoEscopo);
  const restante = r.planejadoEscopo - r.acumuladoAteDia - r.obstaculosEscopo;
  const inicioCamp = r.areaPorDiaAteDia[0]?.data ?? dia;
  const mapaDia = new Map(r.areaPorDiaAteDia.map((x) => [x.data, x.area]));
  const prev = preverTermino(restante, intervaloDatas(inicioCamp, dia).map((d) => mapaDia.get(d) ?? 0), dia);

  const ci = r.climaInicial, cf = r.climaFinal;
  const fora = (l: LeituraClima | null) => (l ? avaliarLeitura(l, lim) : []);
  const fi = fora(ci).join(' '), ff = fora(cf).join(' ');
  const angulo = Math.max(0, Math.min(100, pct ?? 0));
  const C = 2 * Math.PI * 52;

  const corpo = !r.ops.length
    ? `<section class="cartao">${aviso('info', `Nenhuma operação registrada em ${esc(fmtData(dia))}${filtro.turnoId || filtro.liderId ? ' para o turno/líder selecionado' : ''}. Use as setas para ir ao dia com operação mais próximo.`)}</section>`
    : `
    <section class="cartao dia-linha">
      <div class="dia-kpi"><span class="dia-ic">${icone('relogio', 18)}</span><div><span class="dia-rot">Hora inicial</span><b>${esc(hhmm(r.inicioMin))}</b><small>Início das atividades</small></div></div>
      <div class="dia-kpi"><span class="dia-ic laranja">${icone('relogio', 18)}</span><div><span class="dia-rot">Hora final</span><b>${esc(hhmm(r.fimMin))}${r.fimMin !== null && r.fimMin >= 1440 ? '<small> +1 dia</small>' : ''}</b><small>Término das atividades</small></div></div>
      <div class="dia-kpi"><span class="dia-ic">${icone('velocidade', 18)}</span><div><span class="dia-rot">Jornada</span><b>${esc(formatarDuracao(r.jornadaMin))}</b><small>Do 1º início ao último fim</small></div></div>
      <div class="dia-kpi"><span class="dia-ic verde">${icone('area', 18)}</span><div><span class="dia-rot">Aplicação do dia</span><b>${esc(fmtNum(r.areaDia, 1))}<small>ha</small></b><small>meta ${esc(fmtNum(meta, 0))} ha · ${esc(fmtPct(pctMeta, 0))}</small></div></div>
      <div class="dia-kpi"><span class="dia-ic">${icone('aplicacao', 18)}</span><div><span class="dia-rot">ha/h efetivo</span><b>${esc(fmtNum(prodEf, 2))}<small>ha/h</small></b><small>por drone, sem paradas</small></div></div>
      <div class="dia-kpi"><span class="dia-ic">${icone('parada', 18)}</span><div><span class="dia-rot">ha/h da jornada</span><b>${esc(fmtNum(prodJornada, 2))}<small>ha/h</small></b><small>área ÷ jornada (com paradas)</small></div></div>
    </section>

    <section class="cartao dia-linha clima">
      ${climaCard('Temp. inicial', ci?.temperaturaC ?? null, '°C', 'termometro', fi.includes('temperatura'), ci ? `${ci.hora} · ${ci.origem}` : 'sem leitura')}
      ${climaCard('Temp. final', cf?.temperaturaC ?? null, '°C', 'termometro', ff.includes('temperatura'), cf ? `${cf.hora}` : 'sem leitura')}
      ${climaCard('Umidade inicial', ci?.umidadePct ?? null, '%', 'gota', fi.includes('UR'), ci ? ci.hora : '')}
      ${climaCard('Umidade final', cf?.umidadePct ?? null, '%', 'gota', ff.includes('UR'), cf ? cf.hora : '')}
      ${climaCard('Vento inicial', ci?.ventoKmh ?? null, 'km/h', 'vento', fi.includes('vento'), ci?.direcaoVento ? `direção ${ci.direcaoVento}` : '')}
      ${climaCard('Vento final', cf?.ventoKmh ?? null, 'km/h', 'vento', ff.includes('vento'), cf?.direcaoVento ? `direção ${cf.direcaoVento}` : '')}
    </section>
    ${estacaoDoDia(r.ops)}

    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('fazenda', 16)} Fazendas aplicadas</h2></div><span class="muted">${r.fazendas.length} fazenda(s)</span></header>
      <div class="dia-fazendas">${r.fazendas.map((f) => `<div class="dia-faz"><b>${esc(nome.fazenda(f.fazendaId))}</b><span><em>Área</em> ${esc(fmtNum(f.area, 2))} <small>ha</small></span><small>${f.talhoes} talhão(ões) · ${esc(f.os.join(', '))}</small></div>`).join('')}</div>
      <div class="dia-total"><span>Área total das fazendas</span><b>${esc(fmtHa(r.areaDia, 2))}</b></div>
    </section>

    <section class="cartao">
      <header class="cartao-cab"><div><h2 class="dia-tit">${icone('produto', 16)} Produtos aplicados</h2><p>Dose utilizada (média ponderada pela área quando houver mais de uma operação) e quantidade total do dia</p></div></header>
      <div class="dia-produtos">${r.produtos.map((p) => `<div class="dia-prod"><b>${esc(nome.produto(p.produtoId))}</b><span>${esc(fmtNum(p.dose, p.unidade === 'mL/ha' || p.unidade === 'g/ha' ? 0 : 3))} ${esc(p.unidade)}</span><small>Total: ${p.quantidade ? `${esc(fmtNum(p.quantidade.valor, 2))} ${p.quantidade.unidade}` : '—'}${p.lotes.length ? ` · lote ${esc(p.lotes.join(', '))}` : ''}</small></div>`).join('') || '<p class="vazio-txt">Sem produtos no dia.</p>'}</div>
    </section>

    <div class="dia-dupla">
      <section class="cartao">
        <header class="cartao-cab"><div><h2 class="dia-tit">${icone('drone', 16)} Resumo operacional</h2></div></header>
        <div class="dia-drones">
          ${r.porAeronave.map((a) => `<div class="dia-drone"><span class="dia-ic">${icone('drone', 16)}</span><span class="dia-rot">${esc(nome.aeronave(a.aeronaveId))}</span><b>${esc(fmtNum(a.area, 2))}</b><small>ha · ${esc(fmtNum(produtividadeEfetiva(a.area, a.minEfetivo), 1))} ha/h efetivo</small></div>`).join('')}
          <div class="dia-drone total"><span class="dia-ic verde">${icone('area', 16)}</span><span class="dia-rot">Área total aplicada</span><b>${esc(fmtNum(r.areaDia, 2))}</b><small>ha · total das aeronaves</small></div>
          <div class="dia-drone acum"><span class="dia-ic">${icone('meta', 16)}</span><span class="dia-rot">Acumulado da campanha</span><b>${esc(fmtNum(r.acumuladoAteDia, 1))}</b><small>ha · até ${esc(fmtData(dia))}</small></div>
        </div>
        <div class="dia-tempos"><span>Efetivo (soma dos drones) <b>${esc(formatarDuracao(r.minEfetivoSoma))}</b></span><span>Parado <b>${esc(formatarDuracao(r.minParadoSoma))}</b></span>${r.impedidas ? `<span class="txt-critico">${r.impedidas} operação(ões) impedida(s) por clima</span>` : ''}</div>
      </section>
      <section class="cartao">
        <header class="cartao-cab"><div><h2 class="dia-tit">${icone('meta', 16)} Progresso da campanha</h2><p>${esc(r.campanhas.map(nome.campanha).join(' · '))}</p></div></header>
        <div class="dia-progresso">
          <svg viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Percentual concluído"><circle cx="64" cy="64" r="52" fill="none" stroke="var(--linha)" stroke-width="12"/><circle cx="64" cy="64" r="52" fill="none" stroke="var(--verde-500)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C * angulo) / 100} ${C}" transform="rotate(-90 64 64)"/><text x="64" y="66" text-anchor="middle" class="r-centro" style="font-size:22px">${esc(fmtNum(pct, 0))}%</text><text x="64" y="84" text-anchor="middle" class="r-sub">concluído</text></svg>
          <div class="dia-prog-txt">
            <div><span class="dia-rot">Concluído</span><b>${esc(fmtHa(r.acumuladoAteDia, 1))}</b></div>
            <div><span class="dia-rot">Restante</span><b>${esc(fmtHa(Math.max(0, restante), 1))}</b></div>
            <div><span class="dia-rot">Total programado</span><b>${esc(fmtHa(r.planejadoEscopo, 1))}</b></div>
          </div>
        </div>
        <div class="dia-total"><span>Dias de operação</span><b>${r.diasOperacaoAteDia}</b></div>
        <div class="dia-total prev"><span>Previsão de término (ritmo real até este dia)</span><b>${prev.concluida ? 'Concluída' : esc(fmtData(prev.data))}</b></div>
      </section>
    </div>

    <div class="dia-dupla inv">
      <section class="cartao">
        <header class="cartao-cab"><div><h2 class="dia-tit">${icone('info', 16)} Observações</h2></div></header>
        ${r.observacoes.length ? `<ul class="dia-obs">${r.observacoes.map((o, i) => `<li><b>${esc(o.aeronave)}</b> ${esc(o.texto)}${podeGravar() ? `<span class="dia-obs-acoes" data-sem-exportar><button class="btn-icone" data-obs-editar="${i}" title="Editar observação" aria-label="Editar observação">${icone('config', 13)}</button><button class="btn-icone" data-obs-excluir="${i}" title="Excluir observação" aria-label="Excluir observação">${icone('lixo', 13)}</button></span>` : ''}</li>`).join('')}</ul>` : '<p class="vazio-txt">Sem observações digitadas neste dia.</p>'}
      </section>
      <section class="cartao">
        <header class="cartao-cab"><div><h2 class="dia-tit">${icone('historico', 16)} Linha do tempo</h2><p>Gerada das paradas registradas · abastecimentos omitidos</p></div></header>
        <div class="dia-tempo">${r.eventos.map((ev, i) => `<div class="ev ev-${ev.tipo} ${ev.climatico ? 'ev-clima' : ''}">${podeGravar() && ev.tipo !== 'impedida' ? `<button class="btn-icone ev-editar" data-ev-editar="${i}" data-sem-exportar title="Editar ou excluir" aria-label="Editar ou excluir evento">${icone('config', 12)}</button>` : ''}<span class="ev-ic">${icone(ev.tipo === 'inicio' ? 'dir' : ev.tipo === 'fim' ? 'ok' : ev.tipo === 'retomada' ? 'restaurar' : ev.tipo === 'impedida' ? 'alerta' : 'parada', 15)}</span><b>${esc(ev.hora)}</b><small>${esc(ev.aeronave)}</small><span class="ev-txt">${esc(ev.texto)}</span></div>`).join('')}</div>
      </section>
    </div>`;

  host.innerHTML = `
    <section class="dia-cab">
      <div class="dia-cab-tit"><span class="dia-cab-ic">${icone('drone', 22)}</span><div><small>Relatórios · aplicação com drone</small><h1>Diário de aplicações</h1><p>Montado automaticamente a partir dos registros de operação</p></div></div>
      <div class="dia-cab-chips">
        <div class="dia-chip dia-data">
          <button class="btn-icone" data-nav="ant" aria-label="Dia anterior com operação" ${iDia === 0 ? 'disabled' : ''}>${icone('esq', 18)}</button>
          <label><small>Data</small><input type="date" data-k="dia" value="${esc(dia)}"></label>
          <button class="btn-icone" data-nav="prox" aria-label="Próximo dia com operação" ${iDia === datas.length - 1 ? 'disabled' : ''}>${icone('dir', 18)}</button>
        </div>
        <div class="dia-chip"><small>Campanha</small><b>${esc(r.campanhas.map(nome.campanha).join(' · ') || '—')}</b></div>
        <div class="dia-chip"><small>Turno · líder</small><b>${esc(r.turnos.map(nome.turno).join(', ') || '—')}${r.lideres.length ? ` · ${esc(r.lideres.map(nome.colaborador).join(', '))}` : ''}</b></div>
      </div>
    </section>
    <div class="dia-barra">
      <span class="muted">${esc(diaSemana(dia))}, ${esc(fmtData(dia))}</span>
      <label class="f-campo"><span>Campanha</span><select data-k="campanhaId">${opt('', 'Todas', filtro.campanhaId)}${ds.campanhas.map((c) => opt(c.id, c.nome, filtro.campanhaId)).join('')}</select></label>
      <label class="f-campo"><span>Turno</span><select data-k="turnoId">${opt('', 'Todos', filtro.turnoId)}${ds.turnos.map((t) => opt(t.id, t.nome, filtro.turnoId)).join('')}</select></label>
      <label class="f-campo"><span>Líder</span><select data-k="liderId">${opt('', 'Todos', filtro.liderId)}${lideres.map((l) => opt(l.id, l.nome, filtro.liderId)).join('')}</select></label>
      <button class="btn btn-sec btn-peq" data-nav="ultimo">${icone('calendario', 15)} Último dia</button>
      <button class="btn btn-sec btn-peq" data-acao="imagem">${icone('camadas', 15)} Exportar imagem</button>
      <button class="btn btn-sec btn-peq" data-acao="imprimir">${icone('relatorio', 15)} Imprimir</button>
      ${botoesExportar()}
    </div>
    ${corpo}
    <p class="nota">${estado.ds.origemBase === 'propria' ? '' : 'Dados fictícios (demonstração). '}Dia da operação = dia em que começou (aplicação noturna que passa da meia-noite conta no dia de início).</p>`;
}

/** Clima da estação meteorológica para cada operação do dia (só aparece se houver estação ligada). */
function estacaoDoDia(ops: Operacao[]): string {
  const ls = ops.map((op) => ({ op, c: contextoClima(estado.ds, op) })).filter((x) => x.c).sort((a, b) => a.op.horaInicio.localeCompare(b.op.horaInicio));
  if (!ls.length) return '';
  const f = (v: number | null, k = 1) => (v === null ? '—' : esc(fmtNum(v, k)));
  return `<section class="cartao" data-dia-estacao>
    <header class="cartao-cab"><div><h2 class="dia-tit">${icone('clima', 16)} Estação meteorológica</h2><p>"voo" = horas que cobrem a operação · "dia" = resumo diário (não é o horário do voo)</p></div><a class="btn btn-sec btn-peq" href="#/estacoes">Estações</a></header>
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Horário</th><th>Fazenda</th><th>Drone</th><th>Estação</th><th>Base</th><th class="dir">Chuva</th><th class="dir">T máx.</th><th class="dir">UR mín.</th><th class="dir">Rajada</th><th class="dir">ΔT pior</th><th>Alertas</th></tr></thead><tbody>
    ${ls.map(({ op, c }) => { const al = c!.alertas.filter((a) => a !== 'estação sem sensor de vento'); return `<tr><td>${esc(op.horaInicio)}–${esc(op.horaFim ?? '…')}</td><td>${esc(nome.fazenda(estado.ds.ordens.find((o) => o.id === op.osId)?.fazendaId ?? ''))}</td><td>${esc(nome.aeronave(op.aeronaveId))}</td><td>PIC ${esc(c!.estacao.pic)}</td><td>${c!.diario ? '<span class="selo selo-neutro">dia</span>' : '<span class="selo selo-info">voo</span>'}</td><td class="dir">${f(c!.chuva)} mm</td><td class="dir">${f(c!.tmax)} °C</td><td class="dir">${f(c!.urmin, 0)}%</td><td class="dir">${c!.estacao.temVento ? `${f(c!.rajada)} km/h` : 'sem sensor'}</td><td class="dir">${f(c!.deltaTPior)} °C</td><td>${al.map((a) => `<span class="selo selo-atencao">${esc(a)}</span>`).join(' ') || '<span class="selo selo-ok">ok</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
}

/** Editar / excluir uma observação digitada (vale para todos os voos do dia que têm o mesmo texto). */
async function acaoObservacao(host: HTMLElement, b: HTMLElement) {
  const o = obsAtuais[Number(b.dataset.obsEditar ?? b.dataset.obsExcluir)];
  if (!o) return;
  if (b.dataset.obsExcluir !== undefined) {
    if (!(await confirmar('Excluir observação', `Excluir esta observação do dia ${fmtData(dia)} (${o.aeronave})?\n\n"${o.texto}"`, 'Excluir'))) return;
    const erro = alterar((ds) => editarObservacao(ds, o.opIds, o.texto, null));
    if (erro) toast(erro, 'erro'); else { toast('Observação excluída.', 'ok'); desenhar(host); }
    return;
  }
  const m = abrirModal('Editar observação', `<p class="nota">${esc(fmtData(dia))} · ${esc(o.aeronave)}</p><label class="campo"><span>Observação</span><textarea data-obs-txt rows="5">${esc(o.texto)}</textarea></label><div data-obs-msg></div>`,
    { rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-obs-ok>Salvar</button>` });
  m.el.querySelector('[data-obs-ok]')!.addEventListener('click', () => {
    const novo = (m.el.querySelector('[data-obs-txt]') as HTMLTextAreaElement).value;
    const erro = alterar((ds) => editarObservacao(ds, o.opIds, o.texto, novo));
    if (erro) { (m.el.querySelector('[data-obs-msg]') as HTMLElement).innerHTML = aviso('critico', esc(erro)); return; }
    m.fechar(); toast('Observação salva.', 'ok'); desenhar(host);
  });
}

const ROT_EV: Record<string, string> = { inicio: 'Início da aplicação', fim: 'Fim da aplicação', pausa: 'Parada', retomada: 'Retomada (fim da parada)' };
/** Editar / excluir um evento da linha do tempo (horário do voo ou parada), nos drones marcados. */
function editarEventoTela(host: HTMLElement, ev: import('../domain/diario').EventoLinhaTempo | undefined) {
  if (!ev) return;
  const ehParada = ev.tipo === 'pausa' || ev.tipo === 'retomada';
  const p0 = ev.refs[0]?.paradaId ? estado.ds.paradas.find((x) => x.id === ev.refs[0].paradaId) : undefined;
  const m = abrirModal(`Editar — ${ROT_EV[ev.tipo] ?? ev.tipo}`, `
    <p class="nota">${esc(fmtData(dia))} · ${esc(ev.hora)} · ${esc(ev.texto)}</p>
    <fieldset class="campo"><legend>Aplicar nos drones</legend>${ev.refs.map((r, i) => `<label class="chk"><input type="checkbox" data-ev-ref="${i}" checked> ${esc(r.aeronave)}</label>`).join('')}</fieldset>
    <div class="form-grade">
      <label class="campo"><span>${ev.tipo === 'retomada' ? 'Hora da retomada' : ev.tipo === 'pausa' ? 'Hora da parada' : ev.tipo === 'inicio' ? 'Hora de início' : 'Hora do fim'}</span><input type="time" data-ev-hora value="${esc(ev.hora)}"></label>
      ${ev.tipo === 'pausa' ? `<label class="campo"><span>Motivo</span><select data-ev-motivo>${MOTIVOS_PARADA.map((x) => `<option ${x === p0?.motivo ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="campo"><span>Observação da parada</span><input data-ev-obs value="${esc(p0?.observacoes ?? '')}"></label>` : ''}
    </div>
    <p class="nota">${ehParada ? 'Mudar o horário da parada ajusta o tempo efetivo do voo. <b>Excluir</b> remove a parada inteira (parada e retomada).' : 'Mudar o horário do voo ajusta a jornada e o tempo efetivo. Para apagar o voo, use Aplicações.'}</p>
    <div data-ev-msg></div>`,
  { rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button>${ehParada ? '<button class="btn btn-perigo" data-ev-excluir>Excluir parada</button>' : ''}<button class="btn btn-pri" data-ev-ok>Salvar</button>` });
  const refs = () => [...m.el.querySelectorAll<HTMLInputElement>('[data-ev-ref]:checked')].map((x) => ev.refs[Number(x.dataset.evRef)]);
  const msg = (t: string) => { (m.el.querySelector('[data-ev-msg]') as HTMLElement).innerHTML = aviso('critico', esc(t)); };
  m.el.querySelector('[data-ev-ok]')!.addEventListener('click', () => {
    const hora = (m.el.querySelector('[data-ev-hora]') as HTMLInputElement).value;
    const motivo = (m.el.querySelector('[data-ev-motivo]') as HTMLSelectElement | null)?.value as MotivoParada | undefined;
    const obs = (m.el.querySelector('[data-ev-obs]') as HTMLInputElement | null)?.value;
    const erro = alterar((ds) => editarEvento(ds, ev.tipo, refs(), { hora: hora !== ev.hora ? hora : undefined, motivo, observacoes: obs }));
    if (erro) { msg(erro); return; }
    m.fechar(); toast('Linha do tempo atualizada.', 'ok'); desenhar(host);
  });
  m.el.querySelector('[data-ev-excluir]')?.addEventListener('click', async () => {
    if (!(await confirmar('Excluir parada', `Excluir a parada das ${ev.hora} (${ev.texto}) em ${refs().map((r) => r.aeronave).join(', ') || 'nenhum drone'}?`, 'Excluir'))) return;
    const erro = alterar((ds) => excluirEvento(ds, ev.tipo, refs()));
    if (erro) { msg(erro); return; }
    m.fechar(); toast('Parada excluída.', 'ok'); desenhar(host);
  });
}
