/**
 * Análise de produtividade e indicadores comparativos (Fase 3): período A (filtros) × período B.
 */
import { compararPor, indicadoresPeriodo, periodoB, variacao, type Dimensao, type IndicadoresPeriodo, type ModoComparacao } from '../domain/comparativo';
import { descreverFiltros, formatarValor, type Relatorio, type TipoCol } from '../domain/relatorios';
import { PREFIXO } from '../data/repository';
import { estado, nome, redesenhar, salvarFiltros } from '../state';
import { aviso, barraFiltros, cabecalhoPagina } from '../ui/components';
import { addDias } from '../domain/calc';
import { barrasH, CORES, legenda } from '../ui/charts';
import { esc, fmtData } from '../ui/dom';
import { botoesExportar, exportarRelatorio, responsavelAtual } from './relatorios';

const CHAVE = `${PREFIXO}analise`;
let modo: ModoComparacao = 'anterior';
let livre = { de: '', ate: '' };
let dim: Dimensao = 'aeronaveId';

const DIMS: [Dimensao, string][] = [['aeronaveId', 'Aeronave'], ['pilotoId', 'Piloto'], ['turnoId', 'Turno'], ['fazenda', 'Fazenda']];
const rotDim = (d: Dimensao, id: string) => (d === 'aeronaveId' ? nome.aeronave(id) : d === 'pilotoId' ? nome.colaborador(id) : d === 'turnoId' ? nome.turno(id) : nome.fazenda(id));

const LINHAS: { rot: string; k: keyof IndicadoresPeriodo; tipo: TipoCol; melhor: 'maior' | 'menor' | null; dica?: string }[] = [
  { rot: 'Área aplicada (ha)', k: 'area', tipo: 'ha', melhor: 'maior' },
  { rot: 'Dias com aplicação', k: 'dias', tipo: 'int', melhor: null },
  { rot: 'Média por dia aplicado (ha)', k: 'haPorDia', tipo: 'ha', melhor: 'maior' },
  { rot: '% da meta do período', k: 'pctMeta', tipo: 'pct', melhor: 'maior' },
  { rot: 'ha/h efetivo', k: 'prodEfetiva', tipo: 'hah', melhor: 'maior', dica: 'área com voo ÷ horas efetivas' },
  { rot: 'ha/h efetivo × meta por drone', k: 'pctMetaHaH', tipo: 'pct', melhor: 'maior' },
  { rot: 'ha/h operacional', k: 'prodOperacional', tipo: 'hah', melhor: 'maior', dica: 'área com voo ÷ horas totais' },
  { rot: 'Eficiência (efetivo ÷ total)', k: 'eficiencia', tipo: 'pct', melhor: 'maior' },
  { rot: 'Horas efetivas', k: 'minEfetivo', tipo: 'min', melhor: null },
  { rot: 'Horas totais', k: 'minTotal', tipo: 'min', melhor: null },
  { rot: 'Tempo parado', k: 'minParado', tipo: 'min', melhor: 'menor' },
  { rot: '% do tempo parado', k: 'pctParado', tipo: 'pct', melhor: 'menor' },
  { rot: '% parado por clima', k: 'pctParadoClima', tipo: 'pct', melhor: 'menor' },
  { rot: 'Operações', k: 'ops', tipo: 'int', melhor: null },
  { rot: 'Impedidas por clima', k: 'impedidas', tipo: 'int', melhor: 'menor' },
];

function calcular() {
  const { ds, idx, filtros: fA } = estado;
  const pB = periodoB(fA, modo, livre);
  const fB = { ...fA, ...pB };
  return { fA, fB, A: indicadoresPeriodo(ds, fA, idx), B: indicadoresPeriodo(ds, fB, idx), quebra: compararPor(ds, fA, fB, idx, dim, rotDim) };
}

