/**
 * Fechamento do dia a partir da ficha diária (o resumo que a equipe já faz no app de acompanhamento).
 *
 * A ficha traz: janela do dia, pausas da linha do tempo, área por DRONE e área real por FAZENDA/OS.
 * Toda área é voada: o dia vira operações (voos) com drone, piloto e horário — entra no ha/h.
 *
 * Regra de fechamento: total do dia = Σ drones = Σ real das fazendas (tolerância 0,01 ha).
 * O que a ficha NÃO traz é estimado por proporção e marcado como estimado:
 *  - área de cada drone em cada fazenda (rateio que respeita os dois totais; células editáveis);
 *  - horário de cada trecho (o tempo efetivo do drone é dividido na ordem das fazendas, pela área);
 *  - divisão da área do dia entre os talhões da OS (pelo saldo; ao concluir, o desconto vai para o
 *    talhão indicado).
 * A conversão em operações usa o mesmo fechamento do boletim de campo (mesmas validações de saldo).
 */
import { criarIndices } from './analytics';
import { fecharBoletim, type BoletimCampo, type PausaCampo } from './boletim';
import { aplicacoes, aplicadoPorItem, chaveItem, hhmmParaMin, MIN_POR_DIA, round } from './calc';
import { distribuirDesconto, type TalhaoLanc } from './lancamento';
import { registrar } from './base';
import { guardarAprendizadoKml } from './kmlVoo';
import type { Dataset, LeituraClima, Operacao, Parada } from './types';

export interface DroneDia { aeronaveId: string; pilotoId: string; area: number | null; /** vazio = janela do dia */ inicio: string; fim: string; /** paradas só deste drone (ex.: quebra) */ pausas: PausaCampo[] }
export interface FazendaDia { osId: string; real: number | null; concluir: boolean; /** talhões onde ficou o desconto (ao concluir com saldo) */ descontoEm: string[]; /** volume de calda só desta fazenda (L/ha); vazio = o do dia */ volumeLHa?: number | null }
export interface ClimaDia { tIni: number | null; urIni: number | null; vIni: number | null; tFim: number | null; urFim: number | null; vFim: number | null }
export interface FichaDia {
  versao: 1;
  data: string; inicio: string; fim: string;
  turnoId: string; liderId: string; responsavel: string;
  /** pausas da linha do tempo — valem para todos os drones */
  pausas: PausaCampo[];
  drones: DroneDia[];
  fazendas: FazendaDia[];
  clima: ClimaDia;
  observacoes: string;
  /** células da matriz informadas à mão: chave `${osId}|${aeronaveId}` → ha */
  fixas: Record<string, number>;
  /** volume de calda do dia (L/ha), informado à mão; vazio = o da OS */
  volumeLHa?: number | null;
  /** data com que este dia foi gravado antes (data corrigida): os voos dessa data também são substituídos */
  substituiDia?: string;
  /** Medidas do KML de voo por célula `${osId}|${aeronaveId}` */
  kml?: Record<string, import('./kmlVoo').MetricaKml>;
  /** Locais aprendidos do KML: fazendaId → [lat, lon] */
  kmlLocais?: Record<string, [number, number]>;
  /** Série do drone no KML por aeronave */
  kmlSeries?: Record<string, string>;
  /** avisos da aplicação do KML (diferenças ficha × KML), exibidos na prévia */
  kmlAvisos?: string[];
  /** aplicado por talhão e drone (cruzamento com os talhões, editável): `${osId}|${aeronaveId}` → talhaoId → ha */
  talhoesDrone?: Record<string, Record<string, number>>;
  /** talhões de fora da OS que passam a fazer parte dela (decisão no cruzamento) */
  adicionarNaOS?: Record<string, string[]>;
}

export function fichaVazia(data: string): FichaDia {
  return { versao: 1, data, inicio: '', fim: '', turnoId: '', liderId: '', responsavel: '', pausas: [], drones: [], fazendas: [], clima: { tIni: null, urIni: null, vIni: null, tFim: null, urFim: null, vFim: null }, observacoes: '', fixas: {} };
}

const br = (x: number, c = 2) => x.toFixed(c).replace('.', ',');

// ---------------------------------------------------------------- 1. Rateio fazenda × drone
export interface Rateio { m: number[][]; estimada: boolean[][]; erros: string[]; avisos: string[] }

/**
 * Divide o real de cada fazenda (linhas) entre os drones (colunas) respeitando os DOIS totais.
 * Células fixas ficam como informadas; as demais são estimadas por ajuste proporcional iterativo
 * (IPF) e arredondadas em centésimos de modo que linhas e colunas fechem exatamente.
 */
