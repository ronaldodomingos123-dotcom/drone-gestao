/**
 * Validação do registro de uma nova aplicação (formulário em 5 etapas).
 * Erros bloqueiam o avanço; avisos pedem conferência mas não bloqueiam.
 */
import { duracaoTotalMin, hhmmParaMin, MIN_POR_DIA, addDias, minParaHHMM } from './calc';
import type { CondicaoChuva, LeituraClima, LimitesClima, MotivoParada, UnidadeDose } from './types';

export interface ProdutoRascunho {
  produtoId: string;
  dosePlanejada: number | null;
  doseReal: number | null;
  unidade: UnidadeDose;
  lote: string;
  /** Apenas para a interface: filtra a lista de produtos pela classe. */
  classeFiltro?: string;
}

export interface ParadaRascunho {
  motivo: MotivoParada;
  inicio: string; // HH:MM
  fim: string; // HH:MM
  observacoes: string;
}

export interface RascunhoAplicacao {
  data: string;
  horaInicio: string;
  unidadeId: string;
  fazendaId: string;
  osId: string;
  campanhaId: string;
  cultura: string;
  turnoId: string;
  liderId: string;
  itens: { talhaoId: string; areaHa: number | null }[];
  aeronaveId: string;
  pilotoId: string;
  auxiliarIds: string[];
  equipamentosAuxiliares: string;
  volumeLHa: number | null;
  produtos: ProdutoRascunho[];
  velocidadeMs: number | null;
  alturaVooM: number | null;
  faixaM: number | null;
  observacoesTecnicas: string;
  clima: LeituraClima[];
  horaFim: string;
  tempoEfetivoMin: number | null;
  paradas: ParadaRascunho[];
  observacoesOperador: string;
  responsavelEncerramento: string;
}

export interface Mensagem { campo: string; msg: string }
export interface ResultadoValidacao { erros: Mensagem[]; avisos: Mensagem[] }

export interface ContextoValidacao {
  hoje: string; // AAAA-MM-DD
  areaTalhao: (talhaoId: string) => number | null;
  /** Área ainda não aplicada do item da OS (planejada − já aplicada). */
  saldoItem: (osId: string, talhaoId: string) => number | null;
  limites: LimitesClima;
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function validarEtapa1(r: RascunhoAplicacao, ctx: ContextoValidacao): ResultadoValidacao {
  const erros: Mensagem[] = [];
  const avisos: Mensagem[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.data)) erros.push({ campo: 'data', msg: 'Informe a data da operação.' });
  else if (r.data > ctx.hoje) erros.push({ campo: 'data', msg: 'A data não pode estar no futuro.' });
  if (hhmmParaMin(r.horaInicio) === null) erros.push({ campo: 'horaInicio', msg: 'Informe a hora de início (HH:MM).' });
  if (!r.turnoId) erros.push({ campo: 'turnoId', msg: 'Selecione o turno.' });
  if (!r.liderId) erros.push({ campo: 'liderId', msg: 'Selecione o líder do turno.' });
  if (!r.fazendaId) erros.push({ campo: 'fazendaId', msg: 'Selecione a fazenda.' });
  if (!r.osId) erros.push({ campo: 'osId', msg: 'Selecione a ordem de serviço.' });
  if (r.itens.length === 0) erros.push({ campo: 'itens', msg: 'Selecione ao menos um talhão da OS.' });
  const ids = r.itens.map((i) => i.talhaoId);
  if (new Set(ids).size !== ids.length) erros.push({ campo: 'itens', msg: 'Há talhões repetidos — a área seria contada duas vezes.' });
  return { erros, avisos };
}

export function validarEtapa2(r: RascunhoAplicacao): ResultadoValidacao {
  const erros: Mensagem[] = [];
  if (!r.aeronaveId) erros.push({ campo: 'aeronaveId', msg: 'Selecione a aeronave.' });
  if (!r.pilotoId) erros.push({ campo: 'pilotoId', msg: 'Selecione o operador responsável.' });
  if (r.auxiliarIds.includes(r.pilotoId)) erros.push({ campo: 'auxiliarIds', msg: 'O operador responsável não pode constar também como auxiliar.' });
  return { erros, avisos: [] };
}

