/** Telas de cadastro (Fase 1: leitura sobre os dados de demonstração; edição entra na Fase 2). */
import { desempenhoPor, filtrarOperacoes } from '../domain/analytics';
import { aplicacoes, aplicadoPorItem, areaObstaculo, areaOperacao, areaPlanejadaOS, chaveItem, formatarDuracao, percentualExecutado, quantidadeTotal, somaParadasMin } from '../domain/calc';
import type { Aeronave, Campanha, Colaborador, Fazenda, OrdemServico, Produto, Turno, Unidade } from '../domain/types';
import { estado, nome } from '../state';
import { aviso, barraFiltros, cabecalhoPagina, seloAeronave, seloOS, seloOperacao, rotuloStatusOS } from '../ui/components';
import { abrirModal, esc, fmtData, fmtHa, fmtNum, fmtPct } from '../ui/dom';
import { icone } from '../ui/icons';
import { tabela } from '../ui/table';
import { abrirDetalheOperacao } from './aplicacoes';
import { acoesLinha } from './edicao';
const novo = (entidade: string, rotulo: string, extra = '') => `<button class="btn btn-pri" data-novo="${entidade}" ${extra}>${icone('mais', 16)} ${rotulo}</button>`;

const notaFase2 = '';

function barraProgresso(pct: number | null) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return `<div class="mini-prog" title="${esc(fmtPct(pct))}"><div style="width:${v}%" class="${(pct ?? 0) > 100.05 ? 'excesso' : ''}"></div></div><small>${esc(fmtPct(pct, 0))}</small>`;
}

