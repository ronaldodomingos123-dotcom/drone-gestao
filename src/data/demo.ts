/**
 * Gerador DETERMINÍSTICO de dados de demonstração — 100% fictícios.
 * Nomes de unidades, fazendas, pessoas, produtos e todos os números são inventados
 * e não representam nenhuma operação real. A mesma semente sempre gera os mesmos dados.
 */
import { META_PADRAO } from '../domain/metas';
import { migrar, VERSAO_ESQUEMA } from '../domain/base';
import { addDias, areaPlanejadaOS, chaveItem, hhmmParaMin, intervaloDatas, minParaHHMM, round } from '../domain/calc';
import type {
  Aeronave, Calda, Turno, Campanha, Colaborador, Dataset, Fazenda, LeituraClima, MotivoParada, Operacao,
  OrdemServico, Parada, Produto, Talhao, Unidade,
} from '../domain/types';

export const DEMO_DATA_INICIO = '2026-09-14';
export const DEMO_DATA_FIM = '2026-10-19';
export const DEMO_VERSAO = 3; // v2: turnos e líderes · v3: meta operacional

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gerarDemo(seed = 20261020): Dataset {
  const rnd = mulberry32(seed);
  const unif = (a: number, b: number) => a + (b - a) * rnd();
  const inteiro = (a: number, b: number) => Math.floor(unif(a, b + 1));
  const chance = (p: number) => rnd() < p;

  const unidades: Unidade[] = [
    { id: 'un-n', nome: 'Unidade Norte', codigo: 'UN-N', municipio: 'Vila Esperança' },
    { id: 'un-s', nome: 'Unidade Sul', codigo: 'UN-S', municipio: 'Campo Alto' },
  ];

  const nomesFaz: [string, string, string][] = [
    ['Boa Vista', 'un-n', 'Vila Esperança'], ['Santa Clara', 'un-n', 'Vila Esperança'], ['Primavera', 'un-n', 'Serra Azul do Leste'],
    ['Água Limpa', 'un-n', 'Serra Azul do Leste'], ['Bela Aurora', 'un-n', 'Vila Esperança'], ['Santa Rita', 'un-n', 'Serra Azul do Leste'],
    ['São Bento', 'un-s', 'Campo Alto'], ['Lagoa Seca', 'un-s', 'Porto do Cedro'], ['Monte Verde', 'un-s', 'Campo Alto'], ['Recanto', 'un-s', 'Porto do Cedro'],
    ['Vale do Sol', 'un-s', 'Porto do Cedro'], ['Pedra Branca', 'un-s', 'Campo Alto'],
  ];
  const fazendas: Fazenda[] = nomesFaz.map(([nome, unidadeId, municipio], i) => ({
    id: `fz-${i + 1}`, unidadeId, codigo: String(901 + i), nome, municipio,
  }));

  const talhoes: Talhao[] = [];
  for (const f of fazendas) {
    const n = inteiro(20, 32);
    for (let t = 1; t <= n; t++) {
      talhoes.push({ id: `${f.id}-t${t}`, fazendaId: f.id, codigo: String(t).padStart(3, '0'), areaHa: round(unif(10, 35), 2) });
    }
  }

  const campanhas: Campanha[] = [
    { id: 'cp-mat', nome: 'Maturador 26/27', tipo: 'Maturador', cultura: 'Cana-de-açúcar', inicio: '2026-09-14', fim: '2026-11-15' },
    { id: 'cp-ins', nome: 'Inseticida 26/27', tipo: 'Inseticida', cultura: 'Cana-de-açúcar', inicio: '2026-10-01', fim: '2026-11-30' },
  ];

  const produtos: Produto[] = [
    { id: 'pr-mat-a', nome: 'Maturador A', classe: 'Maturador', unidadeDose: 'L/ha', unidadeTotal: 'L' },
    { id: 'pr-mat-b', nome: 'Maturador B', classe: 'Maturador', unidadeDose: 'g/ha', unidadeTotal: 'kg' },
    { id: 'pr-ins-a', nome: 'Inseticida A', classe: 'Inseticida', unidadeDose: 'L/ha', unidadeTotal: 'L' },
    { id: 'pr-ins-b', nome: 'Inseticida B', classe: 'Inseticida', unidadeDose: 'kg/ha', unidadeTotal: 'kg' },
    { id: 'pr-fun-a', nome: 'Fungicida A', classe: 'Fungicida', unidadeDose: 'L/ha', unidadeTotal: 'L' },
    { id: 'pr-her-a', nome: 'Herbicida A', classe: 'Herbicida', unidadeDose: 'L/ha', unidadeTotal: 'L' },
    { id: 'pr-adj-a', nome: 'Adjuvante A', classe: 'Adjuvante', unidadeDose: 'mL/ha', unidadeTotal: 'L' },
    { id: 'pr-fol-a', nome: 'Foliar A', classe: 'Fertilizante foliar', unidadeDose: 'L/ha', unidadeTotal: 'L' },
  ];

  const caldaMat: Calda = { volumeLHa: 20, produtos: [
    { produtoId: 'pr-mat-a', dosePlanejada: 0.4, doseReal: null, unidade: 'L/ha', lote: 'LT-26-0412' },
    { produtoId: 'pr-adj-a', dosePlanejada: 50, doseReal: null, unidade: 'mL/ha', lote: 'LT-26-0388' },
  ] };
  const caldaIns: Calda = { volumeLHa: 15, produtos: [
    { produtoId: 'pr-ins-a', dosePlanejada: 0.15, doseReal: null, unidade: 'L/ha', lote: 'LT-26-0521' },
    { produtoId: 'pr-adj-a', dosePlanejada: 50, doseReal: null, unidade: 'mL/ha', lote: 'LT-26-0388' },
  ] };

  const ordens: OrdemServico[] = [];
  let seqOS = 1;
  const novaOS = (campanhaId: string, f: Fazenda, calda: Calda, ts: Talhao[], emissao: string): OrdemServico => ({
    id: `os-${seqOS}`, numero: `OS-26-${String(seqOS++).padStart(3, '0')}`, campanhaId, unidadeId: f.unidadeId, fazendaId: f.id,
    tipo: 'Pulverização', status: 'aberta', emissao,
    itens: ts.map((t) => ({ talhaoId: t.id, areaPlanejadaHa: t.areaHa })),
    calda: JSON.parse(JSON.stringify(calda)),
  });
  for (const f of fazendas) ordens.push(novaOS('cp-mat', f, caldaMat, talhoes.filter((t) => t.fazendaId === f.id), '2026-09-10'));
  for (const f of fazendas.filter((x) => x.unidadeId === 'un-s').slice(0, 3)) {
    const ts = talhoes.filter((t) => t.fazendaId === f.id);
    ordens.push(novaOS('cp-ins', f, caldaIns, ts.slice(0, Math.ceil(ts.length * 0.6)), '2026-09-28'));
  }
  const osCancelada = novaOS('cp-ins', fazendas[11], caldaIns, talhoes.filter((t) => t.fazendaId === fazendas[11].id).slice(0, 4), '2026-09-28');
  osCancelada.status = 'cancelada';
  osCancelada.observacoes = 'Cancelada: área incluída por engano (exemplo fictício).';
  ordens.push(osCancelada);

  const aeronaves: Aeronave[] = [
    { id: 'ac-1', identificacao: 'DR-01', modelo: 'Agras T70', numeroSerie: 'SN-DEMO-0001', status: 'disponivel', unidadeId: 'un-n', horasAnteriores: 212.5 },
    { id: 'ac-2', identificacao: 'DR-02', modelo: 'Agras T70', numeroSerie: 'SN-DEMO-0002', status: 'em_operacao', unidadeId: 'un-s', horasAnteriores: 188.0 },
    { id: 'ac-3', identificacao: 'DR-03', modelo: 'Agras T70', numeroSerie: 'SN-DEMO-0003', status: 'manutencao', unidadeId: 'un-n', horasAnteriores: 301.2 },
    { id: 'ac-4', identificacao: 'DR-04', modelo: 'Agras T50', numeroSerie: 'SN-DEMO-0004', status: 'disponivel', unidadeId: 'un-s', horasAnteriores: 96.4 },
  ];

  const colaboradores: Colaborador[] = [
    { id: 'pl-1', nome: 'André Moraes', funcao: 'Piloto', unidadeId: 'un-n', ativo: true },
    { id: 'pl-2', nome: 'Bruna Teixeira', funcao: 'Piloto', unidadeId: 'un-s', ativo: true },
    { id: 'pl-3', nome: 'Caio Nunes', funcao: 'Piloto', unidadeId: 'un-n', ativo: true },
    { id: 'pl-4', nome: 'Diego Prado', funcao: 'Piloto', unidadeId: 'un-s', ativo: true },
    { id: 'ax-1', nome: 'Elias Rocha', funcao: 'Auxiliar de campo', unidadeId: 'un-n', ativo: true },
    { id: 'ax-2', nome: 'Fábio Lima', funcao: 'Auxiliar de campo', unidadeId: 'un-s', ativo: true },
    { id: 'ax-3', nome: 'Gisele Duarte', funcao: 'Técnico de calda', unidadeId: 'un-n', ativo: true },
    { id: 'ax-4', nome: 'Hugo Salles', funcao: 'Auxiliar de campo', unidadeId: 'un-s', ativo: true },
    { id: 'ld-1', nome: 'Joana Ribeiro', funcao: 'Líder de turno', unidadeId: 'un-n', ativo: true },
    { id: 'ld-2', nome: 'Marcos Vieira', funcao: 'Líder de turno', unidadeId: 'un-s', ativo: true },
    { id: 'ld-3', nome: 'Paulo Henrique Sá', funcao: 'Líder de turno', unidadeId: 'un-n', ativo: true },
    { id: 'sp-1', nome: 'Íris Campos', funcao: 'Supervisor', unidadeId: 'un-n', ativo: true },
  ];

  // Turnos fictícios em escala 12×36: A e B se alternam por dia. O turno C (diurno) está cadastrado sem operações.
  const turnos: Turno[] = [
    { id: 'tn-a', nome: 'Turno A', periodo: 'Noturno', horaInicio: '17:00', horaFim: '05:00', liderId: 'ld-1', ativo: true },
    { id: 'tn-b', nome: 'Turno B', periodo: 'Noturno', horaInicio: '17:00', horaFim: '05:00', liderId: 'ld-2', ativo: true },
    { id: 'tn-c', nome: 'Turno C', periodo: 'Diurno', horaInicio: '05:00', horaFim: '17:00', liderId: 'ld-3', ativo: true },
  ];

  // Escala fictícia: aeronave → piloto/auxiliar
  const escala: Record<string, { piloto: string; aux: string[] }> = {
    'ac-1': { piloto: 'pl-1', aux: ['ax-1'] },
    'ac-3': { piloto: 'pl-3', aux: ['ax-3'] },
    'ac-2': { piloto: 'pl-2', aux: ['ax-2'] },
    'ac-4': { piloto: 'pl-4', aux: ['ax-4'] },
  };

  // Saldos por item (OS × talhão) para simular a execução em sequência
  const saldo = new Map<string, number>();
  for (const os of ordens) if (os.status !== 'cancelada') for (const it of os.itens) saldo.set(chaveItem(os.id, it.talhaoId), it.areaPlanejadaHa);
  const filaDe = (campanhaId: string, unidadeId: string) =>
    ordens.filter((o) => o.campanhaId === campanhaId && o.unidadeId === unidadeId && o.status !== 'cancelada');

  const operacoes: Operacao[] = [];
  const paradas: Parada[] = [];
  let seqOp = 1;
  let seqPa = 1;

  const leitura = (momento: LeituraClima['momento'], hora: string, ventoBase: number, chuva: LeituraClima['chuva'] = 'sem chuva', orvalho = false): LeituraClima => ({
    momento, hora,
    temperaturaC: round(unif(18, 27), 1), umidadePct: Math.round(unif(58, 88)),
    ventoKmh: round(ventoBase, 1), rajadaKmh: round(ventoBase + unif(1, 5), 1),
    direcaoVento: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][inteiro(0, 7)],
    chuva, orvalho, origem: 'Estação portátil',
  });

  const datas = intervaloDatas(DEMO_DATA_INICIO, DEMO_DATA_FIM);
  for (const [iDia, data] of datas.entries()) {
    const diaImpedido = chance(0.09);
    const turnoDia = turnos[iDia % 2];
    // Substituição eventual do líder (exemplo de líder diferente do padrão do turno)
    const liderDia = iDia === 20 ? 'ld-3' : turnoDia.liderId;
    for (const ac of ['ac-1', 'ac-3', 'ac-2', 'ac-4']) {
      if (ac === 'ac-3' && data >= '2026-10-10') continue; // DR-03 em manutenção
      if (chance(0.1)) continue; // sem operação (folga/escala)
      const aeronave = aeronaves.find((a) => a.id === ac)!;
      const usarInseticida = ac === 'ac-4' && data >= '2026-10-01';
      const campanhaId = usarInseticida ? 'cp-ins' : 'cp-mat';
      const fila = filaDe(campanhaId, aeronave.unidadeId);
      const os = fila.find((o) => o.itens.some((it) => (saldo.get(chaveItem(o.id, it.talhaoId)) ?? 0) > 0.009));
      if (!os) continue;
      const { piloto, aux } = escala[ac];
      const iniMin = inteiro(17 * 60 + 30, 19 * 60 + 40);
      const horaInicio = minParaHHMM(Math.round(iniMin / 5) * 5);
      const opId = `op-${seqOp++}`;
      const calda: Calda = JSON.parse(JSON.stringify(os.calda));
      const ventoBase = unif(3, 9);

      if (diaImpedido) {
        const dur = inteiro(60, 150);
        const motivo: MotivoParada = chance(0.6) ? 'Vento acima do limite' : 'Chuva';
        const horaFim = minParaHHMM((hhmmParaMin(horaInicio) ?? 0) + dur);
        paradas.push({ id: `pa-${seqPa++}`, operacaoId: opId, inicio: `${data}T${horaInicio}`, fim: isoApos(data, horaInicio, dur), motivo, responsavel: colaboradores.find((c) => c.id === piloto)!.nome, observacoes: 'Aguardou janela; operação não iniciada.' });
        operacoes.push({
          id: opId, data, horaInicio, horaFim, osId: os.id, campanhaId, cultura: 'Cana-de-açúcar', turnoId: turnoDia.id, liderId: liderDia, aeronaveId: ac, pilotoId: piloto, auxiliarIds: aux,
          status: 'impedida_clima', itens: [], tempoEfetivoMin: 0, calda,
          clima: [motivo === 'Chuva' ? leitura('inicio', horaInicio, ventoBase, 'chuva') : leitura('inicio', horaInicio, unif(13, 19)), leitura('fim', horaFim, motivo === 'Chuva' ? ventoBase : unif(12, 17), motivo === 'Chuva' ? 'garoa' : 'sem chuva')],
          observacoesOperador: 'Condição fora dos limites configurados durante toda a janela.', responsavelEncerramento: colaboradores.find((c) => c.id === piloto)!.nome,
          origem: 'demo', criadoEm: `${data}T23:59:00`,
        });
        continue;
      }

      // Capacidade da noite e consumo da fila de talhões
      const capacidade = aeronave.modelo === 'Agras T50' ? unif(30, 60) : unif(40, 80);
      let resta = capacidade;
      const itens: { talhaoId: string; areaHa: number }[] = [];
      for (const o of [os, ...fila.filter((x) => x.id !== os.id)]) {
        if (o.id !== os.id) break; // uma OS por operação
        for (const it of o.itens) {
          if (resta <= 0.5) break;
          const k = chaveItem(o.id, it.talhaoId);
          const s = saldo.get(k) ?? 0;
          if (s <= 0.009) continue;
          const a = round(Math.min(s, resta), 2);
          saldo.set(k, round(s - a, 2));
          resta -= a;
          itens.push({ talhaoId: it.talhaoId, areaHa: a });
        }
      }
      const area = itens.reduce((s, i) => s + i.areaHa, 0);
      const taxa = aeronave.modelo === 'Agras T50' ? unif(11, 16) : unif(14, 21); // ha/h efetivo (fictício)
      const efetivo = Math.max(10, Math.round((area / taxa) * 60));

      // Paradas da operação
      const sorteio: [MotivoParada, number, number, number][] = [
        ['Abastecimento/reabastecimento', 0.95, 15, 35], ['Deslocamento', 0.6, 15, 40], ['Vento acima do limite', 0.14, 20, 60],
        ['Orvalho', 0.08, 20, 50], ['Manutenção', 0.08, 25, 80], ['Falha de equipamento', 0.06, 15, 60],
        ['Falta de insumos', 0.05, 20, 45], ['Problemas de equipe', 0.03, 15, 40], ['Umidade abaixo do limite', 0.03, 20, 40], ['Outros', 0.04, 10, 25],
      ];
      const lista: { motivo: MotivoParada; dur: number }[] = [];
      for (const [motivo, p, a, b] of sorteio) if (chance(p)) lista.push({ motivo, dur: inteiro(a, b) });
      const folga = inteiro(3, 12);
      const blocos = lista.length + 1;
      let cursor = hhmmParaMin(horaInicio) ?? 0;
      const fatia = Math.floor(efetivo / blocos);
      const clima: LeituraClima[] = [leitura('inicio', horaInicio, ventoBase, 'sem chuva', false)];
      lista.forEach((p) => {
        cursor += fatia;
        const ini = minParaHHMM(cursor);
        const diaIni = cursor >= 24 * 60 ? addDias(data, 1) : data;
        paradas.push({
          id: `pa-${seqPa++}`, operacaoId: opId, inicio: `${diaIni}T${ini}`, fim: isoApos(diaIni, ini, p.dur), motivo: p.motivo,
          responsavel: colaboradores.find((c) => c.id === piloto)!.nome,
        });
        if (p.motivo === 'Vento acima do limite') clima.push({ ...leitura('durante', ini, unif(13, 18)), observacoes: 'Leitura que motivou a parada.' });
        if (p.motivo === 'Orvalho') clima.push(leitura('durante', ini, ventoBase, 'sem chuva', true));
        cursor += p.dur;
      });
      const total = efetivo + lista.reduce((s, p) => s + p.dur, 0) + folga;
      const horaFim = minParaHHMM((hhmmParaMin(horaInicio) ?? 0) + total);
      clima.push(leitura('fim', horaFim, unif(2, 8)));

      calda.produtos.forEach((p) => { p.doseReal = round(p.dosePlanejada * unif(0.97, 1.03), p.unidade === 'mL/ha' || p.unidade === 'g/ha' ? 0 : 3); });
      const paradaClima = lista.some((p) => p.motivo === 'Vento acima do limite' || p.motivo === 'Orvalho');
      operacoes.push({
        id: opId, data, horaInicio, horaFim, osId: os.id, campanhaId, cultura: 'Cana-de-açúcar', turnoId: turnoDia.id, liderId: liderDia, aeronaveId: ac, pilotoId: piloto, auxiliarIds: aux,
        equipamentosAuxiliares: 'Gerador, misturador de calda, base RTK',
        status: paradaClima && chance(0.5) ? 'parcial' : 'concluida',
        itens, tempoEfetivoMin: efetivo, calda,
        velocidadeMs: round(unif(5.5, 7.5), 1), alturaVooM: round(unif(3, 4), 1), faixaM: aeronave.modelo === 'Agras T50' ? 9 : 11,
        clima, observacoesTecnicas: '', observacoesOperador: '',
        responsavelEncerramento: colaboradores.find((c) => c.id === piloto)!.nome, origem: 'demo', criadoEm: `${data}T23:59:00`,
      });
    }
  }

  // Exemplos intencionais para demonstrar alertas (fictícios):
  // 1) reaplicação sobreposta que ultrapassa o planejado de um talhão;
  const opsComArea = operacoes.filter((o) => o.itens.length > 0);
  const alvo = opsComArea[Math.floor(opsComArea.length * 0.4)];
  if (alvo) {
    alvo.itens[0].areaHa = round(alvo.itens[0].areaHa + 1.35, 2);
    alvo.observacoesTecnicas = 'Exemplo de demonstração: área informada acima do planejado (gera alerta de conferência).';
  }
  // 2) dose utilizada com desvio > 10%.
  const alvo2 = opsComArea[Math.floor(opsComArea.length * 0.7)];
  if (alvo2) {
    alvo2.calda.produtos[0].doseReal = round(alvo2.calda.produtos[0].dosePlanejada * 1.12, 3);
    alvo2.observacoesTecnicas = 'Exemplo de demonstração: dose utilizada 12% acima da planejada.';
  }

  // Status das OS derivado da execução
  for (const os of ordens) {
    if (os.status === 'cancelada') continue;
    const plan = areaPlanejadaOS(os);
    const apl = operacoes.filter((o) => o.osId === os.id).reduce((s, o) => s + o.itens.reduce((a, i) => a + i.areaHa, 0), 0);
    os.status = apl <= 0 ? 'aberta' : apl >= plan - 0.01 ? 'concluida' : 'em_execucao';
  }

  const ds = {
    versao: VERSAO_ESQUEMA, origemBase: 'demo', auditoria: [], lancamentos: [], estacoes: [], registrosEstacao: [],
    geradoEm: new Date().toISOString(),
    unidades, fazendas, talhoes, campanhas, produtos, ordens, aeronaves, colaboradores, turnos, operacoes, paradas,
    limites: { ventoMaxKmh: 10, ventoMinKmh: 2, umidadeMinPct: 55, temperaturaMaxC: 30 },
    metas: { ...META_PADRAO },
  } as Dataset;
  return migrar(ds)!;
}

function isoApos(data: string, hhmm: string, minutos: number): string {
  const ini = hhmmParaMin(hhmm) ?? 0;
  const tot = ini + minutos;
  const d = tot >= 24 * 60 ? addDias(data, Math.floor(tot / (24 * 60))) : data;
  return `${d}T${minParaHHMM(tot)}`;
}