export function validarEtapa3(r: RascunhoAplicacao, ctx: ContextoValidacao): ResultadoValidacao {
  const erros: Mensagem[] = [];
  const avisos: Mensagem[] = [];
  r.itens.forEach((it, i) => {
    const campo = `area_${i}`;
    if (!num(it.areaHa)) erros.push({ campo, msg: 'Informe a área aplicada no talhão.' });
    else if (it.areaHa < 0) erros.push({ campo, msg: 'A área não pode ser negativa.' });
    else if (it.areaHa === 0) erros.push({ campo, msg: 'Área zero: remova o talhão se não foi aplicado.' });
    else {
      const at = ctx.areaTalhao(it.talhaoId);
      if (at !== null && it.areaHa > at + 0.01) avisos.push({ campo, msg: `Área informada (${it.areaHa.toFixed(2)} ha) maior que a área do talhão (${at.toFixed(2)} ha). Confira.` });
      const saldo = ctx.saldoItem(r.osId, it.talhaoId);
      if (saldo !== null && it.areaHa > saldo + 0.01) avisos.push({ campo, msg: `Ultrapassa o saldo planejado da OS neste talhão (${Math.max(0, saldo).toFixed(2)} ha). Será sinalizado para conferência.` });
    }
  });
  if (!num(r.volumeLHa)) erros.push({ campo: 'volumeLHa', msg: 'Informe a taxa de aplicação (L/ha).' });
  else if (r.volumeLHa <= 0) erros.push({ campo: 'volumeLHa', msg: 'A taxa de aplicação (L/ha) deve ser maior que zero.' });
  if (r.produtos.length === 0) erros.push({ campo: 'produtos', msg: 'Inclua ao menos um produto na calda.' });
  const pids = r.produtos.map((p) => p.produtoId);
  if (new Set(pids).size !== pids.length) erros.push({ campo: 'produtos', msg: 'O mesmo produto foi incluído mais de uma vez.' });
  r.produtos.forEach((p, i) => {
    if (!p.produtoId) erros.push({ campo: `prod_${i}`, msg: 'Selecione o produto.' });
    if (!num(p.dosePlanejada) || p.dosePlanejada <= 0) erros.push({ campo: `prod_${i}`, msg: 'Informe a dose planejada (maior que zero).' });
    if (p.doseReal !== null && (!num(p.doseReal) || p.doseReal < 0)) erros.push({ campo: `prod_${i}`, msg: 'Dose utilizada inválida.' });
    if (num(p.dosePlanejada) && num(p.doseReal) && p.dosePlanejada > 0) {
      const d = ((p.doseReal - p.dosePlanejada) / p.dosePlanejada) * 100;
      if (Math.abs(d) > 10) avisos.push({ campo: `prod_${i}`, msg: `Dose utilizada difere ${d > 0 ? '+' : ''}${d.toFixed(1)}% da planejada.` });
    }
  });
  for (const [campo, v, rot] of [['velocidadeMs', r.velocidadeMs, 'Velocidade'], ['alturaVooM', r.alturaVooM, 'Altura de voo'], ['faixaM', r.faixaM, 'Faixa']] as const) {
    if (v !== null && (!num(v) || v <= 0)) erros.push({ campo, msg: `${rot}: informe um valor positivo ou deixe em branco.` });
  }
  return { erros, avisos };
}

/** Verifica uma leitura contra os limites configurados. Nunca declara a operação "segura". */
export function avaliarLeitura(l: LeituraClima, lim: LimitesClima): string[] {
  const foraDosLimites: string[] = [];
  if (num(l.ventoKmh) && l.ventoKmh > lim.ventoMaxKmh) foraDosLimites.push(`vento ${l.ventoKmh} km/h > ${lim.ventoMaxKmh}`);
  if (num(l.ventoKmh) && l.ventoKmh < lim.ventoMinKmh) foraDosLimites.push(`vento ${l.ventoKmh} km/h < ${lim.ventoMinKmh}`);
  if (num(l.rajadaKmh) && l.rajadaKmh > lim.ventoMaxKmh) foraDosLimites.push(`rajada ${l.rajadaKmh} km/h > ${lim.ventoMaxKmh}`);
  if (num(l.umidadePct) && l.umidadePct < lim.umidadeMinPct) foraDosLimites.push(`UR ${l.umidadePct}% < ${lim.umidadeMinPct}%`);
  if (num(l.temperaturaC) && l.temperaturaC > lim.temperaturaMaxC) foraDosLimites.push(`temperatura ${l.temperaturaC} °C > ${lim.temperaturaMaxC}`);
  if (l.chuva === 'chuva') foraDosLimites.push('chuva');
  if (l.orvalho === true) foraDosLimites.push('orvalho');
  return foraDosLimites;
}