// ---------------- Ordens de serviço ----------------
export function renderOrdens(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Ordens de serviço', 'Do pedido à execução: área planejada por talhão, calda prevista e andamento.', `<a class="btn btn-sec" href="#/relatorios/sequencia">${icone('camadas', 16)} Sequência / importar</a>${novo('ordem', 'Nova OS')}`)}${notaFase2}
    <div id="os-filtros"></div><section class="cartao"><div id="os-tab"></div></section>`;
  const host = raiz.querySelector('#os-tab') as HTMLElement;
  const desenhar = () => {
    const { ds, filtros } = estado;
    const apl = aplicadoPorItem(aplicacoes(ds));
    const aplOS = (o: OrdemServico) => o.itens.reduce((s, i) => s + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0);
    const lista = ds.ordens.filter((o) => (!filtros.campanhaId || o.campanhaId === filtros.campanhaId) && (!filtros.unidadeId || o.unidadeId === filtros.unidadeId) && (!filtros.fazendaId || o.fazendaId === filtros.fazendaId));
    tabela<OrdemServico>(host, lista, [
      { id: 'num', titulo: 'OS', valor: (o) => o.numero, render: (o) => `<b>${esc(o.numero)}</b><small class="bloco">${esc(nome.campanha(o.campanhaId))}</small>` },
      { id: 'faz', titulo: 'Fazenda', valor: (o) => nome.fazenda(o.fazendaId), render: (o) => `${esc(nome.fazenda(o.fazendaId))}<small class="bloco">${esc(nome.unidade(o.unidadeId))}</small>` },
      { id: 'tipo', titulo: 'Tipo', valor: (o) => o.tipo, secundaria: true },
      { id: 'em', titulo: 'Emissão', valor: (o) => o.emissao, render: (o) => esc(fmtData(o.emissao)), secundaria: true },
      { id: 'plan', titulo: 'Planejada', alinhar: 'dir', valor: (o) => areaPlanejadaOS(o), render: (o) => `${esc(fmtHa(areaPlanejadaOS(o), 1))}<small class="bloco">${o.itens.length} talhões</small>` },
      { id: 'apl', titulo: 'Aplicada', alinhar: 'dir', valor: (o) => aplOS(o), render: (o) => esc(fmtHa(aplOS(o), 1)) },
      { id: 'pct', titulo: 'Execução', valor: (o) => percentualExecutado(aplOS(o), areaPlanejadaOS(o)), render: (o) => barraProgresso(percentualExecutado(aplOS(o), areaPlanejadaOS(o))) },
      { id: 'st', titulo: 'Status', valor: (o) => rotuloStatusOS(o.status), render: (o) => seloOS(o.status) + (o.concluidaManual ? ' <small class="bloco">manual</small>' : '') },
      { id: 'ac', titulo: '', valor: () => null, render: (o) => acoesLinha('ordem', o.id) },
    ], { aoClicar: detalheOS, placeholderBusca: 'Buscar OS, fazenda, campanha…', ordemInicial: { coluna: 'num', dir: 'asc' } });
  };
  barraFiltros(raiz.querySelector('#os-filtros') as HTMLElement, desenhar, ['campanhaId', 'unidadeId', 'fazendaId']);
  desenhar();
}

function detalheOS(o: OrdemServico) {
  const { ds } = estado;
  const apl = aplicadoPorItem(aplicacoes(ds));
  const ops = ds.operacoes.filter((x) => x.osId === o.id).sort((a, b) => a.data.localeCompare(b.data));
  const plan = areaPlanejadaOS(o);
  const aplicada = o.itens.reduce((s, i) => s + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0);
  abrirModal(`${o.numero} · ${nome.fazenda(o.fazendaId)}`, `
    <div class="pag-acoes modal-acoes"><button class="btn btn-sec btn-peq" data-editar="ordem" data-id="${esc(o.id)}">${icone('config', 14)} Editar</button>${o.status !== 'cancelada' ? `<button class="btn btn-sec btn-peq" data-lancar-aplicado="${esc(o.id)}">${icone('area', 14)} Lançar aplicado</button>` : ''}<a class="btn btn-sec btn-peq" href="#/auditoria?os=${esc(o.id)}">${icone('historico', 14)} Rastrear</a>${o.status !== 'cancelada' ? `<button class="btn btn-sec btn-peq" data-concluir-os="${esc(o.id)}">${icone('ok', 14)} ${o.concluidaManual || o.status === 'concluida' ? 'Reabrir' : 'Concluir manualmente'}</button>` : ''}${o.status !== 'cancelada' && !ds.operacoes.some((x) => x.osId === o.id) ? `<button class="btn btn-sec btn-peq" data-cancelar-os="${esc(o.id)}">${icone('fechar', 14)} Cancelar OS</button>` : ''}</div>
    ${o.observacoes ? aviso('atencao', esc(o.observacoes)) : ''}
    <div class="chips-info"><span>Status ${seloOS(o.status)}</span><span>Campanha <b>${esc(nome.campanha(o.campanhaId))}</b></span><span>Tipo <b>${esc(o.tipo)}</b></span><span>Emissão <b>${esc(fmtData(o.emissao))}</b></span></div>
    <div class="chips-info"><span>Planejada <b>${esc(fmtHa(plan))}</b></span><span>Aplicada <b>${esc(fmtHa(aplicada))}</b></span><span>${o.concluidaManual ? 'Obstáculo' : 'Restante'} <b class="${plan - aplicada < -0.01 ? 'txt-critico' : ''}">${esc(fmtHa(plan - aplicada))}</b></span><span>Execução <b>${esc(fmtPct(percentualExecutado(aplicada, plan)))}</b></span></div>
    <h3 class="sec-tit">Calda prevista</h3>
    <p>${o.calda.tratamento ? `<b>${esc(o.calda.tratamento)}</b> · ` : ''}Taxa de aplicação: <b>${esc(fmtNum(o.calda.volumeLHa, 1))} L/ha</b> · ${o.calda.produtos.map((p) => `${esc(nome.produto(p.produtoId))} <b>${esc(fmtNum(p.dosePlanejada, 3))} ${esc(p.unidade)}</b>`).join(' · ')}</p>
    <h3 class="sec-tit">Talhões</h3>
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Zona</th><th>Talhão</th><th class="dir">Programado</th><th class="dir">Desc. previsto</th><th class="dir">Aplicado</th><th class="dir">${o.concluidaManual ? 'Obstáculo' : 'Saldo'}</th><th>Execução</th></tr></thead><tbody>
    ${o.itens.map((it) => { const t = estado.ds.talhoes.find((x) => x.id === it.talhaoId); const a = apl.get(chaveItem(o.id, it.talhaoId)) ?? 0; const pc = percentualExecutado(a, it.areaPlanejadaHa); return `<tr><td>${esc(t?.zona ?? '—')}</td><td>${esc(t?.codigo ?? '—')}</td><td class="dir">${esc(fmtNum(it.areaPlanejadaHa, 2))}</td><td class="dir">${it.naoAplicadoHa ? esc(fmtNum(it.naoAplicadoHa, 2)) : '—'}</td><td class="dir"><b>${esc(fmtNum(a, 2))}</b></td><td class="dir ${it.areaPlanejadaHa - a < -0.01 ? 'txt-critico' : ''}">${esc(fmtNum(it.areaPlanejadaHa - a, 2))}</td><td>${barraProgresso(pc)}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td></td><td>${o.itens.length} talhão(ões)</td><td class="dir">${esc(fmtNum(plan, 2))}</td><td class="dir">${esc(fmtNum(o.itens.reduce((s2, i) => s2 + (i.naoAplicadoHa ?? 0), 0), 2))}</td><td class="dir"><b>${esc(fmtNum(aplicada, 2))}</b></td><td class="dir">${esc(fmtNum(plan - aplicada, 2))}</td><td></td></tr></tfoot></table></div>
    <h3 class="sec-tit">Operações vinculadas (${ops.length})</h3>
    <div class="lista-ops">${ops.map((op) => `<button class="op-linha" data-op="${esc(op.id)}"><span class="op-data">${esc(fmtData(op.data))}<small>${esc(op.horaInicio)}</small></span><span class="op-info"><b>${esc(nome.aeronave(op.aeronaveId))} · ${esc(nome.colaborador(op.pilotoId))}</b><small>${op.itens.length} talhão(ões)</small></span><span class="op-area">${esc(fmtHa(areaOperacao(op), 1))}</span><span class="op-status">${seloOperacao(op.status)}</span></button>`).join('') || '<p class="vazio-txt">Nenhuma operação registrada para esta OS.</p>'}</div>`, { largura: 'lg' }).el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-op]') as HTMLElement | null;
    if (b) { const op = ds.operacoes.find((x) => x.id === b.dataset.op); if (op) abrirDetalheOperacao(op); }
  });
}

