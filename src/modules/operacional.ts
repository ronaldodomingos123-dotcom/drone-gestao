import { filtrarOperacoes, minutosPorMotivo, temposOperacao } from '../domain/analytics';
import { duracaoParadaMin, formatarDuracao, safeDiv } from '../domain/calc';
import type { LeituraClima, LimitesClima, Operacao, Parada } from '../domain/types';
import { avaliarLeitura } from '../domain/validation';
import { droneTurnosDia, haPorTurnoDrone, META_PADRAO, metaDiaria, metaSemanal, validarMeta, type MetaOperacional } from '../domain/metas';
import { PREFIXO } from '../data/repository';
import { atualizarDataset, estado, nome, redesenhar, repo } from '../state';
import { baseVazia, migrar, registrar } from '../domain/base';
import { barrasH, CORES } from '../ui/charts';
import { aviso, barraFiltros, cabecalhoPagina } from '../ui/components';
import { confirmar, esc, fmtData, fmtDataHora, fmtNum, fmtPct, hojeISO, toast } from '../ui/dom';
import { icone } from '../ui/icons';
import { tabela } from '../ui/table';
import { abrirDetalheOperacao } from './aplicacoes';

// ---------------- Paradas operacionais ----------------
export function renderParadas(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Paradas operacionais', 'Interrupções, duração e principais fatores que reduzem a produtividade.')}
    <div id="pa-filtros"></div><div id="pa-corpo"></div>`;
  const corpo = raiz.querySelector('#pa-corpo') as HTMLElement;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const ops = filtrarOperacoes(ds, filtros, idx);
    const opPorId = new Map(ops.map((o) => [o.id, o]));
    const paradas = ds.paradas.filter((p) => opPorId.has(p.operacaoId));
    const motivos = minutosPorMotivo(ops, idx);
    const totalParado = motivos.reduce((s, m) => s + m.minutos, 0);
    const climatico = motivos.filter((m) => m.climatico).reduce((s, m) => s + m.minutos, 0);
    const minTotal = ops.reduce((s, o) => s + temposOperacao(o, idx).total, 0);
    const abertas = paradas.filter((p) => duracaoParadaMin(p) === null).length;
    corpo.innerHTML = `
      <div class="kpis kpis-4">
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Tempo parado</span><span class="kpi-ico">${icone('parada', 17)}</span></div><div class="kpi-val">${esc(formatarDuracao(totalParado))}</div><div class="kpi-sub">${esc(fmtPct((safeDiv(totalParado, minTotal) ?? 0) * 100))} do tempo total de operação</div></div>
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Paradas registradas</span><span class="kpi-ico">${icone('camadas', 17)}</span></div><div class="kpi-val">${paradas.length}</div><div class="kpi-sub">${abertas ? `${abertas} sem horário de término` : 'todas com início e fim'}</div></div>
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Por motivos climáticos</span><span class="kpi-ico">${icone('vento', 17)}</span></div><div class="kpi-val">${esc(formatarDuracao(climatico))}</div><div class="kpi-sub">${esc(fmtPct((safeDiv(climatico, totalParado) ?? 0) * 100))} do tempo parado</div></div>
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Principal motivo</span><span class="kpi-ico">${icone('alerta', 17)}</span></div><div class="kpi-val kpi-val-txt">${esc(motivos[0]?.motivo ?? '—')}</div><div class="kpi-sub">${motivos[0] ? esc(formatarDuracao(motivos[0].minutos)) : ''}</div></div>
      </div>
      ${aviso('info', 'Tempo parado ≠ tempo efetivo. As paradas não entram nas horas efetivas; entram apenas no tempo total (produtividade "com paradas").')}
      <section class="cartao"><header class="cartao-cab"><div><h2>Tempo parado por motivo</h2><p>Horas no período · ordenado do maior para o menor</p></div></header><div id="pa-graf"></div></section>
      <section class="cartao"><header class="cartao-cab"><div><h2>Registro de paradas</h2><p>Clique para abrir a operação relacionada</p></div></header><div id="pa-tab"></div></section>`;
    barrasH(corpo.querySelector('#pa-graf')!, motivos.map((m) => ({ rotulo: m.motivo, valores: [m.minutos / 60], extraTip: `<div class="tl">Ocorrências<b>${m.ocorrencias}</b></div>${m.climatico ? '<div class="tl">Motivo climático<b>sim</b></div>' : ''}` })),
      [{ nome: 'Horas paradas', cor: CORES.operacional }], { unidade: 'h', casas: 1, larguraRotulo: 190 });
    tabela<Parada>(corpo.querySelector('#pa-tab') as HTMLElement, paradas, [
      { id: 'ini', titulo: 'Início', valor: (p) => p.inicio, render: (p) => esc(fmtDataHora(p.inicio)) },
      { id: 'fim', titulo: 'Término', valor: (p) => p.fim, render: (p) => esc(fmtDataHora(p.fim)), secundaria: true },
      { id: 'dur', titulo: 'Duração', alinhar: 'dir', valor: (p) => duracaoParadaMin(p), render: (p) => esc(formatarDuracao(duracaoParadaMin(p))) },
      { id: 'mot', titulo: 'Motivo', valor: (p) => p.motivo },
      { id: 'op', titulo: 'Operação', valor: (p) => nome.fazenda(idx.os.get(opPorId.get(p.operacaoId)!.osId)?.fazendaId ?? ''), render: (p) => { const o = opPorId.get(p.operacaoId)!; return `${esc(nome.fazenda(idx.os.get(o.osId)?.fazendaId ?? ''))}<small class="bloco">${esc(nome.aeronave(o.aeronaveId))} · ${esc(nome.os(o.osId))}</small>`; } },
      { id: 'resp', titulo: 'Responsável', valor: (p) => p.responsavel, secundaria: true },
    ], { ordemInicial: { coluna: 'ini', dir: 'desc' }, aoClicar: (p) => abrirDetalheOperacao(opPorId.get(p.operacaoId)!), placeholderBusca: 'Buscar motivo, fazenda, aeronave…' });
  };
  barraFiltros(raiz.querySelector('#pa-filtros') as HTMLElement, desenhar);
  desenhar();
}

// ---------------- Condições climáticas ----------------
interface LinhaClima { op: Operacao; l: LeituraClima; fora: string[] }

export function renderClima(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Condições climáticas', 'Leituras registradas nas operações, comparadas com os limites configurados.')}
    <div id="cl-filtros"></div><div id="cl-corpo"></div>`;
  const corpo = raiz.querySelector('#cl-corpo') as HTMLElement;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const lim = ds.limites;
    const ops = filtrarOperacoes(ds, filtros, idx);
    const linhas: LinhaClima[] = ops.flatMap((op) => op.clima.map((l) => ({ op, l, fora: avaliarLeitura(l, lim) })));
    const nFora = linhas.filter((x) => x.fora.length).length;
    corpo.innerHTML = `
      ${aviso('info', `Limites configurados: vento ${lim.ventoMinKmh}–${lim.ventoMaxKmh} km/h · UR ≥ ${lim.umidadeMinPct}% · temperatura ≤ ${lim.temperaturaMaxC} °C · sem chuva/orvalho. Ajuste em <a href="#/configuracoes">Configurações</a> conforme bula e recomendação técnica. Leituras de demonstração são fictícias. Não há integração com estações meteorológicas.`)}
      <div class="kpis kpis-4">
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Leituras no período</span><span class="kpi-ico">${icone('clima', 17)}</span></div><div class="kpi-val">${linhas.length}</div></div>
        <div class="kpi ${nFora ? 'kpi-atencao' : ''}"><div class="kpi-topo"><span class="kpi-rot">Fora dos limites</span><span class="kpi-ico">${icone('alerta', 17)}</span></div><div class="kpi-val">${nFora}</div><div class="kpi-sub">${esc(fmtPct((safeDiv(nFora, linhas.length) ?? 0) * 100))} das leituras</div></div>
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Operações impedidas</span><span class="kpi-ico">${icone('vento', 17)}</span></div><div class="kpi-val">${ops.filter((o) => o.status === 'impedida_clima').length}</div></div>
        <div class="kpi"><div class="kpi-topo"><span class="kpi-rot">Operações sem leitura</span><span class="kpi-ico">${icone('info', 17)}</span></div><div class="kpi-val">${ops.filter((o) => o.clima.length === 0).length}</div></div>
      </div>
      <section class="cartao"><div id="cl-tab"></div></section>`;
    const n = (v: number | null, u: string) => (v === null ? '—' : `${fmtNum(v, 1)} ${u}`);
    tabela<LinhaClima>(corpo.querySelector('#cl-tab') as HTMLElement, linhas, [
      { id: 'data', titulo: 'Data / hora', valor: (x) => x.op.data + x.l.hora, render: (x) => `<b>${esc(fmtData(x.op.data))}</b><small class="bloco">${esc(x.l.hora)} · ${esc({ inicio: 'início', durante: 'durante', fim: 'encerramento' }[x.l.momento])}</small>` },
      { id: 'faz', titulo: 'Fazenda', valor: (x) => nome.fazenda(idx.os.get(x.op.osId)?.fazendaId ?? ''), render: (x) => `${esc(nome.fazenda(idx.os.get(x.op.osId)?.fazendaId ?? ''))}<small class="bloco">${esc(nome.aeronave(x.op.aeronaveId))}</small>`, secundaria: true },
      { id: 't', titulo: 'Temp.', alinhar: 'dir', valor: (x) => x.l.temperaturaC, render: (x) => esc(n(x.l.temperaturaC, '°C')) },
      { id: 'ur', titulo: 'UR', alinhar: 'dir', valor: (x) => x.l.umidadePct, render: (x) => esc(n(x.l.umidadePct, '%')) },
      { id: 'v', titulo: 'Vento', alinhar: 'dir', valor: (x) => x.l.ventoKmh, render: (x) => `${esc(n(x.l.ventoKmh, 'km/h'))}<small class="bloco">rajada ${esc(n(x.l.rajadaKmh, ''))} · ${esc(x.l.direcaoVento ?? '—')}</small>` },
      { id: 'ch', titulo: 'Chuva / orvalho', valor: (x) => `${x.l.chuva ?? ''} ${x.l.orvalho ? 'orvalho' : ''}`, render: (x) => `${esc(x.l.chuva ?? '—')}${x.l.orvalho ? ' · orvalho' : ''}`, secundaria: true },
      { id: 'or', titulo: 'Origem', valor: (x) => x.l.origem, secundaria: true },
      { id: 'sit', titulo: 'Limites', valor: (x) => x.fora.length, render: (x) => (x.fora.length ? `<span class="selo selo-atencao" title="${esc(x.fora.join('; '))}">Fora: ${esc(x.fora.join(', '))}</span>` : '<span class="selo selo-neutro">Dentro</span>') },
    ], { ordemInicial: { coluna: 'data', dir: 'desc' }, aoClicar: (x) => abrirDetalheOperacao(x.op) });
  };
  barraFiltros(raiz.querySelector('#cl-filtros') as HTMLElement, desenhar);
  desenhar();
}

