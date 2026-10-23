/** Planejamento e metas (Fase 3): metas vigentes + situação de cada campanha frente ao prazo. */
import { haPorTurnoDrone, metaDiaria, metaSemanal } from '../domain/metas';
import { planejarCampanhas, type PlanoCampanha } from '../domain/planejamento';
import type { Relatorio } from '../domain/relatorios';
import { alterar, estado, redesenhar } from '../state';
import { diasCampanha, gravarSafra, resumoSafra, type ResumoDias } from '../domain/dias';
import { abrirFormulario } from '../ui/form';
import { toast } from '../ui/dom';
import { numeroBR } from '../domain/importacao';
import { aviso, cabecalhoPagina } from '../ui/components';
import { esc, fmtData, fmtHa, fmtNum, fmtPct, hojeISO } from '../ui/dom';
import { icone } from '../ui/icons';
import { botoesExportar, exportarRelatorio, responsavelAtual } from './relatorios';

const SIT: Record<PlanoCampanha['situacao'], [string, string]> = {
  concluida: ['Concluída', 'selo-ok'], no_prazo: ['No prazo', 'selo-ok'], apertado: ['Apertado', 'selo-atencao'], atrasada: ['Atrasada no ritmo atual', 'selo-critico'], sem_ritmo: ['Sem ritmo recente', 'selo-neutro'],
};

export function renderPlanejamento(raiz: HTMLElement) {
  const { ds } = estado;
  const m = ds.metas;
  const hoje = hojeISO();
  const planos = planejarCampanhas(ds, hoje);
  const sf = resumoSafra(ds, hoje);
  raiz.innerHTML = `${cabecalhoPagina('Planejamento e metas', 'Meta da safra, capacidade planejada, prazo de cada campanha e o que é preciso para cumpri-lo.', `<a class="btn btn-sec" href="#/configuracoes">${icone('config', 15)} Editar metas</a>`)}
    ${cartaoSafra(sf)}
    <section class="cartao">
      <header class="cartao-cab"><h2>Metas vigentes</h2>${botoesExportar()}</header>
      <div class="chips-info"><span>Por drone <b>${esc(fmtNum(m.haHoraDrone, 0))} ha/h</b></span><span>Por turno <b>${esc(fmtNum(haPorTurnoDrone(m), 0))} ha</b> (${esc(fmtNum(m.horasEfetivasTurno, 1))} h efetivas)</span><span>Drones por turno <b>${m.dronesPorTurno}</b></span><span>Turnos por dia <b>${m.turnosPorDia}</b></span><span>Dias por semana <b>${m.diasPorSemana}</b></span><span>Meta diária <b>${esc(fmtHa(metaDiaria(m), 0))}</b></span><span>Meta semanal <b>${esc(fmtHa(metaSemanal(m), 0))}</b></span></div>
    </section>
    ${planos.length ? planos.map((p) => cartao(p)).join('') : aviso('info', 'Nenhuma campanha cadastrada.')}
    <p class="nota">Ritmo real = média por dia corrido nos últimos 14 dias (ou desde o início da campanha, se ela começou há menos de 14 dias). "Apertado": termina no prazo pela média, mas não no cenário pessimista (faixa de 80%). Drone-turnos/dia = área por dia necessária ÷ ${esc(fmtNum(haPorTurnoDrone(m), 0))} ha por drone-turno${m.diasPorSemana < 7 ? `, considerando ${m.diasPorSemana} dias/semana` : ''}. Obstáculos não entram no que falta.</p>`;
  if (raiz.dataset.planLigado) return;
  raiz.dataset.planLigado = '1';
  raiz.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-safra-editar]')) { editarSafra(); return; }
    const b = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
    if (b) void exportarRelatorio(relPlanejamento(planejarCampanhas(estado.ds, hojeISO())), b.dataset.exp as 'csv' | 'xlsx' | 'pdf', b);
  });
}

