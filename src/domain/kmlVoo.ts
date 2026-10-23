/**
 * KML de voo (trajetórias exportadas dos drones, um Placemark por carga/voo). Lê, agrupa por local e
 * aplica no Fechamento do dia: a área de cada drone em cada fazenda passa a ser MEDIDA (não rateada) e
 * os voos ganham tempo em voo, volume pulverizado, taxa real, altura, velocidade e espaçamento.
 *
 * Limites do arquivo: não traz data/hora dos voos nem o contorno dos talhões. O dia vem da ficha aberta
 * e a fazenda/OS de cada grupo é sugerida (pela área real da ficha ou pelo local já conhecido da
 * fazenda) e confirmada pelo usuário.
 */
import { normalizar, registrar } from './base';
import { round } from './calc';
import type { FichaDia } from './fechamentoDia';
import type { Dataset } from './types';

export interface VooKml {
  id: string; serie: string; aeronave: string;
  tempoMin: number | null; alturaM: number | null; faixaM: number | null; velocidadeMs: number | null;
  areaHa: number; volumeL: number | null; taxa: number | null;
  cx: number; cy: number;
  /** trajetória simplificada (desenho) */
  trajeto: [number, number][];
  /** trajetória completa (cruzamento com os talhões); não é gravada */
  pontos: [number, number][];
}
export interface LeituraKml { voos: VooKml[]; erros: string[]; avisos: string[]; unidades: string }

const num = (s: string | undefined) => { if (s === undefined) return null; const v = Number(String(s).trim().replace(',', '.')); return Number.isFinite(v) ? v : null; };
const mediana = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const desc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Simplifica a trajetória para desenho (mantém no máximo `max` pontos). */
function simplificar(p: [number, number][], max = 120): [number, number][] {
  if (p.length <= max) return p;
  const passo = (p.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => p[Math.round(i * passo)]);
}

/** Lê o KML (texto). Unidades conferidas pela plausibilidade (mL→L, ms→min, m²→ha). */
export function lerKmlVoos(texto: string): LeituraKml {
  const erros: string[] = [], avisos: string[] = [];
  if (!/<kml[\s>]/i.test(texto)) return { voos: [], erros: ['Arquivo não é um KML.'], avisos, unidades: '' };
  const brutos: { id: string; dados: Record<string, string>; pts: [number, number][] }[] = [];
  const reP = /<Placemark[\s>][\s\S]*?<\/Placemark>/gi;
  for (const m of texto.match(reP) ?? []) {
    const id = desc((/<name>([\s\S]*?)<\/name>/i.exec(m)?.[1] ?? '').trim());
    const dados: Record<string, string> = {};
    for (const d of m.matchAll(/<Data\s+name="([^"]*)"\s*>\s*<value>([\s\S]*?)<\/value>/gi)) dados[desc(d[1]).trim()] = desc(d[2]).trim();
    for (const d of m.matchAll(/<SimpleData\s+name="([^"]*)"\s*>([\s\S]*?)<\/SimpleData>/gi)) dados[desc(d[1]).trim()] ??= desc(d[2]).trim();
    const co = /<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(m)?.[1];
    if (!co) continue; // polígonos/pontos: fora do escopo (só trajetórias)
    const pts = co.trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]] as [number, number]);
    if (pts.length) brutos.push({ id, dados, pts });
  }
  if (!brutos.length) return { voos: [], erros: ['Nenhuma trajetória de voo (LineString) encontrada no KML.'], avisos, unidades: '' };
  const k = (d: Record<string, string>, ...nomes: string[]) => { for (const n of nomes) { const ch = Object.keys(d).find((x) => normalizar(x) === normalizar(n)); if (ch) return d[ch]; } return undefined; };
  const area0 = brutos.map((b) => num(k(b.dados, 'Task Area', 'Area', 'Área')) ?? 0);
  const vol0 = brutos.map((b) => num(k(b.dados, 'Spray amount', 'Spray Amount', 'Volume')));
  const tempo0 = brutos.map((b) => num(k(b.dados, 'Flight Time', 'Tempo de voo')));
  // unidades
  const medArea = mediana(area0.filter((a) => a > 0)) ?? 0;
  const fArea = medArea > 200 ? 1 / 10000 : 1; // m² → ha
  const taxas = brutos.map((_, i) => (vol0[i] && area0[i] ? vol0[i]! / (area0[i] * fArea) : null)).filter((x): x is number => x !== null);
  const medTaxa = mediana(taxas) ?? 0;
  const fVol = medTaxa > 1000 ? 1 / 1000 : 1; // mL → L
  const medTempo = mediana(tempo0.filter((t): t is number => t !== null && t > 0)) ?? 0;
  const fTempo = medTempo > 20000 ? 1 / 60000 : medTempo > 200 ? 1 / 60 : 1; // ms → min | s → min
  const unidades = `área ${fArea === 1 ? 'ha' : 'm² → ha'} · volume ${fVol === 1 ? 'L' : 'mL → L'} · tempo ${fTempo === 1 ? 'min' : fTempo === 1 / 60 ? 's → min' : 'ms → min'}`;
  if (medTaxa * fVol && (medTaxa * fVol < 3 || medTaxa * fVol > 60)) avisos.push(`Taxa mediana de ${round(medTaxa * fVol, 1)} L/ha — confira as unidades do arquivo (${unidades}).`);
  const voos: VooKml[] = brutos.map((b, i) => {
    const nomeAc = k(b.dados, 'Aircraft Name', 'Aeronave', 'Drone') ?? '';
    const serie = (nomeAc.split(/\s+/).pop() ?? nomeAc).trim();
    const areaHa = round(area0[i] * fArea, 4);
    const volumeL = vol0[i] === null ? null : round(vol0[i]! * fVol, 3);
    const lon = b.pts.map((p) => p[0]), lat = b.pts.map((p) => p[1]);
    return {
      id: b.id, serie, aeronave: nomeAc,
      tempoMin: tempo0[i] === null ? null : round(tempo0[i]! * fTempo, 2),
      alturaM: num(k(b.dados, 'Height', 'Altura')), faixaM: num(k(b.dados, 'Route Spacing', 'Espaçamento')), velocidadeMs: num(k(b.dados, 'Task Flight Speed', 'Velocidade')),
      areaHa, volumeL, taxa: volumeL !== null && areaHa > 0 ? round(volumeL / areaHa, 2) : null,
      cx: lon.reduce((s, x) => s + x, 0) / lon.length, cy: lat.reduce((s, x) => s + x, 0) / lat.length,
      trajeto: simplificar(b.pts),
      pontos: b.pts,
    };
  });
  if (voos.some((v) => !v.serie)) avisos.push('Há voos sem identificação da aeronave.');
  return { voos, erros, avisos, unidades };
}

