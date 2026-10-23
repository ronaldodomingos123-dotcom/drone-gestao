/**
 * Sincronização com a nuvem (Fase 4).
 *
 * • Este aparelho guarda uma cópia (abre e funciona sem internet).
 * • Ler: qualquer pessoa com o link. Gravar: só Líder/Gestor logado — conferido aqui E no banco.
 * • Cada gravação local vai para a nuvem (com a versão-base). Se outra pessoa gravou antes, as duas
 *   versões são mescladas item a item (domain/mesclar.ts) e o envio é refeito — nada é sobrescrito sem aviso.
 * • Sem internet: as alterações ficam pendentes e sobem quando a conexão volta.
 * • A cada 10 s (com a tela aberta) confere se há versão nova e atualiza.
 * • Modo local (?modo=local): nada vai para a nuvem (testes / uso isolado), com aviso na tela.
 */
import type { Dataset } from '../domain/types';
import { definirUsuarioAtual, migrar, recalcularStatusOS } from '../domain/base';
import { iguais, mesclar3 } from '../domain/mesclar';
import { ganchosNuvem, PREFIXO } from './repository';
import { ErroNuvem, lerDataset, rpc, sessaoAtual } from './supabase';

export type Papel = 'anonimo' | 'visualizador' | 'lider' | 'gestor';
export type EstadoSync = 'iniciando' | 'sincronizado' | 'enviando' | 'pendente' | 'offline' | 'vazia' | 'erro' | 'local';

/** Partes que só o Gestor altera (mesma lista do banco, em supabase/schema.sql). */
export const CHAVES_GESTOR = ['unidades', 'campanhas', 'produtos', 'aeronaves', 'colaboradores', 'turnos', 'limites', 'metas', 'safra', 'origemBase', 'geradoEm'] as const;
const ROTULO_CHAVE: Record<string, string> = {
  unidades: 'unidades', campanhas: 'campanhas', produtos: 'produtos', aeronaves: 'aeronaves', colaboradores: 'colaboradores',
  turnos: 'turnos', limites: 'limites de clima', metas: 'metas', safra: 'meta da safra', origemBase: 'a base inteira', geradoEm: 'a base inteira',
};

interface Meta { versaoBase: number; pendente: boolean; vinculado: boolean; atualizadoEm?: string; atualizadoPor?: string | null }
const K_META = `${PREFIXO}nuvem-meta`, K_BASE = `${PREFIXO}nuvem-base`, K_MODO = `${PREFIXO}modo`;

export const nuvem = {
  modo: 'nuvem' as 'nuvem' | 'local',
  papel: 'anonimo' as Papel,
  email: '',
  estado: 'iniciando' as EstadoSync,
  erro: '',
  versao: 0,
  atualizadoEm: '' as string,
  atualizadoPor: '' as string,
  nuvemVazia: false,
  atualizacaoAdiada: false,
  ultimosConflitos: 0,
};

type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();
export const aoMudarNuvem = (f: Ouvinte) => { ouvintes.add(f); return () => ouvintes.delete(f); };
const avisar = () => ouvintes.forEach((f) => { try { f(); } catch { /* ignora */ } });

let meta: Meta = { versaoBase: 0, pendente: false, vinculado: false };
let base: Dataset | null = null;
const ler = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
const gravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço: fica em memória */ } };
const gravarMeta = () => gravar(K_META, meta);
const gravarBase = (d: Dataset | null) => { base = d ? JSON.parse(JSON.stringify(d)) : null; gravar(K_BASE, base); };

export const podeGravar = () => nuvem.modo === 'local' || nuvem.papel === 'gestor' || nuvem.papel === 'lider';
export const ehGestor = () => nuvem.modo === 'local' || nuvem.papel === 'gestor';

