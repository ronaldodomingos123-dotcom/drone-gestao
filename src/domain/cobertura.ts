/**
 * Cruzamento das trajetórias de voo (KML) com o contorno dos talhões, numa grade de 1 m:
 * cada carga vira uma faixa com a largura do seu espaçamento (distância ≤ espaçamento/2 da trajetória);
 * célula coberta por 2+ cargas = repasse. Por talhão: % do polígono coberto, medido = % × área plantada
 * (desconta o carreador na mesma proporção), falha = plantada − medido, repasse e parte de cada drone
 * (a célula é do primeiro drone que passou).
 *
 * Limitações: a trajetória inclui o deslocamento até a base (talhões fora da OS com menos de 10% de
 * cobertura são tratados como passagem); o KML não informa se o bico estava aberto em cada ponto.
 */
import { round } from './calc';
import type { VooKml } from './kmlVoo';
import type { Dataset, Talhao } from './types';

export interface CoberturaTalhao {
  talhaoId: string; codigo: string; plantadaHa: number; poligonoHa: number;
  cobertoHa: number; pct: number; repasseHa: number; medidoHa: number; falhaHa: number;
  /** medido de cada drone (série do KML) */
  porSerie: Record<string, number>;
  naOS: boolean; restricao?: string;
}
/** Imagem reduzida da grade: 0 fora de talhão, 1 talhão sem aplicação (falha), 2 aplicado, 3 repasse; 4/5/6 = idem em talhão da OS. */
export interface MapaCobertura { w: number; h: number; dados: Uint8Array; celM: number; x0: number; y0: number; lon0: number; lat0: number; kx: number; ky: number; contornos: { codigo: string; naOS: boolean; pts: [number, number][] }[] }
export interface CoberturaFazenda { fazendaId: string; osIds: string[]; talhoes: CoberturaTalhao[]; fora: CoberturaTalhao[]; passagem: CoberturaTalhao[]; resM: number; mapa?: MapaCobertura }
export interface ResultadoCobertura { fazendas: CoberturaFazenda[]; semContorno: string[]; avisos: string[] }

const LIMITE_PASSAGEM = 0.1;

/** Varre uma faixa (cápsula: pontos a ≤ w do segmento a–b) linha a linha de uma grade. */
function varrerFaixa(a: [number, number], b: [number, number], w: number, res: number, x0: number, y0: number, nx: number, ny: number, fill: (j: number, i0: number, i1: number) => void) {
  const [ax, ay] = a, [bx, by] = b; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  const nxv = L ? -dy / L : 0, nyv = L ? dx / L : 0;
  const quad: [number, number][] = [[ax + nxv * w, ay + nyv * w], [bx + nxv * w, by + nyv * w], [bx - nxv * w, by - nyv * w], [ax - nxv * w, ay - nyv * w]];
  const j0 = Math.max(0, Math.floor((Math.min(ay, by) - w - y0) / res)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + w - y0) / res));
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * res;
    let lo = Infinity, hi = -Infinity;
    for (const [cx, cy] of [a, b]) { const h = w * w - (y - cy) * (y - cy); if (h >= 0) { const r = Math.sqrt(h); lo = Math.min(lo, cx - r); hi = Math.max(hi, cx + r); } }
    if (L) for (let i = 0, m = 3; i < 4; m = i++) { const [px, py] = quad[m], [qx, qy] = quad[i]; if ((py > y) !== (qy > y)) { const x = px + ((y - py) * (qx - px)) / (qy - py); lo = Math.min(lo, x); hi = Math.max(hi, x); } }
    if (lo > hi) continue;
    const i0 = Math.max(0, Math.ceil((lo - x0) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((hi - x0) / res - 0.5));
    if (i0 <= i1) fill(j, i0, i1);
  }
}

