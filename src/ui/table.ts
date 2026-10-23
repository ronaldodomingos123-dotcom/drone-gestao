/** Tabela reutilizável: busca, ordenação, paginação e layout em cartões no celular. */
import { esc, fmtNum } from './dom';
import { icone } from './icons';

export interface Coluna<T> {
  id: string;
  titulo: string;
  valor: (r: T) => string | number | null;
  render?: (r: T) => string;
  alinhar?: 'dir' | 'centro';
  /** Esconde no celular para priorizar o essencial. */
  secundaria?: boolean;
}

export interface OpcoesTabela<T> {
  porPagina?: number;
  vazio?: string;
  aoClicar?: (r: T) => void;
  ordemInicial?: { coluna: string; dir: 'asc' | 'desc' };
  placeholderBusca?: string;
  rodape?: (filtradas: T[]) => string;
  acoesHTML?: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function tabela<T>(host: HTMLElement, linhas: T[], colunas: Coluna<T>[], o: OpcoesTabela<T> = {}) {
  let termo = '';
  let ordem = o.ordemInicial ?? null;
  let pagina = 1;
  let porPagina = o.porPagina ?? 10;

  host.classList.add('tabela-wrap');
  host.innerHTML = `
    <div class="tabela-barra">
      <label class="busca">${icone('busca', 16)}<input type="search" placeholder="${esc(o.placeholderBusca ?? 'Buscar…')}" aria-label="Buscar na tabela"></label>
      <div class="tabela-acoes">${o.acoesHTML ?? ''}</div>
    </div>
    <div class="tabela-rolagem"><table class="tabela"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
    <div class="paginacao"></div>`;
  const thead = host.querySelector('thead')!;
  const tbody = host.querySelector('tbody')!;
  const tfoot = host.querySelector('tfoot')!;
  const pag = host.querySelector('.paginacao') as HTMLElement;
  const input = host.querySelector('input')!;

  const filtradas = () => {
    let r = linhas;
    if (termo) {
      const t = norm(termo);
      r = r.filter((l) => colunas.some((c) => { const v = c.valor(l); return v !== null && norm(String(v)).includes(t); }));
    }
    if (ordem) {
      const c = colunas.find((x) => x.id === ordem!.coluna);
      if (c) {
        const f = ordem.dir === 'asc' ? 1 : -1;
        r = [...r].sort((a, b) => {
          const va = c.valor(a), vb = c.valor(b);
          if (va === vb) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })) * f;
        });
      }
    }
    return r;
  };

  const desenhar = () => {
    thead.innerHTML = `<tr>${colunas.map((c) => {
      const ativa = ordem?.coluna === c.id;
      const seta = ativa ? (ordem!.dir === 'asc' ? '▲' : '▼') : '';
      return `<th class="${c.alinhar ?? ''} ${c.secundaria ? 'sec' : ''}" aria-sort="${ativa ? (ordem!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button data-ord="${c.id}">${esc(c.titulo)}<span class="seta">${seta}</span></button></th>`;
    }).join('')}</tr>`;
    const fl = filtradas();
    const paginas = Math.max(1, Math.ceil(fl.length / porPagina));
    pagina = Math.min(pagina, paginas);
    const fatia = fl.slice((pagina - 1) * porPagina, pagina * porPagina);
    tbody.innerHTML = fatia.length
      ? fatia.map((l, i) => `<tr data-i="${(pagina - 1) * porPagina + i}" ${o.aoClicar ? 'class="clicavel" tabindex="0"' : ''}>${colunas.map((c) => `<td class="${c.alinhar ?? ''} ${c.secundaria ? 'sec' : ''}" data-label="${esc(c.titulo)}">${c.render ? c.render(l) : esc(c.valor(l) ?? '—')}</td>`).join('')}</tr>`).join('')
      : `<tr class="linha-vazia"><td colspan="${colunas.length}">${icone('info', 18)} ${esc(termo ? 'Nenhum resultado para a busca.' : o.vazio ?? 'Nenhum registro.')}</td></tr>`;
    tfoot.innerHTML = o.rodape && fl.length ? o.rodape(fl) : '';
    pag.innerHTML = `
      <span>${fl.length ? `${fmtNum((pagina - 1) * porPagina + 1, 0)}–${fmtNum(Math.min(pagina * porPagina, fl.length), 0)} de ${fmtNum(fl.length, 0)}` : '0 registros'}</span>
      <label>Por página <select aria-label="Registros por página">${[10, 25, 50].map((n) => `<option ${n === porPagina ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="pag-btns"><button class="btn-icone" data-pag="-1" ${pagina <= 1 ? 'disabled' : ''} aria-label="Página anterior">${icone('esq', 16)}</button>
      <span>${pagina}/${paginas}</span>
      <button class="btn-icone" data-pag="1" ${pagina >= paginas ? 'disabled' : ''} aria-label="Próxima página">${icone('dir', 16)}</button></div>`;
    (host as HTMLElement & { _linhas?: T[] })._linhas = fl;
  };

  input.addEventListener('input', () => { termo = input.value.trim(); pagina = 1; desenhar(); });
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const ord = t.closest('[data-ord]') as HTMLElement | null;
    if (ord) {
      const id = ord.dataset.ord!;
      ordem = ordem?.coluna === id ? { coluna: id, dir: ordem.dir === 'asc' ? 'desc' : 'asc' } : { coluna: id, dir: 'asc' };
      desenhar();
      return;
    }
    const p = t.closest('[data-pag]') as HTMLElement | null;
    if (p) { pagina += Number(p.dataset.pag); desenhar(); return; }
    const tr = t.closest('tr.clicavel') as HTMLElement | null;
    if (tr && o.aoClicar && !t.closest('a,button')) {
      const fl = (host as HTMLElement & { _linhas?: T[] })._linhas ?? [];
      const l = fl[Number(tr.dataset.i)];
      if (l) o.aoClicar(l);
    }
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tr = (e.target as HTMLElement).closest('tr.clicavel') as HTMLElement | null;
    if (tr) tr.click();
  });
  host.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement;
    if (s.tagName === 'SELECT' && s.closest('.paginacao')) { porPagina = Number(s.value); pagina = 1; desenhar(); }
  });
  desenhar();
}
