/**
 * Gráficos SVG próprios (sem dependências). Cada gráfico é desenhado com a largura real
 * do contêiner e redesenhado ao redimensionar. Todos têm camada de hover (tooltip),
 * legenda quando há ≥ 2 séries e rótulos de texto em cores de texto (não na cor da série).
 */
import { esc, fmtNum } from './dom';

export const CORES = {
  realizado: '#1b8a5a',
  planejado: '#6d8fd4',
  efetiva: '#2a78d6',
  operacional: '#eb6834',
  categoricas: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'],
  outros: '#a3a29c',
};

const observadores: ResizeObserver[] = [];
/** Desconecta observadores de gráficos ao trocar de tela. */
export function limparGraficos() { observadores.splice(0).forEach((o) => o.disconnect()); }

function montar(host: HTMLElement, desenhar: (w: number) => string, altura: number) {
  host.classList.add('grafico');
  host.innerHTML = `<div class="g-svg"></div><div class="g-tip" role="tooltip" hidden></div>`;
  const alvo = host.querySelector('.g-svg') as HTMLElement;
  const tip = host.querySelector('.g-tip') as HTMLElement;
  let ultimaW = 0;
  const render = () => {
    const w = Math.max(260, Math.floor(alvo.clientWidth || host.clientWidth || 600));
    if (w === ultimaW) return;
    ultimaW = w;
    alvo.innerHTML = desenhar(w);
    alvo.style.height = `${altura}px`;
  };
  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(host);
  observadores.push(ro);

  const mover = (e: PointerEvent) => {
    const t = (e.target as Element).closest('[data-tip]') as SVGElement | null;
    host.querySelectorAll('.ativo').forEach((x) => x.classList.remove('ativo'));
    if (!t) { tip.hidden = true; return; }
    const grupo = t.getAttribute('data-grupo');
    if (grupo) host.querySelectorAll(`[data-g="${grupo}"]`).forEach((x) => x.classList.add('ativo'));
    tip.innerHTML = t.getAttribute('data-tip') ?? '';
    tip.hidden = false;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, x + 14), r.width - tw - 4)}px`;
    tip.style.top = `${Math.max(4, y - tip.offsetHeight - 10)}px`;
  };
  host.addEventListener('pointermove', mover);
  host.addEventListener('pointerleave', () => { tip.hidden = true; host.querySelectorAll('.ativo').forEach((x) => x.classList.remove('ativo')); });
}

function ticksBonitos(max: number, n = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const bruto = max / n;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? bruto;
  const out: number[] = [];
  for (let v = 0; v <= max + passo * 0.001; v += passo) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + passo);
  return out;
}

/** Retângulo com cantos superiores arredondados (extremidade de dado), base reta no eixo. */
function barraV(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function barraH(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

const tipLinha = (cor: string, nome: string, valor: string) => `<div class="tl"><i style="background:${cor}"></i>${esc(nome)}<b>${esc(valor)}</b></div>`;

export interface PontoG { rotulo: string; valor: number; titulo?: string }

/** Barras verticais de série única. */
export interface MetaBarras { nome: string; cor: string; valores: number[]; detalhe?: (i: number) => string }

/** Barras verticais de série única, com linha de meta (planejado) opcional em degraus tracejados. */
export function barras(host: HTMLElement, pontos: PontoG[], o: { cor: string; unidade: string; rotuloX: (r: string, i: number, n: number) => string | null; altura?: number; casas?: number; meta?: MetaBarras }) {
  const H = o.altura ?? 240;
  const casas = o.casas ?? 1;
  montar(host, (W) => {
    const m = { l: 46, r: 10, t: 18, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const max = Math.max(0, ...pontos.map((p) => p.valor));
    const ticks = ticksBonitos(Math.max(max, ...(o.meta?.valores ?? [0])));
    const top = ticks[ticks.length - 1] || 1;
    const band = pw / Math.max(1, pontos.length);
    const bw = Math.max(2, Math.min(28, band * 0.68));
    const y = (v: number) => m.t + ph - (v / top) * ph;
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Gráfico de barras">`;
    for (const t of ticks) s += `<line class="g-grade" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-eixo" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t, 0)}</text>`;
    const imax = pontos.reduce((bi, p, i) => (p.valor > pontos[bi].valor ? i : bi), 0);
    pontos.forEach((p, i) => {
      const cx = m.l + band * i + band / 2;
      const h = (p.valor / top) * ph;
      s += `<path class="g-marca" data-g="b${i}" d="${barraV(cx - bw / 2, m.t + ph - h, bw, h)}" fill="${o.cor}"/>`;
      const rx = o.rotuloX(p.rotulo, i, pontos.length);
      if (rx) s += `<text class="g-eixo" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(rx)}</text>`;
      const mt = o.meta?.valores[i];
      const tipMeta = o.meta && mt !== undefined
        ? `${tipLinha(o.meta.cor, o.meta.nome, `${fmtNum(mt, casas)} ${o.unidade}`)}<div class="tl">Atingido<b>${mt > 0 ? `${fmtNum((p.valor / mt) * 100, 0)}%` : '—'}</b></div>${o.meta.detalhe ? o.meta.detalhe(i) : ''}`
        : '';
      s += `<rect class="g-alvo" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" data-grupo="b${i}" data-tip="${esc(`<div class="tt">${esc(p.titulo ?? p.rotulo)}</div>${tipLinha(o.cor, 'Aplicado', `${fmtNum(p.valor, casas)} ${o.unidade}`)}${tipMeta}`)}"/>`;
    });
    if (max > 0) {
      const cx = m.l + band * imax + band / 2;
      s += `<text class="g-rotulo" x="${cx}" y="${y(pontos[imax].valor) - 6}" text-anchor="middle">${fmtNum(pontos[imax].valor, 0)}</text>`;
    }
    if (o.meta && o.meta.valores.length) {
      // degraus: um patamar por barra, ligados verticalmente quando a meta muda (ex.: semana parcial)
      let d = '';
      o.meta.valores.forEach((v, i) => {
        const x0 = m.l + band * i, x1 = x0 + band, yy = y(v).toFixed(1);
        d += i === 0 ? `M${x0},${yy}H${x1}` : `V${yy}H${x1}`;
      });
      s += `<path d="${d}" fill="none" stroke="${o.meta.cor}" stroke-width="2" stroke-dasharray="6 5" pointer-events="none"/>`;
    }
    s += `<line class="g-base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/></svg>`;
    if (max === 0) s += `<div class="g-vazio">Sem área aplicada no período filtrado.</div>`;
    return s;
  }, H);
}