/** Área (ha) da faixa pulverizada de uma trajetória (união, grade de 1 m). */
export function areaFaixaHa(q: [number, number][], w: number, res = 1): number {
  if (q.length < 2) return 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 -= w; y0 -= w; x1 += w; y1 += w;
  while (((x1 - x0) / res) * ((y1 - y0) / res) > 8e6) res *= 2;
  const nx = Math.ceil((x1 - x0) / res) + 1, ny = Math.ceil((y1 - y0) / res) + 1;
  const g = new Uint8Array(nx * ny); let n = 0;
  for (let s = 0; s + 1 < q.length; s++) varrerFaixa(q[s], q[s + 1], w, res, x0, y0, nx, ny, (j, i0, i1) => { for (let i = i0; i <= i1; i++) { const c = j * nx + i; if (!g[c]) { g[c] = 1; n++; } } });
  return (n * res * res) / 1e4;
}

/** Maior trecho quase reto (todos os pontos a ≤ 5 m da reta) a partir do início da lista: índice final e comprimento. */
function trechoReto(p: [number, number][], tol = 5): { k: number; L: number } {
  let best = 1;
  for (let k = 2; k < Math.min(p.length, 400); k++) {
    const [ax, ay] = p[0], [bx, by] = p[k]; const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) { best = k; continue; }
    let ok = true;
    for (let i = 1; i < k && ok; i++) if (Math.abs((p[i][0] - ax) * (by - ay) - (p[i][1] - ay) * (bx - ax)) / L > tol) ok = false;
    if (!ok) break;
    best = k;
  }
  return { k: best, L: Math.hypot(p[best][0] - p[0][0], p[best][1] - p[0][1]) };
}

/**
 * Tira o deslocamento base ↔ área: candidatos = trecho reto inicial e/ou final da carga (> 60 m); fica a
 * combinação cuja faixa mais se aproxima da área registrada pelo próprio drone na carga (melhora > 0,02 ha).
 * Conferido nas 84 cargas reais: faixa bruta 263,8 ha → 208,9 ha × 200,0 ha registrados.
 */
export function semDeslocamento(q0: [number, number][], w: number, areaDroneHa: number | null): { q: [number, number][]; cortouIni: boolean; cortouFim: boolean } {
  const q = q0.filter((p, i) => i === 0 || Math.hypot(p[0] - q0[i - 1][0], p[1] - q0[i - 1][1]) > 0.01);
  if (q.length < 4 || !areaDroneHa) return { q, cortouIni: false, cortouFim: false };
  const ini = trechoReto(q), fim = trechoReto([...q].reverse());
  const opcoesA = ini.L > 60 ? [0, ini.k] : [0], opcoesB = fim.L > 60 ? [0, fim.k] : [0];
  let melhor = { d: Math.abs(areaFaixaHa(q, w) - areaDroneHa), a: 0, b: 0 };
  for (const a of opcoesA) for (const b of opcoesB) {
    if (!a && !b) continue;
    const qq = q.slice(a, q.length - b);
    if (qq.length < 2) continue;
    const d = Math.abs(areaFaixaHa(qq, w) - areaDroneHa);
    if (d < melhor.d - 0.02) melhor = { d, a, b };
  }
  return { q: q.slice(melhor.a, q.length - melhor.b), cortouIni: melhor.a > 0, cortouFim: melhor.b > 0 };
}