// Ligação com o resto do app (state.ts injeta para evitar dependência circular)
interface Ponte { atual: () => Dataset; aplicar: (ds: Dataset) => void; salvarLocal: (ds: Dataset) => void; redesenhar: () => void; toast: (m: string, t?: 'ok' | 'erro' | 'info') => void }
let ponte: Ponte;

/** Recusa a gravação local quando o perfil não permite (o banco também recusa). */
function conferirPermissao(novo: Dataset) {
  if (nuvem.modo === 'local') return;
  if (!podeGravar()) {
    throw new Error(nuvem.papel === 'anonimo'
      ? 'Somente leitura: para lançar ou alterar, entre com seu e-mail de Líder ou Gestor (botão da nuvem, no topo).'
      : 'Seu acesso é de Visualizador: só leitura. Peça ao Gestor para liberar como Líder.');
  }
  if (nuvem.papel === 'lider') {
    const atual = ponte.atual() as unknown as Record<string, unknown>;
    const n = novo as unknown as Record<string, unknown>;
    const k = CHAVES_GESTOR.find((c) => !iguais(atual[c], n[c]));
    if (k) throw new Error(`Somente o Gestor altera ${ROTULO_CHAVE[k]}. Peça ao Gestor ou entre com o login de Gestor.`);
  }
}

let timerEnvio = 0, enviando = false, deNovo = false;
function agendarEnvio(atraso = 1200) {
  if (nuvem.modo === 'local') return;
  window.clearTimeout(timerEnvio);
  timerEnvio = window.setTimeout(() => void enviar(), atraso);
}

function definir(e: EstadoSync, erro = '') { nuvem.estado = e; nuvem.erro = erro; avisar(); }

/** Envia a cópia deste aparelho (só se houver alteração pendente e permissão). */
export async function enviar(tentativa = 0): Promise<void> {
  if (nuvem.modo === 'local' || !meta.pendente || !podeGravar()) return;
  if (nuvem.nuvemVazia) { definir('vazia'); return; } // o 1º envio é explícito (Gestor), em "Enviar dados deste aparelho"
  if (enviando) { deNovo = true; return; }
  if (!navigator.onLine) { definir('offline'); return; }
  enviando = true; definir('enviando');
  const enviado = JSON.parse(JSON.stringify(ponte.atual())) as Dataset;
  try {
    const r = await rpc<{ ok: boolean; versao: number; conflito?: boolean }>('salvar_dataset', { p_dados: enviado, p_versao_base: meta.versaoBase });
    if (r.ok) {
      meta.versaoBase = r.versao; nuvem.versao = r.versao; meta.vinculado = true;
      gravarBase(enviado);
      meta.pendente = !iguais(enviado, ponte.atual()); // mudou enquanto enviava? envia de novo
      gravarMeta();
      nuvem.atualizadoEm = new Date().toISOString(); nuvem.atualizadoPor = 'você';
      definir(meta.pendente ? 'pendente' : 'sincronizado');
      if (meta.pendente) agendarEnvio(300);
    } else if (r.conflito && tentativa < 3) {
      enviando = false;
      await puxar(true); // mescla com o que outra pessoa gravou
      return enviar(tentativa + 1);
    } else {
      definir('erro', 'Outra pessoa gravou ao mesmo tempo várias vezes; tente de novo.');
    }
  } catch (e) {
    const er = e as ErroNuvem;
    if (er.semRede) definir('offline');
    else if (er.semPermissao) {
      // a nuvem recusou: descarta a alteração deste aparelho e volta à versão da nuvem
      ponte.toast(`A nuvem recusou a alteração: ${er.message} Este aparelho voltou à versão da nuvem.`, 'erro');
      meta.pendente = false; gravarMeta();
      await puxar(false, true);
    } else definir('erro', er.message);
  } finally {
    enviando = false;
    if (deNovo) { deNovo = false; agendarEnvio(300); }
  }
}

const temModalOuDigitando = () => !!document.querySelector('.modal-fundo') || (document.activeElement instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !!document.activeElement.closest('#conteudo'));