export interface SerieL { nome: string; cor: string; valores: (number | null)[]; tracejada?: boolean; pontilhada?: boolean }

/** Linhas com crosshair. Uma única escala Y. */
export function linhas(host: HTMLElement, rotulos: string[], series: SerieL[], o: { unidade: string; rotuloX: (r: string, i: number, n: number) => string | null; titulo: (r: string) => string; altura?: number; marcos?: { indice: number; texto: string }[] }) {
  const H = o.altura ?? 260;
  montar(host, (W) => {
    const m = { l: 54, r: 14, t: 16, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const max = Math.max(0, ...series.flatMap((s) => s.valores.filter((v): v is number => v !== null)));
    const ticks = ticksBonitos(max);
    const top = ticks[ticks.length - 1] || 1;
    const n = rotulos.length;
    const x = (i: number) => m.l + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = (v: number) => m.t + ph - (v / top) * ph;
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Gráfico de linhas">`;
    for (const t of ticks) s += `<line class="g-grade" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="g-eixo" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t, 0)}</text>`;
    rotulos.forEach((r, i) => { const rx = o.rotuloX(r, i, n); if (rx) s += `<text class="g-eixo" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(rx)}</text>`; });
    for (const se of series) {
      // trechos nulos interrompem a linha (ex.: realizado não existe no futuro)
      let d = '';
      let ant = false;
      se.valores.forEach((v, i) => { if (v === null) { ant = false; return; } d += `${ant ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; ant = true; });
      const traco = se.pontilhada ? 'stroke-dasharray="2 4" stroke-linecap="round"' : se.tracejada ? 'stroke-dasharray="6 5"' : '';
      s += `<path d="${d}" fill="none" stroke="${se.cor}" stroke-width="2" ${traco} stroke-linejoin="round"/>`;
      let ult = -1;
      se.valores.forEach((v, i) => { if (v !== null) ult = i; });
      if (ult >= 0 && !se.tracejada && !se.pontilhada) s += `<circle cx="${x(ult)}" cy="${y(se.valores[ult] as number)}" r="4.5" fill="${se.cor}" stroke="var(--surface)" stroke-width="2"/>`;
    }
    for (const mk of o.marcos ?? []) {
      if (mk.indice < 0 || mk.indice >= n) continue;
      s += `<line x1="${x(mk.indice)}" x2="${x(mk.indice)}" y1="${m.t}" y2="${m.t + ph}" stroke="var(--texto-3)" stroke-width="1" stroke-dasharray="2 3"/><text class="g-eixo" x="${x(mk.indice) + (mk.indice > n * 0.8 ? -4 : 4)}" y="${m.t + 10}" text-anchor="${mk.indice > n * 0.8 ? 'end' : 'start'}">${esc(mk.texto)}</text>`;
    }
    const band = n > 1 ? pw / (n - 1) : pw;
    rotulos.forEach((r, i) => {
      const linhasTip = series.filter((se) => se.valores[i] !== null && se.valores[i] !== undefined).map((se) => tipLinha(se.cor, se.nome, `${fmtNum(se.valores[i], 1)} ${o.unidade}`)).join('');
      s += `<line class="g-cruz" data-g="c${i}" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ph}"/>`;
      s += `<rect class="g-alvo" x="${x(i) - band / 2}" y="${m.t}" width="${band}" height="${ph}" data-grupo="c${i}" data-tip="${esc(`<div class="tt">${esc(o.titulo(r))}</div>${linhasTip}`)}"/>`;
    });
    s += `<line class="g-base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/></svg>`;
    return s;
  }, H);
}

export interface SerieH { nome: string; cor: string }
export interface CategoriaH { rotulo: string; valores: (number | null)[]; extraTip?: string }

/** Barras horizontais agrupadas (ex.: planejado × realizado). Rótulo de valor ao fim de cada barra. */
export function barrasH(host: HTMLElement, cats: CategoriaH[], series: SerieH[], o: { unidade: string; casas?: number; larguraRotulo?: number }) {
  const casas = o.casas ?? 1;
  const alturaBarra = 10, gap = 2, padGrupo = 14;
  const gh = series.length * alturaBarra + (series.length - 1) * gap;
  const H = Math.max(80, cats.length * (gh + padGrupo) + 24);
  montar(host, (W) => {
    const lr = Math.min(o.larguraRotulo ?? 150, W * 0.38);
    const m = { l: lr, r: 64, t: 8, b: 16 };
    const pw = W - m.l - m.r;
    const max = Math.max(0, ...cats.flatMap((c) => c.valores.map((v) => v ?? 0)));
    const ticks = ticksBonitos(max, 3);
    const top = ticks[ticks.length - 1] || 1;
    const x = (v: number) => m.l + (v / top) * pw;
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="Gráfico de barras horizontais">`;
    for (const t of ticks) s += `<line class="g-grade" x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}"/><text class="g-eixo" x="${x(t)}" y="${H - 2}" text-anchor="middle">${fmtNum(t, 0)}</text>`;
    cats.forEach((c, i) => {
      const y0 = m.t + i * (gh + padGrupo) + padGrupo / 2;
      const rot = c.rotulo.length > 22 && lr < 150 ? `${c.rotulo.slice(0, 20)}…` : c.rotulo;
      s += `<text class="g-cat" x="${m.l - 10}" y="${y0 + gh / 2 + 4}" text-anchor="end">${esc(rot)}</text>`;
      series.forEach((se, j) => {
        const v = c.valores[j];
        const yb = y0 + j * (alturaBarra + gap);
        if (v !== null && v > 0) s += `<path class="g-marca" data-g="h${i}" d="${barraH(m.l, yb, x(v) - m.l, alturaBarra)}" fill="${se.cor}"/>`;
        s += `<text class="g-rotulo g-rotulo-s" x="${(v ? x(v) : m.l) + 6}" y="${yb + alturaBarra - 1}">${v === null ? '—' : fmtNum(v, casas)}</text>`;
      });
      const tip = `<div class="tt">${esc(c.rotulo)}</div>${series.map((se, j) => tipLinha(se.cor, se.nome, c.valores[j] === null ? '—' : `${fmtNum(c.valores[j]!, casas)} ${o.unidade}`)).join('')}${c.extraTip ?? ''}`;
      s += `<rect class="g-alvo" x="0" y="${y0 - padGrupo / 2}" width="${W}" height="${gh + padGrupo}" data-grupo="h${i}" data-tip="${esc(tip)}"/>`;
    });
    s += `<line class="g-base" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/></svg>`;
    if (!cats.length) s += `<div class="g-vazio">Sem dados para os filtros aplicados.</div>`;
    return s;
  }, H);
}

