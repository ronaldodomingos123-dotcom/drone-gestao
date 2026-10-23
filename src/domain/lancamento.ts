/**
 * Área aplicada lançada na Sequência / importada da ficha diária, com o desconto (obstáculo) apontado
 * no talhão onde ele realmente ocorreu. Regras puras, testáveis.
 */
import { round } from './calc';
import { normalizar, registrar } from './base';
import { numeroBR } from './importacao';
import type { Dataset, ItemAplicado, LancamentoArea } from './types';

export interface TalhaoLanc { talhaoId: string; programado: number; voos: number }

/** Área já registrada por talhão desta OS: voos (operações) e lançamentos anteriores. */
export function situacaoOS(ds: Dataset, osId: string): { talhoes: TalhaoLanc[]; voos: number; lancado: number } {
  const os = ds.ordens.find((o) => o.id === osId);
  if (!os) return { talhoes: [], voos: 0, lancado: 0 };
  const voo = new Map<string, number>();
  for (const op of ds.operacoes) if (op.osId === osId) for (const i of op.itens) voo.set(i.talhaoId, (voo.get(i.talhaoId) ?? 0) + i.areaHa);
  const lancado = (ds.lancamentos ?? []).filter((l) => l.osId === osId).reduce((s, l) => s + l.itens.reduce((a, i) => a + i.areaHa, 0), 0);
  const talhoes = os.itens.map((i) => ({ talhaoId: i.talhaoId, programado: i.areaPlanejadaHa, voos: voo.get(i.talhaoId) ?? 0 }));
  return { talhoes, voos: talhoes.reduce((s, t) => s + t.voos, 0), lancado };
}

/**
 * Distribui o aplicado total: todos os talhões recebem o programado, exceto os marcados com desconto,
 * que absorvem a diferença (proporcional à área programada). Nunca abaixo do que já foi voado.
 */
export function distribuirDesconto(talhoes: TalhaoLanc[], aplicadoTotal: number, comDesconto: string[]): { aplicado: Map<string, number>; erros: string[] } {
  const erros: string[] = [];
  const aplicado = new Map(talhoes.map((t) => [t.talhaoId, t.programado]));
  const plan = talhoes.reduce((s, t) => s + t.programado, 0);
  const desconto = round(plan - aplicadoTotal, 4);
  if (!(aplicadoTotal >= 0)) { erros.push('Informe o aplicado total.'); return { aplicado, erros }; }
  if (desconto < -0.005) { erros.push(`Aplicado (${round(aplicadoTotal, 2)} ha) maior que o programado (${round(plan, 2)} ha).`); return { aplicado, erros }; }
  if (desconto <= 0.005) return { aplicado, erros };
  const marc = talhoes.filter((t) => comDesconto.includes(t.talhaoId));
  if (!marc.length) { erros.push(`Marque em qual talhão ficou o desconto de ${round(desconto, 2)} ha.`); return { aplicado, erros }; }
  // capacidade de cada talhão marcado = programado − já voado
  let resto = desconto;
  const cap = new Map(marc.map((t) => [t.talhaoId, Math.max(0, t.programado - t.voos)]));
  const capTotal = [...cap.values()].reduce((s, c) => s + c, 0);
  if (capTotal + 0.005 < desconto) { erros.push(`Os talhões marcados só comportam ${round(capTotal, 2)} ha de desconto (o resto já foi voado). Marque mais talhões.`); return { aplicado, erros }; }
  const pesoTotal = marc.reduce((s, t) => s + t.programado, 0);
  for (const t of marc) {
    const d = Math.min(cap.get(t.talhaoId)!, round(desconto * (t.programado / pesoTotal), 4));
    aplicado.set(t.talhaoId, round(t.programado - d, 4)); resto = round(resto - d, 4);
  }
  // sobra de arredondamento/capacidade: joga no talhão marcado com folga
  for (const t of marc) {
    if (resto <= 0.00005) break;
    const folga = aplicado.get(t.talhaoId)! - t.voos;
    const d = Math.min(folga, resto);
    aplicado.set(t.talhaoId, round(aplicado.get(t.talhaoId)! - d, 4)); resto = round(resto - d, 4);
  }
  return { aplicado, erros };
}

/**
 * Grava o aplicado da OS: substitui os lançamentos anteriores da OS por um novo com a diferença entre o
 * alvo de cada talhão e o que já foi voado. Muta ds. `concluir` marca a OS concluída (o que faltar vira
 * obstáculo). Retorna erro (string) ou null.
 */
