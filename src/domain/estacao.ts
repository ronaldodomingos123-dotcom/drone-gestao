/**
 * Estações meteorológicas (importação do relatório da plataforma da estação — xlsx/csv).
 * Aceita o relatório DIÁRIO (uma linha por estação por dia: mín./média/máx.) e o relatório por
 * intervalo (horário/10-15 min: "Início" e "Fim" com hora). O diário vira CONTEXTO do dia da
 * aplicação; só o por intervalo descreve a condição no horário do voo.
 */
import { normalizar, registrar } from './base';
import { round } from './calc';
import type { Dataset, Operacao } from './types';

export interface EstacaoMet {
  id: string; // ID da plataforma
  nome: string; // texto original, ex.: "017 - Faz Santa Rita/Tnº 25 - PIC 25"
  pic: string; // "25"
  fn: string; // "17" (código da fazenda no nome)
  lat: number | null; lon: number | null;
  temVento: boolean;
}
export interface RegistroEstacao {
  estacaoId: string;
  inicio: string; // AAAA-MM-DD ou AAAA-MM-DDTHH:MM (hora local GMT-3)
  fim: string;
  diario: boolean;
  chuva: number | null; et0: number | null;
  tmin: number | null; tmed: number | null; tmax: number | null;
  urmin: number | null; urmed: number | null; urmax: number | null;
  pressao: number | null; vento: number | null; rajada: number | null; radiacao: number | null;
  inativa: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s || s === '-' || s === '—') return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** "15/10/2026" · "15/10/2026 13:00" · serial do Excel · ISO → AAAA-MM-DD[THH:MM] */
