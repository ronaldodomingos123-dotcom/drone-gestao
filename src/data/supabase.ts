/**
 * Cliente mínimo do Supabase (sem biblioteca externa): login por e-mail/senha, chamadas às funções do
 * banco (RPC) e leitura da tabela de dados. Só a chave PÚBLICA (publishable/anon) fica no app — a
 * segurança está nas regras do banco (supabase/schema.sql), não em esconder a chave.
 */

export const NUVEM = {
  url: 'https://erqijxkauqedqglzuekm.supabase.co',
  chave: 'sb_publishable_WWp6_Lu0sb1K3IRS1YcndA_4Y9QRMfM',
};

export interface Sessao { access_token: string; refresh_token: string; expires_at: number; email: string }
const CHAVE_SESSAO = 'dap-proto-v1:sessao';

export class ErroNuvem extends Error {
  constructor(msg: string, public status: number, public codigo = '') { super(msg); }
  get semRede() { return this.status === 0; }
  get semPermissao() { return this.codigo === '42501' || this.status === 401 || this.status === 403; }
}

let sessao: Sessao | null = (() => { try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO) ?? 'null'); } catch { return null; } })();
const guardar = (s: Sessao | null) => { sessao = s; try { if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s)); else localStorage.removeItem(CHAVE_SESSAO); } catch { /* sessão só nesta aba */ } };
export const sessaoAtual = () => sessao;

const MSG: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme o e-mail antes de entrar (veja a caixa de entrada e o spam).',
  'Email not confirmed': 'Confirme o e-mail antes de entrar (veja a caixa de entrada e o spam).',
  user_already_exists: 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci a senha".',
  'User already registered': 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci a senha".',
  weak_password: 'Senha fraca: use ao menos 8 caracteres, misturando letras e números.',
  over_email_send_rate_limit: 'Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  email_address_not_authorized: 'O projeto não envia e-mail para este endereço. Peça ao Gestor para criar a conta no painel do Supabase.',
  'Email address not authorized': 'O projeto não envia e-mail para este endereço. Peça ao Gestor para criar a conta no painel do Supabase.',
  signup_disabled: 'Criação de conta pelo app está desligada. Peça ao Gestor.',
};

function traduzir(corpo: Record<string, unknown>, status: number): ErroNuvem {
  const cod = String(corpo.error_code ?? corpo.code ?? corpo.error ?? '');
  const txt = String(corpo.msg ?? corpo.message ?? corpo.error_description ?? corpo.error ?? `erro ${status}`);
  let m = MSG[cod] ?? MSG[txt] ?? txt;
  if (/sem_permissao/.test(txt)) m = txt.replace(/^sem_permissao:?\s*/, '') || 'Sem permissão para gravar. Entre como Líder ou Gestor.';
  else if (/somente_gestor/.test(txt)) m = txt.replace(/^somente_gestor:?\s*/, 'Somente o Gestor pode fazer isso: ');
  else if (/ultimo_gestor/.test(txt)) m = 'Precisa existir ao menos um Gestor.';
  else if (/permission denied/.test(txt)) m = 'Sem permissão (entre como Líder ou Gestor).';
  else if (/JWT expired/i.test(txt)) m = 'Sessão expirada.';
  return new ErroNuvem(m, status, cod || (/sem_permissao|somente_gestor/.test(txt) ? '42501' : ''));
}

async function req(caminho: string, init: RequestInit & { auth?: boolean } = {}): Promise<unknown> {
  const h: Record<string, string> = { apikey: NUVEM.chave, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> ?? {}) };
  if (init.auth !== false && sessao) h.Authorization = `Bearer ${sessao.access_token}`;
  let r: Response;
  try { r = await fetch(NUVEM.url + caminho, { ...init, headers: h }); } catch { throw new ErroNuvem('Sem conexão com a nuvem.', 0); }
  const txt = await r.text();
  let corpo: unknown = null;
  try { corpo = txt ? JSON.parse(txt) : null; } catch { corpo = txt; }
  if (!r.ok) throw traduzir((corpo && typeof corpo === 'object' ? corpo : { message: String(corpo) }) as Record<string, unknown>, r.status);
  return corpo;
}

/** Garante um token válido (renova se faltar menos de 1 min). */
async function renovarSeNecessario() {
  if (!sessao || sessao.expires_at * 1000 - Date.now() > 60_000) return;
  try {
    const r = await req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: JSON.stringify({ refresh_token: sessao.refresh_token }) }) as Record<string, unknown>;
    aceitarToken(r);
  } catch (e) {
    if ((e as ErroNuvem).semRede) throw e;
    guardar(null); // refresh inválido: precisa entrar de novo
  }
}

