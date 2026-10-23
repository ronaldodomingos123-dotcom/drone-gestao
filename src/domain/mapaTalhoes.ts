/**
 * Mapa de talhões (KML com um polígono por talhão e os campos cod_zona, cod_talhao, area_plantada etc.).
 * Liga cada polígono ao talhão do protótipo pela ZONA (= código da fazenda no protótipo) e pelo número do
 * talhão. Só guarda os contornos das fazendas que existem no protótipo (o mapa geral tem milhares de
 * talhões e o navegador tem limite de espaço). Contornos simplificados a ~0,5 m.
 */
import { registrar } from './base';
import { round } from './calc';
import type { Dataset } from './types';

export interface TalhaoMapa {
  zona: string; talhao: string; fnOriginal: string; nomeFazenda: string; nomeZona: string;
  plantada: number | null; total: number | null; carreador: number | null;
  restricaoVoo: boolean; restricao: string; anel: [number, number][];
}
export interface LeituraMapa { talhoes: TalhaoMapa[]; erros: string[]; zonas: number }

const n = (v: string | undefined) => { if (!v) return null; const x = Number(v.trim().replace(',', '.')); return Number.isFinite(x) ? x : null; };
const semZero = (s: string) => s.trim().replace(/^0+(?=\d)/, '');

/** Douglas–Peucker em metros (projeção local). */
function simplificar(p: [number, number][], tolM = 0.5): [number, number][] {
  if (p.length <= 4) return p;
  const lat0 = p[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const q = p.map(([x, y]) => [x * kx, y * ky]);
  const manter = new Uint8Array(p.length); manter[0] = 1; manter[p.length - 1] = 1;
  // anel fechado (1º = último): parte no ponto mais distante do 1º para o DP não colapsar
  let longe = 0, dl = -1;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.hypot(q[i][0] - q[0][0], q[i][1] - q[0][1]); if (d > dl) { dl = d; longe = i; } }
  manter[longe] = 1;
  const pilha: [number, number][] = longe > 0 ? [[0, longe], [longe, p.length - 1]] : [[0, p.length - 1]];
  while (pilha.length) {
    const [a, b] = pilha.pop()!;
    const [ax, ay] = q[a], [bx, by] = q[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let iMax = -1, dMax = 0;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((q[i][0] - ax) * dy - (q[i][1] - ay) * dx) / L; if (d > dMax) { dMax = d; iMax = i; } }
    if (dMax > tolM && iMax > 0) { manter[iMax] = 1; pilha.push([a, iMax], [iMax, b]); }
  }
  return p.filter((_, i) => manter[i]).map(([x, y]) => [round(x, 7), round(y, 7)] as [number, number]);
}

export function lerMapaTalhoes(texto: string): LeituraMapa {
  if (!/<kml[\s>]/i.test(texto)) return { talhoes: [], erros: ['Arquivo não é um KML.'], zonas: 0 };
  const talhoes: TalhaoMapa[] = [];
  for (const m of texto.match(/<Placemark[\s>][\s\S]*?<\/Placemark>/gi) ?? []) {
    const d: Record<string, string> = {};
    for (const x of m.matchAll(/<SimpleData\s+name="([^"]+)"\s*>([\s\S]*?)<\/SimpleData>/gi)) d[x[1].toLowerCase()] = x[2].trim();
    for (const x of m.matchAll(/<Data\s+name="([^"]+)"\s*>\s*<value>([\s\S]*?)<\/value>/gi)) d[x[1].toLowerCase()] ??= x[2].trim();
    const ext = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(m)?.[1] ?? /<Polygon[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(m)?.[1];
    if (!ext || !d.cod_zona || !d.cod_talhao) continue;
    const anel = ext.trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]] as [number, number]);
    if (anel.length < 3) continue;
    talhoes.push({ zona: semZero(d.cod_zona), talhao: semZero(d.cod_talhao), fnOriginal: semZero(d.cod_fazenda ?? ''), nomeFazenda: (d.nome_fazenda ?? '').trim(), nomeZona: (d.nome_zona ?? '').trim(), plantada: n(d.area_plantada), total: n(d.area_total), carreador: n(d.area_carreador), restricaoVoo: d.restricao_voo === '1', restricao: d.restricao && d.restricao !== '-' ? d.restricao : '', anel });
  }
  if (!talhoes.length) return { talhoes, erros: ['Nenhum talhão com cod_zona e cod_talhao encontrado no KML.'], zonas: 0 };
  return { talhoes, erros: [], zonas: new Set(talhoes.map((t) => t.zona)).size };
}

