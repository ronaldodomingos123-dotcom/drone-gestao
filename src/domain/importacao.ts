/**
 * Importação por "colar do Excel" — mesmo formato da tabela de sequência usada no app atual:
 *   Sequência | Fazenda | O.S | Área | Título      (FN opcional, quando houver cabeçalho)
 * Aceita tab, ponto e vírgula ou vírgula; ignora cabeçalho e linhas de Total/Realizado;
 * entende OS com barra (ex.: 1234/1235) e área com ponto ou vírgula decimal.
 */
import { addDias, round } from './calc';
import { normalizar, referencias, registrar, resolverUnidade } from './base';
import type { Calda, ClasseProduto, Dataset, OrdemServico, TipoCampanha, UnidadeDose } from './types';

// ---------------- utilitários ----------------
/** "1.234,56" → 1234.56 · "214,39" → 214.39 · "214.39" → 214.39 · "1,234.5" → 1234.5 */
export function numeroBR(txt: string | undefined): number | null {
  if (txt === undefined) return null;
  let s = txt.replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const ultV = s.lastIndexOf(','), ultP = s.lastIndexOf('.');
  if (ultV >= 0 && ultP >= 0) {
    const dec = ultV > ultP ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (ultV >= 0) {
    s = s.replace(/,/g, (_m, i) => (i === ultV ? '.' : ''));
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\.(?=.*\.)/g, '');
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function separador(linhas: string[]): string {
  const amostra = linhas.slice(0, 10).join('\n');
  if (amostra.includes('\t')) return '\t';
  if (amostra.includes(';')) return ';';
  return ',';
}

function dividir(linha: string, sep: string): string[] {
  if (sep !== ',') return linha.split(sep).map((c) => c.trim());
  // vírgula como separador: respeita aspas ("214,39")
  const out: string[] = []; let atual = ''; let aspas = false;
  for (const ch of linha) {
    if (ch === '"') { aspas = !aspas; continue; }
    if (ch === ',' && !aspas) { out.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  out.push(atual.trim());
  return out;
}

const ehLinhaDeTotal = (cels: string[]) => cels.slice(0, 3).some((c) => /^(total|realizado|subtotal|soma)\b/.test(normalizar(c)));

// ---------------- sequência ----------------
export interface LinhaSequencia {
  linha: number; // nº da linha no texto colado
  sequencia: number | null;
  fn: string;
  fazenda: string;
  os: string;
  area: number | null;
  titulo: string;
  erros: string[];
}

export interface LeituraSequencia { linhas: LinhaSequencia[]; titulos: string[]; ignoradas: { linha: number; motivo: string }[]; colunas: string[] }

type Col = 'sequencia' | 'fn' | 'fazenda' | 'os' | 'area' | 'titulo';
const PADROES: [Col, RegExp][] = [
  ['sequencia', /^(seq|sequencia|ordem de aplicacao|prioridade|n[ºo°]?|#)$/],
  ['fn', /^(fn|faz|cod|codigo|cod fazenda|n fazenda|numero fazenda|n faz)\.?$/],
  ['fazenda', /^(fazenda|propriedade|nome|nome fazenda|local)$/],
  ['os', /^(o\.?\s?s\.?|os|ordem de servico|ordem)$/],
  ['area', /^(area|area \(ha\)|ha|hectares|area ha|area programada)$/],
  ['titulo', /^(titulo|produto|tipo|operacao|descricao|finalidade)$/],
];

export function lerSequencia(texto: string): LeituraSequencia {
  const brutas = texto.replace(/\r/g, '').split('\n');
  const sep = separador(brutas.filter((l) => l.trim()));
  const ignoradas: LeituraSequencia['ignoradas'] = [];
  let mapa: Partial<Record<Col, number>> | null = null;
  const linhas: LinhaSequencia[] = [];
  brutas.forEach((bruta, i) => {
    const n = i + 1;
    if (!bruta.trim()) return;
    const cels = dividir(bruta, sep);
    const norm = cels.map((c) => normalizar(c).replace(/[:.]$/, ''));
    // cabeçalho: contém "fazenda" e não tem área numérica
    if (!mapa && norm.some((c) => c === 'fazenda' || c === 'propriedade')) {
      mapa = {};
      norm.forEach((c, j) => { const p = PADROES.find(([, re]) => re.test(c)); if (p && mapa![p[0]] === undefined) mapa![p[0]] = j; });
      ignoradas.push({ linha: n, motivo: 'cabeçalho' });
      return;
    }
    if (ehLinhaDeTotal(cels)) { ignoradas.push({ linha: n, motivo: 'linha de total' }); return; }
    const m = mapa ?? { sequencia: 0, fazenda: 1, os: 2, area: 3, titulo: 4 }; // formato do app atual
    const get = (c: Col) => (m[c] === undefined ? '' : (cels[m[c]!] ?? '').trim());
    const l: LinhaSequencia = {
      linha: n,
      sequencia: numeroBR(get('sequencia')) === null ? null : Math.round(numeroBR(get('sequencia'))!),
      fn: get('fn').replace(/^0+(?=\d)/, ''),
      fazenda: get('fazenda'),
      os: get('os').replace(/\s+/g, ''),
      area: numeroBR(get('area')),
      titulo: get('titulo'),
      erros: [],
    };
    if (!l.fazenda) { ignoradas.push({ linha: n, motivo: 'sem nome de fazenda' }); return; }
    if (l.area === null) l.erros.push('área não reconhecida');
    else if (l.area <= 0) l.erros.push('área deve ser maior que zero');
    linhas.push(l);
  });
  const titulos = [...new Set(linhas.map((l) => l.titulo).filter(Boolean))];
  const colunas = mapa ? (Object.keys(mapa) as string[]) : ['sequencia', 'fazenda', 'os', 'area', 'titulo'];
  return { linhas, titulos, ignoradas, colunas };
}

export interface OpcoesImportacao {
  campanhaId: string; // existente, ou '' para criar nova
  novaCampanha?: { nome: string; tipo: TipoCampanha; inicio: string; fim: string };
  /** unidade das fazendas novas (opcional): '' · id · 'nova:<Nome>' */
  unidadeId: string;
  titulos: string[]; // títulos selecionados (vazio = todos)
  /** 'tabela' = sequência passa a ser a da tabela; 'manter' = OS existentes mantêm a ordem atual e as novas entram no fim. */
  ordem?: 'tabela' | 'manter';
  /** taxa de aplicação (volume de calda, L/ha) para a campanha e as OS importadas */
  taxaLHa?: number | null;
}

export interface AcaoImportacao { linha: number; seq: number; fazenda: string; os: string; area: number; acao: string; aviso?: string }
export interface ResultadoImportacao { acoes: AcaoImportacao[]; erros: string[]; avisos: string[]; total: number; campanhaId: string; criadas: { fazendas: number; ordens: number; talhoes: number }; atualizadas: number }

/**
 * Planeja (aplicar=false) ou executa (aplicar=true) a importação. Nunca exclui nada:
 * cria fazendas/OS que faltam, atualiza sequência/título/área de OS existentes e renumera 1..N.
 */
export function importarSequencia(ds: Dataset, lidas: LinhaSequencia[], o: OpcoesImportacao, gerarId: (p: string) => string, aplicar: boolean, hoje: string): ResultadoImportacao {
  const erros: string[] = [];
  const avisos: string[] = [];
  const acoes: AcaoImportacao[] = [];
  const criadas = { fazendas: 0, ordens: 0, talhoes: 0 };
  let atualizadas = 0;
  const filtradas = lidas.filter((l) => !o.titulos.length || o.titulos.includes(l.titulo));
  filtradas.forEach((l) => l.erros.forEach((e) => erros.push(`Linha ${l.linha} (${l.fazenda}): ${e}`)));
  if (!o.campanhaId && !o.novaCampanha?.nome.trim()) erros.push('Escolha a campanha de destino ou informe o nome da nova campanha.');
  if (!filtradas.length) erros.push('Nenhuma linha para importar com os títulos selecionados.');
  const chaves = filtradas.map((l) => `${normalizar(l.fazenda)}|${l.os}`);
  chaves.forEach((k, i) => { if (chaves.indexOf(k) !== i) erros.push(`Linha ${filtradas[i].linha}: fazenda e OS repetidas na tabela (${filtradas[i].fazenda} ${filtradas[i].os}).`); });

  // ordem: pela sequência informada; linhas sem sequência mantêm a ordem colada
  const ordenadas = filtradas.map((l, i) => ({ l, i })).sort((a, b) => (a.l.sequencia ?? 1e9 + a.i) - (b.l.sequencia ?? 1e9 + b.i) || a.i - b.i).map((x) => x.l);
  const total = round(ordenadas.reduce((s, l) => s + (l.area ?? 0), 0), 2);
  if (erros.length) return { acoes, erros, avisos, total, campanhaId: o.campanhaId, criadas, atualizadas };

  const alvo: Dataset = aplicar ? ds : JSON.parse(JSON.stringify(ds));
  let campanhaId = o.campanhaId;
  if (!campanhaId && o.novaCampanha) {
    campanhaId = gerarId('cp');
    alvo.campanhas.push({ id: campanhaId, nome: o.novaCampanha.nome.trim(), tipo: o.novaCampanha.tipo, cultura: 'Cana-de-açúcar', inicio: o.novaCampanha.inicio || hoje, fim: o.novaCampanha.fim || addDias(hoje, 60) });
  }
  const campanha = alvo.campanhas.find((c) => c.id === campanhaId)!;
  const unidadeNovas = filtradas.some((l) => !acharFazenda(alvo, l)) ? resolverUnidade(alvo, o.unidadeId, gerarId) : '';
  if (o.taxaLHa && o.taxaLHa > 0) { campanha.calda ??= { volumeLHa: o.taxaLHa, produtos: [] }; campanha.calda.volumeLHa = o.taxaLHa; }
  const caldaPadrao: Calda = JSON.parse(JSON.stringify(campanha.calda ?? alvo.ordens.find((x) => x.campanhaId === campanhaId)?.calda ?? { volumeLHa: 0, produtos: [] }));
  if (o.taxaLHa && o.taxaLHa > 0) caldaPadrao.volumeLHa = o.taxaLHa;
  if (!caldaPadrao.produtos.length) avisos.push('A campanha ainda não tem calda/produtos definidos. Defina em Cadastros → Campanhas antes de registrar aplicações.');

  const tocadas = new Set<string>();
  const idsAcao: string[] = [];
  const seqAntes = new Map(alvo.ordens.filter((x) => x.campanhaId === campanhaId && x.status !== 'cancelada').map((x) => [x.id, x.sequencia ?? 1e6]));
  ordenadas.forEach((l, idx) => {
    const seq = idx + 1;
    const area = round(l.area ?? 0, 2);
    let fz = acharFazenda(alvo, l);
    let acao = '';
    let aviso: string | undefined;
    if (!fz) {
      fz = { id: gerarId('fz'), unidadeId: unidadeNovas, codigo: l.fn, nome: l.fazenda.trim(), municipio: '' };
      alvo.fazendas.push(fz);
      criadas.fazendas++;
      acao = 'Nova fazenda + nova OS';
    } else if (l.fn && !fz.codigo) {
      fz.codigo = l.fn; // completa o FN que faltava
    }
    let os = alvo.ordens.find((x) => x.campanhaId === campanhaId && x.fazendaId === fz!.id && normalizar(x.numero) === normalizar(l.os || `PROG-${seq}`) && x.status !== 'cancelada');
    if (os) {
      const geral = os.itens.length === 1 && alvo.talhoes.find((t) => t.id === os!.itens[0].talhaoId)?.geral;
      const soma = os.itens.reduce((s, it) => s + it.areaPlanejadaHa, 0);
      if (geral) {
        os.itens[0].areaPlanejadaHa = area;
        const t = alvo.talhoes.find((x) => x.id === os!.itens[0].talhaoId)!;
        t.areaHa = Math.max(t.areaHa, area);
      } else if (Math.abs(soma - area) > 0.05) {
        aviso = `área da tabela (${area} ha) difere da soma dos talhões da OS (${round(soma, 2)} ha); mantida a dos talhões`;
        avisos.push(`${l.fazenda} ${os.numero}: ${aviso}.`);
      }
      os.sequencia = seq; os.titulo = l.titulo || os.titulo;
      atualizadas++;
      acao ||= 'Atualiza OS existente';
    } else {
      const talhoesFaz = alvo.talhoes.filter((t) => t.fazendaId === fz!.id && !t.geral);
      const somaFaz = talhoesFaz.reduce((s, t) => s + t.areaHa, 0);
      let itens: OrdemServico['itens'];
      if (talhoesFaz.length && Math.abs(somaFaz - area) <= 1) {
        itens = talhoesFaz.map((t) => ({ talhaoId: t.id, areaPlanejadaHa: t.areaHa }));
      } else {
        let geral = alvo.talhoes.find((t) => t.fazendaId === fz!.id && t.geral);
        if (!geral) { geral = { id: gerarId('tl'), fazendaId: fz!.id, codigo: 'GERAL', areaHa: area, geral: true }; alvo.talhoes.push(geral); criadas.talhoes++; }
        else geral.areaHa = Math.max(geral.areaHa, area);
        itens = [{ talhaoId: geral.id, areaPlanejadaHa: area }];
        if (talhoesFaz.length) { aviso = `fazenda tem ${talhoesFaz.length} talhões (${round(somaFaz, 2)} ha) que não somam a área programada; usado talhão geral — ajuste na OS`; avisos.push(`${l.fazenda}: ${aviso}.`); }
      }
      os = {
        id: gerarId('os'), numero: l.os || `PROG-${seq}`, campanhaId, unidadeId: fz.unidadeId, fazendaId: fz.id, tipo: 'Pulverização', status: 'aberta',
        emissao: hoje, itens, calda: JSON.parse(JSON.stringify(caldaPadrao)), sequencia: seq, titulo: l.titulo,
      };
      alvo.ordens.push(os);
      criadas.ordens++;
      acao ||= 'Nova OS';
    }
    tocadas.add(os.id);
    idsAcao.push(os.id);
    acoes.push({ linha: l.linha, seq, fazenda: `${fz.codigo ? `${fz.codigo} · ` : ''}${fz.nome}`, os: os.numero, area, acao, aviso });
  });
  const daCampanha = alvo.ordens.filter((x) => x.campanhaId === campanhaId && x.status !== 'cancelada');
  if (o.ordem === 'manter' && seqAntes.size) {
    // ordem atual preservada (inclusive ajustes manuais); OS novas entram no fim, na ordem da tabela
    const posTabela = new Map(idsAcao.map((id, i) => [id, i]));
    daCampanha.sort((a, b) => (seqAntes.get(a.id) ?? 1e7 + (posTabela.get(a.id) ?? 0)) - (seqAntes.get(b.id) ?? 1e7 + (posTabela.get(b.id) ?? 0)) || (a.sequencia ?? 0) - (b.sequencia ?? 0));
    daCampanha.forEach((x, i) => { x.sequencia = i + 1; });
    const seqDe = new Map(daCampanha.map((x) => [x.id, x.sequencia!]));
    acoes.forEach((a, i) => { a.seq = seqDe.get(idsAcao[i])!; });
    acoes.sort((a, b) => a.seq - b.seq);
    const novas = idsAcao.filter((id) => !seqAntes.has(id)).length;
    if (novas) avisos.push(`Ordem atual mantida: ${novas} OS nova(s) entram no fim da sequência.`);
  } else {
    // OS da campanha que não estão na tabela vão para o fim, preservando a ordem relativa
    const restantes = daCampanha.filter((x) => !tocadas.has(x.id)).sort((a, b) => (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9));
    restantes.forEach((x, i) => { x.sequencia = ordenadas.length + i + 1; });
    if (restantes.length) avisos.push(`${restantes.length} OS da campanha não estavam na tabela: mantidas, no fim da sequência.`);
  }

  if (aplicar) registrar(ds, { entidade: 'base', entidadeId: campanhaId, acao: 'importar', resumo: `Importação de sequência: ${acoes.length} linha(s), ${round(total, 2)} ha — ${criadas.fazendas} fazenda(s) e ${criadas.ordens} OS criadas, ${atualizadas} OS atualizada(s).` });
  return { acoes, erros, avisos, total, campanhaId, criadas, atualizadas };
}

function acharFazenda(ds: Dataset, l: { fn: string; fazenda: string }) {
  if (l.fn) { const f = ds.fazendas.find((x) => x.codigo && x.codigo.replace(/^0+/, '') === l.fn); if (f) return f; }
  const nm = normalizar(l.fazenda);
  return ds.fazendas.find((x) => normalizar(x.nome) === nm);
}

// ---------------- talhões ----------------
export interface LinhaTalhao { linha: number; fn: string; fazenda: string; zona: string; talhao: string; area: number | null; naoAplicado: number; real: number | null; erros: string[]; avisos: string[]; /** área total do talhão quando a tabela traz também a área da OS (AREA TN × AREA OS) */ areaTalhao?: number | null; /** código original da coluna FN quando a fazenda foi identificada pela zona */ fnOriginal?: string }

/**
 * Lê talhões colados do Excel. Formatos aceitos:
 *   com cabeçalho: Fazenda/FN · ZONA · Tn/Talhão · há · ñ aplicado · real  (ZONA, ñ aplicado e real opcionais)
 *   sem cabeçalho: Fazenda · Talhão · Área   ou   Fazenda · Zona · Talhão · Área · ñ aplicado · real
 * real = área − não aplicado (conferido quando as duas colunas vêm preenchidas).
 */
export function lerTalhoes(texto: string): { linhas: LinhaTalhao[]; ignoradas: { linha: number; motivo: string }[] } {
  const brutas = texto.replace(/\r/g, '').split('\n');
  const sep = separador(brutas.filter((l) => l.trim()));
  const ignoradas: { linha: number; motivo: string }[] = [];
  const linhas: LinhaTalhao[] = [];
  let mapa: Record<string, number> | null = null;
  brutas.forEach((bruta, i) => {
    const n = i + 1;
    if (!bruta.trim()) return;
    const cels = dividir(bruta, sep);
    const norm = cels.map((c) => normalizar(c).replace(/[:.]$/, ''));
    if (!mapa && norm.some((c) => /^(talh|tn$|tal$)/.test(c))) {
      mapa = {};
      norm.forEach((c, j) => {
        if (/^(fn|faz|cod|codigo)$/.test(c)) mapa!.fn ??= j;
        else if (/^(fazenda|faz\.? ?nome|nome da fazenda)$/.test(c)) mapa!.fazenda ??= j;
        else if (/^(nome|propriedade|descricao)$/.test(c)) mapa!.nome ??= j;
        else if (/^(zona|zn|zon)$|^zona/.test(c)) mapa!.zona ??= j;
        else if (/^area ?(os|programada|a aplicar|aplicar)$/.test(c)) mapa!.area = j;
        else if (/^area ?(tn|talhao|do talhao)$/.test(c)) mapa!.areaTalhao ??= j;
        else if (/^(talh|tn$|tal$)/.test(c)) mapa!.talhao ??= j;
        else if (/(n|nao) ?aplic|^desconto|^excluid/.test(c)) mapa!.nao ??= j;
        else if (/^(real|area real|aplicar|a aplicar|liquid)/.test(c)) mapa!.real ??= j;
        else if (/^(area|ha|hectares|area \(ha\)|area total)$/.test(c)) mapa!.area ??= j;
      });
      ignoradas.push({ linha: n, motivo: 'cabeçalho' });
      return;
    }
    if (ehLinhaDeTotal(cels)) { ignoradas.push({ linha: n, motivo: 'linha de total' }); return; }
    const m = mapa ?? (cels.length >= 4 ? { fazenda: 0, zona: 1, talhao: 2, area: 3, nao: 4, real: 5 } : { fazenda: 0, talhao: 1, area: 2 });
    const get = (c: string) => (m[c] === undefined ? '' : (cels[m[c]] ?? '').trim());
    let fn = get('fn'); let fazenda = get('fazenda');
    if (/^\d+$/.test(fazenda) && !fn) { fn = fazenda; fazenda = ''; }
    if (!fazenda && get('nome')) fazenda = get('nome');
    if (!fn && !fazenda && !get('talhao')) { ignoradas.push({ linha: n, motivo: 'linha sem fazenda/talhão (total?)' }); return; }
    const area = numeroBR(get('area'));
    const nao = numeroBR(get('nao')) ?? 0;
    const realInf = numeroBR(get('real'));
    const l: LinhaTalhao = { linha: n, fn: fn.replace(/^0+(?=\d)/, ''), fazenda, zona: get('zona').replace(/^0+(?=\d)/, ''), talhao: get('talhao').replace(/^0+(?=\d)/, '').padStart(3, '0'), area, naoAplicado: round(nao, 4), real: null, erros: [], avisos: [], ...(m.areaTalhao !== undefined ? { areaTalhao: numeroBR(get('areaTalhao')) } : {}) };
    if (!l.fn && !l.fazenda) { ignoradas.push({ linha: n, motivo: 'sem fazenda' }); return; }
    if (!get('talhao')) l.erros.push('sem código do talhão');
    if (area === null || area <= 0) l.erros.push('área inválida');
    if (nao < 0) l.erros.push('área não aplicada negativa');
    if (area !== null && nao > area) l.erros.push('área não aplicada maior que a do talhão');
    if (area !== null) {
      l.real = round(area - nao, 4);
      if (realInf !== null && Math.abs(realInf - l.real) > 0.011) l.avisos.push(`real informado ${realInf} ≠ área − não aplicado (${round(l.real, 2)}); usado ${round(l.real, 2)}`);
    }
    linhas.push(l);
  });
  return { linhas, ignoradas };
}

export interface ResultadoTalhoes { erros: string[]; avisos: string[]; criados: number; atualizados: number; osAjustadas: number; geraisRemovidos: number }

export function importarTalhoes(ds: Dataset, linhas: LinhaTalhao[], unidadeIdNovas: string, gerarId: (p: string) => string, aplicar: boolean): ResultadoTalhoes {
  const erros: string[] = []; const avisos: string[] = [];
  linhas.forEach((l) => l.erros.forEach((e) => erros.push(`Linha ${l.linha}: ${e}`)));
  const alvo: Dataset = aplicar ? ds : JSON.parse(JSON.stringify(ds));
  let criados = 0, atualizados = 0, osAjustadas = 0, geraisRemovidos = 0;
  const tocadas = new Set<string>();
  const naoPorTalhao = new Map<string, number>();
  let unidadeResolvida: string | undefined;
  linhas.forEach((l) => l.avisos.forEach((a) => avisos.push(`Linha ${l.linha}: ${a}`)));
  for (const l of linhas) {
    if (l.erros.length) continue;
    let fz = acharFazenda(alvo, { fn: l.fn, fazenda: l.fazenda });
    if (!fz) {
      if (!l.fazenda) { erros.push(`Linha ${l.linha}: fazenda FN ${l.fn} não cadastrada (informe o nome para criá-la).`); continue; }
      unidadeResolvida ??= resolverUnidade(alvo, unidadeIdNovas, gerarId);
      fz = { id: gerarId('fz'), unidadeId: unidadeResolvida, codigo: l.fn, nome: l.fazenda, municipio: '' };
      alvo.fazendas.push(fz);
    }
    tocadas.add(fz.id);
    const t = alvo.talhoes.find((x) => x.fazendaId === fz!.id && !x.geral && x.codigo.replace(/^0+/, '') === l.talhao.replace(/^0+/, ''));
    if (t) {
      if (Math.abs(t.areaHa - (l.area ?? 0)) > 0.001 || (l.zona && t.zona !== l.zona)) { t.areaHa = l.area!; if (l.zona) t.zona = l.zona; atualizados++; }
      if (l.naoAplicado) naoPorTalhao.set(t.id, l.naoAplicado);
    } else {
      const novo = { id: gerarId('tl'), fazendaId: fz.id, codigo: l.talhao, areaHa: l.area!, ...(l.zona ? { zona: l.zona } : {}) };
      alvo.talhoes.push(novo); criados++;
      if (l.naoAplicado) naoPorTalhao.set(novo.id, l.naoAplicado);
    }
  }
  // substitui o talhão geral pelos talhões reais quando a soma bate (±1 ha) e o geral ainda não foi aplicado
  for (const fid of tocadas) {
    const geral = alvo.talhoes.find((t) => t.fazendaId === fid && t.geral);
    if (!geral) continue;
    const reais = alvo.talhoes.filter((t) => t.fazendaId === fid && !t.geral);
    const somaReais = reais.reduce((s, t) => s + t.areaHa, 0);
    const usado = alvo.operacoes.some((o) => o.itens.some((i) => i.talhaoId === geral.id));
    const nomeF = alvo.fazendas.find((f) => f.id === fid)?.nome;
    for (const os of alvo.ordens.filter((o) => o.itens.length === 1 && o.itens[0].talhaoId === geral.id)) {
      if (!usado && Math.abs(os.itens[0].areaPlanejadaHa - somaReais) <= 1) {
        os.itens = reais.map((t) => { const nao = naoPorTalhao.get(t.id) ?? 0; return { talhaoId: t.id, areaPlanejadaHa: t.areaHa, ...(nao ? { naoAplicadoHa: nao } : {}) }; });
        osAjustadas++;
      } else {
        avisos.push(`${nomeF} ${os.numero}: mantido o talhão geral (${usado ? 'já tem aplicação registrada' : `programado ${os.itens[0].areaPlanejadaHa} ha ≠ talhões ${round(somaReais, 2)} ha`}). Ajuste os talhões na OS.`);
      }
    }
    if (referencias(alvo, 'talhao', geral.id).length === 0) { alvo.talhoes.splice(alvo.talhoes.indexOf(geral), 1); geraisRemovidos++; }
  }
  if (aplicar && !erros.length) registrar(ds, { entidade: 'base', entidadeId: 'talhoes', acao: 'importar', resumo: `Importação de talhões: ${criados} criado(s), ${atualizados} atualizado(s), ${osAjustadas} OS ajustada(s).` });
  return { erros, avisos, criados, atualizados, osAjustadas, geraisRemovidos };
}

/** Cria a lista de exemplo (para o botão "ver exemplo" do importador). */
export const EXEMPLO_SEQUENCIA = 'Sequência\tFazenda\tO.S\tÁrea\tTítulo\n1\tFazenda Exemplo A\t4101\t268,45\tMaturador\n2\tFazenda Exemplo B\t4102/4103\t79,36\tMaturador\n3\tFazenda Exemplo C\t4104\t181.31\tInseticida\nTotal\t\t\t529,12\t';

// ---------------- tratamento (conjunto de produtos com dose) ----------------
export interface ItemTratamento { codigo: string; produto: string; dose: number; unidade: UnidadeDose; total: number | null; conferido: boolean | null }
export interface LeituraTratamento { nome: string; areaHa: number | null; itens: ItemTratamento[]; avisos: string[] }

const UNIDADES_DOSE: Record<string, UnidadeDose> = { 'l/ha': 'L/ha', 'ml/ha': 'mL/ha', 'kg/ha': 'kg/ha', 'g/ha': 'g/ha' };
const IGNORAR = /^(dose|total|codigo|código|resumo de insumos|produto|produtos|insumo|insumos)$/i;

/**
 * Lê a tabela de tratamento no formato da OS:
 *   TRATAMENTO 1 - 64,4500 HA | DOSE | TOTAL
 *   AUREO | 0,0200 L/ha | 1,2890 L
 *   CODIGO | RESUMO DE INSUMOS | TOTAL
 *   21162 | AUREO | 1,2890 L
 *   ÁREA TOTAL | 64,45 ha
 * Aceita tab, ponto e vírgula, barra vertical ou espaços. Confere dose × área = total.
 */
export function lerTratamento(texto: string): LeituraTratamento {
  const avisos: string[] = [];
  let nome = '';
  let areaHa: number | null = null;
  const itens: ItemTratamento[] = [];
  const codigos = new Map<string, string>();
  let tratamentos = 0;
  const DOSE = /^([\d.,]+)\s*(l\/ha|ml\/ha|kg\/ha|g\/ha)$/i;
  const QTD = /^([\d.,]+)\s*(l|kg|ml|g)$/i;
  for (const bruta of texto.replace(/\r/g, '').split('\n')) {
    if (!bruta.trim()) continue;
    // cabeçalho "TRATAMENTO 1 - 64,4500 HA" (pode estar no meio da linha, ao lado de outra tabela)
    const mt = /(tratamento\s*\d*)\s*[-–]\s*([\d.,]+)\s*ha\b/i.exec(bruta);
    if (mt) {
      tratamentos++;
      if (tratamentos === 1) { nome = mt[1].trim().replace(/\s+/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()); areaHa = numeroBR(mt[2]); }
      continue;
    }
    const ln = normalizar(bruta.replace(/[\t|;]+/g, ' ').replace(/\s+/g, ' ').trim());
    const ma = /^area total\s+([\d.,]+)\s*ha/i.exec(ln);
    if (ma) { areaHa ??= numeroBR(ma[1]); continue; }
    if (bruta.includes('\t')) {
      // por células: o produto é a célula antes da dose (a linha pode trazer outra tabela à esquerda)
      const cs = bruta.split('\t').map((c) => c.trim()).filter(Boolean);
      const i = cs.findIndex((c) => DOSE.test(c));
      if (i > 0) {
        const md = DOSE.exec(cs[i])!;
        const dose = numeroBR(md[1]);
        const cod = i >= 2 && /^\d{3,7}$/.test(cs[i - 2]) ? cs[i - 2] : '';
        const tot = cs[i + 1] && QTD.test(cs[i + 1]) ? numeroBR(QTD.exec(cs[i + 1])![1]) : null;
        if (tratamentos <= 1 && dose !== null && !/^\d+([.,]\d+)?$/.test(cs[i - 1])) itens.push({ codigo: cod, produto: cs[i - 1], dose, unidade: UNIDADES_DOSE[md[2].toLowerCase()], total: tot, conferido: null });
        continue;
      }
      const j = cs.length >= 3 ? cs.length - 1 : -1;
      if (j > 0 && QTD.test(cs[j]) && /^\d{3,7}$/.test(cs[j - 2] ?? '') ) { codigos.set(normalizar(cs[j - 1]), cs[j - 2]); continue; }
      continue;
    }
    const l = bruta.replace(/[|;]+/g, '  ').replace(/\s+/g, ' ').trim();
    if (l.split(' ').every((w) => IGNORAR.test(w) || /^(de|-)$/i.test(w))) continue;
    const md = /^(?:(\d{3,7})\s+)?(.+?)\s+([\d.,]+)\s*(l\/ha|ml\/ha|kg\/ha|g\/ha)(?:\s+([\d.,]+)\s*(l|kg|ml|g)\b)?/i.exec(l);
    if (md) {
      const dose = numeroBR(md[3]);
      if (dose === null || tratamentos > 1) continue; // só o 1º tratamento vira calda
      itens.push({ codigo: md[1] ?? '', produto: md[2].trim(), dose, unidade: UNIDADES_DOSE[md[4].toLowerCase()], total: md[5] ? numeroBR(md[5]) : null, conferido: null });
      continue;
    }
    const mr = /^(\d{3,7})\s+(.+?)\s+([\d.,]+)\s*(l|kg|ml|g)\s*$/i.exec(l);
    if (mr) { codigos.set(normalizar(mr[2]), mr[1]); continue; }
  }
  if (tratamentos > 1) avisos.push(`A OS tem ${tratamentos} tratamentos; usado o ${nome || 'primeiro'} como calda — confira os demais.`);
  for (const it of itens) {
    if (!it.codigo) it.codigo = codigos.get(normalizar(it.produto)) ?? '';
    if (it.total !== null && areaHa) {
      const esperado = it.dose * areaHa / (it.unidade === 'mL/ha' || it.unidade === 'g/ha' ? 1000 : 1);
      it.conferido = Math.abs(esperado - it.total) <= Math.max(0.01, esperado * 0.001);
      if (!it.conferido) avisos.push(`${it.produto}: total ${it.total} não confere com dose × área (${round(esperado, 4)}).`);
    }
  }
  const nomes = itens.map((i) => normalizar(i.produto));
  nomes.forEach((n, i) => { if (nomes.indexOf(n) !== i) avisos.push(`${itens[i].produto} aparece mais de uma vez.`); });
  if (!itens.length && texto.trim()) avisos.push('Nenhuma linha com dose (ex.: "0,0200 L/ha") foi reconhecida.');
  return { nome, areaHa, itens, avisos };
}

/** Produto ainda não cadastrado, escolhido na calda (criado só ao salvar). */
export interface ProdutoNovo { nome: string; codigo: string; unidade: UnidadeDose }
export const PREFIXO_NOVO = 'novo:';
export const codificarNovo = (p: ProdutoNovo) => PREFIXO_NOVO + encodeURIComponent(JSON.stringify(p));
export const decodificarNovo = (id: string): ProdutoNovo | null => {
  if (!id.startsWith(PREFIXO_NOVO)) return null;
  try { return JSON.parse(decodeURIComponent(id.slice(PREFIXO_NOVO.length))) as ProdutoNovo; } catch { return null; }
};

/** Classe provisória de um produto criado a partir da calda: segue o tipo da campanha. */
export function classePorTipo(tipo: TipoCampanha | undefined): ClasseProduto {
  return tipo === 'Dessecação' ? 'Herbicida' : (tipo ?? 'Maturador') as ClasseProduto;
}

/** Procura produto já cadastrado: primeiro pelo código, depois pelo nome (sem acento/caixa). */
export function acharProduto(ds: Dataset, nome: string, codigo: string): string | null {
  if (codigo) { const p = ds.produtos.find((x) => x.codigo === codigo); if (p) return p.id; }
  const n = normalizar(nome);
  return ds.produtos.find((x) => normalizar(x.nome) === n)?.id ?? null;
}

/**
 * Troca os produtos "novos" da calda por produtos cadastrados (cria os que faltam) e completa o
 * código dos já existentes que ainda não tinham. Devolve os nomes criados. Muta ds e calda.
 */
export function resolverProdutosNovos(ds: Dataset, calda: Calda, classe: ClasseProduto, gerarId: (p: string) => string): string[] {
  const criados: string[] = [];
  for (const item of calda.produtos) {
    const novo = decodificarNovo(item.produtoId);
    if (!novo) continue;
    let id = acharProduto(ds, novo.nome, novo.codigo);
    if (!id) {
      id = gerarId('pr');
      const solido = novo.unidade === 'kg/ha' || novo.unidade === 'g/ha';
      ds.produtos.push({ id, nome: novo.nome, codigo: novo.codigo || undefined, classe, unidadeDose: novo.unidade, unidadeTotal: solido ? 'kg' : 'L' });
      registrar(ds, { entidade: 'produto', entidadeId: id, acao: 'criar', resumo: `Criado pela calda: ${novo.nome}${novo.codigo ? ` (cód. ${novo.codigo})` : ''}` });
      criados.push(novo.nome);
    } else {
      const p = ds.produtos.find((x) => x.id === id)!;
      if (!p.codigo && novo.codigo) p.codigo = novo.codigo;
    }
    item.produtoId = id;
  }
  return criados;
}

// ---------------- sequência livre ----------------
/**
 * Move uma OS para a posição informada (1..N) dentro da campanha e renumera 1..N.
 * Devolve a posição anterior e a nova (ou null se nada mudou).
 */
export function moverNaSequencia(ds: Dataset, campanhaId: string, osId: string, novaPosicao: number): { de: number; para: number } | null {
  const lista = ds.ordens.filter((x) => x.campanhaId === campanhaId && x.status !== 'cancelada')
    .sort((a, b) => (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
  const i = lista.findIndex((x) => x.id === osId);
  if (i < 0) return null;
  const para = Math.min(lista.length, Math.max(1, Math.round(novaPosicao)));
  if (!Number.isFinite(para)) return null;
  const [os] = lista.splice(i, 1);
  lista.splice(para - 1, 0, os);
  const mudou = lista.some((x, k) => x.sequencia !== k + 1);
  lista.forEach((x, k) => { x.sequencia = k + 1; });
  return mudou ? { de: i + 1, para } : null;
}

// ---------------- talhões da OS (editados na própria OS) ----------------
export interface LinhaTalhaoOS { talhaoId?: string; zona: string; codigo: string; areaHa: number; naoAplicadoHa: number; usar: boolean; /** área programada na OS quando menor que a do talhão (AREA OS); padrão = areaHa */ areaOSHa?: number }

/**
 * Grava os talhões editados na OS: cria os novos, atualiza zona/área dos existentes e devolve os itens
 * (área programada = área bruta do talhão; não aplicado = desconto previsto, informativo). Remove o talhão GERAL da fazenda quando ele deixa de ser usado.
 * Muta ds. Erros impedem a gravação (tudo ou nada via alterar()).
 */
export function gravarTalhoesOS(ds: Dataset, fazendaId: string, linhas: LinhaTalhaoOS[], gerarId: (p: string) => string): { itens: OrdemServico['itens']; erros: string[] } {
  const erros: string[] = [];
  const usadas = linhas.filter((l) => l.usar);
  const cods = usadas.map((l) => l.codigo.replace(/^0+(?=\d)/, '').toUpperCase());
  cods.forEach((c, i) => { if (cods.indexOf(c) !== i) erros.push(`Talhão ${usadas[i].codigo} aparece duas vezes.`); });
  usadas.forEach((l) => {
    if (!l.codigo.trim()) erros.push('Há talhão sem código.');
    if (!(l.areaHa > 0)) erros.push(`Talhão ${l.codigo}: área maior que zero.`);
    if (l.naoAplicadoHa < 0 || l.naoAplicadoHa >= l.areaHa) erros.push(`Talhão ${l.codigo}: área não aplicada deve ser ≥ 0 e menor que a área do talhão.`);
  });
  if (!usadas.length) erros.push('Marque ao menos um talhão.');
  if (erros.length) return { itens: [], erros };
  const itens: OrdemServico['itens'] = [];
  for (const l of usadas) {
    const codigo = /^\d+$/.test(l.codigo.trim()) ? l.codigo.trim().replace(/^0+(?=\d)/, '').padStart(3, '0') : l.codigo.trim().toUpperCase();
    let t = l.talhaoId ? ds.talhoes.find((x) => x.id === l.talhaoId) : ds.talhoes.find((x) => x.fazendaId === fazendaId && !x.geral && x.codigo.replace(/^0+/, '') === codigo.replace(/^0+/, ''));
    if (!t) {
      t = { id: gerarId('tl'), fazendaId, codigo, areaHa: round(l.areaHa, 4), ...(l.zona.trim() ? { zona: l.zona.trim() } : {}) };
      ds.talhoes.push(t);
      registrar(ds, { entidade: 'talhao', entidadeId: t.id, acao: 'criar', resumo: `Criado pela OS: talhão ${codigo}${t.zona ? ` (zona ${t.zona})` : ''} · ${round(l.areaHa, 2)} ha` });
    } else if (!t.geral && (Math.abs(t.areaHa - l.areaHa) > 0.0001 || (t.zona ?? '') !== l.zona.trim())) {
      const antes = { ...t };
      t.areaHa = round(l.areaHa, 4);
      if (l.zona.trim()) t.zona = l.zona.trim(); else delete t.zona;
      registrar(ds, { entidade: 'talhao', entidadeId: t.id, acao: 'editar', resumo: `Talhão ${t.codigo} atualizado pela OS`, antes, depois: { ...t } });
    }
    itens.push({ talhaoId: t.id, areaPlanejadaHa: round(l.areaOSHa && l.areaOSHa > 0 ? Math.min(l.areaOSHa, l.areaHa) : l.areaHa, 4), ...(l.naoAplicadoHa > 0 ? { naoAplicadoHa: round(l.naoAplicadoHa, 4) } : {}) });
  }
  return { itens, erros };
}

/** Remove talhões GERAL da fazenda que não são mais usados por nenhuma OS/operação. */
export function limparGeraisSemUso(ds: Dataset, fazendaId: string): number {
  let n = 0;
  for (const g of ds.talhoes.filter((t) => t.fazendaId === fazendaId && t.geral)) {
    if (referencias(ds, 'talhao', g.id).length === 0) { ds.talhoes.splice(ds.talhoes.indexOf(g), 1); n++; }
  }
  return n;
}

// ---------------- sequência geral (todas as campanhas) ----------------
/** OS ativas na ordem geral: quem já tem posição, pela posição; as sem posição vão para o fim (campanha mais antiga primeiro, depois a ordem da campanha). */
export function listaGeral(ds: Dataset): OrdemServico[] {
  const ini = new Map(ds.campanhas.map((c) => [c.id, c.inicio ?? '']));
  return ds.ordens.filter((o) => o.status !== 'cancelada').sort((a, b) =>
    (a.sequenciaGeral ?? 1e9) - (b.sequenciaGeral ?? 1e9)
    || (ini.get(a.campanhaId) ?? '').localeCompare(ini.get(b.campanhaId) ?? '')
    || a.campanhaId.localeCompare(b.campanhaId)
    || (a.sequencia ?? 1e9) - (b.sequencia ?? 1e9)
    || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

/** Numera 1..N a ordem geral (só muda o que precisa): OS nova ganha a última posição. Chamado a cada gravação. */
export function normalizarSequenciaGeral(ds: Dataset): void {
  listaGeral(ds).forEach((o, k) => { if (o.sequenciaGeral !== k + 1) o.sequenciaGeral = k + 1; });
}

/** Leva a OS para a posição informada na ordem geral e renumera. */
export function moverNaSequenciaGeral(ds: Dataset, osId: string, novaPosicao: number): { de: number; para: number } | null {
  const lista = listaGeral(ds);
  const i = lista.findIndex((x) => x.id === osId);
  if (i < 0) return null;
  const para = Math.min(lista.length, Math.max(1, Math.round(novaPosicao)));
  if (!Number.isFinite(para)) return null;
  const [os] = lista.splice(i, 1);
  lista.splice(para - 1, 0, os);
  const mudou = lista.some((x, k) => x.sequenciaGeral !== k + 1);
  lista.forEach((x, k) => { x.sequenciaGeral = k + 1; });
  return mudou ? { de: i + 1, para } : null;
}
