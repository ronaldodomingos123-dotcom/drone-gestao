/**
 * Importação por PDF da OS. O texto do PDF (linhas, com células separadas por TAB) é lido no aparelho
 * pelo motor de PDF; aqui ficam só as regras, testáveis sem navegador:
 *   - nº da OS e FN (do texto; na falta, do nome do arquivo "OS 3410 - FN 094-095.pdf");
 *   - tabela de talhões (cabeçalho com Talhão/Tn e Área/há; Zona, Fazenda/FN, ñ aplicado opcionais),
 *     inclusive repetida em várias páginas;
 *   - total declarado (linha TOTAL da tabela, "Área total", ou o cabeçalho do TRATAMENTO) e conferência
 *     com a soma dos talhões;
 *   - tratamento (produtos, doses, códigos) com o leitor já existente.
 * ATENÇÃO: layout calibrado com PDFs fictícios; deve ser conferido com uma OS real.
 */
import { round } from './calc';
import { normalizar, registrar, resolverUnidade } from './base';
import {
  acharProduto, classePorTipo, codificarNovo, gravarTalhoesOS, lerTalhoes, lerTratamento, limparGeraisSemUso, numeroBR,
  resolverProdutosNovos, type AcaoImportacao, type LeituraTratamento, type LinhaTalhao, type LinhaTalhaoOS,
} from './importacao';
import type { Calda, Dataset, TipoCampanha } from './types';

export interface DadosOSPdf {
  arquivo: string;
  os: string;
  fns: string[];
  fazendaNome: string;
  talhoes: LinhaTalhao[];
  totalDeclarado: number | null;
  origemTotal: string;
  somaTalhoes: number;
  volumeLHa: number | null;
  tratamento: LeituraTratamento;
  avisos: string[];
  erros: string[];
  semTexto: boolean;
}

const celulas = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}/)).map((c) => c.trim());
const ehCabecalhoTalhoes = (cs: string[]) => {
  const n = cs.map((c) => normalizar(c).replace(/[:.]$/, ''));
  return n.some((c) => /^(talh|tn$|tal$)/.test(c)) && n.some((c) => /^(area|ha|hectares)\b|^area \(ha\)$/.test(c));
};

function fnsDe(txt: string): string[] {
  return [...new Set((txt.match(/\d{1,4}/g) ?? []).map((x) => x.replace(/^0+(?=\d)/, '')))];
}