export const distM = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => Math.hypot((a.cx - b.cx) * 111320 * Math.cos((a.cy * Math.PI) / 180), (a.cy - b.cy) * 110540);

export interface PorSerie { areaHa: number; volumeL: number; tempoMin: number; cargas: number; alturaM: number | null; velocidadeMs: number | null; faixaM: number | null }
export interface GrupoKml { id: string; voos: VooKml[]; areaHa: number; volumeL: number; tempoMin: number; cx: number; cy: number; porSerie: Record<string, PorSerie>; foraTaxa: VooKml[]; volumeExcedente: number }

/** Agrupa voos próximos (ligação simples: centros a menos de `raioM`). */
export function agruparVoos(voos: VooKml[], taxaAlvo: number | null = null, raioM = 1000): GrupoKml[] {
  const n = voos.length, pai = voos.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (distM(voos[i], voos[j]) < raioM) pai[raiz(i)] = raiz(j);
  const mapa = new Map<number, VooKml[]>();
  voos.forEach((v, i) => { const r = raiz(i); (mapa.get(r) ?? mapa.set(r, []).get(r)!).push(v); });
  // taxa de referência: a informada (OS) ou a mediana dos voos
  const ref = taxaAlvo ?? mediana(voos.map((v) => v.taxa).filter((x): x is number => x !== null)) ?? null;
  const grupos = [...mapa.values()].map((vs) => {
    const areaHa = round(vs.reduce((s, v) => s + v.areaHa, 0), 4);
    const pond = (f: (v: VooKml) => number | null, sub: VooKml[]) => { let s = 0, w = 0; for (const v of sub) { const x = f(v); if (x !== null) { s += x * v.areaHa; w += v.areaHa; } } return w ? round(s / w, 2) : null; };
    const porSerie: Record<string, PorSerie> = {};
    for (const s of [...new Set(vs.map((v) => v.serie))]) {
      const sub = vs.filter((v) => v.serie === s);
      porSerie[s] = { areaHa: round(sub.reduce((a, v) => a + v.areaHa, 0), 4), volumeL: round(sub.reduce((a, v) => a + (v.volumeL ?? 0), 0), 2), tempoMin: round(sub.reduce((a, v) => a + (v.tempoMin ?? 0), 0), 1), cargas: sub.length, alturaM: pond((v) => v.alturaM, sub), velocidadeMs: pond((v) => v.velocidadeMs, sub), faixaM: pond((v) => v.faixaM, sub) };
    }
    const foraTaxa = ref ? vs.filter((v) => v.taxa !== null && (v.taxa > ref * 1.15 || v.taxa < ref * 0.85)) : [];
    const volumeL = round(vs.reduce((s, v) => s + (v.volumeL ?? 0), 0), 2);
    return { id: '', voos: vs, areaHa, volumeL, tempoMin: round(vs.reduce((s, v) => s + (v.tempoMin ?? 0), 0), 1), cx: vs.reduce((s, v) => s + v.cx, 0) / vs.length, cy: vs.reduce((s, v) => s + v.cy, 0) / vs.length, porSerie, foraTaxa, volumeExcedente: ref ? round(Math.max(0, volumeL - ref * areaHa), 1) : 0 };
  }).sort((a, b) => b.areaHa - a.areaHa);
  grupos.forEach((g, i) => { g.id = `G${i + 1}`; });
  return grupos;
}