export function ratear(reais: number[], drones: number[], fixas: (number | null)[][], nomeDrone: (j: number) => string = (j) => `drone ${j + 1}`): Rateio {
  const n = reais.length, k = drones.length;
  const erros: string[] = [], avisos: string[] = [];
  const m = reais.map(() => drones.map(() => 0));
  const estimada = reais.map(() => drones.map(() => true));
  if (!n || !k) return { m, estimada, erros, avisos };
  const R = reais.map((x) => Math.round(x * 100));
  const C = drones.map((x) => Math.round(x * 100));
  const dif = R.reduce((s, x) => s + x, 0) - C.reduce((s, x) => s + x, 0);
  if (Math.abs(dif) > 1) {
    const sf = R.reduce((s, x) => s + x, 0) / 100, sd = C.reduce((s, x) => s + x, 0) / 100;
    erros.push(dif < 0 ? `Faltam ${br(-dif / 100)} ha nas fazendas para fechar com ${br(sd)} ha dos drones (fazendas somam ${br(sf)} ha).` : `As fazendas somam ${br(sf)} ha, ${br(dif / 100)} ha a mais que os drones (${br(sd)} ha).`);
    return { m, estimada, erros, avisos };
  }
  if (dif !== 0) {
    const jm = C.indexOf(Math.max(...C));
    C[jm] += dif;
    avisos.push(`Diferença de 0,01 ha entre fazendas e drones (arredondamento da ficha) absorvida pelo ${nomeDrone(jm)}.`);
  }
  // fixas
  const F = fixas.map((l) => l.map((v) => (v === null || v === undefined ? null : Math.round(v * 100))));
  const rowRem = R.map((r, i) => r - F[i].reduce<number>((s, v) => s + (v ?? 0), 0));
  const colRem = C.map((c, j) => c - F.reduce<number>((s, l) => s + (l[j] ?? 0), 0));
  rowRem.forEach((x, i) => { if (x < 0) erros.push(`Linha ${i + 1}: as células informadas somam mais que o real da fazenda.`); });
  colRem.forEach((x, j) => { if (x < 0) erros.push(`${nomeDrone(j)}: as células informadas somam mais que a área do drone.`); });
  if (erros.length) return { m, estimada, erros, avisos };
  const livre = (i: number, j: number) => F[i][j] === null;
  for (let i = 0; i < n; i++) if (rowRem[i] > 0 && !drones.some((_, j) => livre(i, j))) erros.push(`Linha ${i + 1}: todas as células foram informadas, mas faltam ${br(rowRem[i] / 100)} ha.`);
  for (let j = 0; j < k; j++) if (colRem[j] > 0 && !reais.some((_, i) => livre(i, j))) erros.push(`${nomeDrone(j)}: todas as células foram informadas, mas faltam ${br(colRem[j] / 100)} ha.`);
  if (erros.length) return { m, estimada, erros, avisos };
  // IPF em reais (contínuo)
  const x = reais.map((_, i) => drones.map((__, j) => (livre(i, j) && rowRem[i] > 0 && colRem[j] > 0 ? colRem[j] : 0)));
  for (let it = 0; it < 500; it++) {
    for (let i = 0; i < n; i++) { const s = x[i].reduce((a, b) => a + b, 0); if (s > 0) for (let j = 0; j < k; j++) x[i][j] *= rowRem[i] / s; }
    let maxErr = 0;
    for (let j = 0; j < k; j++) { const s = x.reduce((a, l) => a + l[j], 0); if (s > 0) { for (let i = 0; i < n; i++) x[i][j] *= colRem[j] / s; } maxErr = Math.max(maxErr, Math.abs(s - colRem[j])); }
    if (maxErr < 1e-7) break;
  }
  // arredonda por linha (maior resto) → linhas exatas
  const c = x.map((l, i) => {
    const base = l.map((v) => Math.floor(v + 1e-9));
    let falta = rowRem[i] - base.reduce((a, b) => a + b, 0);
    const ordem = l.map((v, j) => ({ j, r: v - Math.floor(v + 1e-9) })).filter((o) => livre(i, o.j)).sort((a, b) => b.r - a.r);
    for (const o of ordem) { if (falta <= 0) break; base[o.j]++; falta--; }
    return base;
  });
  // acerta colunas trocando centésimos dentro da mesma linha (linhas continuam exatas)
  for (let guarda = 0; guarda < 100000; guarda++) {
    const desv = drones.map((_, j) => c.reduce((s, l) => s + l[j], 0) - colRem[j]);
    const jMais = desv.findIndex((d) => d > 0), jMenos = desv.findIndex((d) => d < 0);
    if (jMais < 0 || jMenos < 0) break;
    const i = c.findIndex((l, ii) => l[jMais] > 0 && livre(ii, jMais) && livre(ii, jMenos));
    if (i < 0) { avisos.push('Não foi possível fechar exatamente as colunas com as células informadas; confira os totais.'); break; }
    c[i][jMais]--; c[i][jMenos]++;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
    if (livre(i, j)) m[i][j] = c[i][j] / 100; else { m[i][j] = F[i][j]! / 100; estimada[i][j] = false; }
  }
  return { m, estimada, erros, avisos };
}

// ---------------------------------------------------------------- 2. Área do dia por talhão da OS
/** Área já registrada por talhão da OS (voos + lançamentos anteriores). */
export function jaPorTalhao(ds: Dataset, osId: string): TalhaoLanc[] {
  const os = ds.ordens.find((o) => o.id === osId);
  if (!os) return [];
  const apl = aplicadoPorItem(aplicacoes(ds));
  return os.itens.map((i) => ({ talhaoId: i.talhaoId, programado: i.areaPlanejadaHa, voos: apl.get(chaveItem(osId, i.talhaoId)) ?? 0 }));
}

/** Corrige o último elemento para que a soma dê exatamente `total` (4 casas). */
function fecharSoma(m: Map<string, number>, total: number) {
  const ks = [...m.keys()].filter((k) => m.get(k)! > 0);
  if (!ks.length) return m;
  const s = [...m.values()].reduce((a, b) => a + b, 0);
  const u = ks[ks.length - 1];
  m.set(u, round(m.get(u)! + (total - s), 4));
  return m;
}