function cartao(p: PlanoCampanha) {
  const [rot, cls] = SIT[p.situacao];
  const atual = estado.ds.metas.dronesPorTurno * estado.ds.metas.turnosPorDia;
  return `<section class="cartao plan-c">
    <header class="cartao-cab"><div><h2>${esc(p.nome)}</h2><p>${esc(p.tipo)} · ${esc(fmtData(p.inicio))} a ${esc(fmtData(p.prazo))}</p></div><span class="selo ${cls}">${esc(rot)}</span></header>
    <div class="progresso plan-prog"><div style="width:${Math.max(0, Math.min(100, p.pct ?? 0))}%"></div></div>
    <div class="plan-grade">
      <div><span>Programado</span><b>${esc(fmtHa(p.programado, 1))}</b></div>
      <div><span>Aplicado</span><b>${esc(fmtHa(p.aplicado, 1))}</b><small>${esc(fmtPct(p.pct, 1))}</small></div>
      <div><span>Obstáculos</span><b>${esc(fmtHa(p.obstaculos, 2))}</b></div>
      <div><span>Falta aplicar</span><b>${esc(fmtHa(p.falta, 1))}</b></div>
      <div><span>Dias até o prazo</span><b>${p.diasAtePrazo}</b></div>
      <div><span>Termina na meta</span><b>${p.falta <= 0.005 ? '—' : esc(fmtData(p.dataNaMeta))}</b><small>${p.diasNaMeta === null || p.falta <= 0.005 ? '' : `${esc(fmtNum(p.diasNaMeta, 1))} dias a ${esc(fmtHa(p.metaDia, 0))}/dia`}</small></div>
      <div><span>Termina no ritmo real</span><b>${p.falta <= 0.005 ? '—' : esc(fmtData(p.dataNoRitmo))}</b><small>${p.ritmoReal ? `${esc(fmtHa(p.ritmoReal, 1))}/dia${p.faixaPessimista ? ` · pessimista ${esc(fmtData(p.faixaPessimista))}` : ''}` : 'sem aplicações nos últimos 14 dias'}</small></div>
      <div><span>Necessário para o prazo</span><b>${p.necessarioDia === null ? 'prazo vencido' : p.falta <= 0.005 ? '—' : `${esc(fmtHa(p.necessarioDia, 1))}/dia`}</b><small>${p.droneTurnosNecessarios === null || p.falta <= 0.005 ? '' : `${esc(fmtNum(p.droneTurnosNecessarios, 1))} drone-turnos/dia (plano: ${atual})`}</small></div>
    </div>
    ${blocoDias(diasCampanha(estado.ds, p.campanhaId, hojeISO()))}
  </section>`;
}

const COR_DIA: Record<string, string> = { aplicacao: 'dia-apl', parado: 'dia-par', sem_registro: 'dia-sem' };
/** Contagem de dias + faixa com um quadrado por dia (aplicação / parado / sem registro). */
export function blocoDias(d: ResumoDias | null, titulo = 'Dias da campanha'): string {
  if (!d || !d.corridos) return '';
  const motivos = Object.entries(d.porMotivo).map(([m, n]) => `${esc(m)}: ${n}`).join(' · ');
  const ultimos = d.dias.slice(-120);
  return `<div class="dias-bloco" data-dias>
    <div class="dias-tit">${esc(titulo)} <small>${esc(fmtData(d.de))} a ${esc(fmtData(d.ate))}</small></div>
    <div class="chips-info"><span>Corridos <b>${d.corridos}</b></span><span>Com aplicação <b>${d.comAplicacao}</b>${d.pctEfetivo !== null ? ` (${esc(fmtPct(d.pctEfetivo, 0))})` : ''}</span><span>Parados <b>${d.parados}</b>${d.parados ? ` (clima ${d.paradosClima})` : ''}</span><span>Sem registro <b>${d.semRegistro}</b></span><span>ha/dia com aplicação <b>${esc(fmtNum(d.haDiaEfetivo, 1))}</b></span><span>ha/dia corrido <b>${esc(fmtNum(d.haDiaCorrido, 1))}</b></span></div>
    ${motivos ? `<p class="nota">Motivos: ${motivos}</p>` : ''}
    <div class="dias-faixa" role="img" aria-label="Dias: aplicação, parado, sem registro">${ultimos.map((x) => `<i class="${COR_DIA[x.tipo]}" title="${esc(fmtData(x.data))} · ${x.tipo === 'aplicacao' ? `${fmtNum(x.area, 2)} ha` : x.tipo === 'parado' ? esc(`${x.motivo ?? 'parado'}${x.observacao ? ` — ${x.observacao}` : ''}`) : 'sem registro'}"></i>`).join('')}</div>
    <div class="dias-leg"><span><i class="dia-apl"></i>com aplicação</span><span><i class="dia-par"></i>parado (dia sem aplicação)</span><span><i class="dia-sem"></i>sem registro</span>${d.dias.length > ultimos.length ? `<span>últimos ${ultimos.length} dias</span>` : ''}</div>
  </div>`;
}

function cartaoSafra(sf: ReturnType<typeof resumoSafra>): string {
  const pct = Math.max(0, Math.min(100, sf.pct ?? 0));
  return `<section class="cartao safra-c" data-safra>
    <header class="cartao-cab"><div><h2>${icone('meta', 16)} ${esc(sf.safra.nome)} — meta da safra</h2><p>${esc(fmtData(sf.safra.inicio))} a ${esc(fmtData(sf.safra.fim))} · todas as campanhas · independente das campanhas abertas</p></div><button class="btn btn-sec btn-peq" data-safra-editar>${icone('config', 14)} Definir meta e período</button></header>
    <div class="progresso plan-prog"><div style="width:${pct}%"></div></div>
    <div class="plan-grade">
      <div><span>Meta da safra</span><b>${esc(fmtHa(sf.safra.metaHa, 0))}</b></div>
      <div><span>Aplicado na safra</span><b>${esc(fmtHa(sf.aplicado, 1))}</b><small>${esc(fmtPct(sf.pct, 1))}</small></div>
      <div><span>Falta</span><b>${esc(fmtHa(sf.falta, 1))}</b></div>
      <div><span>Dias restantes</span><b>${sf.diasRestantes}</b><small>até ${esc(fmtData(sf.safra.fim))}</small></div>
      <div><span>Necessário por dia</span><b>${sf.necessarioDia === null ? '—' : `${esc(fmtHa(sf.necessarioDia, 1))}/dia`}</b><small>dias corridos restantes</small></div>
      <div><span>Projeção no ritmo atual</span><b>${sf.projecaoFim === null ? '—' : esc(fmtHa(sf.projecaoFim, 0))}</b><small>${sf.ritmoCorrido === null ? '' : `${esc(fmtHa(sf.ritmoCorrido, 1))}/dia corrido`}</small></div>
    </div>
    ${blocoDias(sf, 'Dias da safra (a partir do início da 1ª campanha)')}
  </section>`;
}

