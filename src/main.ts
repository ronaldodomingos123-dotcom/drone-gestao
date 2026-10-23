import './styles.css';
import { carregarEstado } from './state';
import { limparGraficos } from './ui/charts';
import { esc, toast } from './ui/dom';
import { icone } from './ui/icons';
import { renderDashboard } from './modules/dashboard';
import { renderAplicacoes } from './modules/aplicacoes';
import { renderCentralRelatorios, renderVerRelatorio } from './modules/relatorios';
import { renderAnalise } from './modules/analise';
import { renderEstacoes } from './modules/estacoes';
import { renderFechamento } from './modules/fechamento';
import { renderPlanejamento } from './modules/planejamento';
import { abrirLancarAplicado } from './modules/lancarAplicado';
import { renderNovaAplicacao } from './modules/novaAplicacao';
import { renderAeronaves, renderCampanhas, renderColaboradores, renderFazendas, renderOrdens, renderProdutos, renderTurnos } from './modules/cadastros';
import { renderDiario } from './modules/diario';
import { renderCampo } from './modules/campo';
import { renderAuditoria } from './modules/auditoria';
import { alternarConclusaoOS, cancelarOS, editarAeronave, editarCampanha, editarColaborador, editarFazenda, editarOS, editarProduto, editarTalhao, editarTurno, editarUnidade, excluir } from './modules/edicao';
import { abrirImportarTalhoes, renderSequencia } from './modules/sequencia';
import { abrirImportarMapa } from './modules/mapaTalhoes';
import { estado, nome } from './state';
import type { EntidadeAuditada } from './domain/types';
import { renderClima, renderConfiguracoes, renderParadas } from './modules/operacional';

type Situacao = 'pronto' | 'parcial' | 'planejado';
interface Modulo { rota: string; titulo: string; icone: string; grupo: string; situacao: Situacao; render: (el: HTMLElement) => void; menu?: boolean }

const MODULOS: Modulo[] = [
  { rota: 'dashboard', titulo: 'Dashboard gerencial', icone: 'painel', grupo: 'Visão geral', situacao: 'pronto', render: renderDashboard },
  { rota: 'aplicacoes', titulo: 'Aplicações', icone: 'aplicacao', grupo: 'Operação', situacao: 'pronto', render: renderAplicacoes },
  { rota: 'campo', titulo: 'Registro de campo', icone: 'drone', grupo: 'Operação', situacao: 'pronto', render: renderCampo },
  { rota: 'aplicacoes/nova', titulo: 'Nova aplicação', icone: 'mais', grupo: 'Operação', situacao: 'pronto', render: renderNovaAplicacao, menu: false },
  { rota: 'ordens', titulo: 'Ordens de serviço', icone: 'os', grupo: 'Operação', situacao: 'pronto', render: renderOrdens },
  { rota: 'paradas', titulo: 'Paradas operacionais', icone: 'parada', grupo: 'Operação', situacao: 'pronto', render: renderParadas },
  { rota: 'clima', titulo: 'Condições climáticas', icone: 'clima', grupo: 'Operação', situacao: 'pronto', render: renderClima },
  { rota: 'fechamento', titulo: 'Fechamento do dia', icone: 'ok', grupo: 'Operação', situacao: 'pronto', render: renderFechamento },
  { rota: 'estacoes', titulo: 'Estações meteorológicas', icone: 'termometro', grupo: 'Operação', situacao: 'pronto', render: renderEstacoes },
  { rota: 'planejamento', titulo: 'Planejamento e metas', icone: 'meta', grupo: 'Operação', situacao: 'pronto', render: renderPlanejamento },
  { rota: 'campanhas', titulo: 'Campanhas e calda', icone: 'meta', grupo: 'Cadastros', situacao: 'pronto', render: renderCampanhas },
  { rota: 'turnos', titulo: 'Turnos e líderes', icone: 'clientes', grupo: 'Cadastros', situacao: 'pronto', render: renderTurnos },
  { rota: 'fazendas', titulo: 'Fazendas e talhões', icone: 'fazenda', grupo: 'Cadastros', situacao: 'pronto', render: renderFazendas },
  { rota: 'aeronaves', titulo: 'Aeronaves e equipamentos', icone: 'drone', grupo: 'Cadastros', situacao: 'pronto', render: renderAeronaves },
  { rota: 'colaboradores', titulo: 'Pilotos e colaboradores', icone: 'pessoa', grupo: 'Cadastros', situacao: 'pronto', render: renderColaboradores },
  { rota: 'produtos', titulo: 'Produtos e insumos', icone: 'produto', grupo: 'Cadastros', situacao: 'pronto', render: renderProdutos },
  { rota: 'relatorios', titulo: 'Relatórios', icone: 'relatorio', grupo: 'Gestão', situacao: 'pronto', render: renderCentralRelatorios },
  { rota: 'relatorios/ver', titulo: 'Relatório', icone: 'relatorio', grupo: 'Gestão', situacao: 'pronto', render: renderVerRelatorio, menu: false },
  { rota: 'relatorios/sequencia', titulo: 'Sequência de aplicação', icone: 'camadas', grupo: 'Gestão', situacao: 'pronto', render: renderSequencia, menu: false },
  { rota: 'relatorios/diario', titulo: 'Diário de aplicações', icone: 'relatorio', grupo: 'Gestão', situacao: 'pronto', render: renderDiario, menu: false },
  { rota: 'analise', titulo: 'Análise de produtividade', icone: 'velocidade', grupo: 'Gestão', situacao: 'pronto', render: renderAnalise },
  { rota: 'auditoria', titulo: 'Histórico e auditoria', icone: 'historico', grupo: 'Gestão', situacao: 'pronto', render: renderAuditoria },
  { rota: 'configuracoes', titulo: 'Configurações', icone: 'config', grupo: 'Gestão', situacao: 'pronto', render: renderConfiguracoes },
];

