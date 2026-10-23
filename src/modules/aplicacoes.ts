import { filtrarOperacoes, temposOperacao } from '../domain/analytics';
import { areaOperacao, desvioDosePct, duracaoParadaMin, duracaoTotalMin, formatarDuracao, hhmmParaMin, produtividadeEfetiva, produtividadeOperacional, quantidadeTotal, somaParadasMin, volumeTotalCalda } from '../domain/calc';
import { avaliarLeitura } from '../domain/validation';
import { contextoClima } from '../domain/estacao';
import { registrar } from '../domain/base';
import type { Operacao, StatusOperacao } from '../domain/types';
import { abrirFormulario } from '../ui/form';
import { alterar, estado, nome, redesenhar } from '../state';
import { aviso, barraFiltros, cabecalhoPagina, seloOperacao } from '../ui/components';
import { abrirModal, esc, fmtData, fmtDataHora, fmtHa, fmtNum, fmtPct, toast } from '../ui/dom';
import { icone } from '../ui/icons';
import { tabela } from '../ui/table';

export function renderAplicacoes(raiz: HTMLElement) {
  raiz.innerHTML = `
    ${cabecalhoPagina('Aplicações', 'Registros de operação em campo. Clique em uma linha para ver o registro técnico completo.',
      `<a class="btn btn-sec" href="#/campo">${icone('drone', 16)} Registro de campo (turno)</a><a class="btn btn-pri" href="#/aplicacoes/nova">${icone('mais', 16)} Nova aplicação</a>`)}
    <div id="ap-filtros"></div>
    <section class="cartao"><div id="ap-tabela"></div></section>`;
  const host = raiz.querySelector('#ap-tabela') as HTMLElement;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const ops = filtrarOperacoes(ds, filtros, idx);
    tabela<Operacao>(host, ops, [
      { id: 'data', titulo: 'Data', valor: (o) => o.data + o.horaInicio, render: (o) => `<b>${esc(fmtData(o.data))}</b><small class="bloco">${esc(o.horaInicio)}–${esc(o.horaFim ?? '…')}</small>` },
      { id: 'faz', titulo: 'Fazenda', valor: (o) => nome.fazenda(idx.os.get(o.osId)?.fazendaId ?? ''), render: (o) => `${esc(nome.fazenda(idx.os.get(o.osId)?.fazendaId ?? ''))}<small class="bloco">${esc(nome.os(o.osId))} · ${o.itens.length} talhão(ões)</small>` },
      { id: 'area', titulo: 'Área', alinhar: 'dir', valor: (o) => areaOperacao(o), render: (o) => `<b>${esc(fmtHa(areaOperacao(o)))}</b>` },
      { id: 'ac', titulo: 'Aeronave', valor: (o) => nome.aeronave(o.aeronaveId), secundaria: true },
      { id: 'turno', titulo: 'Turno / líder', valor: (o) => `${nome.turno(o.turnoId)} ${nome.colaborador(o.liderId)}`, render: (o) => `${esc(nome.turno(o.turnoId))}<small class="bloco">${esc(nome.colaborador(o.liderId))}</small>`, secundaria: true },
      { id: 'pil', titulo: 'Operador', valor: (o) => nome.colaborador(o.pilotoId), secundaria: true },
      { id: 'efet', titulo: 'Tempo efetivo', alinhar: 'dir', secundaria: true, valor: (o) => o.tempoEfetivoMin, render: (o) => esc(formatarDuracao(o.tempoEfetivoMin)) },
      { id: 'prod', titulo: 'ha/h efetivo', alinhar: 'dir', secundaria: true, valor: (o) => produtividadeEfetiva(areaOperacao(o), o.tempoEfetivoMin), render: (o) => esc(fmtNum(produtividadeEfetiva(areaOperacao(o), o.tempoEfetivoMin), 2)) },
      { id: 'st', titulo: 'Status', valor: (o) => o.status, render: (o) => seloOperacao(o.status) + (o.origem === 'registro_prototipo' ? ' <span class="selo selo-novo">Registrado aqui</span>' : '') },
    ], {
      ordemInicial: { coluna: 'data', dir: 'desc' },
      placeholderBusca: 'Buscar fazenda, OS, turno, líder, aeronave…',
      vazio: 'Nenhuma operação para os filtros aplicados.',
      aoClicar: abrirDetalheOperacao,
      rodape: (fl) => `<tr><td>Total (${fl.length} operações)</td><td class="sec"></td><td class="dir"><b>${esc(fmtHa(fl.reduce((s, o) => s + areaOperacao(o), 0)))}</b></td><td colspan="6" class="sec"></td></tr>`,
    });
  };
  barraFiltros(raiz.querySelector('#ap-filtros') as HTMLElement, desenhar);
  desenhar();
}