function editarSafra() {
  const s = resumoSafra(estado.ds, hojeISO()).safra;
  abrirFormulario({
    titulo: 'Meta e período da safra',
    campos: [
      { k: 'nome', rot: 'Nome', obrig: true, dica: 'Ex.: Safra 2026/27' },
      { k: 'metaHa', rot: 'Meta da safra (ha)', obrig: true, dica: 'Área total a aplicar na safra, independente das campanhas' },
      { k: 'inicio', rot: 'Início da safra', tipo: 'data', obrig: true },
      { k: 'fim', rot: 'Fim da safra', tipo: 'data', obrig: true },
    ],
    valores: { nome: s.nome, metaHa: fmtNum(s.metaHa, 0).replace(/\./g, ''), inicio: s.inicio, fim: s.fim },
    aoSalvar: (v) => {
      const meta = numeroBR(String(v.metaHa ?? '').replace(/\.(?=\d{3}(\D|$))/g, ''));
      const erro = alterar((d) => gravarSafra(d, { nome: String(v.nome ?? ''), inicio: String(v.inicio ?? ''), fim: String(v.fim ?? ''), metaHa: meta ?? 0 }));
      if (erro) return erro;
      toast('Meta da safra gravada.', 'ok'); redesenhar(); return null;
    },
  });
}

function relPlanejamento(planos: PlanoCampanha[]): Relatorio {
  const m = estado.ds.metas;
  return {
    id: 'planejamento', titulo: 'Planejamento e metas — situação das campanhas', periodo: null, filtros: [`Referência: ${fmtData(hojeISO())}`, `Metas: ${m.haHoraDrone} ha/h · ${m.horasEfetivasTurno} h/turno · ${m.dronesPorTurno} drone(s)/turno · ${m.turnosPorDia} turno(s)/dia · ${m.diasPorSemana} dias/semana`],
    geradoEm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(), responsavel: responsavelAtual(),
    indicadores: [{ rotulo: 'Meta diária', valor: metaDiaria(m), tipo: 'ha' }, { rotulo: 'Meta semanal', valor: metaSemanal(m), tipo: 'ha' }, { rotulo: 'Campanhas', valor: planos.length, tipo: 'int' }, { rotulo: 'Falta aplicar (todas)', valor: planos.reduce((s, p) => s + p.falta, 0), tipo: 'ha' }],
    secoes: [{ titulo: 'Campanhas', colunas: [{ titulo: 'Campanha', tipo: 'texto' }, { titulo: 'Prazo', tipo: 'data' }, { titulo: 'Programado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Aplicado (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Obstáculos (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Falta (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Dias até o prazo', tipo: 'int' }, { titulo: 'Fim na meta', tipo: 'data' }, { titulo: 'Fim no ritmo real', tipo: 'data' }, { titulo: 'Necessário (ha/dia)', tipo: 'ha' }, { titulo: 'Drone-turnos/dia', tipo: 'num', casas: 1 }, { titulo: 'Situação', tipo: 'texto' }],
      linhas: planos.map((p) => [p.nome, p.prazo, p.programado, p.aplicado, p.obstaculos, p.falta, p.diasAtePrazo, p.falta <= 0.005 ? null : p.dataNaMeta, p.falta <= 0.005 ? null : p.dataNoRitmo, p.falta <= 0.005 ? null : p.necessarioDia, p.falta <= 0.005 ? null : p.droneTurnosNecessarios, SIT[p.situacao][0]]) }],
    notas: ['Ritmo real = média por dia corrido nos últimos 14 dias (ou desde o início da campanha, se ela começou há menos de 14 dias). Obstáculos não entram no que falta.', (() => { const sf = resumoSafra(estado.ds, hojeISO()); return `${sf.safra.nome}: meta ${fmtHa(sf.safra.metaHa, 0)} · aplicado ${fmtHa(sf.aplicado, 1)} (${fmtPct(sf.pct, 1)}) · falta ${fmtHa(sf.falta, 1)} · ${sf.diasRestantes} dias restantes · dias: ${sf.corridos} corridos, ${sf.comAplicacao} com aplicação, ${sf.parados} parados, ${sf.semRegistro} sem registro.`; })()],
  };
}
