/** Histórico e auditoria: quem alterou o quê, quando, por quê — com valores antes/depois. */
import type { RegistroAuditoria } from '../domain/types';
import { estado, nome } from '../state';
import { aviso, cabecalhoPagina } from '../ui/components';
import { abrirModal, esc, fmtDataHora, fmtHa, fmtNum } from '../ui/dom';
import { icone } from '../ui/icons';
import { rastrear, type TipoEvento } from '../domain/rastreio';
import type { Relatorio } from '../domain/relatorios';
import { botoesExportar, exportarRelatorio, responsavelAtual } from './relatorios';
import { tabela } from '../ui/table';

const ACOES: Record<string, string> = { criar: 'Criação', editar: 'Edição', excluir: 'Exclusão', inativar: 'Inativação', reativar: 'Reativação', importar: 'Importação', concluir: 'Conclusão', reabrir: 'Reabertura', corrigir: 'Correção', reordenar: 'Reordenação', base: 'Base de dados' };
const ENT: Record<string, string> = { lancamento: 'Lançamento de área', unidade: 'Unidade', fazenda: 'Fazenda', talhao: 'Talhão', campanha: 'Campanha', ordem: 'Ordem de serviço', aeronave: 'Aeronave', colaborador: 'Colaborador', turno: 'Turno', produto: 'Produto', operacao: 'Operação', base: 'Base', configuracao: 'Configuração' };
const iso = (q: string) => { const d = new Date(q); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function renderAuditoria(raiz: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const aba = q.get('aba') ?? (q.get('os') || q.get('talhao') ? 'rastrear' : 'alteracoes');
  raiz.innerHTML = `${cabecalhoPagina('Histórico e auditoria', 'Alterações registradas e rastreabilidade completa de cada OS e talhão.')}
    <div class="imp-abas au-abas" role="tablist"><a href="#/auditoria?aba=alteracoes" class="${aba === 'alteracoes' ? 'ativo' : ''}">Alterações</a><a href="#/auditoria?aba=rastrear" class="${aba === 'rastrear' ? 'ativo' : ''}">Rastrear OS / talhão</a></div>
    <div id="au-conteudo"></div>`;
  const host = raiz.querySelector('#au-conteudo') as HTMLElement;
  if (aba === 'rastrear') renderRastreio(host, q.get('os') ? { tipo: 'os', id: q.get('os')! } : q.get('talhao') ? { tipo: 'talhao', id: q.get('talhao')! } : null);
  else renderAlteracoes(host);
}

function renderAlteracoes(raiz: HTMLElement) {
  const regs = [...estado.ds.auditoria].sort((a, b) => b.quando.localeCompare(a.quando));
  raiz.innerHTML = `
    ${aviso('info', 'Com a nuvem, cada registro leva o nome de quem estava logado (parte do e-mail antes do @); sem login ou no modo local aparece "Gestor (demo)". O nome é informado pelo app; o controle de QUEM pode gravar é feito pelo banco. Este histórico vai junto com os dados e no backup.')}
    <section class="cartao"><div id="au-tab"></div></section>`;
  tabela<RegistroAuditoria>(raiz.querySelector('#au-tab') as HTMLElement, regs, [
    { id: 'q', titulo: 'Quando', valor: (r) => r.quando, render: (r) => esc(fmtDataHora(iso(r.quando))) },
    { id: 'a', titulo: 'Ação', valor: (r) => ACOES[r.acao] ?? r.acao, render: (r) => `<span class="selo ${r.acao === 'excluir' || r.acao === 'corrigir' ? 'selo-atencao' : r.acao === 'criar' || r.acao === 'importar' ? 'selo-ok' : 'selo-neutro'}">${esc(ACOES[r.acao] ?? r.acao)}</span>` },
    { id: 'e', titulo: 'Registro', valor: (r) => ENT[r.entidade] ?? r.entidade, secundaria: true },
    { id: 'r', titulo: 'Resumo', valor: (r) => `${r.resumo} ${r.motivo ?? ''}`, render: (r) => `${esc(r.resumo)}${r.motivo ? `<small class="bloco">Motivo: ${esc(r.motivo)}</small>` : ''}` },
    { id: 'u', titulo: 'Usuário', valor: (r) => r.usuario, secundaria: true },
  ], { ordemInicial: { coluna: 'q', dir: 'desc' }, vazio: 'Nenhuma alteração registrada ainda.', placeholderBusca: 'Buscar fazenda, OS, ação, motivo…', aoClicar: detalhe });
}

function detalhe(r: RegistroAuditoria) {
  const a = (r.antes ?? {}) as Record<string, unknown>;
  const d = (r.depois ?? {}) as Record<string, unknown>;
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]));
  const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'object' ? `<code>${esc(JSON.stringify(v).slice(0, 400))}</code>` : esc(String(v)));
  abrirModal(`${ACOES[r.acao] ?? r.acao} · ${ENT[r.entidade] ?? r.entidade}`, `
    <div class="chips-info"><span>Quando <b>${esc(fmtDataHora(iso(r.quando)))}</b></span><span>Usuário <b>${esc(r.usuario)}</b></span><span>ID <b>${esc(r.entidadeId)}</b></span></div>
    <p>${esc(r.resumo)}</p>${r.motivo ? `<p><b>Motivo:</b> ${esc(r.motivo)}</p>` : ''}
    ${r.antes !== undefined || r.depois !== undefined ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
      ${chaves.map((k) => `<tr><td><b>${esc(k)}</b></td><td>${fmt(a[k])}</td><td>${fmt(d[k])}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sem diferenças de campo.</td></tr>'}
    </tbody></table></div>` : ''}`, { largura: 'lg' });
}