export function renderAnalise(raiz: HTMLElement) {
  try { const s = JSON.parse(localStorage.getItem(CHAVE) ?? 'null'); if (s) { modo = s.modo ?? modo; dim = s.dim ?? dim; livre = s.livre ?? livre; } } catch { /* opcional */ }
  raiz.innerHTML = `${cabecalhoPagina('Análise de produtividade', 'Indicadores comparativos: período A (filtros) × período B, no total e por aeronave, piloto, turno ou fazenda.')}
    <div id="an-filtros"></div>
    <section class="cartao rel-barra">
      <label class="f-campo"><span>Período A rápido</span><select data-k="rapido"><option value="">Usar o filtro De/Até</option><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <label class="f-campo"><span>Comparar com (período B)</span><select data-k="modo">
        <option value="anterior">Período anterior (mesma duração)</option><option value="semana">Mesmo período, semana anterior</option><option value="ano">Mesmo período, ano anterior</option><option value="livre">Escolher datas…</option></select></label>
      <label class="f-campo an-livre"><span>B de</span><input type="date" data-k="de" value="${esc(livre.de)}"></label>
      <label class="f-campo an-livre"><span>B até</span><input type="date" data-k="ate" value="${esc(livre.ate)}"></label>
      <label class="f-campo"><span>Quebrar por</span><select data-k="dim">${DIMS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      ${botoesExportar()}
    </section>
    <div id="an-corpo"></div>`;
  const corpo = raiz.querySelector('#an-corpo') as HTMLElement;
  (raiz.querySelector('[data-k="modo"]') as HTMLSelectElement).value = modo;
  (raiz.querySelector('[data-k="dim"]') as HTMLSelectElement).value = dim;
  const desenhar = () => {
    try { localStorage.setItem(CHAVE, JSON.stringify({ modo, dim, livre })); } catch { /* opcional */ }
    raiz.querySelectorAll<HTMLElement>('.an-livre').forEach((e) => { e.style.display = modo === 'livre' ? '' : 'none'; });
    const { fB, A, B, quebra } = calcular();
    const per = (x: { de: string; ate: string }) => `${fmtData(x.de)} a ${fmtData(x.ate)}`;
    const seta = (va: number | null, vb: number | null, melhor: 'maior' | 'menor' | null) => {
      const v = variacao(va, vb);
      if (v === null) return '<span class="muted">—</span>';
      const bom = melhor === null ? null : (melhor === 'maior' ? v > 0 : v < 0);
      return `<span class="an-var ${bom === null || Math.abs(v) < 0.05 ? '' : bom ? 'bom' : 'ruim'}">${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${esc(formatarValor(Math.abs(v), 'pct'))}</span>`;
    };
    const nomeDim = DIMS.find(([d]) => d === dim)![1];
    const semB = B.ops === 0 && B.area === 0;
    corpo.innerHTML = `${semB ? aviso('atencao', `<b>Período B (${esc(per(fB))}) sem registros.</b> O período A provavelmente cobre todos os dados. Use "Período A rápido" (ex.: últimos 14 dias × 14 anteriores) ou escolha as datas de B.`) : ''}
      <section class="cartao">
        <div class="an-per"><span class="an-a">A</span> ${esc(per(A))}<span class="an-b">B</span> ${esc(per(fB))}</div>
        <div class="tabela-rolagem"><table class="tabela tabela-simples an-t"><thead><tr><th>Indicador</th><th class="dir">A</th><th class="dir">B</th><th class="dir">Diferença</th><th class="dir">Variação</th></tr></thead><tbody>
        ${LINHAS.map((l) => { const a = A[l.k] as number | null, b = B[l.k] as number | null; const dif = a === null || b === null ? null : a - b; return `<tr><td>${esc(l.rot)}${l.dica ? `<small class="bloco muted">${esc(l.dica)}</small>` : ''}</td><td class="dir"><b>${esc(formatarValor(a, l.tipo))}</b></td><td class="dir">${esc(formatarValor(b, l.tipo))}</td><td class="dir">${dif === null ? '—' : `${dif > 0 ? '+' : dif < 0 ? '−' : ''}${esc(formatarValor(Math.abs(dif), l.tipo))}`}</td><td class="dir">${seta(a, b, l.melhor)}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${A.areaLancada > 0.005 || B.areaLancada > 0.005 ? `<p class="nota">Área lançada sem voo (sequência/ficha diária) entra na área, mas não no ha/h: A ${esc(formatarValor(A.areaLancada, 'ha'))} ha · B ${esc(formatarValor(B.areaLancada, 'ha'))} ha.</p>` : ''}
      </section>
      <div class="grade-graficos an-graficos">
        <section class="cartao meio"><header class="cartao-cab"><h2>ha/h efetivo por ${esc(nomeDim.toLowerCase())}</h2></header>${legenda([{ nome: 'A', cor: CORES.efetiva }, { nome: 'B', cor: CORES.planejado }])}<div id="g-an-prod"></div><p class="nota">Meta por drone: ${esc(formatarValor(estado.ds.metas.haHoraDrone, 'hah'))} ha/h.</p></section>
        <section class="cartao meio"><header class="cartao-cab"><h2>Área por ${esc(nomeDim.toLowerCase())}</h2></header>${legenda([{ nome: 'A', cor: CORES.realizado }, { nome: 'B', cor: CORES.outros }])}<div id="g-an-area"></div></section>
      </div>
      <section class="cartao"><header class="cartao-cab"><h2>Comparativo por ${esc(nomeDim.toLowerCase())}</h2></header>
        <div class="tabela-rolagem"><table class="tabela tabela-simples an-t"><thead><tr><th>${esc(nomeDim)}</th><th class="dir">Área A</th><th class="dir">Área B</th><th class="dir">ha/h ef. A</th><th class="dir">ha/h ef. B</th><th class="dir">Variação ha/h</th><th class="dir">Eficiência A</th><th class="dir">Eficiência B</th><th class="dir">Parado A</th></tr></thead><tbody>
        ${quebra.map((q) => `<tr><td><b>${esc(q.rotulo)}</b></td><td class="dir">${esc(formatarValor(q.a.area, 'ha'))}</td><td class="dir">${esc(formatarValor(q.b.area, 'ha'))}</td><td class="dir"><b>${esc(formatarValor(q.a.prodEfetiva, 'hah'))}</b></td><td class="dir">${esc(formatarValor(q.b.prodEfetiva, 'hah'))}</td><td class="dir">${seta(q.a.prodEfetiva, q.b.prodEfetiva, 'maior')}</td><td class="dir">${esc(formatarValor(q.a.eficiencia, 'pct'))}</td><td class="dir">${esc(formatarValor(q.b.eficiencia, 'pct'))}</td><td class="dir">${esc(formatarValor(q.a.minParado, 'min'))}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio-txt">Sem operações nos períodos.</td></tr>'}
        </tbody></table></div></section>`;
    const top = quebra.slice(0, 12);
    barrasH(corpo.querySelector('#g-an-prod') as HTMLElement, top.map((q) => ({ rotulo: q.rotulo, valores: [q.a.prodEfetiva, q.b.prodEfetiva] })), [{ nome: 'A', cor: CORES.efetiva }, { nome: 'B', cor: CORES.planejado }], { unidade: 'ha/h', casas: 1 });
    barrasH(corpo.querySelector('#g-an-area') as HTMLElement, top.map((q) => ({ rotulo: q.rotulo, valores: [q.a.area, q.b.area] })), [{ nome: 'A', cor: CORES.realizado }, { nome: 'B', cor: CORES.outros }], { unidade: 'ha', casas: 0 });
  };
  barraFiltros(raiz.querySelector('#an-filtros') as HTMLElement, desenhar);
  raiz.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k === 'rapido') {
      if (!el.value) return;
      const ultimo = [...estado.ds.operacoes.map((o) => o.data), ...(estado.ds.lancamentos ?? []).map((l) => l.data)].sort().pop() ?? estado.filtros.ate;
      estado.filtros = { ...estado.filtros, ate: ultimo, de: addDias(ultimo, -(Number(el.value) - 1)) };
      salvarFiltros(); modo = 'anterior';
      redesenhar(); return;
    }
    if (el.dataset.k === 'modo') modo = el.value as ModoComparacao;
    else if (el.dataset.k === 'dim') dim = el.value as Dimensao;
    else if (el.dataset.k === 'de') livre.de = el.value;
    else if (el.dataset.k === 'ate') livre.ate = el.value;
    else return;
    desenhar();
  });
  raiz.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-exp]') as HTMLButtonElement | null;
    if (b) void exportarRelatorio(relAnalise(), b.dataset.exp as 'csv' | 'xlsx' | 'pdf', b);
  });
  desenhar();
}