export function gravarAplicadoOS(ds: Dataset, osId: string, alvo: Map<string, number>, data: string, origem: LancamentoArea['origem'], concluir: boolean, gerarId: (p: string) => string, observacao?: string): string | null {
  const os = ds.ordens.find((o) => o.id === osId);
  if (!os) return 'OS não encontrada.';
  const sit = situacaoOS(ds, osId);
  const itens: ItemAplicado[] = [];
  for (const t of sit.talhoes) {
    const a = alvo.get(t.talhaoId) ?? t.voos;
    if (a < t.voos - 0.005) return `Talhão: aplicado (${round(a, 2)} ha) menor que o já registrado nos voos (${round(t.voos, 2)} ha).`;
    if (a > t.programado + 0.005) return `Talhão: aplicado (${round(a, 2)} ha) maior que o programado (${round(t.programado, 2)} ha).`;
    const dif = round(a - t.voos, 4);
    if (dif > 0.00005) itens.push({ talhaoId: t.talhaoId, areaHa: dif });
  }
  const antes = (ds.lancamentos ?? []).filter((l) => l.osId === osId);
  ds.lancamentos = (ds.lancamentos ?? []).filter((l) => l.osId !== osId);
  let novo: LancamentoArea | undefined;
  if (itens.length) { novo = { id: gerarId('la'), data, osId, campanhaId: os.campanhaId, itens, origem, observacao, criadoEm: new Date().toISOString() }; ds.lancamentos.push(novo); }
  const total = round(sit.voos + itens.reduce((s, i) => s + i.areaHa, 0), 4);
  const plan = os.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0);
  const obst = round(Math.max(0, plan - total), 2);
  if (concluir) os.concluidaManual = true;
  const br = (x: number) => x.toFixed(2).replace('.', ',');
  registrar(ds, { entidade: 'lancamento', entidadeId: osId, acao: antes.length ? 'corrigir' : 'criar', resumo: `Aplicado ${os.numero}: ${br(total)} de ${br(plan)} ha (${origem === 'ficha_diaria' ? 'ficha diária' : 'lançado na sequência'})${concluir ? ` · concluída, obstáculo ${br(obst)} ha` : ''}`, antes, depois: novo });
  return null;
}

/** Linha da ficha diária: data (opcional), FN e/ou fazenda, área aplicada. */
export interface LinhaFicha { linha: number; data: string | null; fn: string; fazenda: string; area: number }

/**
 * Lê a ficha diária colada (do app de acompanhamento, planilha ou WhatsApp). Aceita linhas como:
 *   13/10/2026  090  Jacinto I  32,17
 *   Jacinto I - 32,17 ha
 *   FN 90 Jacinto I · T70 D 16,00 · T70 A 16,17 · Total 32,17   (usa o último número = total)
 * Ignora cabeçalhos, linhas de total geral e horários (18:20).
 */
export function lerFichaDiaria(texto: string, anoPadrao = new Date().getFullYear()): LinhaFicha[] {
  const out: LinhaFicha[] = [];
  let dataAtual: string | null = null;
  texto.replace(/\r/g, '').split('\n').forEach((bruta, i) => {
    let l = bruta.trim();
    if (!l) return;
    const md = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(l);
    if (md) {
      const ano = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : anoPadrao;
      dataAtual = `${ano}-${md[2].padStart(2, '0')}-${md[1].padStart(2, '0')}`;
      l = l.replace(md[0], ' ');
    }
    l = l.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/\b(T\d{2,3}\s*[A-Z]?)\b/gi, ' ');
    const n = normalizar(l);
    if (/^(total|acumulado|area total|realizado|soma)\b/.test(n)) return;
    const nums = [...l.matchAll(/\d{1,3}(?:\.\d{3})*,\d+|\d+[.,]\d+/g)];
    if (!nums.length) return;
    const area = numeroBR(nums[nums.length - 1][0]);
    if (area === null || area <= 0) return;
    let resto = l.slice(0, nums[0].index).replace(/[|;·\t]+/g, ' ').replace(/\b(fn|faz\.?|fazenda)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    let fn = '';
    const mfn = /^(\d{1,4})\b\s*[-–]?\s*/.exec(resto);
    if (mfn) { fn = mfn[1].replace(/^0+(?=\d)/, ''); resto = resto.slice(mfn[0].length).trim(); }
    resto = resto.replace(/[-–:]+$/, '').trim();
    if (!fn && !resto) return;
    out.push({ linha: i + 1, data: dataAtual, fn, fazenda: resto, area: round(area, 4) });
  });
  return out;
}

/** Linhas da ficha que pertencem à fazenda da OS (por FN ou nome). */
export function fichaDaOS(ds: Dataset, osId: string, linhas: LinhaFicha[]): LinhaFicha[] {
  const os = ds.ordens.find((o) => o.id === osId);
  const fz = os && ds.fazendas.find((f) => f.id === os.fazendaId);
  if (!fz) return [];
  const nome = normalizar(fz.nome).replace(/^(fazenda|sitio|faz)\s+/, '');
  return linhas.filter((l) => (l.fn && fz.codigo && l.fn === fz.codigo.replace(/^0+(?=\d)/, '')) || (!l.fn && l.fazenda && (normalizar(l.fazenda).replace(/^(fazenda|sitio|faz)\s+/, '') === nome)) || (l.fn && !fz.codigo && normalizar(l.fazenda).includes(nome)));
}