export function lerOSdoPdf(linhas: string[], arquivo: string, semTexto = false, caixas?: { x0: number; x1: number }[][]): DadosOSPdf {
  const avisos: string[] = [];
  const erros: string[] = [];
  const texto = linhas.join('\n');
  const plano = linhas.map((l) => l.replace(/\t/g, '  ')).join('\n');
  const vazio: DadosOSPdf = { arquivo, os: '', fns: [], fazendaNome: '', talhoes: [], totalDeclarado: null, origemTotal: '', somaTalhoes: 0, volumeLHa: null, tratamento: { nome: '', areaHa: null, itens: [], avisos: [] }, avisos, erros, semTexto };
  if (semTexto || texto.replace(/\s/g, '').length < 20) {
    erros.push('PDF sem texto (digitalizado/imagem). Não dá para ler sem OCR — use "Colar tabela" ou peça o PDF gerado pelo sistema.');
    return { ...vazio, semTexto: true };
  }
  // nº da OS
  const mOS = /ordem de servi[cç]o\s*(?:n[º°o]\.?|n[uú]mero)?\s*[:\-]?\s*(\d{3,7})\b/i.exec(plano)
    ?? /\bO\.?\s?S\.?\s*(?:n[º°o]\.?|n[uú]mero)?\s*[:\-]?\s*(\d{3,7})\b/.exec(plano)
    ?? /\bOS\s*[-_ ]?\s*(\d{3,7})\b/i.exec(arquivo);
  const os = mOS?.[1] ?? '';
  if (!os) erros.push('Não encontrei o número da OS no PDF nem no nome do arquivo.');
  // FN e nome da fazenda
  let fns: string[] = [];
  const mFN = /\bFN\s*[:\-]?\s*(\d{1,4}(?:\s*(?:[-/,;e]|a)\s*\d{1,4})*)/i.exec(plano);
  if (mFN) fns = fnsDe(mFN[1]);
  let fazendaNome = '';
  const mFaz = /\bfazenda\s*[:\-]\s*(?:(\d{1,4})\s*[-–]\s*)?([^\n\t]{2,60})/i.exec(plano.replace(/ {2,}/g, '\t'));
  if (mFaz) { if (mFaz[1] && !fns.length) fns = [mFaz[1].replace(/^0+(?=\d)/, '')]; fazendaNome = mFaz[2].trim(); }
  if (!fns.length) { const mf = /FN\s*([\d\s\-,e]+)/i.exec(arquivo); if (mf) fns = fnsDe(mf[1]); }

  // quadro "Zonas": "090 - Fazenda Jacinto I | 32,70" → fazenda identificada pela zona
  const zonas = new Map<string, { nome: string; area: number | null }>();
  for (const l of linhas) {
    const cs = celulas(l);
    cs.forEach((c, k) => {
      const mz = /^(\d{2,4})\s*[-–]\s*([A-Za-zÀ-ú].{1,60})$/.exec(c);
      if (mz && !/l\/ha|\bha\b/i.test(c)) zonas.set(mz[1].replace(/^0+(?=\d)/, ''), { nome: mz[2].trim(), area: numeroBR(cs[k + 1]) });
    });
  }
  if (zonas.size) fns = [...zonas.keys()];
  if (zonas.size === 1 && !fazendaNome) fazendaNome = [...zonas.values()][0].nome;

  // tabelas de talhões: depois do cabeçalho, TODAS as linhas seguintes do documento são examinadas
  // (a tabela pode passar do resumo de insumos, continuar na outra página e dividir linhas com a tabela
  // do tratamento ao lado). Com posições (PDF), cada valor vai para a coluna cujo centro está mais perto;
  // sem posições (texto corrigido à mão), usa a ordem das células.
  const blocos: string[][] = [];
  let totalTabela: number | null = null;
  interface Cab { nomes: string[]; n: string[]; iT: number; iA: number; iZ: number; iF: number; faixas: [number, number][] | null }
  let cab: Cab | null = null;
  let atual: string[][] = [];
  const fechar = () => {
    if (!cab || !atual.length) { atual = []; return; }
    const temFaz = cab.n.some((c) => /^(fn|faz|fazenda|cod|codigo|nome|propriedade)/.test(c));
    if (!temFaz) {
      if (zonas.size && cab.iZ >= 0) blocos.push([['FN', ...cab.nomes].join('\t'), ...atual.map((cs) => [cs[cab!.iZ] ?? '', ...cs].join('\t'))]);
      else if (fns.length === 1) blocos.push([['FN', ...cab.nomes].join('\t'), ...atual.map((cs) => [fns[0], ...cs].join('\t'))]);
      else erros.push(`Tabela de talhões sem coluna de fazenda e a OS tem ${fns.length || 'nenhuma'} FN identificada.`);
    } else blocos.push([cab.nomes.join('\t'), ...atual.map((cs) => cs.join('\t'))]);
    atual = [];
  };
  const ehCodigoTalhao = (c: string | undefined) => !!c && /^[\dA-Z]{1,6}$/i.test(c) && /\d/.test(c);
  const vistosTal = new Set<string>();
  for (let i = 0; i < linhas.length; i++) {
    const cs = celulas(linhas[i]);
    const bx = caixas?.[i];
    if (ehCabecalhoTalhoes(cs)) {
      fechar();
      const n = cs.map((c) => normalizar(c).replace(/[:.]$/, ''));
      // a tabela de talhões termina onde começa outra (ex.: "TRATAMENTO 1 - 32,7 HA", DOSE, TOTAL)
      let fimTab = n.findIndex((c, k) => k > 0 && (/^tratamento\s*\d+\s*[-–]|^dose$|^codigo$|^resumo/.test(c) || (/^total$/.test(c) && k > n.findIndex((x) => /^(talh|tn$|tal$)/.test(x)) + 2)));
      if (fimTab < 0) fimTab = cs.length;
      const nomes = cs.slice(0, fimTab); const nn = n.slice(0, fimTab);
      const iOS = nn.findIndex((c) => /^area ?(os|programada|a aplicar)$/.test(c));
      let faixas: [number, number][] | null = null;
      if (bx && bx.length === cs.length) {
        const cen = nomes.map((_, k) => (bx[k].x0 + bx[k].x1) / 2);
        faixas = cen.map((c, k) => {
          const esq = k > 0 ? (cen[k - 1] + c) / 2 : c - Math.max(12, (bx[k].x1 - bx[k].x0) / 2 + 12);
          const dir = k < cen.length - 1 ? (c + cen[k + 1]) / 2 : Math.min(c + Math.max(12, (bx[k].x1 - bx[k].x0) / 2 + 14), fimTab < cs.length ? bx[fimTab].x0 - 2 : Infinity);
          return [esq, dir];
        });
      }
      cab = { nomes, n: nn, iT: nn.findIndex((c) => /^(talh|tn$|tal$)/.test(c)), iA: iOS >= 0 ? iOS : nn.findIndex((c) => /^(area|ha|hectares)\b|^area \(ha\)$/.test(c)), iZ: nn.findIndex((c) => /^(zona|zn|zon)$/.test(c)), iF: nn.findIndex((c) => /^(fn|faz|fazenda)$/.test(c)), faixas };
      continue;
    }
    if (!cab) continue;
    // linha TOTAL da própria tabela (só quando não há posições, ou quando o número cai na coluna da área)
    if (/^(total|soma)\b/i.test(normalizar(cs[0] ?? ''))) {
      if (!atual.length) continue;
      const nums = (linhas[i].match(/\d{1,3}(?:\.\d{3})*,\d+|\d+[.,]\d+|\d+/g) ?? []).map((x) => numeroBR(x)).filter((x): x is number => x !== null);
      if (nums.length) totalTabela = (totalTabela ?? 0) + nums[nums.length - 1];
      continue;
    }
    // monta a linha nas colunas do cabeçalho
    let row: string[];
    if (cab.faixas && bx && bx.length === cs.length) {
      row = cab.nomes.map(() => '');
      cs.forEach((c, k) => {
        const m = (bx[k].x0 + bx[k].x1) / 2;
        const col = cab!.faixas!.findIndex(([e, d]) => m >= e && m < d);
        if (col >= 0) row[col] = row[col] ? `${row[col]} ${c}` : c;
      });
    } else row = cs.slice(0, cab.nomes.length);
    if (!ehCodigoTalhao(row[cab.iT]) || numeroBR(row[cab.iA]) === null) continue;
    if (zonas.size && cab.iZ >= 0 && !zonas.has((row[cab.iZ] ?? '').replace(/^0+(?=\d)/, ''))) continue;
    if (!zonas.size && cab.iF >= 0 && !/\d|[A-Za-z]{3}/.test(row[cab.iF] ?? '')) continue;
    const chave = `${cab.iZ >= 0 ? row[cab.iZ] : ''}|${cab.iF >= 0 ? row[cab.iF] : ''}|${row[cab.iT]}`;
    if (vistosTal.has(chave)) { avisos.push(`Talhão ${row[cab.iT]} aparece mais de uma vez no PDF — considerado uma vez.`); continue; }
    vistosTal.add(chave);
    atual.push(row);
  }
  fechar();
  const talhoes: LinhaTalhao[] = [];
  for (const b of blocos) talhoes.push(...lerTalhoes(b.join('\n')).linhas);
  // fazenda pela zona quando a OS traz o quadro "Zonas" (a coluna FN guarda outro código)
  if (zonas.size) for (const t of talhoes) {
    const z = zonas.get(t.zona);
    if (z) { if (t.fn && t.fn !== t.zona) t.fnOriginal = t.fn; t.fn = t.zona; t.fazenda = z.nome; }
  }
  talhoes.forEach((t) => { if (t.fn && !fns.includes(t.fn)) fns.push(t.fn); });
  // confere área por zona
  for (const [cod, z] of zonas) {
    const soma = talhoes.filter((t) => t.fn === cod && !t.erros.length).reduce((s2, t) => s2 + (t.area ?? 0), 0);
    if (z.area !== null && talhoes.length && Math.abs(soma - z.area) > 0.011) avisos.push(`Zona ${cod} (${z.nome}): talhões somam ${round(soma, 2)} ha, quadro "Zonas" diz ${round(z.area, 2)} ha.`);
  }
  const somaTalhoes = round(talhoes.filter((t) => !t.erros.length).reduce((s, t) => s + (t.area ?? 0), 0), 4);

  const tratamento = lerTratamento(texto);
  const mArea = /[áa]rea\s*(?:total|programada|a aplicar)(?!\s*d[oa]\s*kml)\s*(?:\(ha\))?\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d+|\d+[.,]?\d*)\s*(?:ha|há)?/i.exec(plano);
  let totalDeclarado: number | null = null; let origemTotal = '';
  if (totalTabela !== null) { totalDeclarado = round(totalTabela, 4); origemTotal = 'linha TOTAL da tabela'; }
  else if (mArea) { totalDeclarado = numeroBR(mArea[1]); origemTotal = '"Área total"'; }
  else if (tratamento.areaHa) { totalDeclarado = tratamento.areaHa; origemTotal = 'cabeçalho do tratamento'; }
  const mVol = /volume\s*(?:de\s*)?calda\s*[:\-]?\s*(\d+[.,]?\d*)\s*l\s*\/?\s*ha/i.exec(plano);

  if (!talhoes.length) avisos.push(totalDeclarado ? `Talhões não encontrados: a OS entra com talhão GERAL de ${round(totalDeclarado, 2)} ha.` : 'Não encontrei tabela de talhões nem área total.');
  if (!talhoes.length && !totalDeclarado) erros.push('Sem talhões e sem área total: nada para programar.');
  if (talhoes.length && totalDeclarado !== null && Math.abs(somaTalhoes - totalDeclarado) > 0.011) avisos.push(`Soma dos talhões (${round(somaTalhoes, 2)} ha) difere do total do PDF (${round(totalDeclarado, 2)} ha, ${origemTotal}).`);
  if (!fns.length) erros.push('Não encontrei a FN (fazenda) no PDF nem no nome do arquivo.');
  talhoes.forEach((t) => { t.erros.forEach((e) => erros.push(`Talhão ${t.talhao}: ${e}`)); t.avisos.forEach((a) => avisos.push(`Talhão ${t.talhao}: ${a}`)); });
  if (tratamento.itens.length) tratamento.avisos.forEach((a) => avisos.push(`Tratamento: ${a}`));
  return { arquivo, os, fns, fazendaNome, talhoes, totalDeclarado, origemTotal, somaTalhoes, volumeLHa: mVol ? numeroBR(mVol[1]) : null, tratamento, avisos, erros, semTexto: false };
}