export interface Fatia { rotulo: string; valor: number; cor: string; detalhe?: string }

/** Rosca com legenda em HTML (valores e % visíveis — identidade nunca só por cor). */
export function rosca(host: HTMLElement, fatias: Fatia[], o: { centro: string; subCentro: string; formatar: (v: number) => string }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const R = 70, r = 46, C = 90;
  let ang = -Math.PI / 2;
  let arcos = '';
  fatias.forEach((f, i) => {
    if (f.valor <= 0 || total <= 0) return;
    const a = (f.valor / total) * Math.PI * 2;
    const gapA = fatias.length > 1 ? 0.025 : 0;
    const a0 = ang + gapA / 2, a1 = ang + a - gapA / 2;
    const p = (rad: number, raio: number) => `${(C + raio * Math.cos(rad)).toFixed(2)},${(C + raio * Math.sin(rad)).toFixed(2)}`;
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    const pct = (f.valor / total) * 100;
    const tip = `<div class="tt">${esc(f.rotulo)}</div>${tipLinha(f.cor, 'Tempo', o.formatar(f.valor))}${tipLinha(f.cor, 'Participação', `${fmtNum(pct, 1)}%`)}${f.detalhe ?? ''}`;
    arcos += `<path class="g-marca" data-g="f${i}" data-grupo="f${i}" data-tip="${esc(tip)}" d="M${p(a0, R)}A${R},${R} 0 ${grande} 1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${grande} 0 ${p(a0, r)}Z" fill="${f.cor}"/>`;
    ang += a;
  });
  host.classList.add('grafico', 'rosca-wrap');
  host.innerHTML = `
    <div class="rosca">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Distribuição">${arcos || `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="var(--linha)" stroke-width="${R - r}"/>`}
        <text x="${C}" y="${C - 2}" text-anchor="middle" class="r-centro">${esc(o.centro)}</text>
        <text x="${C}" y="${C + 16}" text-anchor="middle" class="r-sub">${esc(o.subCentro)}</text></svg>
    </div>
    <ul class="legenda-lista">${fatias.map((f, i) => `<li data-g="f${i}"><i style="background:${f.cor}"></i><span>${esc(f.rotulo)}</span><b>${esc(o.formatar(f.valor))}</b><em>${total > 0 ? fmtNum((f.valor / total) * 100, 0) : '0'}%</em></li>`).join('') || '<li class="vazio">Sem paradas registradas no período.</li>'}</ul>
    <div class="g-tip" role="tooltip" hidden></div>`;
  const tipEl = host.querySelector('.g-tip') as HTMLElement;
  host.onpointermove = (e) => {
    const t = (e.target as Element).closest('[data-tip]') as SVGElement | null;
    host.querySelectorAll('.ativo').forEach((x) => x.classList.remove('ativo'));
    if (!t) { tipEl.hidden = true; return; }
    host.querySelectorAll(`[data-g="${t.getAttribute('data-grupo')}"]`).forEach((x) => x.classList.add('ativo'));
    tipEl.innerHTML = t.getAttribute('data-tip') ?? '';
    tipEl.hidden = false;
    const rr = host.getBoundingClientRect();
    tipEl.style.left = `${Math.min(e.clientX - rr.left + 12, rr.width - tipEl.offsetWidth - 4)}px`;
    tipEl.style.top = `${Math.max(4, e.clientY - rr.top - tipEl.offsetHeight - 8)}px`;
  };
  host.onpointerleave = () => { tipEl.hidden = true; host.querySelectorAll('.ativo').forEach((x) => x.classList.remove('ativo')); };
}

export function legenda(series: { nome: string; cor: string; tracejada?: boolean; pontilhada?: boolean }[]): string {
  return `<div class="legenda">${series.map((s) => `<span><i class="${s.pontilhada ? 'pontilhada' : s.tracejada ? 'tracejada' : ''}" style="--c:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>`;
}