// ---------------- Módulos planejados ----------------
export function renderPlanejado(titulo: string, descricao: string, itens: string[], fase: string) {
  return (raiz: HTMLElement) => {
    raiz.innerHTML = `${cabecalhoPagina(titulo, descricao)}
      <section class="cartao planejado">
        <div class="planejado-ico">${icone('construcao', 30)}</div>
        <span class="selo selo-planejado">Planejado · ${esc(fase)}</span>
        <h2>Este módulo ainda não foi implementado</h2>
        <p>Nenhuma funcionalidade desta tela está ativa. O escopo previsto é:</p>
        <ul class="lista-prevista">${itens.map((i) => `<li>${icone('dir', 14)} ${esc(i)}</li>`).join('')}</ul>
      </section>`;
  };
}

// ---------------- Configurações ----------------
export function renderConfiguracoes(raiz: HTMLElement) {
  const { ds } = estado;
  const lim = ds.limites;
  raiz.innerHTML = `${cabecalhoPagina('Configurações', 'Parâmetros do protótipo.')}
    <section class="cartao">
      <header class="cartao-cab"><div><h2>Limites climáticos de referência</h2><p>Usados apenas para sinalizar leituras "dentro/fora". Ajuste conforme bula, recomendação técnica e procedimento da empresa.</p></div></header>
      <form id="form-lim" class="form-grade" novalidate>
        <label class="campo"><span>Vento mínimo</span><div class="com-unidade"><input name="ventoMinKmh" inputmode="decimal" value="${lim.ventoMinKmh}"><span>km/h</span></div><small>Vento muito baixo favorece inversão térmica</small></label>
        <label class="campo"><span>Vento máximo</span><div class="com-unidade"><input name="ventoMaxKmh" inputmode="decimal" value="${lim.ventoMaxKmh}"><span>km/h</span></div></label>
        <label class="campo"><span>Umidade relativa mínima</span><div class="com-unidade"><input name="umidadeMinPct" inputmode="decimal" value="${lim.umidadeMinPct}"><span>%</span></div></label>
        <label class="campo"><span>Temperatura máxima</span><div class="com-unidade"><input name="temperaturaMaxC" inputmode="decimal" value="${lim.temperaturaMaxC}"><span>°C</span></div></label>
        <div class="campo largo"><button class="btn btn-pri" type="submit">${icone('ok', 16)} Salvar limites</button></div>
      </form>
      <p class="nota">Valores iniciais são apenas exemplos usuais de boas práticas de pulverização, não uma recomendação técnica.</p>
    </section>
    <section class="cartao">
      <header class="cartao-cab"><div><h2>Meta operacional (planejado)</h2><p>Base da linha "Planejado" nos gráficos diário e semanal e do ritmo planejado na evolução da campanha.</p></div></header>
      <form id="form-meta" class="form-grade" novalidate>
        ${campoMeta('haHoraDrone', 'Produtividade por drone', 'ha/h', 'Efetiva, por drone')}
        ${campoMeta('horasEfetivasTurno', 'Horas efetivas por turno', 'h', 'Tempo aplicando, sem paradas')}
        ${campoMeta('turnosPorDia', 'Turnos por dia', 'turnos', '')}
        ${campoMeta('dronesPorTurno', 'Drones por turno', 'drones', '1 = cada drone em um turno · 2 = os dois drones nos dois turnos')}
        ${campoMeta('dronesFrota', 'Drones no plano', 'drones', 'Usado para recortar a meta por drone')}
        ${campoMeta('diasPorSemana', 'Dias de operação por semana', 'dias', '')}
        <div class="campo largo"><div class="resumo-meta" id="resumo-meta"></div></div>
        <div class="campo largo pag-acoes"><button class="btn btn-pri" type="submit">${icone('ok', 16)} Salvar meta</button><button class="btn btn-sec" type="button" data-acao="meta-padrao">${icone('restaurar', 15)} Voltar aos valores da prévia</button></div>
      </form>
    </section>
    <section class="cartao">
      <header class="cartao-cab"><div><h2>Dados do protótipo</h2><p>Armazenamento isolado deste protótipo.</p></div></header>
      <div class="chips-info"><span>Armazenamento <b>${esc(repo.tipo)}</b> neste navegador</span><span>Prefixo das chaves <b>${esc(PREFIXO)}</b></span><span>Operações <b>${ds.operacoes.length}</b> (${ds.operacoes.filter((o) => o.origem === 'registro_prototipo').length} registradas aqui)</span></div>
      <p>O protótipo não usa servidor, banco de dados externo nem a base de qualquer outro aplicativo. Limpar os dados do navegador apaga os registros feitos aqui.</p>
      <button class="btn btn-perigo" data-acao="restaurar">${icone('restaurar', 16)} Restaurar dados de demonstração</button>
    </section>
    <section class="cartao">
      <header class="cartao-cab"><div><h2>Base de dados</h2><p>Base atual: <b>${ds.origemBase === 'propria' ? 'própria (seus dados)' : 'demonstração (fictícia)'}</b> · ${ds.fazendas.length} fazendas · ${ds.ordens.length} OS · ${ds.operacoes.length} operações · ${ds.auditoria.length} registros de auditoria</p></div></header>
      <div class="pag-acoes">
        <button class="btn btn-sec" data-acao="backup">${icone('relatorio', 16)} Exportar backup (.json)</button>
        <label class="btn btn-sec">${icone('restaurar', 16)} Importar backup<input type="file" accept="application/json,.json" data-acao="restaurar-backup" hidden></label>
        <button class="btn btn-perigo" data-acao="base-propria">${icone('construcao', 16)} Começar base própria (vazia)</button>
      </div>
      <p class="nota">Os dados ficam no navegador deste aparelho. Exporte o backup regularmente e para levar os dados a outro aparelho. A sincronização entre aparelhos entra na Fase 4.</p>
    </section>
    <section class="cartao planejado-mini">
      <span class="selo selo-planejado">Planejado · Fase 4</span>
      <p>Usuários, perfis e permissões; banco centralizado com sincronização entre aparelhos; tema escuro.</p>
    </section>`;
  const formMeta = raiz.querySelector('#form-meta') as HTMLFormElement;
  const lerMeta = (): MetaOperacional => {
    const fd = new FormData(formMeta);
    const v = (k: keyof MetaOperacional) => Number(String(fd.get(k) ?? '').replace(',', '.'));
    return { haHoraDrone: v('haHoraDrone'), horasEfetivasTurno: v('horasEfetivasTurno'), turnosPorDia: v('turnosPorDia'), dronesPorTurno: v('dronesPorTurno'), dronesFrota: v('dronesFrota'), diasPorSemana: v('diasPorSemana') };
  };
  const preencherMeta = (m: MetaOperacional) => { (Object.keys(m) as (keyof MetaOperacional)[]).forEach((k) => { (formMeta.elements.namedItem(k) as HTMLInputElement).value = String(m[k]).replace('.', ','); }); };
  const atualizarResumo = () => {
    const m = lerMeta();
    const erros = validarMeta(m);
    const box = raiz.querySelector('#resumo-meta') as HTMLElement;
    if (erros.length) { box.innerHTML = `<div class="aviso aviso-critico">${icone('alerta', 18)}<div>${erros.map(esc).join('<br>')}</div></div>`; return; }
    const um = { umDrone: true, umTurno: false };
    box.innerHTML = `
      <table class="tabela tabela-simples"><thead><tr><th>Escopo</th><th class="dir">Por turno</th><th class="dir">Por dia</th><th class="dir">Por semana</th></tr></thead><tbody>
        <tr><td>Por drone</td><td class="dir">${esc(fmtNum(haPorTurnoDrone(m), 0))} ha</td><td class="dir">${esc(fmtNum(metaDiaria(m, um), 0))} ha</td><td class="dir">${esc(fmtNum(metaSemanal(m, um), 0))} ha</td></tr>
        <tr><td><b>Operação (${m.dronesFrota} drones, ${m.turnosPorDia} turnos)</b></td><td class="dir">${esc(fmtNum(haPorTurnoDrone(m) * m.dronesPorTurno, 0))} ha</td><td class="dir"><b>${esc(fmtNum(metaDiaria(m), 0))} ha</b></td><td class="dir"><b>${esc(fmtNum(metaSemanal(m), 0))} ha</b></td></tr>
      </tbody></table>
      <p class="nota">Por turno = ${esc(fmtNum(m.haHoraDrone, 1))} ha/h × ${esc(fmtNum(m.horasEfetivasTurno, 1))} h · Por dia = ${droneTurnosDia(m)} drone-turno(s) × ${esc(fmtNum(haPorTurnoDrone(m), 0))} ha · Por semana = por dia × ${m.diasPorSemana} dias.</p>`;
  };
  preencherMeta(ds.metas);
  atualizarResumo();
  formMeta.addEventListener('input', atualizarResumo);
  raiz.querySelector('[data-acao="meta-padrao"]')!.addEventListener('click', () => { preencherMeta(META_PADRAO); atualizarResumo(); });
  formMeta.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = lerMeta();
    const erros = validarMeta(m);
    if (erros.length) { toast(erros[0], 'erro'); return; }
    ds.metas = m;
    try { repo.salvar(ds); atualizarDataset(ds); toast('Meta operacional salva.', 'ok'); } catch (err) { toast((err as Error).message, 'erro'); }
  });

  raiz.querySelector('#form-lim')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const v = (k: keyof LimitesClima) => Number(String(fd.get(k) ?? '').replace(',', '.'));
    const novo: LimitesClima = { ventoMinKmh: v('ventoMinKmh'), ventoMaxKmh: v('ventoMaxKmh'), umidadeMinPct: v('umidadeMinPct'), temperaturaMaxC: v('temperaturaMaxC') };
    if (Object.values(novo).some((x) => !Number.isFinite(x) || x < 0)) { toast('Informe valores numéricos não negativos.', 'erro'); return; }
    if (novo.ventoMinKmh >= novo.ventoMaxKmh) { toast('O vento mínimo deve ser menor que o máximo.', 'erro'); return; }
    if (novo.umidadeMinPct > 100) { toast('Umidade mínima deve ser no máximo 100%.', 'erro'); return; }
    ds.limites = novo;
    try { repo.salvar(ds); atualizarDataset(ds); toast('Limites salvos.', 'ok'); } catch (err) { toast((err as Error).message, 'erro'); }
  });
  raiz.querySelector('[data-acao="backup"]')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(estado.ds, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup-gestao-drones-${hojeISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup exportado.', 'ok');
  });
  raiz.querySelector('[data-acao="restaurar-backup"]')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const arq = input.files?.[0];
    input.value = '';
    if (!arq) return;
    let dados: ReturnType<typeof migrar> = null;
    try { dados = migrar(JSON.parse(await arq.text())); } catch { dados = null; }
    if (!dados) { toast('Arquivo inválido: não é um backup desta plataforma.', 'erro'); return; }
    if (!(await confirmar('Importar backup', `Substituir a base atual pelo backup "${arq.name}" (${dados.fazendas.length} fazendas, ${dados.ordens.length} OS, ${dados.operacoes.length} operações)? Exporte um backup da base atual antes, se precisar dela.`, 'Substituir base'))) return;
    registrar(dados, { entidade: 'base', entidadeId: 'backup', acao: 'base', resumo: `Base restaurada do backup ${arq.name}` });
    try { repo.salvar(dados); atualizarDataset(dados); toast('Backup importado.', 'ok'); redesenhar(); } catch (err) { toast((err as Error).message, 'erro'); }
  });
  raiz.querySelector('[data-acao="base-propria"]')!.addEventListener('click', async () => {
    if (!(await confirmar('Começar base própria', 'A base será ESVAZIADA (cadastros, OS e operações) para você carregar seus dados reais. Metas e limites climáticos são mantidos. Exporte um backup antes se quiser guardar a base atual. Continuar?', 'Esvaziar e começar'))) return;
    const nova = baseVazia(ds);
    registrar(nova, { entidade: 'base', entidadeId: 'base', acao: 'base', resumo: `Base própria iniciada (antes: ${ds.origemBase}, ${ds.operacoes.length} operações)` });
    try { repo.salvar(nova); atualizarDataset(nova); toast('Base própria criada. Comece por Fazendas e talhões → Nova unidade, ou importe a sequência.', 'ok'); location.hash = '#/fazendas'; } catch (err) { toast((err as Error).message, 'erro'); }
  });
  raiz.querySelector('[data-acao="restaurar"]')!.addEventListener('click', async () => {
    const aviso2 = ds.origemBase === 'propria' ? ' ATENÇÃO: a base atual é PRÓPRIA (seus dados reais) e será apagada. Exporte um backup antes.' : '';
    if (await confirmar('Restaurar dados de demonstração', `Os registros atuais, os limites e a meta serão substituídos pelos dados fictícios originais.${aviso2} Esta ação não pode ser desfeita.`, 'Restaurar')) {
      atualizarDataset(repo.restaurarDemo());
      toast('Dados de demonstração restaurados.', 'ok');
      renderConfiguracoes(raiz);
    }
  });
}

function campoMeta(nomeCampo: keyof MetaOperacional, rotulo: string, unidade: string, dica: string) {
  return `<label class="campo"><span>${esc(rotulo)}</span><div class="com-unidade"><input name="${nomeCampo}" inputmode="decimal"><span>${esc(unidade)}</span></div>${dica ? `<small>${esc(dica)}</small>` : ''}</label>`;
}