export function cruzarCobertura(ds: Dataset, voos: VooKml[], osIds: string[], resPadrao = 1): ResultadoCobertura {
  const out: ResultadoCobertura = { fazendas: [], semContorno: [], avisos: [] };
  const ordens = osIds.map((id) => ds.ordens.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
  const series = [...new Set(voos.map((v) => v.serie))];
  for (const fzId of [...new Set(ordens.map((o) => o.fazendaId))]) {
    const osDaFaz = ordens.filter((o) => o.fazendaId === fzId);
    const tOS = new Set(osDaFaz.flatMap((o) => o.itens.map((i) => i.talhaoId)));
    const tals = ds.talhoes.filter((t) => t.fazendaId === fzId && t.poligono && t.poligono.length >= 3);
    const semPol = [...tOS].filter((id) => !tals.some((t) => t.id === id));
    if (!tals.length || semPol.length) { out.semContorno.push(fzId); if (!tals.length) continue; }
    // projeção local (m)
    const lat0 = tals[0].poligono![0][1], lon0 = tals[0].poligono![0][0];
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const P = (p: [number, number]) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky] as [number, number];
    const polys = tals.map((t) => t.poligono!.map(P));
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const pl of polys) for (const [x, y] of pl) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const vs = voos.map((v) => { const w = Math.max(1, (v.faixaM ?? 9) / 2); return { v, q: semDeslocamento(v.pontos.map(P), w, v.areaHa).q, w }; }).filter(({ q, w }) => q.some(([x, y]) => x >= bx0 - w && x <= bx1 + w && y >= by0 - w && y <= by1 + w));
    if (!vs.length) { out.fazendas.push({ fazendaId: fzId, osIds: osDaFaz.map((o) => o.id), ...montar(tals, tOS, null, 0, [], series, 1), resM: 1 }); continue; }
    // recorta a grade à região dos voos
    let fx0 = Infinity, fx1 = -Infinity, fy0 = Infinity, fy1 = -Infinity;
    for (const { q, w } of vs) for (const [x, y] of q) { if (x - w < fx0) fx0 = x - w; if (x + w > fx1) fx1 = x + w; if (y - w < fy0) fy0 = y - w; if (y + w > fy1) fy1 = y + w; }
    const x0 = Math.max(bx0, fx0), x1 = Math.min(bx1, fx1), y0 = Math.max(by0, fy0), y1 = Math.min(by1, fy1);
    let res = resPadrao;
    while (((x1 - x0) / res) * ((y1 - y0) / res) > 30e6) res *= 2;
    if (res !== resPadrao) out.avisos.push(`Área grande: grade de ${res} m.`);
    const nx = Math.max(1, Math.ceil((x1 - x0) / res)), ny = Math.max(1, Math.ceil((y1 - y0) / res));
    const rotulo = new Int16Array(nx * ny);
    // talhões (preenchimento por linha, regra par/ímpar)
    polys.forEach((pl, k) => {
      let py0 = Infinity, py1 = -Infinity; for (const [, y] of pl) { if (y < py0) py0 = y; if (y > py1) py1 = y; }
      const j0 = Math.max(0, Math.floor((py0 - y0) / res)), j1 = Math.min(ny - 1, Math.ceil((py1 - y0) / res));
      const xs: number[] = [];
      for (let j = j0; j <= j1; j++) {
        const y = y0 + (j + 0.5) * res; xs.length = 0;
        for (let i = 0, m = pl.length - 1; i < pl.length; m = i++) { const [ax, ay] = pl[m], [bx, by] = pl[i]; if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay)); }
        xs.sort((a, b) => a - b);
        for (let t = 0; t + 1 < xs.length; t += 2) {
          const i0 = Math.max(0, Math.ceil((xs[t] - x0) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[t + 1] - x0) / res - 0.5));
          for (let i = i0; i <= i1; i++) rotulo[j * nx + i] = k + 1;
        }
      }
    });
    // faixas pulverizadas
    const cont = new Uint8Array(nx * ny), dono = new Uint8Array(nx * ny), ultimo = new Uint32Array(nx * ny);
    vs.forEach(({ v, q, w }, f) => {
      const sIdx = series.indexOf(v.serie) + 1, marca = f + 1;
      for (let s = 0; s + 1 < q.length; s++) varrerFaixa(q[s], q[s + 1], w, res, x0, y0, nx, ny, (j, i0, i1) => {
        const base = j * nx;
        for (let i = i0; i <= i1; i++) { const c = base + i; if (!rotulo[c] || ultimo[c] === marca) continue; ultimo[c] = marca; if (cont[c] < 255) cont[c]++; if (!dono[c]) dono[c] = sIdx; }
      });
    });
    const conta = { cel: new Float64Array(tals.length), cob: new Float64Array(tals.length), rep: new Float64Array(tals.length), ser: tals.map(() => new Float64Array(series.length + 1)) };
    for (let c = 0; c < rotulo.length; c++) { const k = rotulo[c]; if (!k) continue; conta.cel[k - 1]++; if (cont[c]) { conta.cob[k - 1]++; conta.ser[k - 1][dono[c]]++; if (cont[c] > 1) conta.rep[k - 1]++; } }
    // imagem reduzida (até ~900 px no maior lado), por maioria em cada bloco
    const fat = Math.max(1, Math.ceil(Math.max(nx, ny) / 900)), w2 = Math.ceil(nx / fat), h2 = Math.ceil(ny / fat);
    const dados = new Uint8Array(w2 * h2);
    const naOSk = tals.map((t) => tOS.has(t.id));
    for (let bj = 0; bj < h2; bj++) for (let bi = 0; bi < w2; bi++) {
      let tal = 0, cob = 0, rep = 0, os = 0;
      for (let j = bj * fat; j < Math.min(ny, (bj + 1) * fat); j++) for (let i = bi * fat; i < Math.min(nx, (bi + 1) * fat); i++) { const c = j * nx + i, k = rotulo[c]; if (!k) continue; tal++; if (naOSk[k - 1]) os++; if (cont[c]) { cob++; if (cont[c] > 1) rep++; } }
      if (!tal) continue;
      const est = rep * 2 >= tal ? 3 : cob * 2 >= tal ? 2 : 1;
      dados[(h2 - 1 - bj) * w2 + bi] = est + (os * 2 >= tal ? 3 : 0); // linha 0 = norte
    }
    const mapa: MapaCobertura = { w: w2, h: h2, dados, celM: res * fat, x0, y0, lon0, lat0, kx, ky, contornos: tals.map((t, k) => ({ codigo: t.codigo, naOS: naOSk[k], pts: polys[k] })) };
    out.fazendas.push({ fazendaId: fzId, osIds: osDaFaz.map((o) => o.id), ...montar(tals, tOS, conta, res * res, polys, series, res), resM: res, mapa });
  }
  return out;
}