export interface ResultadoMapa { ligados: number; criados: number; areasAtualizadas: number; fazendas: number; ignoradas: number; avisos: string[] }

/**
 * Grava os contornos nos talhões do protótipo (fazendas cujo código = zona do mapa). Talhões do mapa que
 * não existem no protótipo são criados só se `criarTalhoes` (com a área plantada). `atualizarArea` troca a
 * área do talhão do protótipo pela plantada do mapa (as OS não mudam).
 */
export function aplicarMapaTalhoes(ds: Dataset, l: LeituraMapa, o: { criarTalhoes: boolean; atualizarArea: boolean }, gerarId: (p: string) => string): ResultadoMapa {
  const r: ResultadoMapa = { ligados: 0, criados: 0, areasAtualizadas: 0, fazendas: 0, ignoradas: 0, avisos: [] };
  const porZona = new Map<string, TalhaoMapa[]>();
  for (const t of l.talhoes) (porZona.get(t.zona) ?? porZona.set(t.zona, []).get(t.zona)!).push(t);
  for (const [zona, ts] of porZona) {
    const fz = ds.fazendas.find((f) => semZero(f.codigo) === zona);
    if (!fz) { r.ignoradas++; continue; }
    r.fazendas++;
    for (const t of ts) {
      let tl = ds.talhoes.find((x) => x.fazendaId === fz.id && !x.geral && semZero(x.codigo) === t.talhao);
      if (!tl && o.criarTalhoes) {
        // mesmo padrão de código da fazenda (ex.: "019" → zeros à esquerda)
        const cods = ds.talhoes.filter((x) => x.fazendaId === fz.id && !x.geral && /^\d+$/.test(x.codigo)).map((x) => x.codigo);
        const pad = cods.length && cods.filter((c) => c.startsWith('0')).length * 2 >= cods.length ? Math.max(...cods.map((c) => c.length)) : 0;
        tl = { id: gerarId('tl'), fazendaId: fz.id, codigo: pad ? t.talhao.padStart(pad, '0') : t.talhao, zona, areaHa: t.plantada ?? t.total ?? 0 }; ds.talhoes.push(tl); r.criados++;
      }
      if (!tl) continue;
      tl.poligono = simplificar(t.anel);
      if (t.plantada !== null) tl.areaPlantadaHa = t.plantada;
      if (t.total !== null) tl.areaTotalHa = t.total;
      tl.restricaoVoo = t.restricaoVoo || undefined;
      if (t.restricao) tl.restricao = t.restricao; else delete tl.restricao;
      if (o.atualizarArea && t.plantada !== null && Math.abs(tl.areaHa - t.plantada) > 0.005) { tl.areaHa = t.plantada; r.areasAtualizadas++; }
      else if (t.plantada !== null && Math.abs(tl.areaHa - t.plantada) > 0.05) r.avisos.push(`${fz.nome} talhão ${tl.codigo}: protótipo ${String(tl.areaHa).replace('.', ',')} ha × mapa ${String(t.plantada).replace('.', ',')} ha plantados.`);
      r.ligados++;
    }
  }
  registrar(ds, { entidade: 'base', entidadeId: 'mapa-talhoes', acao: 'importar', resumo: `Mapa de talhões: ${r.ligados} contorno(s) em ${r.fazendas} fazenda(s); ${r.criados} talhão(ões) criado(s); ${r.areasAtualizadas} área(s) atualizada(s).` });
  return r;
}