// ---------------- Aeronaves ----------------
export function renderAeronaves(raiz: HTMLElement) {
  const { ds, idx } = estado;
  raiz.innerHTML = `${cabecalhoPagina('Aeronaves e equipamentos', 'Situação atual, utilização e ocorrências por aeronave.', novo('aeronave', 'Nova aeronave'))}
    ${aviso('info', 'Horas e áreas vêm dos registros de operação do sistema. <b>Não há integração com telemetria do fabricante, RTK ou NTRIP</b> — essas integrações exigem estudo, documentação e autorização próprios.')}
    <div class="grade-cartoes" id="ac-grade"></div>`;
  const grade = raiz.querySelector('#ac-grade') as HTMLElement;
  grade.innerHTML = ds.aeronaves.map((a) => {
    const ops = ds.operacoes.filter((o) => o.aeronaveId === a.id);
    const area = ops.reduce((s, o) => s + areaOperacao(o), 0);
    const minEf = ops.reduce((s, o) => s + o.tempoEfetivoMin, 0);
    const ocorr = ops.flatMap((o) => idx.paradasPorOp.get(o.id) ?? []).filter((p) => p.motivo === 'Manutenção' || p.motivo === 'Falha de equipamento');
    const ultima = ops.reduce((m, o) => (o.data > m ? o.data : m), '');
    return `<button class="cartao cartao-ac" data-ac="${esc(a.id)}">
      <div class="ac-topo"><span class="ac-ico">${icone('drone', 22)}</span><div><b>${esc(a.identificacao)}</b><small>${esc(a.modelo)} · ${esc(a.numeroSerie)}</small></div>${seloAeronave(a.status)}</div>
      <div class="ac-metricas">
        <div><span>Área aplicada</span><b>${esc(fmtHa(area, 1))}</b></div>
        <div><span>Tempo efetivo</span><b>${esc(formatarDuracao(minEf))}</b></div>
        <div><span>Operações</span><b>${ops.length}</b></div>
        <div><span>Ocorrências</span><b>${ocorr.length}</b></div>
      </div>
      <div class="ac-rodape"><span>${esc(nome.unidade(a.unidadeId))}</span><span>Último uso: ${esc(fmtData(ultima || null))}</span></div>
    </button>`;
  }).join('');
  grade.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-ac]') as HTMLElement | null;
    if (b) detalheAeronave(ds.aeronaves.find((a) => a.id === b.dataset.ac)!);
  });
}