function aplicarRemoto(ds: Dataset) {
  ponte.salvarLocal(ds);
  ponte.aplicar(ds);
  if (temModalOuDigitando()) { nuvem.atualizacaoAdiada = true; avisar(); } else { nuvem.atualizacaoAdiada = false; ponte.redesenhar(); }
}
export function mostrarAtualizacao() { nuvem.atualizacaoAdiada = false; ponte.redesenhar(); avisar(); }

/**
 * Busca a versão da nuvem. Sem alteração pendente: substitui a cópia local. Com pendente: mescla.
 * `forcar` busca mesmo sem versão nova; `descartarLocal` ignora o que está pendente.
 */
export async function puxar(forcar = false, descartarLocal = false): Promise<void> {
  if (nuvem.modo === 'local') return;
  const cab = await lerDataset(false);
  if (!cab) throw new ErroNuvem('A nuvem não respondeu com os dados. Confira se o script do banco foi aplicado.', 500);
  nuvem.versao = cab.versao; nuvem.atualizadoEm = cab.atualizado_em; nuvem.atualizadoPor = cab.atualizado_por ?? '';
  nuvem.nuvemVazia = cab.versao === 0;
  if (nuvem.nuvemVazia) { definir('vazia'); return; }
  if (!forcar && !descartarLocal && cab.versao === meta.versaoBase && meta.vinculado) { definir(meta.pendente ? 'pendente' : 'sincronizado'); return; }
  const linha = await lerDataset(true);
  if (!linha?.dados) return;
  const remoto = migrar(linha.dados as Dataset);
  if (!remoto) { definir('erro', 'Os dados da nuvem estão em formato desconhecido.'); return; }
  recalcularStatusOS(remoto);
  const local = ponte.atual();
  let novo = remoto;
  if (meta.pendente && !descartarLocal && base) {
    const m = mesclar3(base, local, remoto);
    novo = m.valor; recalcularStatusOS(novo);
    nuvem.ultimosConflitos = m.conflitos.length;
    if (m.conflitos.length) ponte.toast(`Outra pessoa gravou ao mesmo tempo: as alterações foram juntadas (${m.conflitos.length} item(ns) alterado(s) pelos dois — ficou a versão deste aparelho).`, 'info');
  } else if (!meta.vinculado && local.origemBase === 'propria' && !iguais(local, remoto)) {
    // primeira ligação deste aparelho com a nuvem: guarda a base local antes de trocar
    try { localStorage.setItem(`${PREFIXO}dataset-antes-da-nuvem-${Date.now()}`, JSON.stringify(local)); } catch { /* sem espaço */ }
    ponte.toast('Este aparelho passou a usar os dados da nuvem. A base que estava aqui foi guardada (Configurações → Nuvem e acesso).', 'info');
  }
  gravarBase(remoto);
  meta.versaoBase = linha.versao;
  meta.vinculado = true;
  if (descartarLocal) meta.pendente = false;
  gravarMeta();
  if (!iguais(novo, local)) aplicarRemoto(novo);
  definir(meta.pendente ? 'pendente' : 'sincronizado');
}

/** 1º envio (Gestor): sobe a base deste aparelho para a nuvem vazia. */
export async function enviarBaseInicial(): Promise<string | null> {
  if (!ehGestor() || nuvem.modo === 'local') return 'Só o Gestor faz o primeiro envio.';
  try {
    const cab = await lerDataset(false);
    if (cab && cab.versao !== 0) return 'A nuvem já tem dados. Use o histórico de versões se quiser substituir.';
    const ds = JSON.parse(JSON.stringify(ponte.atual())) as Dataset;
    const r = await rpc<{ ok: boolean; versao: number; conflito?: boolean }>('salvar_dataset', { p_dados: ds, p_versao_base: 0, p_motivo: 'primeiro envio' });
    if (!r.ok) return 'Outra pessoa enviou dados antes. Atualize a página.';
    meta = { versaoBase: r.versao, pendente: false, vinculado: true }; gravarMeta(); gravarBase(ds);
    nuvem.nuvemVazia = false; nuvem.versao = r.versao;
    definir('sincronizado');
    return null;
  } catch (e) { return (e as Error).message; }
}