const ROTULO_SIT: Record<Situacao, string> = { pronto: '', parcial: 'Consulta', planejado: 'Planejado' };

function shell(app: HTMLElement) {
  const grupos = [...new Set(MODULOS.filter((m) => m.menu !== false).map((m) => m.grupo))];
  app.innerHTML = `
    <aside class="lateral" id="lateral" aria-label="Menu principal">
      <div class="marca"><span class="marca-ico">${icone('drone', 20)}</span><div><b>Gestão de Aplicações</b><small>Drones agrícolas · protótipo</small></div>
        <button class="btn-icone fechar-menu" data-menu="fechar" aria-label="Fechar menu">${icone('fechar', 18)}</button></div>
      <nav>${grupos.map((g) => `<div class="nav-grupo"><span class="nav-tit">${esc(g)}</span>${MODULOS.filter((m) => m.grupo === g && m.menu !== false).map((m) => `
        <a href="#/${m.rota}" data-rota="${m.rota}">${icone(m.icone, 18)}<span>${esc(m.titulo)}</span>${m.situacao !== 'pronto' ? `<em class="nav-sit nav-${m.situacao}">${ROTULO_SIT[m.situacao]}</em>` : ''}</a>`).join('')}</div>`).join('')}</nav>
      <div class="lateral-rodape"><span class="avatar">GD</span><div><b>Gestor (demo)</b><small>Sem autenticação — Fase 4</small></div></div>
    </aside>
    <div class="fundo-menu" data-menu="fechar"></div>
    <div class="principal">
      <div class="faixa-demo" role="note">${icone('info', 15)}<span><b>DADOS DE DEMONSTRAÇÃO — fictícios.</b> Protótipo Fase 1 · dados salvos só neste navegador · nada é enviado a servidores.</span></div>
      <header class="topo">
        <button class="btn-icone abrir-menu" data-menu="abrir" aria-label="Abrir menu">${icone('menu', 20)}</button>
        <div class="topo-tit"><small id="topo-grupo"></small><b id="topo-titulo"></b></div>
        <a class="btn btn-pri btn-topo" href="#/aplicacoes/nova">${icone('mais', 16)}<span>Nova aplicação</span></a>
      </header>
      <main id="conteudo" tabindex="-1"></main>
    </div>
    <nav class="barra-inferior" aria-label="Navegação rápida">
      <a href="#/dashboard" data-rota="dashboard">${icone('painel', 20)}<span>Painel</span></a>
      <a href="#/aplicacoes" data-rota="aplicacoes">${icone('aplicacao', 20)}<span>Aplicações</span></a>
      <a href="#/campo" class="bi-novo" data-rota="campo" aria-label="Registro de campo">${icone('mais', 24)}</a>
      <a href="#/paradas" data-rota="paradas">${icone('parada', 20)}<span>Paradas</span></a>
      <button data-menu="abrir">${icone('menu', 20)}<span>Menu</span></button>
    </nav>`;
  // link de navegação dentro de um modal: fecha o modal antes de trocar de tela
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('.modal a[href^="#"]');
    if (a) a.closest('.modal-fundo')?.querySelector<HTMLElement>('.modal-cab [data-fechar]')?.click();
  }, true);
  app.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-menu]') as HTMLElement | null;
    if (t) document.body.classList.toggle('menu-aberto', t.dataset.menu === 'abrir');
  });
}

