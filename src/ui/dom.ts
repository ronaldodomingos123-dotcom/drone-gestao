/** Utilitários de DOM e formatação (pt-BR). */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

const nf = (casas: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const cache = new Map<number, Intl.NumberFormat>();
export function fmtNum(v: number | null | undefined, casas = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  let f = cache.get(casas);
  if (!f) { f = nf(casas); cache.set(casas, f); }
  return f.format(v);
}
export const fmtHa = (v: number | null | undefined, casas = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmtNum(v, casas)} ha`);
export const fmtPct = (v: number | null | undefined, casas = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmtNum(v, casas)}%`);
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function fmtDataCurta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}
export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${fmtData(iso)} ${iso.slice(11, 16)}`;
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Notificação breve (sucesso/erro/info). */
export function toast(msg: string, tipo: 'ok' | 'erro' | 'info' = 'info') {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 300); }, 3800);
}

/** Diálogo modal simples. Retorna função para fechar. */
export function abrirModal(titulo: string, corpoHTML: string, opts: { largura?: 'md' | 'lg'; rodapeHTML?: string } = {}): { fechar: () => void; el: HTMLElement } {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `
    <div class="modal modal-${opts.largura ?? 'md'}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <header class="modal-cab"><h2>${esc(titulo)}</h2><button class="btn-icone" data-fechar aria-label="Fechar">✕</button></header>
      <div class="modal-corpo">${corpoHTML}</div>
      ${opts.rodapeHTML ? `<footer class="modal-rod">${opts.rodapeHTML}</footer>` : ''}
    </div>`;
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
  fundo.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (t === fundo || t.closest('[data-fechar]')) fechar(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(fundo);
  (fundo.querySelector('[data-fechar]') as HTMLElement)?.focus();
  return { fechar, el: fundo };
}

/** Confirmação explícita antes de ações destrutivas. */
export function confirmar(titulo: string, msg: string, rotuloOk = 'Confirmar'): Promise<boolean> {
  return new Promise((res) => {
    const m = abrirModal(titulo, `<p style="white-space:pre-line">${esc(msg)}</p>`, { rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-perigo" data-ok>${esc(rotuloOk)}</button>` });
    let ok = false;
    m.el.querySelector('[data-ok]')!.addEventListener('click', () => { ok = true; m.fechar(); });
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); res(ok); } });
    obs.observe(document.body, { childList: true });
  });
}