export interface AlvoDia { porTalhao: Map<string, number>; saldo: number; obstaculo: number; erros: string[] }
/**
 * Como a área REAL do dia nesta OS se distribui pelos talhões:
 * - sem concluir: proporcional ao saldo de cada talhão (estimado);
 * - concluindo: cada talhão completa o programado, exceto os marcados com desconto (obstáculo).
 */
export function alvoDiaOS(ds: Dataset, osId: string, realDia: number, concluir: boolean, descontoEm: string[]): AlvoDia {
  const tl = jaPorTalhao(ds, osId);
  const saldoT = new Map(tl.map((t) => [t.talhaoId, Math.max(0, round(t.programado - t.voos, 4))]));
  const saldo = round([...saldoT.values()].reduce((a, b) => a + b, 0), 4);
  const erros: string[] = [];
  const porTalhao = new Map<string, number>();
  if (realDia > saldo + 0.005) { erros.push(`Real do dia (${br(realDia)} ha) maior que o saldo da OS (${br(saldo)} ha).`); return { porTalhao, saldo, obstaculo: 0, erros }; }
  if (!concluir || saldo - realDia <= 0.005) {
    for (const [t, s] of saldoT) porTalhao.set(t, saldo > 0 ? round(realDia * s / saldo, 4) : 0);
    return { porTalhao: fecharSoma(porTalhao, realDia), saldo, obstaculo: concluir ? round(Math.max(0, saldo - realDia), 4) : 0, erros };
  }
  const ja = tl.reduce((s, t) => s + t.voos, 0);
  const obst = round(saldo - realDia, 4);
  // desconto previsto na OS (coluna "ñ aplicado" da planilha): se o obstáculo do dia é exatamente ele,
  // usa o valor de cada talhão (em vez de ratear pela área)
  const os = ds.ordens.find((o) => o.id === osId);
  const prev = new Map((os?.itens ?? []).filter((i) => (i.naoAplicadoHa ?? 0) > 0 && (!descontoEm.length || descontoEm.includes(i.talhaoId))).map((i) => [i.talhaoId, i.naoAplicadoHa!]));
  const somaPrev = [...prev.values()].reduce((a, b) => a + b, 0);
  if (prev.size && Math.abs(somaPrev - obst) <= 0.011 && tl.every((t) => t.programado - (prev.get(t.talhaoId) ?? 0) >= t.voos - 0.005)) {
    for (const t of tl) porTalhao.set(t.talhaoId, Math.max(0, round(t.programado - (prev.get(t.talhaoId) ?? 0) - t.voos, 4)));
    return { porTalhao: fecharSoma(porTalhao, realDia), saldo, obstaculo: obst, erros };
  }
  const d = distribuirDesconto(tl, ja + realDia, descontoEm);
  if (d.erros.length) return { porTalhao, saldo, obstaculo: 0, erros: d.erros };
  for (const t of tl) porTalhao.set(t.talhaoId, Math.max(0, round((d.aplicado.get(t.talhaoId) ?? t.programado) - t.voos, 4)));
  return { porTalhao: fecharSoma(porTalhao, realDia), saldo, obstaculo: obst, erros };
}

