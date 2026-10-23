/** Formulário modal reutilizável para cadastros (criar/editar), com validação antes de salvar. */
import { esc } from './dom';
import { abrirModal } from './dom';
import { icone } from './icons';

export interface CampoForm {
  k: string;
  rot: string;
  tipo?: 'texto' | 'numero' | 'data' | 'hora' | 'select' | 'check' | 'textarea';
  opcoes?: [string, string][];
  obrig?: boolean;
  dica?: string;
  unidade?: string;
  largo?: boolean;
  min?: number;
  max?: number;
  inteiro?: boolean;
}

export type Valores = Record<string, string | number | boolean | null>;

export interface OpcoesForm {
  titulo: string;
  campos: CampoForm[];
  valores: Valores;
  /** HTML extra abaixo dos campos (ex.: editor de talhões ou calda) — deve usar data-extra nos inputs. */
  extraHTML?: string;
  /** Lê o conteúdo extra no momento de salvar. */
  lerExtra?: (corpo: HTMLElement) => unknown;
  validar?: (v: Valores, extra: unknown) => string[];
  aoSalvar: (v: Valores, extra: unknown) => string | null; // retorna mensagem de erro ou null
  aoMontar?: (corpo: HTMLElement) => void;
  largura?: 'md' | 'lg';
}

const num = (s: string) => { const t = s.replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };

export function abrirFormulario(o: OpcoesForm) {
  const campo = (c: CampoForm) => {
    const v = o.valores[c.k];
    const attrs = `name="${esc(c.k)}" ${c.obrig ? 'required' : ''}`;
    let input = '';
    switch (c.tipo ?? 'texto') {
      case 'select': input = `<select ${attrs}>${(c.opcoes ?? []).map(([val, t]) => `<option value="${esc(val)}" ${String(v ?? '') === val ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`; break;
      case 'check': return `<label class="chk campo-check ${c.largo ? 'largo' : ''}"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}><span>${esc(c.rot)}${c.dica ? `<small>${esc(c.dica)}</small>` : ''}</span></label>`;
      case 'textarea': input = `<textarea ${attrs} rows="3">${esc(v ?? '')}</textarea>`; break;
      case 'numero': input = `<input ${attrs} inputmode="decimal" value="${esc(v === null || v === undefined ? '' : String(v).replace('.', ','))}">`; break;
      case 'data': input = `<input type="date" ${attrs} value="${esc(v ?? '')}">`; break;
      case 'hora': input = `<input type="time" ${attrs} value="${esc(v ?? '')}">`; break;
      default: input = `<input ${attrs} value="${esc(v ?? '')}">`;
    }
    if (c.unidade) input = `<div class="com-unidade">${input}<span>${esc(c.unidade)}</span></div>`;
    return `<label class="campo ${c.largo ? 'largo' : ''}" data-v="${esc(c.k)}"><span>${esc(c.rot)}${c.obrig ? ' <em class="obrig">*</em>' : ''}</span>${input}${c.dica ? `<small>${esc(c.dica)}</small>` : ''}</label>`;
  };
  const m = abrirModal(o.titulo, `
    <form class="form-cadastro" novalidate>
      <div class="form-msgs"></div>
      <div class="form-grade">${o.campos.map(campo).join('')}</div>
      ${o.extraHTML ?? ''}
    </form>`, { largura: o.largura ?? 'md', rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-salvar>${icone('ok', 16)} Salvar</button>` });
  const form = m.el.querySelector('form') as HTMLFormElement;
  o.aoMontar?.(form);
  const ler = (): { v: Valores; erros: string[] } => {
    const v: Valores = {};
    const erros: string[] = [];
    for (const c of o.campos) {
      const el = form.elements.namedItem(c.k) as HTMLInputElement | null;
      if (!el) continue;
      if (c.tipo === 'check') { v[c.k] = el.checked; continue; }
      const bruto = el.value.trim();
      if (c.tipo === 'numero') {
        const n = num(bruto);
        if (n === null) { v[c.k] = null; if (c.obrig) erros.push(`${c.rot}: obrigatório.`); continue; }
        if (Number.isNaN(n)) { erros.push(`${c.rot}: número inválido.`); continue; }
        if (c.inteiro && !Number.isInteger(n)) erros.push(`${c.rot}: use um número inteiro.`);
        if (c.min !== undefined && n < c.min) erros.push(`${c.rot}: mínimo ${c.min}.`);
        if (c.max !== undefined && n > c.max) erros.push(`${c.rot}: máximo ${c.max}.`);
        v[c.k] = n;
        continue;
      }
      v[c.k] = bruto;
      if (c.obrig && !bruto) erros.push(`${c.rot}: obrigatório.`);
    }
    return { v, erros };
  };
  const salvar = () => {
    const { v, erros } = ler();
    const extra = o.lerExtra ? o.lerExtra(form) : undefined;
    const todos = [...erros, ...(o.validar ? o.validar(v, extra) : [])];
    const box = form.querySelector('.form-msgs') as HTMLElement;
    if (todos.length) {
      box.innerHTML = `<div class="aviso aviso-critico">${icone('alerta', 18)}<div><ul>${todos.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>`;
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    const erro = o.aoSalvar(v, extra);
    if (erro) { box.innerHTML = `<div class="aviso aviso-critico">${icone('alerta', 18)}<div>${esc(erro)}</div></div>`; return; }
    m.fechar();
  };
  m.el.querySelector('[data-salvar]')!.addEventListener('click', salvar);
  form.addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
  (form.querySelector('input,select,textarea') as HTMLElement | null)?.focus();
  return m;
}