export function validarEtapa4(r: RascunhoAplicacao, ctx: ContextoValidacao): ResultadoValidacao {
  const erros: Mensagem[] = [];
  const avisos: Mensagem[] = [];
  if (r.clima.length === 0) avisos.push({ campo: 'clima', msg: 'Nenhuma leitura climática registrada. Recomenda-se ao menos a leitura de início.' });
  r.clima.forEach((l, i) => {
    const campo = `clima_${i}`;
    if (hhmmParaMin(l.hora) === null) erros.push({ campo, msg: 'Informe o horário da medição.' });
    if (!l.origem.trim()) erros.push({ campo, msg: 'Informe a origem da informação (ex.: estação portátil).' });
    if (num(l.umidadePct) && (l.umidadePct < 0 || l.umidadePct > 100)) erros.push({ campo, msg: 'Umidade relativa deve estar entre 0 e 100%.' });
    if (num(l.ventoKmh) && l.ventoKmh < 0) erros.push({ campo, msg: 'Vento não pode ser negativo.' });
    if (num(l.rajadaKmh) && num(l.ventoKmh) && l.rajadaKmh < l.ventoKmh) avisos.push({ campo, msg: 'Rajada menor que o vento médio — confira.' });
    if (num(l.temperaturaC) && (l.temperaturaC < -10 || l.temperaturaC > 55)) erros.push({ campo, msg: 'Temperatura fora da faixa plausível.' });
    const fora = avaliarLeitura(l, ctx.limites);
    if (fora.length) avisos.push({ campo, msg: `Fora dos limites configurados: ${fora.join(', ')}.` });
  });
  return { erros, avisos };
}

/** Converte HH:MM em deslocamento (min) a partir do início da operação, tratando a virada do dia. */
export function deslocamentoMin(horaInicio: string, hhmm: string): number | null {
  const a = hhmmParaMin(horaInicio);
  const b = hhmmParaMin(hhmm);
  if (a === null || b === null) return null;
  return (b - a + MIN_POR_DIA) % MIN_POR_DIA;
}

/** Converte HH:MM de uma parada em ISO local, considerando a data de início e a virada do dia. */
export function paradaParaISO(data: string, horaInicioOp: string, hhmm: string): string {
  const a = hhmmParaMin(horaInicioOp) ?? 0;
  const b = hhmmParaMin(hhmm) ?? 0;
  const d = b < a ? addDias(data, 1) : data;
  return `${d}T${minParaHHMM(b)}`;
}

export function validarEtapa5(r: RascunhoAplicacao): ResultadoValidacao {
  const erros: Mensagem[] = [];
  const avisos: Mensagem[] = [];
  const total = duracaoTotalMin(r.horaInicio, r.horaFim);
  if (total === null) erros.push({ campo: 'horaFim', msg: 'Informe a hora de término (HH:MM).' });
  else if (total === 0) erros.push({ campo: 'horaFim', msg: 'Hora de término igual à de início.' });
  else if (total > 16 * 60) avisos.push({ campo: 'horaFim', msg: 'Operação com mais de 16 h — confira as horas (considerada virada de dia).' });

  let somaParadas = 0;
  r.paradas.forEach((p, i) => {
    const campo = `parada_${i}`;
    const a = deslocamentoMin(r.horaInicio, p.inicio);
    const b = deslocamentoMin(r.horaInicio, p.fim);
    if (a === null || b === null) { erros.push({ campo, msg: 'Informe início e fim da parada.' }); return; }
    if (b <= a) { erros.push({ campo, msg: 'O fim da parada deve ser após o início.' }); return; }
    if (total !== null && b > total) erros.push({ campo, msg: 'Parada fora do intervalo da operação.' });
    somaParadas += b - a;
  });
  // sobreposição de paradas
  const ints = r.paradas
    .map((p) => [deslocamentoMin(r.horaInicio, p.inicio), deslocamentoMin(r.horaInicio, p.fim)] as const)
    .filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null && x[1] > x[0])
    .sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ints.length; i++) if (ints[i][0] < ints[i - 1][1]) { erros.push({ campo: 'paradas', msg: 'Há paradas sobrepostas no tempo.' }); break; }

  if (!num(r.tempoEfetivoMin)) erros.push({ campo: 'tempoEfetivoMin', msg: 'Informe o tempo efetivo de aplicação.' });
  else if (r.tempoEfetivoMin <= 0) erros.push({ campo: 'tempoEfetivoMin', msg: 'O tempo efetivo deve ser maior que zero.' });
  else if (total !== null && r.tempoEfetivoMin + somaParadas > total) {
    erros.push({ campo: 'tempoEfetivoMin', msg: `Tempo efetivo (${r.tempoEfetivoMin} min) + paradas (${somaParadas} min) excede o tempo total (${total} min).` });
  }
  if (!r.responsavelEncerramento.trim()) erros.push({ campo: 'responsavelEncerramento', msg: 'Informe o responsável pelo encerramento.' });
  return { erros, avisos };
}

export function validarTudo(r: RascunhoAplicacao, ctx: ContextoValidacao): ResultadoValidacao {
  const partes = [validarEtapa1(r, ctx), validarEtapa2(r), validarEtapa3(r, ctx), validarEtapa4(r, ctx), validarEtapa5(r)];
  return { erros: partes.flatMap((p) => p.erros), avisos: partes.flatMap((p) => p.avisos) };
}

export const CONDICOES_CHUVA: CondicaoChuva[] = ['sem chuva', 'garoa', 'chuva'];