// ---------------- Rastreabilidade ----------------
const ROT: Record<TipoEvento, string> = { cadastro: 'Cadastro', importacao: 'Importação', edicao: 'Edição', voo: 'Voo', parada: 'Parada', lancamento: 'Lançamento', conclusao: 'Conclusão', reabertura: 'Reabertura', correcao: 'Correção', reordenacao: 'Sequência', exclusao: 'Exclusão' };
const ICO: Record<TipoEvento, string> = { cadastro: 'mais', importacao: 'camadas', edicao: 'config', voo: 'drone', parada: 'parada', lancamento: 'area', conclusao: 'ok', reabertura: 'restaurar', correcao: 'alerta', reordenacao: 'rota', exclusao: 'lixo' };
let alvoAtual: { tipo: 'os' | 'talhao'; id: string } | null = null;

function renderRastreio(raiz: HTMLElement, alvo: { tipo: 'os' | 'talhao'; id: string } | null) {
  const ds = estado.ds;
  alvoAtual = alvo ?? alvoAtual;
  const ordens = [...ds.ordens].sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
  const talhoes = [...ds.talhoes].sort((a, b) => nome.fazenda(a.fazendaId).localeCompare(nome.fazenda(b.fazendaId), 'pt-BR', { numeric: true }) || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
  raiz.innerHTML = `<section class="cartao rel-barra">
      <label class="f-campo"><span>Rastrear</span><select data-r="tipo"><option value="os">Ordem de serviço</option><option value="talhao">Talhão</option></select></label>
      <label class="f-campo rel-op"><span>Qual</span><select data-r="id"></select></label>
      ${botoesExportar()}
    </section><div id="rs-corpo"></div>`;
  const selT = raiz.querySelector('[data-r="tipo"]') as HTMLSelectElement;
  const selI = raiz.querySelector('[data-r="id"]') as HTMLSelectElement;
  const opcoes = () => {
    const tipo = selT.value as 'os' | 'talhao';
    selI.innerHTML = tipo === 'os'
      ? ordens.map((o) => `<option value="${esc(o.id)}">OS ${esc(o.numero)} · ${esc(nome.fazenda(o.fazendaId))}${o.status === 'cancelada' ? ' (cancelada)' : ''}</option>`).join('')
      : talhoes.map((t) => `<option value="${esc(t.id)}">${esc(nome.fazenda(t.fazendaId))} · talhão ${esc(t.geral ? 'GERAL' : t.codigo)}${t.zona ? ` (zona ${esc(t.zona)})` : ''}</option>`).join('');
  };
  if (alvoAtual) selT.value = alvoAtual.tipo;
  opcoes();
  if (alvoAtual && [...selI.options].some((o) => o.value === alvoAtual!.id)) selI.value = alvoAtual.id;
  const desenhar = () => {
    alvoAtual = { tipo: selT.value as 'os' | 'talhao', id: selI.value };
    const r = rastrear(ds, alvoAtual);
    const saldo = r.programado - r.aplicado;
    (raiz.querySelector('#rs-corpo') as HTMLElement).innerHTML = `<section class="cartao">
      <h2 class="rs-tit">${esc(r.titulo)}</h2>
      <div class="chips-info"><span>Programado <b>${esc(fmtHa(r.programado, 2))}</b></span><span>Aplicado <b>${esc(fmtHa(r.aplicado, 2))}</b></span><span>Saldo <b>${esc(fmtHa(saldo, 2))}</b></span><span>Eventos <b>${r.eventos.length}</b></span></div>
      ${r.eventos.length ? `<ol class="rs-linha">${r.eventos.map((e) => `<li class="rs-ev rs-${e.tipo}"><span class="rs-ic">${icone(ICO[e.tipo], 14)}</span><div class="rs-txt"><div class="rs-cab"><b>${esc(ROT[e.tipo])}</b><time>${esc(fmtDataHora(e.quando))}</time>${e.fonte === 'auditoria' ? '<span class="selo selo-neutro">alteração</span>' : '<span class="selo selo-info">campo</span>'}</div><div>${esc(e.titulo)}</div>${e.detalhe ? `<small>${esc(e.detalhe)}</small>` : ''}${e.area !== null ? `<small class="rs-area">+${esc(fmtNum(e.area, 2))} ha · acumulado ${esc(fmtNum(e.acumulado ?? 0, 2))} ha</small>` : ''}${e.usuario ? `<small>por ${esc(e.usuario)}</small>` : ''}</div></li>`).join('')}</ol>` : '<p class="vazio-txt">Nada registrado para este item ainda.</p>'}
    </section>`;
  };
  selT.addEventListener('change', () => { opcoes(); desenhar(); });
  selI.addEventListener('change', desenhar);
  raiz.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
    if (!b || !alvoAtual) return;
    const r = rastrear(estado.ds, alvoAtual);
    const rel: Relatorio = {
      id: 'rastreio', titulo: `Rastreabilidade — ${r.titulo}`, periodo: null, filtros: [r.titulo], geradoEm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(), responsavel: responsavelAtual(),
      indicadores: [{ rotulo: 'Programado', valor: r.programado, tipo: 'ha' }, { rotulo: 'Aplicado', valor: r.aplicado, tipo: 'ha' }, { rotulo: 'Saldo', valor: r.programado - r.aplicado, tipo: 'ha' }, { rotulo: 'Eventos', valor: r.eventos.length, tipo: 'int' }],
      secoes: [{ titulo: 'Linha do tempo', colunas: [{ titulo: 'Quando', tipo: 'texto' }, { titulo: 'Tipo', tipo: 'texto' }, { titulo: 'Origem', tipo: 'texto' }, { titulo: 'Evento', tipo: 'texto' }, { titulo: 'Detalhe', tipo: 'texto' }, { titulo: 'Área (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Acumulado (ha)', tipo: 'ha' }, { titulo: 'Usuário', tipo: 'texto' }],
        linhas: r.eventos.map((e) => [fmtDataHora(e.quando), ROT[e.tipo], e.fonte === 'campo' ? 'Campo' : 'Alteração', e.titulo, e.detalhe, e.area, e.acumulado, e.usuario ?? '']) }],
      notas: ['Campo = voos, paradas e lançamentos de área. Alteração = registros do histórico (importação, edição, correção, conclusão).'],
    };
    void exportarRelatorio(rel, b.dataset.exp as 'csv' | 'xlsx' | 'pdf', b);
  });
  desenhar();
}