function areaPoligonoHa(pl: [number, number][]) { let s = 0; for (let i = 0, m = pl.length - 1; i < pl.length; m = i++) s += pl[m][0] * pl[i][1] - pl[i][0] * pl[m][1]; return Math.abs(s) / 2 / 1e4; }

function montar(tals: Talhao[], tOS: Set<string>, c: { cel: Float64Array; cob: Float64Array; rep: Float64Array; ser: Float64Array[] } | null, celM2: number, polys: [number, number][][], series: string[], _res: number) {
  const linhas: CoberturaTalhao[] = tals.map((t, k) => {
    const plantada = t.areaPlantadaHa ?? t.areaHa;
    // fração sobre as células do polígono dentro da grade; sem voos na região, 0
    const cel = c ? c.cel[k] : 0;
    const pct = c && cel ? c.cob[k] / cel : 0;
    const polHa = polys[k] ? areaPoligonoHa(polys[k]) : (t.areaTotalHa ?? plantada);
    const porSerie: Record<string, number> = {};
    if (c && cel) series.forEach((s, i) => { const v = c.ser[k][i + 1]; if (v) porSerie[s] = round((v / cel) * plantada, 4); });
    const medido = round(pct * plantada, 4);
    return { talhaoId: t.id, codigo: t.codigo, plantadaHa: plantada, poligonoHa: round(polHa, 2), cobertoHa: c ? round((c.cob[k] * celM2) / 1e4, 4) : 0, pct: round(pct, 4), repasseHa: c ? round((c.rep[k] * celM2) / 1e4, 4) : 0, medidoHa: medido, falhaHa: round(plantada - medido, 4), porSerie, naOS: tOS.has(t.id), ...(t.restricao ? { restricao: t.restricao } : {}) };
  });
  const ordem = (a: CoberturaTalhao, b: CoberturaTalhao) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true });
  return {
    talhoes: linhas.filter((l) => l.naOS).sort(ordem),
    fora: linhas.filter((l) => !l.naOS && l.pct >= LIMITE_PASSAGEM).sort(ordem),
    passagem: linhas.filter((l) => !l.naOS && l.pct > 0 && l.pct < LIMITE_PASSAGEM).sort(ordem),
  };
}

// ---------------------------------------------------------------- aplicar na ficha
import type { FichaDia } from './fechamentoDia';
import { jaPorTalhao } from './fechamentoDia';

/** Linha editável do cruzamento: talhão da OS (ou de fora, com a decisão). */
export interface LinhaCruz { osId: string; talhaoId: string; medido: number; padrao: number; limitado: boolean; porSerie: Record<string, number> }