export interface OpcoesImportacaoPdf {
  campanhaId: string;
  novaCampanha?: { nome: string; tipo: TipoCampanha; inicio: string; fim: string };
  unidadeId: string;
  usarTratamento: boolean;
  /** taxa de aplicação (volume de calda, L/ha) informada na importação: vale para todas as OS importadas */
  taxaLHa?: number | null;
}
export interface ResultadoImportacaoPdf { acoes: AcaoImportacao[]; erros: string[]; avisos: string[]; total: number; campanhaId: string }

/** Planeja (aplicar=false) ou grava (aplicar=true) as OS lidas dos PDFs. Nunca apaga aplicações. */
export function importarOSPdf(ds: Dataset, lista: DadosOSPdf[], o: OpcoesImportacaoPdf, gerarId: (p: string) => string, aplicar: boolean, hoje: string): ResultadoImportacaoPdf {
  const erros: string[] = []; const avisos: string[] = []; const acoes: AcaoImportacao[] = [];
  lista.forEach((d) => d.erros.forEach((e) => erros.push(`${d.arquivo}: ${e}`)));
  if (!o.campanhaId && !o.novaCampanha?.nome.trim()) erros.push('Escolha a campanha de destino ou informe o nome da nova campanha.');
  if (!lista.length) erros.push('Nenhum PDF lido.');
  if (erros.length) return { acoes, erros, avisos, total: 0, campanhaId: o.campanhaId };

  const alvo: Dataset = aplicar ? ds : JSON.parse(JSON.stringify(ds));
  let campanhaId = o.campanhaId;
  if (!campanhaId && o.novaCampanha) {
    campanhaId = gerarId('cp');
    alvo.campanhas.push({ id: campanhaId, nome: o.novaCampanha.nome.trim(), tipo: o.novaCampanha.tipo, cultura: 'Cana-de-açúcar', inicio: o.novaCampanha.inicio || hoje, fim: o.novaCampanha.fim || hoje });
  }
  const camp = alvo.campanhas.find((c) => c.id === campanhaId)!;
  const taxa = o.taxaLHa && o.taxaLHa > 0 ? o.taxaLHa : null;
  if (taxa !== null && taxa > 200) erros.push(`Taxa de aplicação ${String(taxa).replace('.', ',')} L/ha não é plausível para drone.`);
  if (taxa !== null) { camp.calda ??= { volumeLHa: taxa, produtos: [] }; camp.calda.volumeLHa = taxa; }
  let total = 0;
  let unidadeNovas: string | undefined;
  const vistos = new Map<string, string>(); // OS|FN → arquivo (mesmo PDF escolhido duas vezes)
  lista.forEach((d, k) => {
    const chaves = (d.fns.length ? d.fns : ['?']).map((f) => `${normalizar(d.os)}|${f}`);
    const rep = chaves.find((c) => vistos.has(c));
    if (rep) { avisos.push(`${d.arquivo}: repete a OS ${d.os} de "${vistos.get(rep)}" — ignorado.`); return; }
    chaves.forEach((c) => vistos.set(c, d.arquivo));
    // tratamento lido → calda
    let calda: Calda | null = null;
    if (o.usarTratamento && d.tratamento.itens.length) {
      calda = {
        tratamento: d.tratamento.nome || undefined,
        volumeLHa: taxa ?? d.volumeLHa ?? camp.calda?.volumeLHa ?? 0,
        produtos: d.tratamento.itens.map((i) => ({ produtoId: acharProduto(alvo, i.produto, i.codigo) ?? codificarNovo({ nome: i.produto, codigo: i.codigo, unidade: i.unidade }), dosePlanejada: i.dose, doseReal: null, unidade: i.unidade })),
      };
      resolverProdutosNovos(alvo, calda, classePorTipo(camp.tipo), gerarId);
      if (!(calda.volumeLHa > 0)) avisos.push(`${d.arquivo}: taxa de aplicação (L/ha) não encontrada no PDF — informe no campo "Taxa de aplicação".`);
      else if (taxa !== null && d.volumeLHa !== null && Math.abs(d.volumeLHa - taxa) > 0.001) avisos.push(`${d.arquivo}: o PDF diz ${String(d.volumeLHa).replace('.', ',')} L/ha; usada a taxa informada (${String(taxa).replace('.', ',')} L/ha).`);
      if (!camp.calda?.produtos.length) camp.calda = JSON.parse(JSON.stringify(calda));
    }
    // agrupa talhões por fazenda (FN ou nome)
    const grupos = new Map<string, { fn: string; nome: string; linhas: LinhaTalhao[] }>();
    for (const t of d.talhoes.filter((x) => !x.erros.length)) {
      const ch = t.fn || normalizar(t.fazenda);
      const g = grupos.get(ch) ?? { fn: t.fn, nome: t.fazenda, linhas: [] };
      g.linhas.push(t); grupos.set(ch, g);
    }
    if (!grupos.size && d.fns.length === 1 && d.totalDeclarado) grupos.set(d.fns[0], { fn: d.fns[0], nome: d.fazendaNome, linhas: [] });
    if (!grupos.size && d.fns.length > 1) { erros.push(`${d.arquivo}: OS com várias FN e sem tabela de talhões — não sei dividir a área.`); return; }
    for (const g of grupos.values()) {
      let fz = alvo.fazendas.find((f) => (g.fn && f.codigo && f.codigo.replace(/^0+/, '') === g.fn) || (!g.fn && normalizar(f.nome) === normalizar(g.nome)));
      let acao = '';
      if (!fz) {
        unidadeNovas ??= resolverUnidade(alvo, o.unidadeId, gerarId);
        fz = { id: gerarId('fz'), unidadeId: unidadeNovas, codigo: g.fn, nome: (g.nome || (d.fns.length === 1 ? d.fazendaNome : '') || `FN ${g.fn}`).trim(), municipio: '' };
        alvo.fazendas.push(fz); acao = 'Nova fazenda + ';
      }
      // talhões: reais da tabela, ou GERAL com o total
      let linhasOS: LinhaTalhaoOS[];
      if (g.linhas.length) linhasOS = g.linhas.map((t) => ({ zona: t.zona, codigo: t.talhao, areaHa: t.areaTalhao && t.areaTalhao > 0 ? t.areaTalhao : t.area!, areaOSHa: t.area!, naoAplicadoHa: t.naoAplicado, usar: true }));
      else {
        let geral = alvo.talhoes.find((t) => t.fazendaId === fz!.id && t.geral);
        if (!geral) { geral = { id: gerarId('tl'), fazendaId: fz.id, codigo: 'GERAL', areaHa: d.totalDeclarado!, geral: true }; alvo.talhoes.push(geral); } else geral.areaHa = Math.max(geral.areaHa, d.totalDeclarado!);
        linhasOS = [{ talhaoId: geral.id, zona: '', codigo: 'GERAL', areaHa: d.totalDeclarado!, naoAplicadoHa: 0, usar: true }];
      }
      const r = gravarTalhoesOS(alvo, fz.id, linhasOS, gerarId);
      if (r.erros.length) { r.erros.forEach((e) => erros.push(`${d.arquivo} (FN ${g.fn}): ${e}`)); continue; }
      let os = alvo.ordens.find((x) => x.campanhaId === campanhaId && x.fazendaId === fz!.id && normalizar(x.numero) === normalizar(d.os) && x.status !== 'cancelada');
      const area = round(r.itens.reduce((s, i) => s + i.areaPlanejadaHa, 0), 4);
      if (os) {
        const aplicados = new Set(alvo.operacoes.filter((op) => op.osId === os!.id).flatMap((op) => op.itens.map((i) => i.talhaoId)));
        const faltando = os.itens.filter((i) => aplicados.has(i.talhaoId) && !r.itens.some((n) => n.talhaoId === i.talhaoId));
        if (faltando.length) { os.itens = [...r.itens, ...faltando]; avisos.push(`${d.arquivo}: OS ${d.os} já tem aplicação em talhões que não estão no PDF — mantidos.`); } else os.itens = r.itens;
        if (calda) os.calda = JSON.parse(JSON.stringify(calda));
        acao += 'Atualiza OS existente';
      } else {
        const seq = Math.max(0, ...alvo.ordens.filter((x) => x.campanhaId === campanhaId && x.status !== 'cancelada').map((x) => x.sequencia ?? 0)) + 1;
        os = { id: gerarId('os'), numero: d.os, campanhaId, unidadeId: fz.unidadeId, fazendaId: fz.id, tipo: 'Pulverização', status: 'aberta', emissao: hoje, itens: r.itens, calda: JSON.parse(JSON.stringify(calda ?? camp.calda ?? { volumeLHa: 0, produtos: [] })), sequencia: seq, titulo: camp.tipo };
        alvo.ordens.push(os);
        acao += 'Nova OS (fim da sequência)';
      }
      limparGeraisSemUso(alvo, fz.id);
      total += area;
      acoes.push({ linha: k + 1, seq: os.sequencia ?? 0, fazenda: `${fz.codigo ? `${fz.codigo} · ` : ''}${fz.nome}`, os: os.numero, area: round(area, 2), acao: `${acao} · ${r.itens.length} talhão(ões)` });
    }
  });
  if (aplicar && !erros.length) registrar(ds, { entidade: 'base', entidadeId: campanhaId, acao: 'importar', resumo: `Importação de PDF: ${lista.length} arquivo(s), ${acoes.length} OS, ${round(total, 2)} ha.` });
  return { acoes, erros, avisos, total: round(total, 2), campanhaId };
}