export async function atualizarPerfil() {
  if (nuvem.modo === 'local') return;
  const s = sessaoAtual();
  try {
    const p = await rpc<{ papel: Papel; email: string | null }>('meu_perfil');
    nuvem.papel = p.papel; nuvem.email = p.email ?? s?.email ?? '';
  } catch (e) {
    if ((e as ErroNuvem).semRede) { nuvem.papel = s ? (ler<Papel>(`${PREFIXO}nuvem-papel`) ?? 'visualizador') : 'anonimo'; nuvem.email = s?.email ?? ''; }
    else { nuvem.papel = s ? 'visualizador' : 'anonimo'; nuvem.email = s?.email ?? ''; }
  }
  gravar(`${PREFIXO}nuvem-papel`, nuvem.papel);
  definirUsuarioAtual(nuvem.email ? nuvem.email.split('@')[0] : null);
  avisar();
}

/** Liga/desliga o modo local (sem nuvem). */
export function definirModoLocal(local: boolean) {
  try { if (local) localStorage.setItem(K_MODO, 'local'); else localStorage.removeItem(K_MODO); } catch { /* ignora */ }
  location.reload();
}

let verificando = false;
async function verificar() {
  if (verificando || nuvem.modo === 'local' || document.hidden) return;
  verificando = true;
  try {
    if (meta.pendente && podeGravar() && !nuvem.nuvemVazia) await enviar();
    const cab = await lerDataset(false);
    if (cab && (cab.versao !== meta.versaoBase || !meta.vinculado || nuvem.nuvemVazia !== (cab.versao === 0))) await puxar();
    else if (nuvem.estado === 'offline' || nuvem.estado === 'erro' || nuvem.estado === 'iniciando') definir(meta.pendente ? 'pendente' : 'sincronizado');
  } catch (e) {
    const er = e as ErroNuvem;
    definir(er.semRede ? 'offline' : 'erro', er.message);
  } finally { verificando = false; }
}

export function iniciarNuvem(p: Ponte, intervaloMs = 10_000) {
  ponte = p;
  const q = new URLSearchParams(location.search);
  if (q.get('modo') === 'local') { try { localStorage.setItem(K_MODO, 'local'); } catch { /* ignora */ } }
  if (q.get('modo') === 'nuvem') { try { localStorage.removeItem(K_MODO); } catch { /* ignora */ } }
  let modoLocal = false;
  try { modoLocal = localStorage.getItem(K_MODO) === 'local'; } catch { /* ignora */ }
  if (modoLocal) { nuvem.modo = 'local'; nuvem.estado = 'local'; avisar(); return; }
  meta = ler<Meta>(K_META) ?? { versaoBase: 0, pendente: false, vinculado: false };
  base = ler<Dataset>(K_BASE);
  ganchosNuvem.antes = conferirPermissao;
  ganchosNuvem.depois = () => { meta.pendente = true; gravarMeta(); definir(navigator.onLine ? 'pendente' : 'offline'); agendarEnvio(); };
  window.addEventListener('online', () => void verificar());
  window.addEventListener('offline', () => definir('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void verificar(); });
  let iv = intervaloMs;
  try { const x = Number(localStorage.getItem(`${PREFIXO}nuvem-intervalo`)); if (x >= 1000) iv = x; } catch { /* padrão */ }
  window.setInterval(() => void verificar(), iv);
  void atualizarPerfil().then(() => verificar());
}

export const pendente = () => meta.pendente;
export const metaNuvem = () => ({ ...meta });