function aceitarToken(r: Record<string, unknown>) {
  const exp = Number(r.expires_at) || Math.floor(Date.now() / 1000) + Number(r.expires_in ?? 3600);
  const email = String((r.user as Record<string, unknown> | undefined)?.email ?? sessao?.email ?? '');
  guardar({ access_token: String(r.access_token), refresh_token: String(r.refresh_token), expires_at: exp, email });
}

/** Chamada autenticada; se o token venceu, renova e tenta de novo uma vez. */
async function autenticado(caminho: string, init: RequestInit = {}): Promise<unknown> {
  await renovarSeNecessario();
  try { return await req(caminho, init); } catch (e) {
    const er = e as ErroNuvem;
    if (sessao && er.status === 401 && /expir|JWT/i.test(er.message)) { sessao.expires_at = 0; await renovarSeNecessario(); return req(caminho, init); }
    throw e;
  }
}

export const rpc = <T = unknown>(nome: string, args: Record<string, unknown> = {}) => autenticado(`/rest/v1/rpc/${nome}`, { method: 'POST', body: JSON.stringify(args) }) as Promise<T>;

export interface LinhaDataset { versao: number; atualizado_em: string; atualizado_por: string | null; dados?: unknown }
export async function lerDataset(comDados: boolean): Promise<LinhaDataset | null> {
  const r = await autenticado(`/rest/v1/dataset?id=eq.1&select=versao,atualizado_em,atualizado_por${comDados ? ',dados' : ''}`, { method: 'GET' }) as LinhaDataset[];
  return r?.[0] ?? null;
}

export async function entrar(email: string, senha: string) {
  const r = await req('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim(), password: senha }) }) as Record<string, unknown>;
  aceitarToken(r);
}

const urlRetorno = () => (location.protocol.startsWith('http') ? location.origin + location.pathname : undefined);

/** Cria a conta; o Supabase manda um e-mail de confirmação (o papel só vale depois de confirmar). */
export async function criarConta(email: string, senha: string): Promise<'confirmar' | 'pronto'> {
  const ret = urlRetorno();
  const r = await req(`/auth/v1/signup${ret ? `?redirect_to=${encodeURIComponent(ret)}` : ''}`, { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim(), password: senha }) }) as Record<string, unknown>;
  if (r?.access_token) { aceitarToken(r); return 'pronto'; }
  return 'confirmar';
}

export async function esqueciSenha(email: string) {
  const ret = urlRetorno();
  await req(`/auth/v1/recover${ret ? `?redirect_to=${encodeURIComponent(ret)}` : ''}`, { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim() }) });
}

export async function trocarSenha(nova: string) {
  await autenticado('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: nova }) });
}

export async function sair() {
  try { if (sessao) await req('/auth/v1/logout', { method: 'POST' }); } catch { /* sai localmente mesmo sem rede */ }
  guardar(null);
}

/**
 * Volta do e-mail (confirmação de conta ou redefinição de senha): o Supabase devolve os tokens no "#".
 * Retorna o tipo ('signup' | 'recovery' | …) ou a mensagem de erro.
 */
export function lerRetornoDoEmail(): { tipo?: string; erro?: string } | null {
  const h = location.hash.replace(/^#/, '');
  if (!/access_token=|error_description=|error=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#/dashboard');
  if (p.get('error') || p.get('error_description')) return { erro: (p.get('error_description') ?? p.get('error') ?? '').replace(/\+/g, ' ') };
  const at = p.get('access_token'), rt = p.get('refresh_token');
  if (!at || !rt) return null;
  let email = '';
  try { email = JSON.parse(atob(at.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? ''; } catch { /* sem e-mail no token */ }
  guardar({ access_token: at, refresh_token: rt, expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') ?? 3600), email });
  return { tipo: p.get('type') ?? 'login' };
}

/** Requisição SEM login (só a chave pública) — usada no teste de segurança. */
export async function semLogin(caminho: string, init: RequestInit = {}): Promise<{ status: number; corpo: unknown }> {
  const h: Record<string, string> = { apikey: NUVEM.chave, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers as Record<string, string> ?? {}) };
  try {
    const r = await fetch(NUVEM.url + caminho, { ...init, headers: h });
    const t = await r.text();
    let corpo: unknown = t; try { corpo = t ? JSON.parse(t) : null; } catch { /* texto */ }
    return { status: r.status, corpo };
  } catch { return { status: 0, corpo: null }; }
}