function detalheAeronave(a: Aeronave) {
  const { ds, idx } = estado;
  const ops = ds.operacoes.filter((o) => o.aeronaveId === a.id).sort((x, y) => y.data.localeCompare(x.data));
  const minEf = ops.reduce((s, o) => s + o.tempoEfetivoMin, 0);
  const ocorr = ops.flatMap((o) => (idx.paradasPorOp.get(o.id) ?? []).map((p) => ({ p, o }))).filter(({ p }) => p.motivo === 'Manutenção' || p.motivo === 'Falha de equipamento');
  const m = abrirModal(`${a.identificacao} · ${a.modelo}`, `
    <div class="pag-acoes modal-acoes"><button class="btn btn-sec btn-peq" data-editar="aeronave" data-id="${esc(a.id)}">${icone('config', 14)} Editar</button><button class="btn btn-sec btn-peq" data-excluir="aeronave" data-id="${esc(a.id)}">${icone('lixo', 14)} Excluir / inativar</button></div>
    <div class="chips-info"><span>Status ${seloAeronave(a.status)}</span><span>Nº de série <b>${esc(a.numeroSerie)}</b></span><span>Unidade <b>${esc(nome.unidade(a.unidadeId))}</b></span></div>
    <div class="chips-info"><span>Horas anteriores (cadastro) <b>${esc(fmtNum(a.horasAnteriores, 1))} h</b></span><span>Horas efetivas registradas <b>${esc(fmtNum(minEf / 60, 1))} h</b></span><span>Total <b>${esc(fmtNum(a.horasAnteriores + minEf / 60, 1))} h</b></span></div>
    <h3 class="sec-tit">Ocorrências (manutenção e falhas) — ${ocorr.length}</h3>
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Data</th><th>Motivo</th><th class="dir">Duração</th><th>Fazenda</th></tr></thead><tbody>
    ${ocorr.map(({ p, o }) => `<tr><td>${esc(fmtData(p.inicio))}</td><td>${esc(p.motivo)}</td><td class="dir">${esc(formatarDuracao(somaParadasMin([p])))}</td><td>${esc(nome.fazenda(idx.os.get(o.osId)?.fazendaId ?? ''))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem ocorrências registradas.</td></tr>'}
    </tbody></table></div>
    ${aviso('info', 'Histórico de manutenção preventiva (planos, peças, horas por componente) é um cadastro próprio previsto para a Fase 2.')}
    <h3 class="sec-tit">Histórico de utilização (${ops.length})</h3>
    <div class="lista-ops">${ops.slice(0, 30).map((op) => `<button class="op-linha" data-op="${esc(op.id)}"><span class="op-data">${esc(fmtData(op.data))}<small>${esc(op.horaInicio)}</small></span><span class="op-info"><b>${esc(nome.fazenda(idx.os.get(op.osId)?.fazendaId ?? ''))}</b><small>${esc(nome.os(op.osId))} · ${esc(nome.colaborador(op.pilotoId))}</small></span><span class="op-area">${esc(fmtHa(areaOperacao(op), 1))}</span><span class="op-status">${seloOperacao(op.status)}</span></button>`).join('') || '<p class="vazio-txt">Sem operações registradas.</p>'}</div>`, { largura: 'lg' });
  m.el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-op]') as HTMLElement | null;
    if (b) { const op = ds.operacoes.find((x) => x.id === b.dataset.op); if (op) abrirDetalheOperacao(op); }
  });
}

// ---------------- Pilotos e colaboradores ----------------
export function renderColaboradores(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Pilotos e colaboradores', 'Equipe de campo e desempenho dos operadores no período filtrado.', novo('colaborador', 'Novo colaborador'))}${notaFase2}<div id="col-filtros"></div><section class="cartao"><div id="col-tab"></div></section>`;
  const host = raiz.querySelector('#col-tab') as HTMLElement;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const ops = filtrarOperacoes(ds, filtros, idx).filter((o) => o.status !== 'impedida_clima');
    const desemp = new Map(desempenhoPor(ops, idx, 'pilotoId', nome.colaborador).map((d) => [d.id, d]));
    const comoAux = (id: string) => ops.filter((o) => o.auxiliarIds.includes(id)).length;
    const comoLider = (id: string) => ops.filter((o) => o.liderId === id).length;
    const qtd = (c: Colaborador) => (c.funcao === 'Piloto' ? desemp.get(c.id)?.ops ?? 0 : c.funcao === 'Líder de turno' ? comoLider(c.id) : comoAux(c.id));
    const rotQtd = (c: Colaborador) => (c.funcao === 'Piloto' ? String(qtd(c)) : c.funcao === 'Líder de turno' ? `${qtd(c)} (líder)` : `${qtd(c)} (apoio)`);
    tabela<Colaborador>(host, ds.colaboradores.filter((c) => !filtros.unidadeId || c.unidadeId === filtros.unidadeId), [
      { id: 'nome', titulo: 'Nome', valor: (c) => c.nome, render: (c) => `<b>${esc(c.nome)}</b><small class="bloco">${esc(c.funcao)}</small>` },
      { id: 'un', titulo: 'Unidade', valor: (c) => nome.unidade(c.unidadeId), secundaria: true },
      { id: 'ops', titulo: 'Operações', alinhar: 'dir', valor: qtd, render: (c) => esc(rotQtd(c)) },
      { id: 'area', titulo: 'Área como operador', alinhar: 'dir', valor: (c) => desemp.get(c.id)?.area ?? null, render: (c) => esc(c.funcao === 'Piloto' ? fmtHa(desemp.get(c.id)?.area ?? 0, 1) : '—') },
      { id: 'ef', titulo: 'ha/h efetivo', alinhar: 'dir', valor: (c) => desemp.get(c.id)?.prodEfetiva ?? null, render: (c) => esc(fmtNum(desemp.get(c.id)?.prodEfetiva ?? null, 2)) },
      { id: 'op', titulo: 'ha/h c/ paradas', alinhar: 'dir', secundaria: true, valor: (c) => desemp.get(c.id)?.prodOperacional ?? null, render: (c) => esc(fmtNum(desemp.get(c.id)?.prodOperacional ?? null, 2)) },
      { id: 'at', titulo: 'Situação', valor: (c) => (c.ativo ? 'Ativo' : 'Inativo'), render: (c) => `<span class="selo ${c.ativo ? 'selo-ok' : 'selo-apagado'}">${c.ativo ? 'Ativo' : 'Inativo'}</span>`, secundaria: true },
      { id: 'ac', titulo: '', valor: () => null, render: (c) => acoesLinha('colaborador', c.id) },
    ], { ordemInicial: { coluna: 'area', dir: 'desc' } });
  };
  barraFiltros(raiz.querySelector('#col-filtros') as HTMLElement, desenhar, ['de', 'ate', 'campanhaId', 'unidadeId']);
  desenhar();
}

// ---------------- Fazendas e talhões ----------------
export function renderFazendas(raiz: HTMLElement) {
  const { ds } = estado;
  raiz.innerHTML = `${cabecalhoPagina('Fazendas e talhões', 'Base de localização: (unidade/empresa, opcional) → fazenda → talhão. O talhão é a unidade de controle de área.', `<button class="btn btn-sec" data-importar-talhoes>${icone('camadas', 16)} Importar talhões</button><button class="btn btn-sec" data-importar-mapa>${icone('rota', 16)} Importar mapa de talhões (KML)</button>${novo('fazenda', 'Nova fazenda')}`)}${notaFase2}
    <section class="cartao"><header class="cartao-cab"><div><h2>Unidades / empresas <small class="muted">(opcional)</small></h2><p>Agrupam fazendas, aeronaves e equipes. Não é obrigatório: fazendas podem ficar sem unidade.</p></div>${novo('unidade', 'Nova unidade / empresa').replace('btn-pri', 'btn-sec btn-peq')}</header><div id="un-tab"></div></section>
    <section class="cartao"><header class="cartao-cab"><div><h2>Fazendas</h2><p>Clique para ver os talhões</p></div></header><div id="fz-tab"></div></section>`;
  tabela<Unidade>(raiz.querySelector('#un-tab') as HTMLElement, ds.unidades, [
    { id: 'cod', titulo: 'Código', valor: (u) => u.codigo },
    { id: 'nome', titulo: 'Unidade', valor: (u) => u.nome, render: (u) => `<b>${esc(u.nome)}</b><small class="bloco">${esc(u.municipio)}</small>` },
    { id: 'faz', titulo: 'Fazendas', alinhar: 'dir', valor: (u) => ds.fazendas.filter((f) => f.unidadeId === u.id).length },
    { id: 'tal', titulo: 'Área total', alinhar: 'dir', valor: (u) => ds.talhoes.filter((t) => ds.fazendas.find((f) => f.id === t.fazendaId)?.unidadeId === u.id).reduce((a, t) => a + t.areaHa, 0), render: (u) => esc(fmtHa(ds.talhoes.filter((t) => ds.fazendas.find((f) => f.id === t.fazendaId)?.unidadeId === u.id).reduce((a, t) => a + t.areaHa, 0), 1)) },
    { id: 'ac', titulo: 'Aeronaves', alinhar: 'dir', valor: (u) => ds.aeronaves.filter((a) => a.unidadeId === u.id).length, secundaria: true },
    { id: 'acoes', titulo: '', valor: () => null, render: (u) => acoesLinha('unidade', u.id) },
  ], { porPagina: 10, vazio: 'Nenhuma unidade/empresa cadastrada (opcional).' });
  const apl = aplicadoPorItem(aplicacoes(ds));
  const aplFaz = (f: Fazenda) => ds.ordens.filter((o) => o.fazendaId === f.id && o.status !== 'cancelada').reduce((s, o) => s + o.itens.reduce((a, i) => a + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0), 0);
  const ts = (f: Fazenda) => ds.talhoes.filter((t) => t.fazendaId === f.id);
  tabela<Fazenda>(raiz.querySelector('#fz-tab') as HTMLElement, ds.fazendas, [
    { id: 'cod', titulo: 'Nº', valor: (f) => f.codigo, render: (f) => `<b>${esc(f.codigo)}</b>` },
    { id: 'nome', titulo: 'Fazenda', valor: (f) => f.nome, render: (f) => `${esc(f.nome)}<small class="bloco">${esc(f.municipio)}</small>` },
    { id: 'un', titulo: 'Unidade', valor: (f) => nome.unidade(f.unidadeId), secundaria: true },
    { id: 'tal', titulo: 'Talhões', alinhar: 'dir', valor: (f) => ts(f).length },
    { id: 'area', titulo: 'Área total', alinhar: 'dir', valor: (f) => ts(f).reduce((s, t) => s + t.areaHa, 0), render: (f) => esc(fmtHa(ts(f).reduce((s, t) => s + t.areaHa, 0), 1)) },
    { id: 'apl', titulo: 'Aplicada (todas as OS)', alinhar: 'dir', valor: aplFaz, render: (f) => esc(fmtHa(aplFaz(f), 1)), secundaria: true },
    { id: 'acoes', titulo: '', valor: () => null, render: (f) => acoesLinha('fazenda', f.id) },
  ], {
    vazio: 'Nenhuma fazenda. Cadastre, importe a sequência (Relatórios → Sequência) ou importe talhões.',
    aoClicar: (f) => abrirModal(`${f.codigo} · ${f.nome}`, `<div class="pag-acoes modal-acoes"><button class="btn btn-sec btn-peq" data-novo="talhao" data-fazenda="${esc(f.id)}">${icone('mais', 14)} Novo talhão</button><button class="btn btn-sec btn-peq" data-editar="fazenda" data-id="${esc(f.id)}">${icone('config', 14)} Editar fazenda</button></div>
      <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Talhão</th><th class="dir">Área</th><th>OS vinculadas</th><th></th></tr></thead><tbody>${ts(f).map((t) => `<tr><td>${esc(t.codigo)}${t.geral ? ' <small class="muted">(geral, da importação)</small>' : ''}</td><td class="dir">${esc(fmtHa(t.areaHa))}</td><td>${esc(ds.ordens.filter((o) => o.itens.some((i) => i.talhaoId === t.id)).map((o) => o.numero).join(', ') || '—')}</td><td class="dir">${acoesLinha('talhao', t.id)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem talhões cadastrados.</td></tr>'}</tbody></table></div>`, { largura: 'md' }),
    rodape: (fl) => `<tr><td></td><td>Total</td><td class="sec"></td><td class="dir">${fl.reduce((s, f) => s + ts(f).length, 0)}</td><td class="dir"><b>${esc(fmtHa(fl.reduce((s, f) => s + ts(f).reduce((a, t) => a + t.areaHa, 0), 0), 1))}</b></td><td class="sec"></td></tr>`,
  });
}

// ---------------- Turnos e líderes ----------------
export function renderTurnos(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Turnos e líderes', 'Turnos de trabalho, líder responsável e desempenho de cada turno no período filtrado.', novo('turno', 'Novo turno'))}${notaFase2}
    ${aviso('info', 'Cada operação registra o <b>turno</b> e o <b>líder do turno</b> que respondeu por ela. O líder padrão vem do cadastro do turno e pode ser trocado no registro em caso de substituição.')}
    <div id="tn-filtros"></div><section class="cartao"><div id="tn-tab"></div></section>
    <section class="cartao"><header class="cartao-cab"><div><h2>Desempenho por líder</h2><p>Operações em que o colaborador respondeu como líder do turno</p></div></header><div id="ld-tab"></div></section>`;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const ops = filtrarOperacoes(ds, { ...filtros, turnoId: '', liderId: '' }, idx);
    const comArea = ops.filter((o) => o.status !== 'impedida_clima');
    const porTurno = new Map(desempenhoPor(comArea, idx, 'turnoId', nome.turno).map((d) => [d.id, d]));
    const impedidas = (campo: 'turnoId' | 'liderId', id: string) => ops.filter((o) => o[campo] === id && o.status === 'impedida_clima').length;
    const parado = (campo: 'turnoId' | 'liderId', id: string) => ops.filter((o) => o[campo] === id).reduce((s, o) => s + somaParadasMin(idx.paradasPorOp.get(o.id) ?? []), 0);
    tabela<Turno>(raiz.querySelector('#tn-tab') as HTMLElement, ds.turnos, [
      { id: 'nome', titulo: 'Turno', valor: (t) => t.nome, render: (t) => `<b>${esc(t.nome)}</b><small class="bloco">${esc(t.periodo)} · ${esc(t.horaInicio)}–${esc(t.horaFim)}</small>` },
      { id: 'lider', titulo: 'Líder padrão', valor: (t) => nome.colaborador(t.liderId) },
      { id: 'ops', titulo: 'Operações', alinhar: 'dir', valor: (t) => porTurno.get(t.id)?.ops ?? 0, render: (t) => esc(`${porTurno.get(t.id)?.ops ?? 0}${impedidas('turnoId', t.id) ? ` + ${impedidas('turnoId', t.id)} impedidas` : ''}`) },
      { id: 'area', titulo: 'Área aplicada', alinhar: 'dir', valor: (t) => porTurno.get(t.id)?.area ?? 0, render: (t) => `<b>${esc(fmtHa(porTurno.get(t.id)?.area ?? 0, 1))}</b>` },
      { id: 'ef', titulo: 'ha/h efetivo', alinhar: 'dir', valor: (t) => porTurno.get(t.id)?.prodEfetiva ?? null, render: (t) => esc(fmtNum(porTurno.get(t.id)?.prodEfetiva ?? null, 2)) },
      { id: 'op', titulo: 'ha/h c/ paradas', alinhar: 'dir', valor: (t) => porTurno.get(t.id)?.prodOperacional ?? null, render: (t) => esc(fmtNum(porTurno.get(t.id)?.prodOperacional ?? null, 2)), secundaria: true },
      { id: 'par', titulo: 'Tempo parado', alinhar: 'dir', valor: (t) => parado('turnoId', t.id), render: (t) => esc(formatarDuracao(parado('turnoId', t.id))), secundaria: true },
      { id: 'at', titulo: 'Situação', valor: (t) => (t.ativo ? 'Ativo' : 'Inativo'), render: (t) => `<span class="selo ${t.ativo ? 'selo-ok' : 'selo-apagado'}">${t.ativo ? 'Ativo' : 'Inativo'}</span>`, secundaria: true },
      { id: 'ac', titulo: '', valor: () => null, render: (t) => acoesLinha('turno', t.id) },
    ], { vazio: 'Nenhum turno cadastrado.' });
    const lideres = ds.colaboradores.filter((c) => c.funcao === 'Líder de turno');
    const porLider = new Map(desempenhoPor(comArea, idx, 'liderId', nome.colaborador).map((d) => [d.id, d]));
    tabela<Colaborador>(raiz.querySelector('#ld-tab') as HTMLElement, lideres, [
      { id: 'nome', titulo: 'Líder', valor: (c) => c.nome, render: (c) => `<b>${esc(c.nome)}</b><small class="bloco">${esc(ds.turnos.filter((t) => t.liderId === c.id).map((t) => `Líder padrão do ${t.nome}`).join(', ') || 'Substituto')}</small>` },
      { id: 'ops', titulo: 'Operações', alinhar: 'dir', valor: (c) => porLider.get(c.id)?.ops ?? 0 },
      { id: 'area', titulo: 'Área aplicada', alinhar: 'dir', valor: (c) => porLider.get(c.id)?.area ?? 0, render: (c) => `<b>${esc(fmtHa(porLider.get(c.id)?.area ?? 0, 1))}</b>` },
      { id: 'ef', titulo: 'ha/h efetivo', alinhar: 'dir', valor: (c) => porLider.get(c.id)?.prodEfetiva ?? null, render: (c) => esc(fmtNum(porLider.get(c.id)?.prodEfetiva ?? null, 2)) },
      { id: 'par', titulo: 'Tempo parado', alinhar: 'dir', valor: (c) => parado('liderId', c.id), render: (c) => esc(formatarDuracao(parado('liderId', c.id))), secundaria: true },
    ], { ordemInicial: { coluna: 'area', dir: 'desc' } });
  };
  barraFiltros(raiz.querySelector('#tn-filtros') as HTMLElement, desenhar, ['de', 'ate', 'campanhaId', 'unidadeId', 'fazendaId', 'aeronaveId']);
  desenhar();
}

// ---------------- Produtos ----------------
export function renderProdutos(raiz: HTMLElement) {
  raiz.innerHTML = `${cabecalhoPagina('Produtos e insumos', 'Lista padronizada de produtos por classe. Consumo calculado pelas operações do período.', novo('produto', 'Novo produto'))}${notaFase2}<div id="pr-filtros"></div><section class="cartao"><div id="pr-tab"></div></section>
    <p class="nota">Consumo = Σ (dose utilizada — ou planejada, quando não informada — × área aplicada da operação), convertido para a unidade de estoque. Dose, volume de calda e quantidade total são grandezas distintas.</p>`;
  const host = raiz.querySelector('#pr-tab') as HTMLElement;
  const desenhar = () => {
    const { ds, idx, filtros } = estado;
    const ops = filtrarOperacoes(ds, filtros, idx);
    const consumo = (p: Produto) => ops.reduce((s, o) => {
      const it = o.calda.produtos.find((x) => x.produtoId === p.id);
      if (!it) return s;
      const q = quantidadeTotal(it.doseReal ?? it.dosePlanejada, it.unidade, areaOperacao(o));
      return s + (q?.valor ?? 0);
    }, 0);
    const usos = (p: Produto) => ops.filter((o) => o.calda.produtos.some((x) => x.produtoId === p.id) && areaOperacao(o) > 0).length;
    tabela<Produto>(host, ds.produtos, [
      { id: 'nome', titulo: 'Produto', valor: (p) => p.nome, render: (p) => `<b>${esc(p.nome)}</b>` },
      { id: 'cod', titulo: 'Código', valor: (p) => p.codigo ?? '', render: (p) => esc(p.codigo ?? '—') },
      { id: 'cl', titulo: 'Classe', valor: (p) => p.classe },
      { id: 'ud', titulo: 'Unidade de dose', valor: (p) => p.unidadeDose, secundaria: true },
      { id: 'ops', titulo: 'Operações', alinhar: 'dir', valor: usos },
      { id: 'cons', titulo: 'Consumo no período', alinhar: 'dir', valor: consumo, render: (p) => `<b>${esc(fmtNum(consumo(p), 2))}</b> ${esc(p.unidadeTotal)}` },
      { id: 'ac', titulo: '', valor: () => null, render: (p) => acoesLinha('produto', p.id) },
    ], { ordemInicial: { coluna: 'cons', dir: 'desc' } });
  };
  barraFiltros(raiz.querySelector('#pr-filtros') as HTMLElement, desenhar, ['de', 'ate', 'campanhaId', 'unidadeId', 'fazendaId']);
  desenhar();
}

// ---------------- Campanhas ----------------
export function renderCampanhas(raiz: HTMLElement) {
  const { ds } = estado;
  raiz.innerHTML = `${cabecalhoPagina('Campanhas e calda', 'Cada campanha tem prazo e calda padrão (produtos e doses). Novas OS herdam a calda da campanha.', novo('campanha', 'Nova campanha'))}<section class="cartao"><div id="cp-tab"></div></section>`;
  const apl = aplicadoPorItem(aplicacoes(ds));
  const plan = (id: string) => ds.ordens.filter((o) => o.campanhaId === id && o.status !== 'cancelada').reduce((s, o) => s + areaPlanejadaOS(o), 0);
  const obst = (id: string) => ds.ordens.filter((o) => o.campanhaId === id && o.status !== 'cancelada').reduce((s, o) => s + areaObstaculo(o, apl), 0);
  const feito = (id: string) => ds.ordens.filter((o) => o.campanhaId === id && o.status !== 'cancelada').reduce((s, o) => s + o.itens.reduce((a, i) => a + (apl.get(chaveItem(o.id, i.talhaoId)) ?? 0), 0), 0);
  tabela<Campanha>(raiz.querySelector('#cp-tab') as HTMLElement, ds.campanhas, [
    { id: 'nome', titulo: 'Campanha', valor: (c) => c.nome, render: (c) => `<b>${esc(c.nome)}</b><small class="bloco">${esc(c.tipo)} · ${esc(c.cultura)}</small>` },
    { id: 'per', titulo: 'Período', valor: (c) => c.inicio, render: (c) => `${esc(fmtData(c.inicio))} a ${esc(fmtData(c.fim))}`, secundaria: true },
    { id: 'calda', titulo: 'Calda', valor: (c) => c.calda?.produtos.length ?? 0, render: (c) => (c.calda?.produtos.length ? `${c.calda.tratamento ? `<b>${esc(c.calda.tratamento)}</b> · ` : ''}${esc(fmtNum(c.calda.volumeLHa, 0))} L/ha · ${c.calda.produtos.map((p) => `${esc(nome.produto(p.produtoId))} ${esc(fmtNum(p.dosePlanejada, 3))} ${esc(p.unidade)}`).join(' · ')}` : '<span class="selo selo-atencao">definir calda</span>') },
    { id: 'os', titulo: 'OS', alinhar: 'dir', valor: (c) => ds.ordens.filter((o) => o.campanhaId === c.id && o.status !== 'cancelada').length },
    { id: 'plan', titulo: 'Programado', alinhar: 'dir', valor: (c) => plan(c.id), render: (c) => esc(fmtHa(plan(c.id), 1)) },
    { id: 'apl', titulo: 'Aplicado', alinhar: 'dir', valor: (c) => feito(c.id), render: (c) => esc(fmtHa(feito(c.id), 2)) },
    { id: 'obst', titulo: 'Obstáculos', alinhar: 'dir', valor: (c) => obst(c.id), render: (c) => (obst(c.id) > 0.005 ? esc(fmtHa(obst(c.id), 2)) : '—'), secundaria: true },
    { id: 'pct', titulo: 'Execução', valor: (c) => percentualExecutado(feito(c.id), plan(c.id)), render: (c) => barraProgresso(percentualExecutado(feito(c.id), plan(c.id))) },
    { id: 'ac', titulo: '', valor: () => null, render: (c) => acoesLinha('campanha', c.id) },
  ], { vazio: 'Nenhuma campanha. Crie uma ou importe a sequência em Relatórios → Sequência.' });
}