function navegar() {
  const rota = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const mod = MODULOS.find((m) => m.rota === rota) ?? MODULOS[0];
  document.body.classList.remove('menu-aberto');
  document.body.classList.toggle('rota-form', mod.rota === 'aplicacoes/nova');
  const faixa = document.querySelector('.faixa-demo') as HTMLElement;
  const propria = estado.ds.origemBase === 'propria';
  faixa.classList.toggle('propria', propria);
  faixa.querySelector('span')!.innerHTML = propria
    ? '<b>Base própria</b> · dados salvos só neste aparelho · faça backup em Configurações regularmente.'
    : '<b>DADOS DE DEMONSTRAÇÃO — fictícios.</b> Para usar com dados reais: Configurações → Começar base própria.';
  limparGraficos();
  document.querySelectorAll('.modal-fundo').forEach((m) => m.remove());
  document.querySelectorAll('[data-rota]').forEach((a) => {
    const r = (a as HTMLElement).dataset.rota!;
    a.classList.toggle('ativo', r === mod.rota || (mod.rota === 'aplicacoes/nova' && r === 'aplicacoes' && a.closest('.lateral') !== null) || (mod.rota.startsWith('relatorios/') && r === 'relatorios'));
  });
  (document.getElementById('topo-grupo') as HTMLElement).textContent = mod.grupo;
  (document.getElementById('topo-titulo') as HTMLElement).textContent = mod.titulo;
  document.title = `${mod.titulo} · Gestão de Aplicações (protótipo)`;
  const main = document.getElementById('conteudo') as HTMLElement;
  const pagina = document.createElement('div');
  pagina.className = 'pagina';
  main.replaceChildren(pagina);
  try {
    mod.render(pagina);
  } catch (err) {
    console.error(err);
    pagina.innerHTML = `<div class="aviso aviso-critico">${icone('alerta', 18)}<div><b>Erro ao abrir esta tela.</b> ${esc((err as Error).message)}</div></div>`;
  }
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

const EDITORES: Record<string, (id?: string) => void> = {
  unidade: editarUnidade, fazenda: editarFazenda, talhao: (id) => editarTalhao(id), campanha: editarCampanha, ordem: (id) => editarOS(id),
  aeronave: editarAeronave, colaborador: editarColaborador, turno: editarTurno, produto: editarProduto,
};
function rotuloDe(entidade: string, id: string): string {
  const ds = estado.ds;
  switch (entidade) {
    case 'unidade': return nome.unidade(id);
    case 'fazenda': return nome.fazenda(id);
    case 'talhao': return `talhão ${nome.talhao(id)} · ${nome.fazenda(nome.fazendaDoTalhao(id))}`;
    case 'campanha': return nome.campanha(id);
    case 'ordem': return nome.os(id);
    case 'aeronave': return nome.aeronave(id);
    case 'colaborador': return nome.colaborador(id);
    case 'turno': return nome.turno(id);
    case 'produto': return nome.produto(id);
    default: return ds ? id : id;
  }
}
const INATIVAR: Partial<Record<string, (id: string) => (ds: import('./domain/types').Dataset) => void>> = {
  colaborador: (id) => (ds) => { const c = ds.colaboradores.find((x) => x.id === id); if (c) c.ativo = false; },
  turno: (id) => (ds) => { const t = ds.turnos.find((x) => x.id === id); if (t) t.ativo = false; },
  aeronave: (id) => (ds) => { const a = ds.aeronaves.find((x) => x.id === id); if (a) a.status = 'indisponivel'; },
};

/** Despachante central dos botões de cadastro (funciona em tabelas e modais). */
function acoesCadastro(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest('[data-novo],[data-editar],[data-excluir],[data-concluir-os],[data-cancelar-os],[data-importar-talhoes],[data-importar-mapa],[data-lancar-aplicado]') as HTMLElement | null;
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.modal-fundo').forEach((m) => m.remove());
  if (t.dataset.novo) { if (t.dataset.novo === 'talhao') editarTalhao(undefined, t.dataset.fazenda); else if (t.dataset.novo === 'ordem') editarOS(undefined, t.dataset.campanha); else EDITORES[t.dataset.novo]?.(); return; }
  if (t.dataset.editar) { EDITORES[t.dataset.editar]?.(t.dataset.id); return; }
  if (t.dataset.excluir) { const ent = t.dataset.excluir as EntidadeAuditada; const id = t.dataset.id!; void excluir(ent, id, rotuloDe(ent, id), INATIVAR[ent]?.(id)); return; }
  if (t.dataset.concluirOs) { void alternarConclusaoOS(t.dataset.concluirOs); return; }
  if (t.dataset.lancarAplicado) { document.querySelectorAll<HTMLElement>('.modal-cab [data-fechar]').forEach((x) => x.click()); abrirLancarAplicado(t.dataset.lancarAplicado); return; }
  if (t.dataset.cancelarOs) { void cancelarOS(t.dataset.cancelarOs); return; }
  if (t.dataset.importarTalhoes !== undefined) abrirImportarTalhoes();
  if (t.dataset.importarMapa !== undefined) abrirImportarMapa();
}

function iniciar() {
  const app = document.getElementById('app')!;
  try {
    carregarEstado();
  } catch (err) {
    app.innerHTML = `<div class="aviso aviso-critico" style="margin:24px">Não foi possível carregar os dados: ${esc((err as Error).message)}</div>`;
    return;
  }
  shell(app);
  window.addEventListener('hashchange', navegar);
  document.addEventListener('click', acoesCadastro, true);
  window.addEventListener('error', (e) => toast(`Erro inesperado: ${e.message}`, 'erro'));
  navegar();
}

iniciar();