export function dataHora(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return v % 1 ? `${base}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : base;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    const base = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return m[4] ? `${base}T${m[4].padStart(2, '0')}:${m[5]}` : base;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (m) return m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export interface LeituraRelatorio { estacoes: EstacaoMet[]; registros: RegistroEstacao[]; avisos: string[]; erros: string[]; diario: boolean; periodo: { de: string; ate: string } | null }

/** Lê as linhas (já extraídas do xlsx/csv) do relatório da estação. */
export function lerRelatorioEstacao(linhas: unknown[][]): LeituraRelatorio {
  const avisos: string[] = []; const erros: string[] = [];
  // problemas agrupados por estação (um aviso por estação, não um por registro)
  const probPressao = new Map<string, { n: number; min: number; max: number }>(), probUR = new Map<string, { n: number; min: number; max: number }>();
  const contar = (m: Map<string, { n: number; min: number; max: number }>, k: string, v: number) => { const x = m.get(k) ?? { n: 0, min: v, max: v }; x.n++; x.min = Math.min(x.min, v); x.max = Math.max(x.max, v); m.set(k, x); };
  const faixa = (x: { min: number; max: number }) => (x.min === x.max ? String(x.min) : `${x.min}–${x.max}`).replace(/\./g, ',');
  const iCab = linhas.findIndex((l) => l.some((c) => /^pic$|esta[cç][aã]o/i.test(String(c ?? '').trim())) && l.some((c) => /^in[ií]cio/i.test(String(c ?? '').trim())));
  if (iCab < 0) return { estacoes: [], registros: [], avisos, erros: ['Cabeçalho não reconhecido: esperado colunas como "PIC", "Início", "Chuva", "Temp.", "Umidade".'], diario: true, periodo: null };
  const cab = linhas[iCab].map((c) => normalizar(String(c ?? '')).replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim());
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const c = {
    id: col(/^id$/), pic: col(/^pic$|^estacao$|^nome$/), lat: col(/^lat/), lon: col(/^lon/), ini: col(/^inicio/), fim: col(/^fim/), inativa: col(/inativ/),
    chuva: col(/^chuva|^precip/), et0: col(/^et.?0|^et₀|^eto/),
    tmin: col(/^temp\.? min/), tmed: col(/^temp\.? med|^temp\.?$|^temperatura$/), tmax: col(/^temp\.? max/),
    urmin: col(/^umidade min|^ur min/), urmed: col(/^umidade med|^umidade$|^ur med|^ur$/), urmax: col(/^umidade max|^ur max/),
    pres: col(/^press/), vento: col(/^vento med|^vento$|^velocidade do vento/), rajada: col(/^rajada/), rad: col(/^radia/),
  };
  if (c.pic < 0 || c.ini < 0) erros.push('Faltam as colunas da estação (PIC) ou de início.');
  const est = new Map<string, EstacaoMet>();
  const regs: RegistroEstacao[] = [];
  const g = (l: unknown[], i: number) => (i < 0 ? null : l[i]);
  for (const l of linhas.slice(iCab + 1)) {
    const nome = String(g(l, c.pic) ?? '').trim();
    const ini = dataHora(g(l, c.ini));
    if (!nome || !ini) continue;
    const id = String(g(l, c.id) ?? nome).trim();
    const pic = /PIC\s*0*(\d+)/i.exec(nome)?.[1] ?? '';
    const fn = /^\s*0*(\d{1,4})\s*[-–]/.exec(nome)?.[1] ?? '';
    const r: RegistroEstacao = {
      estacaoId: id, inicio: ini, fim: dataHora(g(l, c.fim)) ?? ini, diario: !ini.includes('T'),
      chuva: num(g(l, c.chuva)), et0: num(g(l, c.et0)), tmin: num(g(l, c.tmin)), tmed: num(g(l, c.tmed)), tmax: num(g(l, c.tmax)),
      urmin: num(g(l, c.urmin)), urmed: num(g(l, c.urmed)), urmax: num(g(l, c.urmax)), pressao: num(g(l, c.pres)),
      vento: num(g(l, c.vento)), rajada: num(g(l, c.rajada)), radiacao: num(g(l, c.rad)), inativa: /^s(im)?$/i.test(String(g(l, c.inativa) ?? '').trim()),
    };
    // relatório por intervalo traz um valor só: usa-o como médio/mín./máx. do intervalo
    if (!r.diario) { r.tmed ??= r.tmax ?? r.tmin; r.urmed ??= r.urmin ?? r.urmax; }
    regs.push(r);
    const e = est.get(id) ?? { id, nome, pic, fn, lat: num(g(l, c.lat)), lon: num(g(l, c.lon)), temVento: false };
    if (r.vento !== null || r.rajada !== null) e.temVento = true;
    est.set(id, e);
  }
  // qualidade: valores fisicamente implausíveis viram aviso (não são corrigidos)
  for (const r of regs) {
    const e = est.get(r.estacaoId)!;
    if (r.pressao !== null && (r.pressao < 850 || r.pressao > 1050)) contar(probPressao, e.nome, r.pressao);
    if (r.urmax !== null && r.urmax > 100) contar(probUR, e.nome, r.urmax);
  }
  const datas = regs.map((r) => r.inicio.slice(0, 10)).sort();
  if (!regs.length && !erros.length) erros.push('Nenhuma linha de dados reconhecida.');
  for (const [k, x] of probPressao) avisos.push(`${k}: pressão ${faixa(x)} hPa fora do plausível (850–1050) em ${x.n} registro(s) — conferir o sensor.`);
  for (const [k, x] of probUR) avisos.push(`${k}: umidade ${faixa(x)}% acima de 100 em ${x.n} registro(s).`);
  return { estacoes: [...est.values()], registros: regs, avisos: [...new Set(avisos)], erros, diario: regs.every((r) => r.diario), periodo: datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null };
}

/** Grava (substitui por estação+início — reimportar não duplica) e liga estação ↔ fazenda pelo código. */
export function importarEstacao(ds: Dataset, l: LeituraRelatorio): { estacoesNovas: number; registros: number; substituidos: number; fazendasLigadas: number } {
  ds.estacoes ??= []; ds.registrosEstacao ??= [];
  let estacoesNovas = 0;
  for (const e of l.estacoes) {
    const i = ds.estacoes.findIndex((x) => x.id === e.id);
    if (i < 0) { ds.estacoes.push(e); estacoesNovas++; } else ds.estacoes[i] = { ...ds.estacoes[i], ...e, temVento: ds.estacoes[i].temVento || e.temVento };
  }
  const chave = (r: RegistroEstacao) => `${r.estacaoId}|${r.inicio}`;
  const novas = new Set(l.registros.map(chave));
  const antes = ds.registrosEstacao.length;
  ds.registrosEstacao = ds.registrosEstacao.filter((r) => !novas.has(chave(r)));
  const substituidos = antes - ds.registrosEstacao.length;
  ds.registrosEstacao.push(...l.registros);
  ds.registrosEstacao.sort((a, b) => a.inicio.localeCompare(b.inicio));
  // fazenda sem estação: liga pelo código (FN) do nome da estação
  let fazendasLigadas = 0;
  for (const f of ds.fazendas) {
    if (f.estacaoId) continue;
    const e = ds.estacoes.find((x) => x.fn && f.codigo && x.fn === f.codigo.replace(/^0+(?=\d)/, ''));
    if (e) { f.estacaoId = e.id; fazendasLigadas++; }
  }
  registrar(ds, { entidade: 'base', entidadeId: 'estacao', acao: 'importar', resumo: `Estação meteorológica: ${l.registros.length} registro(s) de ${l.estacoes.length} estação(ões)${l.periodo ? ` (${l.periodo.de} a ${l.periodo.ate})` : ''}; ${fazendasLigadas} fazenda(s) ligada(s) pelo código.` });
  return { estacoesNovas, registros: l.registros.length, substituidos, fazendasLigadas };
}

/**
 * Temperatura de bulbo úmido (°C) por Stull (2011), J. Appl. Meteor. Climatol. 50:2267–2269.
 * Válida para UR 5–99% e T −20 a 50 °C, ao nível do mar (erro típico < 1 °C).
 */
export function bulboUmido(t: number, ur: number): number {
  return t * Math.atan(0.151977 * Math.sqrt(ur + 8.313659)) + Math.atan(t + ur) - Math.atan(ur - 1.676331) + 0.00391838 * ur ** 1.5 * Math.atan(0.023101 * ur) - 4.686035;
}
/** ΔT = T − Tbu (°C). null fora da faixa de validade da fórmula. */
export function deltaT(t: number | null, ur: number | null): number | null {
  if (t === null || ur === null || ur < 5 || ur > 99 || t < -20 || t > 50) return null;
  return round(t - bulboUmido(t, ur), 1);
}

export interface ContextoClima {
  estacao: EstacaoMet;
  diario: boolean;
  registros: RegistroEstacao[];
  chuva: number | null; tmin: number | null; tmax: number | null; urmin: number | null; urmax: number | null; vento: number | null; rajada: number | null;
  /** ΔT estimado na condição mais seca/quente (Tmáx com URmín) — pior hora provável do dia/intervalo */
  deltaTPior: number | null;
  alertas: string[];
}

/** Estação usada para a operação: a ligada à fazenda da OS. */
export function estacaoDaOperacao(ds: Dataset, op: Pick<Operacao, 'osId'>): EstacaoMet | null {
  const os = ds.ordens.find((o) => o.id === op.osId);
  const f = os && ds.fazendas.find((x) => x.id === os.fazendaId);
  return (f?.estacaoId && ds.estacoes?.find((e) => e.id === f.estacaoId)) || null;
}

/**
 * Contexto climático de uma operação: se houver registros por intervalo cobrindo o voo, usa o
 * intervalo do voo; senão, o resumo DIÁRIO da data (marcado como tal).
 */
export function contextoClima(ds: Dataset, op: Pick<Operacao, 'osId' | 'data' | 'horaInicio' | 'horaFim'>): ContextoClima | null {
  const e = estacaoDaOperacao(ds, op);
  if (!e) return null;
  const regs = (ds.registrosEstacao ?? []).filter((r) => r.estacaoId === e.id && !r.inativa);
  const ini = `${op.data}T${op.horaInicio}`;
  let fimOp = `${op.data}T${op.horaFim ?? op.horaInicio}`;
  if (op.horaFim && op.horaFim < op.horaInicio) { const d = new Date(`${op.data}T00:00Z`); d.setUTCDate(d.getUTCDate() + 1); fimOp = `${d.toISOString().slice(0, 10)}T${op.horaFim}`; }
  const intervalo = regs.filter((r) => !r.diario && r.fim > ini && r.inicio < fimOp);
  const usados = intervalo.length ? intervalo : regs.filter((r) => r.diario && r.inicio === op.data);
  if (!usados.length) return null;
  const vals = (k: keyof RegistroEstacao) => usados.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const mn = (k: keyof RegistroEstacao) => { const v = vals(k); return v.length ? Math.min(...v) : null; };
  const mx = (k: keyof RegistroEstacao) => { const v = vals(k); return v.length ? Math.max(...v) : null; };
  const soma = (k: keyof RegistroEstacao) => { const v = vals(k); return v.length ? round(v.reduce((a, b) => a + b, 0), 1) : null; };
  const diario = !intervalo.length;
  // extremos medidos (mín./máx. de cada registro); a média só entra se o arquivo não trouxer extremos
  const tmax = mx('tmax') ?? mx('tmed');
  const urmin = mn('urmin') ?? mn('urmed');
  const ctx: ContextoClima = {
    estacao: e, diario, registros: usados, chuva: soma('chuva'), tmin: mn('tmin') ?? mn('tmed'), tmax, urmin, urmax: mx('urmax') ?? mx('urmed'),
    vento: mx('vento'), rajada: mx('rajada'), deltaTPior: deltaT(tmax, urmin), alertas: [],
  };
  const lim = ds.limites;
  const quando = diario ? 'no dia' : 'durante o voo';
  if (ctx.chuva !== null && ctx.chuva > 0) ctx.alertas.push(`chuva ${quando}: ${String(ctx.chuva).replace('.', ',')} mm`);
  if (ctx.rajada !== null && ctx.rajada > lim.ventoMaxKmh) ctx.alertas.push(`rajada máx. ${quando} ${String(ctx.rajada).replace('.', ',')} km/h > ${lim.ventoMaxKmh}`);
  if (!diario && ctx.vento !== null && ctx.vento > lim.ventoMaxKmh) ctx.alertas.push(`vento ${String(ctx.vento).replace('.', ',')} km/h > ${lim.ventoMaxKmh}`);
  if (ctx.urmin !== null && ctx.urmin < lim.umidadeMinPct) ctx.alertas.push(`UR mín. ${quando} ${ctx.urmin}% < ${lim.umidadeMinPct}%`);
  if (ctx.tmax !== null && ctx.tmax > lim.temperaturaMaxC) ctx.alertas.push(`T máx. ${quando} ${String(ctx.tmax).replace('.', ',')} °C > ${lim.temperaturaMaxC}`);
  if (ctx.deltaTPior !== null && ctx.deltaTPior > 8) ctx.alertas.push(`ΔT estimado ${String(ctx.deltaTPior).replace('.', ',')} °C > 8 (evaporação alta)`);
  if (!e.temVento) ctx.alertas.push('estação sem sensor de vento');
  return ctx;
}

/** Texto curto do contexto (usado em tela e relatórios). */
export function resumoContexto(c: ContextoClima): string {
  const f = (v: number | null, d = 1) => (v === null ? '—' : v.toFixed(d).replace('.', ','));
  return `${c.diario ? 'Resumo do dia' : 'Durante o voo'} · PIC ${c.estacao.pic || c.estacao.id}: chuva ${f(c.chuva)} mm · T ${f(c.tmin)}–${f(c.tmax)} °C · UR ${f(c.urmin, 0)}–${f(c.urmax, 0)}% · vento ${f(c.vento)} km/h · rajada ${f(c.rajada)} km/h · ΔT pior ${f(c.deltaTPior)} °C`;
}

export const nomeCurtoEstacao = (e: EstacaoMet) => {
  const m = /^\s*(\d{1,4})\s*-\s*(.+?)\s*-\s*PIC\s*(\d+)/i.exec(e.nome);
  return m ? `PIC ${m[3]} · ${m[1]} ${m[2]}` : e.nome;
};
/** Busca estação por texto (PIC, código, nome). */
export function acharEstacao(ds: Dataset, t: string): EstacaoMet | undefined {
  const n = normalizar(t);
  return ds.estacoes?.find((e) => normalizar(e.nome).includes(n) || `pic ${e.pic}` === n || e.id === t);
}

export interface DiaEstacao { data: string; fonte: 'diario' | 'horario'; horas: number; chuva: number | null; tmin: number | null; tmax: number | null; urmin: number | null; urmax: number | null; vento: number | null; rajada: number | null }
/**
 * Um resumo por dia para a estação. Se houver o registro do relatório diário, ele é usado (é o total
 * oficial do dia); senão, agrega os registros horários (soma da chuva, extremos de T/UR, máximos de
 * vento/rajada). Nunca soma diário + horário do mesmo dia (evita contar a chuva em dobro).
 */
export function resumoDiario(ds: Dataset, estacaoId: string): DiaEstacao[] {
  const porDia = new Map<string, RegistroEstacao[]>();
  for (const r of ds.registrosEstacao ?? []) if (r.estacaoId === estacaoId && !r.inativa) { const d = r.inicio.slice(0, 10); (porDia.get(d) ?? porDia.set(d, []).get(d)!).push(r); }
  return [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, rs]) => {
    const dia = rs.find((r) => r.diario);
    const us = dia ? [dia] : rs.filter((r) => !r.diario);
    const v = (k: keyof RegistroEstacao, alt?: keyof RegistroEstacao) => { const a = us.map((r) => (r[k] ?? (alt ? r[alt] : null)) as number | null).filter((n): n is number => typeof n === 'number'); return a; };
    const mx = (a: number[]) => (a.length ? Math.max(...a) : null), mn = (a: number[]) => (a.length ? Math.min(...a) : null);
    const ch = v('chuva');
    return { data, fonte: dia ? 'diario' : 'horario', horas: dia ? 24 : us.length, chuva: ch.length ? round(ch.reduce((s, n) => s + n, 0), 1) : null, tmin: mn(v('tmin', 'tmed')), tmax: mx(v('tmax', 'tmed')), urmin: mn(v('urmin', 'urmed')), urmax: mx(v('urmax', 'urmed')), vento: mx(v('vento')), rajada: mx(v('rajada')) };
  });
}