/** Aeronave do cadastro pelo nº de série. */
export function aeronaveDaSerie(ds: Dataset, serie: string): string {
  const s = normalizar(serie).replace(/\s/g, '');
  if (!s) return '';
  return ds.aeronaves.find((a) => { const n = normalizar(a.numeroSerie ?? '').replace(/\s/g, ''); return n.length >= 4 && (n === s || s.endsWith(n) || n.endsWith(s)); })?.id ?? '';
}

/**
 * Sugere a(s) OS de cada grupo para a ficha aberta: 1) uma fazenda da ficha cujo real é a área do grupo
 * (±0,02 ha); 2) duas fazendas da ficha cuja soma é a área do grupo; 3) fazenda com local conhecido a
 * menos de 1,5 km (se a ficha já tem fazendas, só as dela; se está vazia, OS ainda não concluída).
 * Grupos sem sugestão ficam "fora deste dia".
 */
export function sugerirOS(ds: Dataset, f: FichaDia, grupos: GrupoKml[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const usados = new Set<string>();
  const doDia = f.fazendas.filter((z) => z.osId && z.real !== null && z.real > 0);
  for (const g of grupos) {
    const um = doDia.find((z) => !usados.has(z.osId) && Math.abs(z.real! - g.areaHa) <= 0.02);
    if (um) { out[g.id] = [um.osId]; usados.add(um.osId); }
  }
  for (const g of grupos) {
    if (out[g.id]) continue;
    const livres = doDia.filter((z) => !usados.has(z.osId));
    let par: string[] | null = null;
    for (let i = 0; i < livres.length && !par; i++) for (let j = i + 1; j < livres.length && !par; j++) if (Math.abs(livres[i].real! + livres[j].real! - g.areaHa) <= 0.02) par = [livres[i].osId, livres[j].osId];
    if (par) { out[g.id] = par; par.forEach((x) => usados.add(x)); continue; }
    const fz = ds.fazendas.filter((x) => typeof x.lat === 'number' && typeof x.lon === 'number').map((x) => ({ x, d: distM(g, { cx: x.lon!, cy: x.lat! }) })).filter((y) => y.d <= 1500).sort((a, b) => a.d - b.d)[0];
    if (fz) {
      const naFicha = f.fazendas.find((z) => ds.ordens.find((o) => o.id === z.osId)?.fazendaId === fz.x.id);
      // ficha com fazendas: só as dela; ficha vazia (começando pelo KML): OS aberta da fazenda
      const os = naFicha?.osId ?? (f.fazendas.length ? undefined : ds.ordens.filter((o) => o.fazendaId === fz.x.id && o.status !== 'cancelada' && o.status !== 'concluida' && !o.concluidaManual).sort((a, b) => b.emissao.localeCompare(a.emissao))[0]?.id);
      if (os && !usados.has(os)) { out[g.id] = [os]; usados.add(os); continue; }
    }
    out[g.id] = [];
  }
  return out;
}

export interface MetricaKml { cargas: number; tempoVooMin: number; volumeL: number; areaHa: number; alturaM: number | null; velocidadeMs: number | null; faixaM: number | null; foraTaxa: number; dividido: boolean }

/**
 * Aplica os grupos escolhidos na ficha: área de cada drone = soma do KML; células fazenda × drone
 * fixadas com o medido (uma por linha fica livre para absorver diferença de centésimos com o real);
 * fazendas sem real recebem a área do KML. Grupo com 2+ OS: dividido pelo real de cada OS.
 */
export function aplicarKmlNaFicha(ds: Dataset, f0: FichaDia, grupos: GrupoKml[], atrib: Record<string, string[]>, acPorSerie: Record<string, string>): { ficha: FichaDia; avisos: string[]; erros: string[] } {
  const f: FichaDia = JSON.parse(JSON.stringify(f0));
  const avisos: string[] = [], erros: string[] = [];
  const nomeAc = (id: string) => ds.aeronaves.find((a) => a.id === id)?.identificacao ?? id;
  const usados = grupos.filter((g) => (atrib[g.id] ?? []).length);
  if (!usados.length) { erros.push('Escolha a fazenda/OS de ao menos um grupo de voos.'); return { ficha: f0, avisos, erros }; }
  const series = [...new Set(usados.flatMap((g) => Object.keys(g.porSerie)))];
  for (const s of series) if (!acPorSerie[s]) erros.push(`Escolha a aeronave do drone de série ${s}.`);
  const acs = series.map((s) => acPorSerie[s]);
  if (new Set(acs.filter(Boolean)).size !== acs.filter(Boolean).length) erros.push('Duas séries do KML foram ligadas à mesma aeronave.');
  const osRep = usados.flatMap((g) => atrib[g.id]);
  if (new Set(osRep).size !== osRep.length) erros.push('A mesma OS foi escolhida para mais de um grupo de voos.');
  if (erros.length) return { ficha: f0, avisos, erros };
  // fazendas da ficha
  for (const g of usados) {
    const oss = atrib[g.id];
    for (const os of oss) {
      let z = f.fazendas.find((x) => x.osId === os);
      if (!z) { z = { osId: os, real: null, concluir: false, descontoEm: [] }; f.fazendas.push(z); }
      if (z.real === null && oss.length === 1) { z.real = round(g.areaHa, 2); avisos.push(`OS ${ds.ordens.find((o) => o.id === os)?.numero}: real preenchido com a área do KML (${String(round(g.areaHa, 2)).replace('.', ',')} ha).`); }
    }
    if (oss.length > 1 && oss.some((os) => !(f.fazendas.find((x) => x.osId === os)!.real! > 0))) erros.push(`Grupo ${g.id} cobre ${oss.length} OS: informe o real de cada uma para dividir a área dos drones.`);
    if (oss.length === 1) {
      const real = f.fazendas.find((x) => x.osId === oss[0])!.real!;
      if (Math.abs(real - g.areaHa) > 0.02) avisos.push(`OS ${ds.ordens.find((o) => o.id === oss[0])?.numero}: real da ficha ${String(real).replace('.', ',')} ha × KML ${String(round(g.areaHa, 2)).replace('.', ',')} ha.`);
    }
  }
  if (erros.length) return { ficha: f0, avisos, erros };
  // fazendas da ficha sem voos nos grupos escolhidos: a área dos drones não fecharia
  const cobertas = new Set(usados.flatMap((g) => atrib[g.id]));
  for (const z of f.fazendas) if (z.osId && !cobertas.has(z.osId)) erros.push(`OS ${ds.ordens.find((o) => o.id === z.osId)?.numero ?? '?'} está na ficha mas nenhum grupo do KML foi ligado a ela: ligue o grupo ou retire a fazenda da ficha.`);
  if (erros.length) return { ficha: f0, avisos, erros };
  // matriz fazenda × aeronave em centésimos: cada linha fecha exatamente com o real da ficha
  const acsOrdem = [...new Set(series.map((s) => acPorSerie[s]))];
  const cent = (x: number) => Math.round(x * 100);
  const celulas = new Map<string, number>(); // `${os}|${ac}` → centésimos
  const metr = new Map<string, MetricaKml>();
  for (const g of usados) {
    const oss = atrib[g.id];
    const reais = oss.map((os) => f.fazendas.find((x) => x.osId === os)!.real!);
    const somaReais = reais.reduce((a, b) => a + b, 0);
    oss.forEach((os, i) => {
      const part = oss.length === 1 ? 1 : reais[i] / somaReais;
      const alvo = cent(reais[i]);
      const bruto = acsOrdem.map((ac) => { const s = Object.keys(g.porSerie).find((x) => acPorSerie[x] === ac); return { ac, s, v: s ? g.porSerie[s].areaHa * part : 0 }; });
      const somaBruto = bruto.reduce((a, b) => a + b.v, 0);
      // escala para o real e arredonda pelo maior resto (linha exata)
      const esc = bruto.map((b) => ({ ...b, x: somaBruto > 0 ? (b.v * alvo) / somaBruto : 0 }));
      const base = esc.map((b) => Math.floor(b.x + 1e-9));
      let falta = alvo - base.reduce((a, b) => a + b, 0);
      esc.map((b, k) => ({ k, r: b.x - Math.floor(b.x + 1e-9) })).sort((a, b) => b.r - a.r).forEach(({ k }) => { if (falta > 0) { base[k]++; falta--; } });
      esc.forEach((b, k) => {
        celulas.set(`${os}|${b.ac}`, base[k]);
        if (b.s) { const p = g.porSerie[b.s]; metr.set(`${os}|${b.ac}`, { cargas: oss.length === 1 ? p.cargas : Math.max(1, Math.round(p.cargas * part)), tempoVooMin: round(p.tempoMin * part, 1), volumeL: round(p.volumeL * part, 1), areaHa: base[k] / 100, alturaM: p.alturaM, velocidadeMs: p.velocidadeMs, faixaM: p.faixaM, foraTaxa: g.foraTaxa.filter((v) => v.serie === b.s).length, dividido: oss.length > 1 }); }
      });
    });
    if (oss.length > 1) avisos.push(`Grupo ${g.id} (${String(round(g.areaHa, 2)).replace('.', ',')} ha) cobre ${oss.length} OS vizinhas: a área de cada drone foi dividida pelo real de cada OS (sem o contorno dos talhões não dá para cortar no limite).`);
    if (g.foraTaxa.length) avisos.push(`Grupo ${g.id}: ${g.foraTaxa.length} voo(s) com taxa fora de ±15% da referência; volume acima do esperado ≈ ${String(g.volumeExcedente).replace('.', ',')} L.`);
    if (oss.length === 1) { const fz = ds.ordens.find((o) => o.id === oss[0])?.fazendaId; if (fz) (f.kmlLocais ??= {})[fz] = [round(g.cy, 6), round(g.cx, 6)]; }
  }
  // área de cada drone = soma das suas células (consistente com as linhas)
  const antes = new Map(f.drones.map((d) => [d.aeronaveId, d.area]));
  f.drones = acsOrdem.map((ac) => {
    const area = [...celulas.entries()].filter(([k]) => k.endsWith(`|${ac}`)).reduce((a, [, v]) => a + v, 0) / 100;
    const d = f0.drones.find((x) => x.aeronaveId === ac);
    const a0 = antes.get(ac);
    if (a0 !== undefined && a0 !== null && Math.abs(a0 - area) > 0.01) avisos.push(`${nomeAc(ac)}: ficha ${String(a0).replace('.', ',')} ha → KML ${String(area.toFixed(2)).replace('.', ',')} ha.`);
    return d ? { ...d, area } : { aeronaveId: ac, pilotoId: ds.aeronaves.find((a) => a.id === ac)?.pilotoPadraoId ?? '', area, inicio: '', fim: '', pausas: [] };
  });
  for (const d of f0.drones) if (!acsOrdem.includes(d.aeronaveId)) avisos.push(`${nomeAc(d.aeronaveId)} não aparece nos voos escolhidos do KML: retirado da ficha (tinha ${String(d.area ?? 0).replace('.', ',')} ha).`);
  f.fixas = Object.fromEntries([...celulas.entries()].map(([k, v]) => [k, v / 100]));
  f.kml = Object.fromEntries(metr);
  f.kmlSeries = Object.fromEntries(series.map((s) => [acPorSerie[s], s]));
  return { ficha: f, avisos, erros };
}

/** Após gravar: guarda o local das fazendas e o nº de série das aeronaves (só quando estavam vazios). */
export function guardarAprendizadoKml(ds: Dataset, f: FichaDia) {
  for (const [fz, [lat, lon]] of Object.entries(f.kmlLocais ?? {})) {
    const x = ds.fazendas.find((y) => y.id === fz);
    if (x && (typeof x.lat !== 'number' || typeof x.lon !== 'number')) { x.lat = lat; x.lon = lon; registrar(ds, { entidade: 'fazenda', entidadeId: fz, acao: 'editar', resumo: `Local de ${x.nome} aprendido do KML de voo (${lat.toFixed(5)}, ${lon.toFixed(5)})` }); }
  }
  for (const [ac, serie] of Object.entries(f.kmlSeries ?? {})) {
    const a = ds.aeronaves.find((y) => y.id === ac);
    if (a && !(a.numeroSerie ?? '').trim()) { a.numeroSerie = serie; registrar(ds, { entidade: 'aeronave', entidadeId: ac, acao: 'editar', resumo: `${a.identificacao}: nº de série ${serie} (do KML de voo)` }); }
  }
}