export function abrirDetalheOperacao(op: Operacao) {
  const { ds, idx } = estado;
  const os = idx.os.get(op.osId);
  const t = temposOperacao(op, idx);
  const area = areaOperacao(op);
  const paradas = (idx.paradasPorOp.get(op.id) ?? []).slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
  const naoAtribuido = t.total - t.efetivo - t.parado;
  const linha = (r: string, v: string) => `<div class="campo-l"><span>${esc(r)}</span><b>${v}</b></div>`;
  const volCalda = volumeTotalCalda(op.calda.volumeLHa, area);

  const corpo = `
    ${op.origem === 'demo' ? aviso('info', 'Registro <b>fictício</b> gerado para demonstração.') : aviso('info', 'Registro criado neste protótipo (armazenado apenas neste navegador).')}
    ${op.observacoesTecnicas ? aviso('atencao', esc(op.observacoesTecnicas)) : ''}
    <div class="detalhe-grade">
      <section><h3>${icone('os', 16)} Identificação</h3>
        ${linha('Data / horário', `${esc(fmtData(op.data))} · ${esc(op.horaInicio)}–${esc(op.horaFim ?? '…')}`)}
        ${linha('Ordem de serviço', esc(nome.os(op.osId)))}
        ${linha('Campanha', esc(nome.campanha(op.campanhaId)))}
        ${linha('Unidade', esc(nome.unidade(os?.unidadeId ?? '')))}
        ${linha('Fazenda', esc(nome.fazenda(os?.fazendaId ?? '')))}
        ${linha('Turno', esc(nome.turno(op.turnoId)))}
        ${linha('Líder do turno', esc(nome.colaborador(op.liderId)))}
        ${linha('Cultura', esc(op.cultura))}
        ${linha('Status', seloOperacao(op.status))}
      </section>
      <section><h3>${icone('drone', 16)} Equipamento e equipe</h3>
        ${linha('Aeronave', esc(`${nome.aeronave(op.aeronaveId)} · ${ds.aeronaves.find((a) => a.id === op.aeronaveId)?.modelo ?? ''}`))}
        ${linha('Nº de série', esc(ds.aeronaves.find((a) => a.id === op.aeronaveId)?.numeroSerie ?? '—'))}
        ${linha('Operador responsável', esc(nome.colaborador(op.pilotoId)))}
        ${linha('Demais colaboradores', esc(op.auxiliarIds.map(nome.colaborador).join(', ') || '—'))}
        ${linha('Equipamentos auxiliares', esc(op.equipamentosAuxiliares || '—'))}
      </section>
      <section><h3>${icone('relogio', 16)} Tempos e produtividade</h3>
        ${linha('Tempo total', esc(formatarDuracao(t.total)))}
        ${linha('Tempo efetivo de aplicação', esc(formatarDuracao(t.efetivo)))}
        ${linha('Tempo parado (paradas registradas)', esc(formatarDuracao(t.parado)))}
        ${linha('Tempo não atribuído', esc(formatarDuracao(naoAtribuido)))}
        ${linha('Produtividade efetiva', `${esc(fmtNum(produtividadeEfetiva(area, t.efetivo), 2))} ha/h`)}
        ${linha('Produtividade c/ paradas', `${esc(fmtNum(produtividadeOperacional(area, t.total), 2))} ha/h`)}
      </section>
      <section><h3>${icone('rota', 16)} Parâmetros de voo</h3>
        ${linha('Velocidade', op.velocidadeMs ? `${esc(fmtNum(op.velocidadeMs, 1))} m/s` : '—')}
        ${linha('Altura de voo', op.alturaVooM ? `${esc(fmtNum(op.alturaVooM, 1))} m` : '—')}
        ${linha('Largura de faixa', op.faixaM ? `${esc(fmtNum(op.faixaM, 1))} m` : '—')}
      </section>
    </div>

    <h3 class="sec-tit">${icone('area', 16)} Talhões aplicados <span class="muted">— a área é registrada uma única vez, por talhão</span></h3>
    <table class="tabela tabela-simples"><thead><tr><th>Talhão</th><th class="dir">Área do talhão</th><th class="dir">Planejado na OS</th><th class="dir">Aplicado nesta operação</th></tr></thead><tbody>
      ${op.itens.map((it) => `<tr><td>${esc(nome.talhao(it.talhaoId))}</td><td class="dir">${esc(fmtHa(ds.talhoes.find((x) => x.id === it.talhaoId)?.areaHa))}</td><td class="dir">${esc(fmtHa(os?.itens.find((x) => x.talhaoId === it.talhaoId)?.areaPlanejadaHa))}</td><td class="dir"><b>${esc(fmtHa(it.areaHa))}</b></td></tr>`).join('') || `<tr><td colspan="4" class="muted">Sem área aplicada${op.status === 'impedida_clima' ? ' (impedida por condições climáticas)' : ''}.</td></tr>`}
    </tbody><tfoot><tr><td colspan="3">Área total aplicada</td><td class="dir"><b>${esc(fmtHa(area))}</b></td></tr></tfoot></table>

    <h3 class="sec-tit">${icone('produto', 16)} Calda e produtos</h3>
    ${op.voo ? `<div class="chips-info" data-voo-kml><span>Medido no KML de voo</span><span>Cargas <b>${op.voo.cargas}</b></span><span>Em voo <b>${esc(formatarDuracao(Math.round(op.voo.tempoVooMin)))}</b></span><span>Volume pulverizado <b>${esc(fmtNum(op.voo.volumeL, 0))} L</b></span><span>Taxa real <b>${esc(fmtNum(op.voo.taxaLHa, 2))} L/ha</b></span>${op.voo.foraTaxa ? `<span class="selo selo-atencao">${op.voo.foraTaxa} carga(s) fora da taxa</span>` : ''}${op.voo.dividido ? '<span class="selo selo-neutro">dividido entre OS vizinhas</span>' : ''}</div>` : ''}
    <div class="chips-info"><span>Taxa de aplicação <b>${esc(fmtNum(op.calda.volumeLHa, 1))} L/ha</b></span><span>Volume total de calda <b>${esc(volCalda === null ? '—' : `${fmtNum(volCalda, 0)} L`)}</b></span></div>
    <table class="tabela tabela-simples"><thead><tr><th>Produto</th><th>Classe</th><th class="dir">Dose planejada</th><th class="dir">Dose utilizada</th><th class="dir">Desvio</th><th class="dir">Qtde. total*</th><th>Lote</th></tr></thead><tbody>
      ${op.calda.produtos.map((p) => {
        const pr = ds.produtos.find((x) => x.id === p.produtoId);
        const dv = desvioDosePct(p.dosePlanejada, p.doseReal);
        const q = quantidadeTotal(p.doseReal ?? p.dosePlanejada, p.unidade, area);
        return `<tr><td>${esc(pr?.nome ?? '—')}</td><td>${esc(pr?.classe ?? '—')}</td><td class="dir">${esc(fmtNum(p.dosePlanejada, 3))} ${esc(p.unidade)}</td><td class="dir">${p.doseReal === null ? '—' : `${esc(fmtNum(p.doseReal, 3))} ${esc(p.unidade)}`}</td><td class="dir ${dv !== null && Math.abs(dv) > 10 ? 'txt-critico' : ''}">${dv === null ? '—' : esc(`${dv > 0 ? '+' : ''}${fmtPct(dv)}`)}</td><td class="dir">${q ? `${esc(fmtNum(q.valor, 2))} ${q.unidade}` : '—'}</td><td>${esc(p.lote || '—')}</td></tr>`;
      }).join('')}
    </tbody></table>
    <p class="nota">* Quantidade total = dose utilizada (ou planejada, se não informada) × área aplicada, convertida para a unidade de estoque.</p>

    <h3 class="sec-tit">${icone('clima', 16)} Condições climáticas</h3>
    <table class="tabela tabela-simples"><thead><tr><th>Momento</th><th>Hora</th><th class="dir">Temp.</th><th class="dir">UR</th><th class="dir">Vento</th><th class="dir">Rajada</th><th>Dir.</th><th>Chuva</th><th>Orvalho</th><th>Origem</th><th>Limites</th></tr></thead><tbody>
      ${op.clima.map((l) => {
        const fora = avaliarLeitura(l, ds.limites);
        return `<tr><td>${esc({ inicio: 'Início', durante: 'Durante', fim: 'Encerramento' }[l.momento])}</td><td>${esc(l.hora)}</td><td class="dir">${l.temperaturaC ?? '—'} °C</td><td class="dir">${l.umidadePct ?? '—'}%</td><td class="dir">${l.ventoKmh ?? '—'} km/h</td><td class="dir">${l.rajadaKmh ?? '—'} km/h</td><td>${esc(l.direcaoVento ?? '—')}</td><td>${esc(l.chuva ?? '—')}</td><td>${l.orvalho === null ? '—' : l.orvalho ? 'Sim' : 'Não'}</td><td>${esc(l.origem)}</td><td>${fora.length ? `<span class="selo selo-atencao" title="${esc(fora.join('; '))}">Fora (${fora.length})</span>` : '<span class="selo selo-neutro">Dentro</span>'}</td></tr>`;
      }).join('') || '<tr><td colspan="11" class="muted">Nenhuma leitura registrada.</td></tr>'}
    </tbody></table>
    <p class="nota">"Dentro/Fora" compara a leitura com os limites configurados (vento ${ds.limites.ventoMinKmh}–${ds.limites.ventoMaxKmh} km/h, UR ≥ ${ds.limites.umidadeMinPct}%, temp. ≤ ${ds.limites.temperaturaMaxC} °C). Não é uma declaração de segurança da aplicação.</p>
    ${blocoEstacao(op)}

    <h3 class="sec-tit">${icone('parada', 16)} Paradas</h3>
    <table class="tabela tabela-simples"><thead><tr><th>Motivo</th><th>Início</th><th>Fim</th><th class="dir">Duração</th><th>Responsável</th><th>Observações</th></tr></thead><tbody>
      ${paradas.map((p) => `<tr><td>${esc(p.motivo)}</td><td>${esc(fmtDataHora(p.inicio))}</td><td>${esc(fmtDataHora(p.fim))}</td><td class="dir">${esc(formatarDuracao(duracaoParadaMin(p)))}</td><td>${esc(p.responsavel)}</td><td>${esc(p.observacoes ?? '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma parada registrada.</td></tr>'}
    </tbody></table>

    ${op.observacoesOperador ? `<h3 class="sec-tit">Observações do operador</h3><p>${esc(op.observacoesOperador)}</p>` : ''}
    <p class="nota">Encerrado por: ${esc(op.responsavelEncerramento ?? '—')} · Registro criado em ${esc(fmtDataHora(op.criadoEm))} · ID ${esc(op.id)}</p>`;
  const m = abrirModal(`Operação · ${fmtData(op.data)} · ${nome.fazenda(os?.fazendaId ?? '')}`, corpo, {
    largura: 'lg',
    rodapeHTML: `<button class="btn btn-sec" data-op-excluir>${icone('lixo', 15)} Excluir</button><button class="btn btn-sec" data-op-corrigir>${icone('config', 15)} Corrigir registro</button><button class="btn btn-pri" data-fechar>Fechar</button>`,
  });
  m.el.querySelector('[data-op-corrigir]')!.addEventListener('click', () => { m.fechar(); corrigirOperacao(op.id); });
  m.el.querySelector('[data-op-excluir]')!.addEventListener('click', () => { m.fechar(); excluirOperacao(op.id); });
}

/**
 * Correção auditável: altera horários, tempo efetivo, áreas e status de uma operação gravada.
 * Motivo obrigatório; o registro anterior fica guardado na auditoria (antes/depois).
 */
export function corrigirOperacao(id: string) {
  const op = estado.ds.operacoes.find((o) => o.id === id);
  if (!op) return;
  const paradas = estado.idx.paradasPorOp.get(op.id) ?? [];
  const campos = [
    { k: 'data', rot: 'Data', tipo: 'data' as const, obrig: true },
    { k: 'horaInicio', rot: 'Hora de início', tipo: 'hora' as const, obrig: true },
    { k: 'horaFim', rot: 'Hora de término', tipo: 'hora' as const, obrig: true },
    { k: 'tempoEfetivoMin', rot: 'Tempo efetivo', tipo: 'numero' as const, unidade: 'min', min: 0, inteiro: true, obrig: true },
    { k: 'status', rot: 'Status', tipo: 'select' as const, opcoes: [['concluida', 'Concluída'], ['parcial', 'Parcial'], ['impedida_clima', 'Impedida (clima)']] as [string, string][] },
    ...op.itens.map((it, i) => ({ k: `area_${i}`, rot: `Área · talhão ${nome.talhao(it.talhaoId)}`, tipo: 'numero' as const, unidade: 'ha', min: 0 })),
    { k: 'observacoesTecnicas', rot: 'Observações técnicas', tipo: 'textarea' as const, largo: true },
    { k: 'motivo', rot: 'Motivo da correção', tipo: 'textarea' as const, largo: true, obrig: true, dica: 'Obrigatório. Fica registrado no histórico de auditoria junto com os valores anteriores.' },
  ];
  const valores: Record<string, string | number | null> = { data: op.data, horaInicio: op.horaInicio, horaFim: op.horaFim ?? '', tempoEfetivoMin: op.tempoEfetivoMin, status: op.status, observacoesTecnicas: op.observacoesTecnicas ?? '', motivo: '' };
  op.itens.forEach((it, i) => { valores[`area_${i}`] = it.areaHa; });
  abrirFormulario({
    titulo: `Corrigir operação · ${fmtData(op.data)} · ${nome.aeronave(op.aeronaveId)}`,
    largura: 'lg',
    campos,
    valores,
    extraHTML: `<p class="nota">Paradas registradas nesta operação: ${paradas.length} (${formatarDuracao(somaParadasMin(paradas))}). Elas não são alteradas aqui.</p>`,
    validar: (v) => {
      const e: string[] = [];
      const total = duracaoTotalMin(String(v.horaInicio), String(v.horaFim));
      if (total === null || total === 0) e.push('Horário de início/término inválido.');
      const parado = somaParadasMin(paradas);
      const efet = Number(v.tempoEfetivoMin ?? 0);
      if (total !== null && efet + parado > total) e.push(`Tempo efetivo (${efet} min) + paradas (${parado} min) excede o tempo total (${total} min).`);
      const areas = op.itens.map((_, i) => Number(v[`area_${i}`] ?? 0));
      if (v.status !== 'impedida_clima' && areas.every((a) => a <= 0)) e.push('Informe a área aplicada (ou marque como impedida por clima).');
      if (v.status !== 'impedida_clima' && efet <= 0) e.push('Tempo efetivo deve ser maior que zero.');
      if (String(v.data) > new Date().toISOString().slice(0, 10)) e.push('A data não pode estar no futuro.');
      if (hhmmParaMin(String(v.horaInicio)) === null) e.push('Hora de início inválida.');
      return e;
    },
    aoSalvar: (v) => {
      const erro = alterar((ds) => {
        const alvo = ds.operacoes.find((o) => o.id === id);
        if (!alvo) return 'Operação não encontrada.';
        const antes = JSON.parse(JSON.stringify(alvo));
        alvo.data = String(v.data); alvo.horaInicio = String(v.horaInicio); alvo.horaFim = String(v.horaFim);
        alvo.tempoEfetivoMin = Number(v.tempoEfetivoMin ?? 0); alvo.status = String(v.status) as StatusOperacao;
        alvo.itens = alvo.itens.map((it, i) => ({ ...it, areaHa: Number(v[`area_${i}`] ?? 0) })).filter((it) => it.areaHa > 0);
        if (alvo.status === 'impedida_clima') { alvo.itens = []; alvo.tempoEfetivoMin = 0; }
        alvo.observacoesTecnicas = String(v.observacoesTecnicas ?? '');
        registrar(ds, { entidade: 'operacao', entidadeId: id, acao: 'corrigir', resumo: `Correção: ${nome.aeronave(alvo.aeronaveId)} ${fmtData(alvo.data)} · ${nome.os(alvo.osId)}`, motivo: String(v.motivo), antes, depois: alvo });
        return null;
      });
      if (!erro) { toast('Correção registrada.', 'ok'); redesenhar(); }
      return erro;
    },
  });
}

export function excluirOperacao(id: string) {
  const op = estado.ds.operacoes.find((o) => o.id === id);
  if (!op) return;
  abrirFormulario({
    titulo: `Excluir operação · ${fmtData(op.data)} · ${nome.aeronave(op.aeronaveId)}`,
    campos: [{ k: 'motivo', rot: 'Motivo da exclusão', tipo: 'textarea', largo: true, obrig: true, dica: 'Ex.: registro duplicado. A operação e suas paradas ficam guardadas na auditoria.' }],
    valores: { motivo: '' },
    extraHTML: `<div class="aviso aviso-atencao">${icone('alerta', 18)}<div>Serão removidos ${esc(fmtHa(areaOperacao(op), 2))} da área aplicada e ${(estado.idx.paradasPorOp.get(id) ?? []).length} parada(s).</div></div>`,
    aoSalvar: (v) => {
      const erro = alterar((ds) => {
        const i = ds.operacoes.findIndex((o) => o.id === id);
        if (i < 0) return 'Operação não encontrada.';
        const antes = { operacao: ds.operacoes[i], paradas: ds.paradas.filter((p) => p.operacaoId === id) };
        ds.operacoes.splice(i, 1);
        ds.paradas = ds.paradas.filter((p) => p.operacaoId !== id);
        registrar(ds, { entidade: 'operacao', entidadeId: id, acao: 'excluir', resumo: `Exclusão: ${nome.aeronave(antes.operacao.aeronaveId)} ${fmtData(antes.operacao.data)} · ${nome.os(antes.operacao.osId)} · ${fmtHa(areaOperacao(antes.operacao), 2)}`, motivo: String(v.motivo), antes });
        return null;
      });
      if (!erro) { toast('Operação excluída (registrada na auditoria).', 'ok'); redesenhar(); }
      return erro;
    },
  });
}

/** Clima da estação meteorológica ligada à fazenda da OS (horário do voo ou resumo do dia). */
function blocoEstacao(op: Operacao): string {
  const c = contextoClima(estado.ds, op);
  if (!c) return '';
  const f = (v: number | null, k = 1) => (v === null ? '—' : esc(fmtNum(v, k)));
  const al = c.alertas.filter((a) => a !== 'estação sem sensor de vento');
  return `<h3 class="sec-tit">${icone('clima', 16)} Estação meteorológica · PIC ${esc(c.estacao.pic || c.estacao.id)} <span class="selo ${c.diario ? 'selo-neutro' : 'selo-info'}">${c.diario ? 'Resumo do dia' : `Durante o voo (${c.registros.length} h)`}</span></h3>
    <div class="chips-info" data-estacao-op><span>Chuva <b>${f(c.chuva)} mm</b></span><span>Temp. <b>${f(c.tmin)}–${f(c.tmax)} °C</b></span><span>UR <b>${f(c.urmin, 0)}–${f(c.urmax, 0)}%</b></span><span>Vento <b>${c.estacao.temVento ? `${f(c.vento)} km/h` : 'sem sensor'}</b></span><span>Rajada <b>${c.estacao.temVento ? `${f(c.rajada)} km/h` : 'sem sensor'}</b></span><span>ΔT pior <b>${f(c.deltaTPior)} °C</b></span></div>
    ${al.length ? `<p>${al.map((a) => `<span class="selo selo-atencao">${esc(a)}</span>`).join(' ')}</p>` : '<p><span class="selo selo-ok">Sem alerta da estação</span></p>'}
    <p class="nota">${esc(c.estacao.nome)}. ${c.diario ? 'Só há o relatório diário para esta data: os valores são do dia inteiro, não do horário do voo.' : 'Extremos medidos nas horas que cobrem o voo.'} ΔT estimado pela T máx. com a UR mín. (Stull, 2011).</p>`;
}