// ---------------------------------------------------------------- 3. Tempo: pausas e trechos
type Int = [number, number]; // minutos relativos ao início do dia
/** a − b (lista de intervalos disjuntos) */
function subtrair(a: Int, bs: Int[]): Int[] {
  let res: Int[] = [a];
  for (const [b0, b1] of bs) res = res.flatMap(([x0, x1]) => (b1 <= x0 || b0 >= x1 ? [[x0, x1] as Int] : [[x0, Math.max(x0, b0)] as Int, [Math.min(x1, b1), x1] as Int].filter(([p, q]) => q > p)));
  return res;
}
const hh = (base: number, relMin: number) => { const t = (((base + relMin) % MIN_POR_DIA) + MIN_POR_DIA) % MIN_POR_DIA; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export interface TempoDrone { inicio: string; fim: string; total: number; parado: number; efetivo: number; pausas: (PausaCampo & { a: number; z: number })[] }
/** Janela, pausas (do dia + do drone, sem sobreposição) e tempo efetivo de um drone. */
export function tempoDrone(f: FichaDia, d: DroneDia): TempoDrone | string {
  const base = hhmmParaMin(f.inicio);
  if (base === null || hhmmParaMin(f.fim) === null) return 'Informe a hora inicial e final do dia.';
  const r = (h: string) => { const v = hhmmParaMin(h); return v === null ? null : (v - base + MIN_POR_DIA) % MIN_POR_DIA; };
  const fimDia = r(f.fim)! || MIN_POR_DIA;
  const wa = d.inicio ? r(d.inicio) : 0, wz = d.fim ? (r(d.fim) || MIN_POR_DIA) : fimDia;
  if (wa === null || wz === null) return 'Horário do drone inválido.';
  if (wz <= wa) return 'O fim do drone precisa ser depois do início.';
  const clip = (p: PausaCampo): Int | null => { const a = r(p.inicio), z = p.fim ? r(p.fim) : null; if (a === null || z === null) return null; const zz = z < a ? z + MIN_POR_DIA : z; const x0 = Math.max(a, wa), x1 = Math.min(zz, wz); return x1 > x0 ? [x0, x1] : null; };
  const pausas: TempoDrone['pausas'] = [];
  const ocup: Int[] = [];
  for (const p of f.pausas) { const c = clip(p); if (!c) continue; for (const [a, z] of subtrair(c, ocup)) { pausas.push({ ...p, inicio: hh(base, a), fim: hh(base, z), a, z }); ocup.push([a, z]); } }
  for (const p of d.pausas) { const c = clip(p); if (!c) continue; for (const [a, z] of subtrair(c, ocup)) { pausas.push({ ...p, inicio: hh(base, a), fim: hh(base, z), a, z }); ocup.push([a, z]); } }
  pausas.sort((x, y) => x.a - y.a);
  const parado = pausas.reduce((s, p) => s + (p.z - p.a), 0);
  return { inicio: hh(base, wa), fim: hh(base, wz), total: wz - wa, parado, efetivo: wz - wa - parado, pausas };
}

/** Divide o tempo efetivo do drone entre os trechos (na ordem), proporcional à área de cada um. */
export function trechosDoDrone(t: TempoDrone, areas: number[], base: number, wa: number): { inicio: string; fim: string; pausas: PausaCampo[]; efetivo: number }[] {
  const tot = areas.reduce((a, b) => a + b, 0);
  const q = areas.map((a) => (tot > 0 ? (t.efetivo * a) / tot : 0));
  const qi = q.map((v) => Math.max(1, Math.floor(v)));
  let falta = t.efetivo - qi.reduce((a, b) => a + b, 0);
  const ordem = q.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (let k = 0; falta > 0; k = (k + 1) % ordem.length) { qi[ordem[k].i]++; falta--; }
  for (let i = qi.length - 1; falta < 0 && i >= 0; i--) { const tira = Math.min(qi[i] - 1, -falta); qi[i] -= tira; falta += tira; }
  const wz = wa + t.total;
  const out: { inicio: string; fim: string; pausas: PausaCampo[]; efetivo: number }[] = [];
  let pos = wa;
  qi.forEach((cota, k) => {
    const ini = pos;
    let need = cota;
    while (need > 0 && pos < wz) {
      const dentro = t.pausas.find((p) => p.a <= pos && pos < p.z);
      if (dentro) { pos = dentro.z; continue; }
      const prox = t.pausas.filter((p) => p.a > pos).map((p) => p.a);
      const lim = Math.min(wz, ...prox);
      const take = Math.min(lim - pos, need);
      pos += take; need -= take;
    }
    const fim = k === qi.length - 1 ? wz : pos;
    out.push({ inicio: hh(base, ini), fim: hh(base, fim), efetivo: cota, pausas: t.pausas.filter((p) => p.a >= ini && p.z <= fim).map(({ a: _a, z: _z, ...p }) => p) });
  });
  return out;
}

/** Cópia do dataset com os talhões que o cruzamento mandou adicionar à OS (a OS real só muda ao gravar). */
function comAdicoesNaOS(ds: Dataset, f: FichaDia): Dataset {
  const add = f.adicionarNaOS ?? {};
  if (!Object.keys(add).length) return ds;
  return { ...ds, ordens: ds.ordens.map((o) => { const ts = (add[o.id] ?? []).filter((t) => !o.itens.some((i) => i.talhaoId === t)); if (!ts.length) return o; return { ...o, itens: [...o.itens, ...ts.map((t) => { const tl = ds.talhoes.find((x) => x.id === t); return { talhaoId: t, areaPlanejadaHa: tl?.areaPlantadaHa ?? tl?.areaHa ?? 0 }; })] }; }) };
}

/** Quando o aplicado por talhão veio do cruzamento (medido/editado), ele define o dia da OS. */
function alvoMedido(ds: Dataset, f: FichaDia, osId: string, realDia: number, concluir: boolean): AlvoDia | null {
  const ks = Object.keys(f.talhoesDrone ?? {}).filter((k) => k.startsWith(`${osId}|`));
  if (!ks.length) return null;
  const porTalhao = new Map<string, number>();
  for (const k of ks) for (const [t, v] of Object.entries(f.talhoesDrone![k])) porTalhao.set(t, round((porTalhao.get(t) ?? 0) + v, 4));
  const tl = jaPorTalhao(ds, osId);
  const saldo = round(tl.reduce((s, t) => s + Math.max(0, t.programado - t.voos), 0), 4);
  const erros: string[] = [];
  const nomeT = (id: string) => ds.talhoes.find((t) => t.id === id)?.codigo ?? '?';
  for (const [t, v] of porTalhao) {
    const x = tl.find((y) => y.talhaoId === t);
    if (!x) erros.push(`talhão ${nomeT(t)} não está na OS.`);
    else if (v > x.programado - x.voos + 0.005) erros.push(`talhão ${nomeT(t)}: aplicado ${br(v)} ha maior que o saldo ${br(Math.max(0, x.programado - x.voos))} ha (edite no cruzamento).`);
  }
  const soma = round([...porTalhao.values()].reduce((a, b) => a + b, 0), 4);
  if (Math.abs(soma - realDia) > 0.011) erros.push(`soma dos talhões (${br(soma)} ha) diferente do real da fazenda (${br(realDia)} ha).`);
  return { porTalhao, saldo, obstaculo: concluir ? round(Math.max(0, saldo - soma), 4) : 0, erros };
}

// ---------------------------------------------------------------- 4. Prévia e gravação
/** Volume de calda efetivo: o da fazenda, senão o do dia, senão o da OS. */
export function volumeCalda(f: Pick<FichaDia, 'volumeLHa'>, x: Pick<FazendaDia, 'volumeLHa'>, daOS: number | null | undefined): number | null {
  for (const v of [x.volumeLHa, f.volumeLHa, daOS]) if (typeof v === 'number' && v > 0) return v;
  return null;
}
export interface PreviaFechamento {
  rateio: Rateio;
  alvos: (AlvoDia | null)[];
  tempos: (TempoDrone | null)[];
  ops: Operacao[];
  paradas: Parada[];
  erros: string[];
  avisos: string[];
  /** voos de um fechamento anterior do mesmo dia/drones que serão substituídos */
  substitui: Operacao[];
  totalDrones: number;
  totalFazendas: number;
  /** tempo com o drone no ar (KML), por drone, em min */
  tempoVoo?: (number | null)[];
}

/**
 * Remove (em cópia) os voos de um fechamento anterior do MESMO dia, MESMO turno e mesmos drones (regravar o
 * mesmo turno = correção). Voos de OUTRO turno do mesmo dia nunca são substituídos (ex.: 1º e 2º turno com o
 * mesmo drone).
 */
function semAnterior(ds: Dataset, f: FichaDia): { base: Dataset; antigas: Operacao[] } {
  const acs = new Set(f.drones.map((d) => d.aeronaveId));
  const datas = new Set([f.data, ...(f.substituiDia ? [f.substituiDia] : [])]);
  const antigas = ds.operacoes.filter((o) => !!o.fechamentoDia && datas.has(o.fechamentoDia) && acs.has(o.aeronaveId) && o.turnoId === f.turnoId);
  if (!antigas.length) return { base: ds, antigas };
  const ids = new Set(antigas.map((o) => o.id));
  return { base: { ...ds, operacoes: ds.operacoes.filter((o) => !ids.has(o.id)), paradas: ds.paradas.filter((p) => !ids.has(p.operacaoId)) }, antigas };
}

function validarClima(c: ClimaDia, erros: string[], avisos: string[]) {
  const t = (v: number | null, rot: string) => { if (v !== null && (v < -5 || v > 50)) erros.push(`${rot}: ${br(v, 1)} °C não é plausível.`); };
  const u = (v: number | null, rot: string) => { if (v !== null && (v < 0 || v > 100)) erros.push(`${rot}: ${br(v, 0)}% fora de 0–100.`); };
  t(c.tIni, 'Temperatura inicial'); t(c.tFim, 'Temperatura final'); u(c.urIni, 'Umidade inicial'); u(c.urFim, 'Umidade final');
  if (c.tFim !== null && c.tFim > 50 && c.urFim !== null && c.urFim <= 50) erros.push(`Temperatura final ${br(c.tFim, 0)} °C e umidade final ${br(c.urFim, 0)}%: parecem trocadas.`);
  if (c.tIni !== null && c.tIni > 50 && c.urIni !== null && c.urIni <= 50) erros.push(`Temperatura inicial ${br(c.tIni, 0)} °C e umidade inicial ${br(c.urIni, 0)}%: parecem trocadas.`);
  if ([c.tIni, c.urIni, c.vIni, c.tFim, c.urFim, c.vFim].every((v) => v === null)) avisos.push('Sem leituras de clima no dia.');
}

export function previaFechamento(dsOrig: Dataset, f: FichaDia, gerarId: (p: string) => string, agoraISO: string): PreviaFechamento {
  const erros: string[] = [], avisos: string[] = [];
  const { base: ds0, antigas } = semAnterior(dsOrig, f);
  const ds = comAdicoesNaOS(ds0, f);
  const nomeAc = (id: string) => ds.aeronaves.find((a) => a.id === id)?.identificacao ?? 'drone';
  const vazio: PreviaFechamento = { rateio: { m: [], estimada: [], erros: [], avisos: [] }, alvos: [], tempos: [], ops: [], paradas: [], erros, avisos, substitui: antigas, totalDrones: 0, totalFazendas: 0 };
  if (!f.data) erros.push('Informe a data.');
  if (!f.inicio || !f.fim) erros.push('Informe a hora inicial e final do dia.');
  if (!f.drones.length) erros.push('Adicione os drones do dia.');
  if (!f.fazendas.length) erros.push('Adicione as fazendas/OS do dia.');
  const acs = f.drones.map((d) => d.aeronaveId).filter(Boolean);
  if (new Set(acs).size !== acs.length) erros.push('O mesmo drone aparece duas vezes.');
  const oss = f.fazendas.map((x) => x.osId).filter(Boolean);
  if (new Set(oss).size !== oss.length) erros.push('A mesma OS aparece duas vezes.');
  f.drones.forEach((d, j) => {
    const rot = d.aeronaveId ? nomeAc(d.aeronaveId) : `Drone ${j + 1}`;
    if (!d.aeronaveId) erros.push(`${rot}: selecione a aeronave.`);
    if (!d.pilotoId) erros.push(`${rot}: selecione o piloto (cadastre o piloto padrão na aeronave para vir preenchido).`);
    if (!(d.area !== null && d.area > 0)) erros.push(`${rot}: informe a área aplicada.`);
  });
  f.fazendas.forEach((x, i) => { if (!x.osId) erros.push(`Fazenda ${i + 1}: escolha a OS.`); if (!(x.real !== null && x.real > 0)) erros.push(`Fazenda ${i + 1}: informe o real aplicado.`); });
  // volume de calda: o da fazenda, senão o do dia, senão o da OS
  for (const x of f.fazendas) {
    if (!x.osId) continue;
    const os = ds.ordens.find((o) => o.id === x.osId);
    const v = volumeCalda(f, x, os?.calda.volumeLHa);
    if (v !== null && v > 200) erros.push(`${ds.fazendas.find((z) => z.id === os?.fazendaId)?.nome ?? 'Fazenda'}: taxa de aplicação ${br(v, 1)} L/ha não é plausível para drone.`);
    if (!(v !== null && v > 0)) erros.push(`${ds.fazendas.find((z) => z.id === os?.fazendaId)?.nome ?? 'Fazenda'} (OS ${os?.numero ?? '?'}): informe a taxa de aplicação (L/ha) do dia.`);
  }
  validarClima(f.clima, erros, avisos);
  (f.kmlAvisos ?? []).forEach((a) => avisos.push(`KML: ${a}`));
  vazio.totalDrones = round(f.drones.reduce((s, d) => s + (d.area ?? 0), 0), 4);
  vazio.totalFazendas = round(f.fazendas.reduce((s, x) => s + (x.real ?? 0), 0), 4);
  if (erros.length) return vazio;

  // rateio
  const fixas = f.fazendas.map((x) => f.drones.map((d) => { const v = f.fixas[`${x.osId}|${d.aeronaveId}`]; return typeof v === 'number' ? v : null; }));
  const rateio = ratear(f.fazendas.map((x) => x.real!), f.drones.map((d) => d.area!), fixas, (j) => nomeAc(f.drones[j].aeronaveId));
  erros.push(...rateio.erros); avisos.push(...rateio.avisos);
  // talhões
  const alvos = f.fazendas.map((x) => {
    const a = alvoMedido(ds, f, x.osId, x.real!, x.concluir) ?? alvoDiaOS(ds, x.osId, x.real!, x.concluir, x.descontoEm);
    const os = ds.ordens.find((o) => o.id === x.osId);
    a.erros.forEach((e) => erros.push(`OS ${os?.numero ?? '?'}: ${e}`));
    return a;
  });
  // tempos
  const tempos = f.drones.map((d) => { const t = tempoDrone(f, d); if (typeof t === 'string') { erros.push(`${nomeAc(d.aeronaveId)}: ${t}`); return null; } return t; });
  const res: PreviaFechamento = { ...vazio, rateio, alvos, tempos };
  if (erros.length) return res;

  // boletim → operações (mesmas validações do registro de campo)
  const baseMin = hhmmParaMin(f.inicio)!;
  const relIni = (t: TempoDrone) => ((hhmmParaMin(t.inicio)! - baseMin + MIN_POR_DIA) % MIN_POR_DIA);
  const b: BoletimCampo = { versao: 1, data: f.data, turnoId: f.turnoId, liderId: f.liderId, campanhaId: ds.ordens.find((o) => o.id === f.fazendas[0].osId)?.campanhaId ?? '', responsavel: f.responsavel, drones: [], clima: [], observacoes: f.observacoes, };
  f.drones.forEach((d, j) => {
    const t = tempos[j]!;
    const cel = f.fazendas.map((_, i) => ({ i, area: rateio.m[i][j] })).filter((c) => c.area > 0);
    if (t.efetivo < cel.length) { erros.push(`${nomeAc(d.aeronaveId)}: tempo efetivo insuficiente para ${cel.length} trecho(s).`); return; }
    const tr = trechosDoDrone(t, cel.map((c) => c.area), baseMin, relIni(t));
    b.drones.push({
      chave: d.aeronaveId, aeronaveId: d.aeronaveId, pilotoId: d.pilotoId, auxiliarIds: [], estado: 'finalizado',
      trechos: cel.map((c, k) => {
        const x = f.fazendas[c.i];
        const alvo = alvos[c.i]!.porTalhao;
        const td = f.talhoesDrone?.[`${x.osId}|${d.aeronaveId}`];
        const itens = td ? Object.entries(td).filter(([, v]) => v > 0).map(([talhaoId, v]) => ({ talhaoId, areaHa: round(v, 4) })) : [...alvo.entries()].filter(([, v]) => v > 0).map(([talhaoId, v]) => ({ talhaoId, areaHa: round(c.area * v / x.real!, 4) }));
        const s = itens.reduce((a, it) => a + it.areaHa, 0);
        if (itens.length && !td) itens[itens.length - 1].areaHa = round(itens[itens.length - 1].areaHa + (c.area - s), 4);
        return { osId: x.osId, inicio: tr[k].inicio, fim: tr[k].fim, pausas: tr[k].pausas, itens };
      }),
    });
  });
  if (erros.length) return res;
  const leit = (momento: 'inicio' | 'fim', hora: string, t: number | null, u: number | null, v: number | null): LeituraClima | null =>
    t === null && u === null && v === null ? null : { momento, hora, temperaturaC: t, umidadePct: u, ventoKmh: v, rajadaKmh: null, direcaoVento: null, chuva: null, orvalho: null, origem: 'Ficha diária' };
  b.clima = [leit('inicio', f.inicio, f.clima.tIni, f.clima.urIni, f.clima.vIni), leit('fim', f.fim, f.clima.tFim, f.clima.urFim, f.clima.vFim)].filter((l): l is LeituraClima => !!l);
  const ctx = { hoje: f.data, areaTalhao: (id: string) => ds.talhoes.find((t) => t.id === id)?.areaHa ?? null, saldoItem: () => null, limites: ds.limites };
  // a calda das operações usa o volume informado no dia (a OS não é alterada)
  const dsV: Dataset = { ...ds, ordens: ds.ordens.map((o) => { const x = f.fazendas.find((z) => z.osId === o.id); if (!x) return o; const v = volumeCalda(f, x, o.calda.volumeLHa); return v && v !== o.calda.volumeLHa ? { ...o, calda: { ...o.calda, volumeLHa: v } } : o; }) };
  const r = fecharBoletim(JSON.parse(JSON.stringify(b)), dsV, criarIndices(dsV), ctx, gerarId, agoraISO);
  // mensagens do boletim citam "trecho n": troca pela OS do trecho e remove repetições
  const osDoTrecho = (msg: string) => msg.replace(/^(.+?) \(trecho (\d+)\):/, (_m, ac: string, n: string) => {
    const dr = b.drones.find((d) => nomeAc(d.aeronaveId) === ac); const t = dr?.trechos[Number(n) - 1];
    return `${ac} · OS ${ds.ordens.find((o) => o.id === t?.osId)?.numero ?? '?'}:`;
  });
  [...new Set(r.erros.map((e) => osDoTrecho(e.msg)))].forEach((m) => erros.push(m));
  [...new Set(r.avisos.map((a) => osDoTrecho(a.msg)))].forEach((m) => avisos.push(m));
  const algumaEstimada = rateio.estimada.some((l) => l.some(Boolean));
  const temKml = !!f.kml && Object.keys(f.kml).length > 0;
  for (const op of r.ops) {
    op.fechamentoDia = f.data;
    const k = f.kml?.[`${op.osId}|${op.aeronaveId}`];
    if (k) {
      const area = op.itens.reduce((s2, i) => s2 + i.areaHa, 0);
      op.voo = { origem: 'kml', cargas: k.cargas, tempoVooMin: k.tempoVooMin, volumeL: k.volumeL, taxaLHa: area > 0 ? round(k.volumeL / area, 2) : null, foraTaxa: k.foraTaxa, dividido: k.dividido };
      if (k.alturaM !== null) op.alturaVooM = k.alturaM;
      if (k.velocidadeMs !== null) op.velocidadeMs = k.velocidadeMs;
      if (k.faixaM !== null) op.faixaM = k.faixaM;
    }
    op.observacoesTecnicas = temKml
      ? `Fechamento do dia com KML de voo: área do drone por fazenda${k?.dividido ? ' (dividida entre OS vizinhas pelo real)' : ''}, cargas, tempo em voo, volume, altura, velocidade e espaçamento medidos. Horário de cada trecho e divisão por talhão estimados.`
      : `Fechamento do dia (ficha diária). ${algumaEstimada ? 'Área do drone por fazenda estimada por proporção (salvo células informadas); ' : ''}horário de cada trecho e divisão por talhão estimados.`;
  }
  const tempoVoo = f.drones.map((d) => { const vs = Object.entries(f.kml ?? {}).filter(([kk]) => kk.endsWith(`|${d.aeronaveId}`)); return vs.length ? round(vs.reduce((s2, [, m]) => s2 + m.tempoVooMin, 0), 1) : null; });
  f.drones.forEach((d, j) => { const tv = tempoVoo[j], t = tempos[j]; if (tv !== null && t && tv > t.efetivo + 5) avisos.push(`${nomeAc(d.aeronaveId)}: ${Math.round(tv)} min em voo no KML, mais que o tempo efetivo da ficha (${t.efetivo} min). Confira a janela e as paradas.`); });
  const outrosTurnos = dsOrig.operacoes.filter((o) => !!o.fechamentoDia && o.fechamentoDia === f.data && o.turnoId !== f.turnoId && f.drones.some((d) => d.aeronaveId === o.aeronaveId));
  if (outrosTurnos.length) avisos.push(`Já há ${outrosTurnos.length} voo(s) de outro turno em ${f.data.split('-').reverse().join('/')} com estes drones; eles são mantidos (este fechamento soma).`);
  if (antigas.length) avisos.push(`Substitui ${antigas.length} voo(s) do fechamento anterior de ${[...new Set(antigas.map((o) => o.fechamentoDia!))].map((d) => d.split('-').reverse().join('/')).join(' e ')}.`);
  return { ...res, ops: r.ops, paradas: r.paradas, tempoVoo };
}

/** Grava o fechamento (muta ds). Retorna erro ou null. */
export function gravarFechamento(ds: Dataset, f: FichaDia, gerarId: (p: string) => string, agoraISO: string): string | null {
  const p = previaFechamento(ds, f, gerarId, agoraISO);
  if (p.erros.length) return p.erros[0];
  const ids = new Set(p.substitui.map((o) => o.id));
  ds.operacoes = ds.operacoes.filter((o) => !ids.has(o.id));
  ds.paradas = ds.paradas.filter((x) => !ids.has(x.operacaoId));
  ds.operacoes.push(...p.ops);
  ds.paradas.push(...p.paradas);
  guardarAprendizadoKml(ds, f);
  for (const [osId, ts] of Object.entries(f.adicionarNaOS ?? {})) {
    const os = ds.ordens.find((o) => o.id === osId);
    if (!os) continue;
    for (const t of ts) if (!os.itens.some((i) => i.talhaoId === t)) {
      const tl = ds.talhoes.find((x) => x.id === t);
      os.itens.push({ talhaoId: t, areaPlanejadaHa: tl?.areaPlantadaHa ?? tl?.areaHa ?? 0 });
      registrar(ds, { entidade: 'ordem', entidadeId: os.id, acao: 'editar', resumo: `OS ${os.numero}: talhão ${tl?.codigo ?? '?'} adicionado (aplicado conforme o KML de voo)` });
    }
  }
  f.fazendas.forEach((x, i) => {
    if (!x.concluir) return;
    const os = ds.ordens.find((o) => o.id === x.osId);
    if (!os) return;
    os.concluidaManual = true;
    registrar(ds, { entidade: 'ordem', entidadeId: os.id, acao: 'concluir', resumo: `OS ${os.numero} concluída no fechamento de ${f.data.split('-').reverse().join('/')} · obstáculo ${br(p.alvos[i]?.obstaculo ?? 0)} ha` });
  });
  const area = p.ops.reduce((s, o) => s + o.itens.reduce((a, it) => a + it.areaHa, 0), 0);
  registrar(ds, { entidade: 'operacao', entidadeId: f.data, acao: p.substitui.length ? 'corrigir' : 'criar', resumo: `Fechamento do dia ${f.data.split('-').reverse().join('/')}: ${p.ops.length} voo(s), ${br(area)} ha (${f.drones.map((d) => `${ds.aeronaves.find((a) => a.id === d.aeronaveId)?.identificacao ?? ''} ${br(d.area ?? 0)}`).join(' + ')})`, antes: p.substitui.length ? p.substitui : undefined, depois: { voos: p.ops.map((o) => o.id) } });
  return null;
}

/**
 * Reaponta, entre os talhões da OS, a área dos voos que vieram do Fechamento do dia (divisão por
 * talhão estimada), para chegar ao `alvo` por talhão — por exemplo, ao indicar depois o talhão do
 * desconto. A área de cada voo NÃO muda (o total de cada drone se mantém); voos registrados talhão a
 * talhão e lançamentos antigos ficam como estão. Muta ds; retorna erro ou null.
 */
export function redistribuirEstimados(ds: Dataset, osId: string, alvo: Map<string, number>): string | null {
  const os = ds.ordens.find((o) => o.id === osId);
  if (!os) return 'OS não encontrada.';
  const est = ds.operacoes.filter((o) => o.osId === osId && o.fechamentoDia);
  const fixo = new Map<string, number>();
  for (const o of ds.operacoes) if (o.osId === osId && !o.fechamentoDia) for (const i of o.itens) fixo.set(i.talhaoId, (fixo.get(i.talhaoId) ?? 0) + i.areaHa);
  for (const l of ds.lancamentos ?? []) if (l.osId === osId) for (const i of l.itens) fixo.set(i.talhaoId, (fixo.get(i.talhaoId) ?? 0) + i.areaHa);
  const totEst = est.reduce((s, o) => s + o.itens.reduce((a, i) => a + i.areaHa, 0), 0);
  const alvoEst = new Map<string, number>();
  for (const it of os.itens) {
    const r = round((alvo.get(it.talhaoId) ?? 0) - (fixo.get(it.talhaoId) ?? 0), 4);
    if (r < -0.005) return `Talhão ${ds.talhoes.find((t) => t.id === it.talhaoId)?.codigo ?? ''}: já tem ${br(fixo.get(it.talhaoId) ?? 0)} ha em voos registrados talhão a talhão, acima do alvo ${br(alvo.get(it.talhaoId) ?? 0)} ha.`;
    if (r > 0.00005) alvoEst.set(it.talhaoId, r);
  }
  const somaAlvo = [...alvoEst.values()].reduce((a, b) => a + b, 0);
  if (Math.abs(somaAlvo - totEst) > 0.01) return `A área estimada dos voos (${br(totEst)} ha) não fecha com o alvo (${br(somaAlvo)} ha).`;
  if (!est.length) return null;
  const antes = est.map((o) => ({ id: o.id, itens: o.itens }));
  for (const o of est) {
    const a = o.itens.reduce((s, i) => s + i.areaHa, 0);
    const m = new Map([...alvoEst.entries()].map(([t, v]) => [t, round(a * v / somaAlvo, 4)]));
    o.itens = [...fecharSoma(m, round(a, 4)).entries()].filter(([, v]) => v > 0).map(([talhaoId, areaHa]) => ({ talhaoId, areaHa }));
  }
  registrar(ds, { entidade: 'ordem', entidadeId: osId, acao: 'editar', resumo: `OS ${os.numero}: divisão por talhão dos voos do fechamento ajustada (desconto indicado)`, antes, depois: est.map((o) => ({ id: o.id, itens: o.itens })) });
  return null;
}