/** Saldo de cada talhão da OS sem os voos do próprio dia (que o fechamento substitui). */
export function saldosOS(ds: Dataset, osId: string, data: string): Map<string, number> {
  const semDia: Dataset = { ...ds, operacoes: ds.operacoes.filter((o) => o.fechamentoDia !== data) };
  return new Map(jaPorTalhao(semDia, osId).map((t) => [t.talhaoId, round(Math.max(0, t.programado - t.voos), 4)]));
}

/** Valores sugeridos: medido, limitado ao saldo do talhão na OS. */
export function linhasPadrao(ds: Dataset, c: ResultadoCobertura, data: string): LinhaCruz[] {
  const out: LinhaCruz[] = [];
  for (const fz of c.fazendas) for (const os of fz.osIds) {
    const sal = saldosOS(ds, os, data);
    const o = ds.ordens.find((x) => x.id === os)!;
    for (const t of fz.talhoes.filter((x) => o.itens.some((i) => i.talhaoId === x.talhaoId))) {
      const lim = sal.get(t.talhaoId) ?? t.plantadaHa;
      const padrao = round(Math.min(t.medidoHa, lim), 2);
      out.push({ osId: os, talhaoId: t.talhaoId, medido: round(t.medidoHa, 2), padrao, limitado: t.medidoHa > lim + 0.005, porSerie: t.porSerie });
    }
  }
  return out;
}

export type AcaoFora = { tipo: 'ignorar' } | { tipo: 'mover'; destino: string } | { tipo: 'adicionar'; osId: string };

/**
 * Leva o aplicado por talhão (valores da tabela, medidos ou editados) para a ficha: real de cada OS =
 * soma dos talhões; divisão por drone pela parte medida de cada drone no talhão (sem medição, pela
 * proporção do drone na OS); células e área de cada drone recalculadas a partir disso.
 */