/** A análise como relatório exportável. */
export function relAnalise(): Relatorio {
  const { fA, fB, A, B, quebra } = calcular();
  const nomeDim = DIMS.find(([d]) => d === dim)![1];
  const per = (x: { de: string; ate: string }) => `${fmtData(x.de)} a ${fmtData(x.ate)}`;
  return {
    id: 'analise', titulo: 'Análise de produtividade — comparativo', periodo: { de: fA.de, ate: fA.ate },
    filtros: [...descreverFiltros(estado.ds, fA, true), `Período A: ${per(fA)}`, `Período B: ${per(fB)}`],
    geradoEm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(), responsavel: responsavelAtual(),
    indicadores: [{ rotulo: 'Área A', valor: A.area, tipo: 'ha' }, { rotulo: 'Área B', valor: B.area, tipo: 'ha' }, { rotulo: 'ha/h efetivo A', valor: A.prodEfetiva, tipo: 'hah' }, { rotulo: 'ha/h efetivo B', valor: B.prodEfetiva, tipo: 'hah' }, { rotulo: 'Variação ha/h', valor: variacao(A.prodEfetiva, B.prodEfetiva), tipo: 'pct' }],
    secoes: [
      { titulo: 'Indicadores', colunas: [{ titulo: 'Indicador', tipo: 'texto' }, { titulo: 'A', tipo: 'num' }, { titulo: 'B', tipo: 'num' }, { titulo: 'Variação (%)', tipo: 'pct' }],
        linhas: LINHAS.map((l) => [l.rot, fmtLinha(A[l.k] as number | null, l.tipo), fmtLinha(B[l.k] as number | null, l.tipo), variacao(A[l.k] as number | null, B[l.k] as number | null)]) },
      { titulo: `Por ${nomeDim.toLowerCase()}`, colunas: [{ titulo: nomeDim, tipo: 'texto' }, { titulo: 'Área A (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'Área B (ha)', tipo: 'ha', total: 'soma' }, { titulo: 'ha/h ef. A', tipo: 'hah' }, { titulo: 'ha/h ef. B', tipo: 'hah' }, { titulo: 'Variação ha/h', tipo: 'pct' }, { titulo: 'Eficiência A', tipo: 'pct' }, { titulo: 'Eficiência B', tipo: 'pct' }, { titulo: 'Parado A', tipo: 'min', total: 'soma' }],
        linhas: quebra.map((q) => [q.rotulo, q.a.area, q.b.area, q.a.prodEfetiva, q.b.prodEfetiva, variacao(q.a.prodEfetiva, q.b.prodEfetiva), q.a.eficiencia, q.b.eficiencia, q.a.minParado]) },
    ],
    notas: ['Variação = (A − B) ÷ B. ha/h usa só área com voo registrado (tempo efetivo); área lançada sem voo entra apenas na área.', `Meta por drone: ${estado.ds.metas.haHoraDrone} ha/h.`],
  };
}
/** Na tabela de indicadores do arquivo, horas vão em horas decimais e o resto como número. */
const fmtLinha = (v: number | null, t: TipoCol) => (v === null ? null : t === 'min' ? Math.round((v / 60) * 100) / 100 : v);