export function aplicarCoberturaNaFicha(ds: Dataset, f0: FichaDia, c: ResultadoCobertura, valores: Record<string, number>, acoesFora: Record<string, AcaoFora>, acPorSerie: Record<string, string>): { ficha: FichaDia; erros: string[]; avisos: string[] } {
  const f: FichaDia = JSON.parse(JSON.stringify(f0));
  const erros: string[] = [], avisos: string[] = [];
  const serieDoAc = (ac: string) => Object.keys(acPorSerie).find((s) => acPorSerie[s] === ac);
  f.talhoesDrone = { ...(f.talhoesDrone ?? {}) };
  f.adicionarNaOS = { ...(f.adicionarNaOS ?? {}) };
  const cruzadas = new Set(c.fazendas.flatMap((x) => x.osIds));
  for (const k of Object.keys(f.talhoesDrone)) if (cruzadas.has(k.split('|')[0])) delete f.talhoesDrone[k];
  // por OS: talhão → valor e partes por série
  const porOS = new Map<string, Map<string, { v: number; partes: Record<string, number> }>>();
  const linha = (os: string) => porOS.get(os) ?? porOS.set(os, new Map()).get(os)!;
  for (const fz of c.fazendas) for (const os of fz.osIds) {
    const o = ds.ordens.find((x) => x.id === os)!;
    for (const t of fz.talhoes.filter((x) => o.itens.some((i) => i.talhaoId === x.talhaoId))) {
      const v = valores[`${os}|${t.talhaoId}`];
      if (v === undefined || v === null || !(v >= 0)) continue;
      linha(os).set(t.talhaoId, { v, partes: t.porSerie });
    }
    for (const t of fz.fora) {
      const a = acoesFora[t.talhaoId] ?? { tipo: 'ignorar' };
      if (a.tipo === 'ignorar') continue;
      const v = valores[`fora|${t.talhaoId}`] ?? round(t.medidoHa, 2);
      if (a.tipo === 'mover') {
        const os2 = fz.osIds.find((x) => ds.ordens.find((o2) => o2.id === x)!.itens.some((i) => i.talhaoId === a.destino));
        if (!os2) { erros.push(`Talhão ${t.codigo}: destino não pertence a uma OS do dia.`); continue; }
        const atual = linha(os2).get(a.destino) ?? { v: 0, partes: {} };
        const partes = { ...atual.partes }; for (const [s, x] of Object.entries(t.porSerie)) partes[s] = (partes[s] ?? 0) + x;
        linha(os2).set(a.destino, { v: round(atual.v + v, 4), partes });
        avisos.push(`Talhão ${t.codigo} (fora da OS): ${String(v).replace('.', ',')} ha lançados no talhão ${ds.talhoes.find((x) => x.id === a.destino)?.codigo}.`);
      } else {
        if (!fz.osIds.includes(a.osId)) { erros.push(`Talhão ${t.codigo}: OS inválida.`); continue; }
        f.adicionarNaOS[a.osId] = [...new Set([...(f.adicionarNaOS[a.osId] ?? []), t.talhaoId])];
        linha(a.osId).set(t.talhaoId, { v, partes: t.porSerie });
        avisos.push(`Talhão ${t.codigo} será adicionado à OS ${ds.ordens.find((o) => o.id === a.osId)?.numero} (${String(v).replace('.', ',')} ha).`);
      }
    }
  }
  if (erros.length) return { ficha: f0, erros, avisos };
  // proporção de cada drone na OS (para talhões sem medição por drone)
  for (const [os, ts] of porOS) {
    const z = f.fazendas.find((x) => x.osId === os);
    if (!z) { erros.push(`OS ${ds.ordens.find((o) => o.id === os)?.numero} não está na ficha.`); continue; }
    const totSer: Record<string, number> = {};
    for (const { partes } of ts.values()) for (const [s, x] of Object.entries(partes)) totSer[s] = (totSer[s] ?? 0) + x;
    const somaTot = Object.values(totSer).reduce((a, b) => a + b, 0);
    for (const [t, { v, partes }] of ts) {
      const somaP = Object.values(partes).reduce((a, b) => a + b, 0);
      const pesos = f.drones.map((d) => { const s = serieDoAc(d.aeronaveId); return s ? (somaP > 0 ? (partes[s] ?? 0) / somaP : somaTot > 0 ? (totSer[s] ?? 0) / somaTot : 0) : 0; });
      const sp = pesos.reduce((a, b) => a + b, 0);
      const alvo = Math.round(v * 100);
      const bruto = pesos.map((p) => (sp > 0 ? (p / sp) * alvo : alvo / f.drones.length));
      const cents = bruto.map((b) => Math.floor(b + 1e-9));
      let falta = alvo - cents.reduce((a, b) => a + b, 0);
      bruto.map((b, k) => ({ k, r: b - Math.floor(b + 1e-9) })).sort((a, b) => b.r - a.r).forEach(({ k }) => { if (falta > 0) { cents[k]++; falta--; } });
      f.drones.forEach((d, k) => { if (!cents[k]) return; const key = `${os}|${d.aeronaveId}`; (f.talhoesDrone![key] ??= {})[t] = cents[k] / 100; });
    }
    const real = round([...ts.values()].reduce((a, b) => a + b.v, 0), 2);
    if (z.real !== null && Math.abs(z.real - real) > 0.01) avisos.push(`OS ${ds.ordens.find((o) => o.id === os)?.numero}: real ${String(z.real).replace('.', ',')} → ${String(real).replace('.', ',')} ha (talhões medidos/editados).`);
    z.real = real;
    // células desta OS
    for (const d of f.drones) { const td = f.talhoesDrone![`${os}|${d.aeronaveId}`]; f.fixas[`${os}|${d.aeronaveId}`] = td ? round(Object.values(td).reduce((a, b) => a + b, 0), 2) : 0; }
    z.descontoEm = [];
  }
  if (erros.length) return { ficha: f0, erros, avisos };
  // área de cada drone = soma das suas células
  for (const d of f.drones) {
    const novo = round(f.fazendas.reduce((a, z) => a + (f.fixas[`${z.osId}|${d.aeronaveId}`] ?? 0), 0), 2);
    if (d.area !== null && Math.abs(d.area - novo) > 0.01) avisos.push(`${ds.aeronaves.find((a) => a.id === d.aeronaveId)?.identificacao}: ${String(d.area).replace('.', ',')} → ${String(novo).replace('.', ',')} ha (talhões).`);
    d.area = novo;
  }
  return { ficha: f, erros, avisos };
}
