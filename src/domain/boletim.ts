/**
 * Boletim de campo (registro rápido do turno).
 *
 * Cada drone percorre: aguardando → aplicando ⇄ pausado → finalizado.
 * "Mudar de área" fecha o trecho atual e abre outro (nova OS/fazenda) no mesmo horário,
 * de modo que cada trecho vira UMA operação com horários reais — nada é rateado.
 *
 * Tempo efetivo de cada trecho = (fim − início) − soma das pausas. Não é digitado.
 */
import type { Indices } from './analytics';
import { addDias, aplicacoes, aplicadoPorItem, chaveItem, duracaoTotalMin, hhmmParaMin, MIN_POR_DIA } from './calc';
import type { Dataset, LeituraClima, MotivoParada, Operacao, Parada } from './types';
import { MOTIVOS_CLIMATICOS } from './types';
import { paradaParaISO, validarEtapa1, validarEtapa3, validarEtapa5, type ContextoValidacao, type Mensagem, type RascunhoAplicacao } from './validation';

export interface PausaCampo { motivo: MotivoParada; inicio: string; fim: string | null; observacoes?: string }
export interface TrechoCampo { osId: string; inicio: string; fim: string | null; pausas: PausaCampo[]; itens: { talhaoId: string; areaHa: number | null }[] }
export type EstadoDrone = 'aguardando' | 'aplicando' | 'pausado' | 'finalizado';
export interface DroneCampo { chave: string; aeronaveId: string; pilotoId: string; auxiliarIds: string[]; estado: EstadoDrone; trechos: TrechoCampo[] }
export interface BoletimCampo {
  versao: 1;
  data: string;
  turnoId: string;
  liderId: string;
  campanhaId: string;
  responsavel: string;
  drones: DroneCampo[];
  clima: LeituraClima[];
  observacoes: string;
}

export function boletimVazio(data: string): BoletimCampo {
  return { versao: 1, data, turnoId: '', liderId: '', campanhaId: '', responsavel: '', drones: [], clima: [], observacoes: '' };
}

const trechoAtual = (d: DroneCampo) => d.trechos[d.trechos.length - 1];
const pausaAberta = (t: TrechoCampo | undefined) => (t ? t.pausas.find((p) => p.fim === null) : undefined);

// ---------- Ações (retornam mensagem de erro ou null) ----------
export function iniciar(d: DroneCampo, osId: string, hora: string): string | null {
  if (d.estado !== 'aguardando') return 'O drone já foi iniciado.';
  if (!osId) return 'Escolha a fazenda/OS antes de iniciar.';
  if (hhmmParaMin(hora) === null) return 'Hora inválida.';
  d.trechos.push({ osId, inicio: hora, fim: null, pausas: [], itens: [] });
  d.estado = 'aplicando';
  return null;
}

export function pausar(d: DroneCampo, motivo: MotivoParada, hora: string): string | null {
  if (d.estado !== 'aplicando') return 'Só é possível pausar um drone em aplicação.';
  if (hhmmParaMin(hora) === null) return 'Hora inválida.';
  trechoAtual(d).pausas.push({ motivo, inicio: hora, fim: null });
  d.estado = 'pausado';
  return null;
}

export function retomar(d: DroneCampo, hora: string): string | null {
  if (d.estado !== 'pausado') return 'O drone não está pausado.';
  const p = pausaAberta(trechoAtual(d));
  if (!p) return 'Nenhuma pausa aberta.';
  p.fim = hora;
  d.estado = 'aplicando';
  return null;
}

export function mudarArea(d: DroneCampo, osId: string, hora: string): string | null {
  if (d.estado !== 'aplicando' && d.estado !== 'pausado') return 'O drone precisa estar em operação.';
  if (!osId) return 'Escolha a nova fazenda/OS.';
  const t = trechoAtual(d);
  if (t.osId === osId) return 'Essa já é a área atual.';
  const p = pausaAberta(t);
  if (p) p.fim = hora;
  t.fim = hora;
  d.trechos.push({ osId, inicio: hora, fim: null, pausas: [], itens: [] });
  d.estado = 'aplicando';
  return null;
}

export function finalizar(d: DroneCampo, hora: string): string | null {
  if (d.estado !== 'aplicando' && d.estado !== 'pausado') return 'O drone não está em operação.';
  const t = trechoAtual(d);
  const p = pausaAberta(t);
  if (p) p.fim = hora;
  t.fim = hora;
  d.estado = 'finalizado';
  return null;
}

export function reabrir(d: DroneCampo): string | null {
  if (d.estado !== 'finalizado') return 'O drone não está finalizado.';
  trechoAtual(d).fim = null;
  d.estado = 'aplicando';
  return null;
}

// ---------- Métricas ----------
/** Minutos de um HH:MM relativos a uma origem, tratando a virada do dia. */
export function rel(origem: string, hhmm: string | null): number | null {
  const a = hhmmParaMin(origem), b = hhmmParaMin(hhmm);
  if (a === null || b === null) return null;
  return (b - a + MIN_POR_DIA) % MIN_POR_DIA;
}

export function metricasTrecho(t: TrechoCampo, agora?: string) {
  const fim = t.fim ?? agora ?? null;
  const total = duracaoTotalMin(t.inicio, fim) ?? 0;
  const parado = t.pausas.reduce((s, p) => {
    const a = rel(t.inicio, p.inicio), b = rel(t.inicio, p.fim ?? fim);
    return a !== null && b !== null && b > a ? s + (b - a) : s;
  }, 0);
  const area = t.itens.reduce((s, i) => s + (i.areaHa && i.areaHa > 0 ? i.areaHa : 0), 0);
  return { total, parado, efetivo: Math.max(0, total - parado), area };
}

export function metricasDrone(d: DroneCampo, agora?: string) {
  return d.trechos.map((t) => metricasTrecho(t, agora)).reduce((a, m) => ({ total: a.total + m.total, parado: a.parado + m.parado, efetivo: a.efetivo + m.efetivo, area: a.area + m.area }), { total: 0, parado: 0, efetivo: 0, area: 0 });
}

// ---------- Conversão para operações ----------
export interface ResultadoFechamento { ops: Operacao[]; paradas: Parada[]; erros: Mensagem[]; avisos: Mensagem[] }

export function fecharBoletim(b: BoletimCampo, ds: Dataset, idx: Indices, ctx: ContextoValidacao, gerarId: (p: string) => string, agoraISO: string): ResultadoFechamento {
  const erros: Mensagem[] = [];
  const avisos: Mensagem[] = [];
  const ops: Operacao[] = [];
  const paradas: Parada[] = [];
  const nomeAc = (id: string) => ds.aeronaves.find((a) => a.id === id)?.identificacao ?? 'drone';
  const nomeCol = (id: string) => ds.colaboradores.find((c) => c.id === id)?.nome ?? '';

  if (!b.turnoId) erros.push({ campo: 'turnoId', msg: 'Selecione o turno.' });
  if (!b.liderId) erros.push({ campo: 'liderId', msg: 'Selecione o líder do turno.' });
  if (!b.responsavel.trim()) erros.push({ campo: 'responsavel', msg: 'Informe o responsável pelo fechamento.' });
  if (!b.drones.length) erros.push({ campo: 'drones', msg: 'Adicione ao menos um drone.' });
  const acs = b.drones.map((d) => d.aeronaveId).filter(Boolean);
  if (new Set(acs).size !== acs.length) erros.push({ campo: 'drones', msg: 'O mesmo drone aparece duas vezes no boletim.' });

  // aplicado já registrado + o que vai entrando neste boletim (para checar saldo sem dupla contagem)
  const jaAplicado = aplicadoPorItem(aplicacoes(ds));
  const leituras = [...b.clima].sort((x, y) => (rel(b.clima[0]?.hora ?? '00:00', x.hora) ?? 0) - (rel(b.clima[0]?.hora ?? '00:00', y.hora) ?? 0));
  let climaUsado = false;

  for (const d of b.drones) {
    const rot = nomeAc(d.aeronaveId);
    if (!d.aeronaveId) { erros.push({ campo: `drone_${d.chave}`, msg: 'Selecione a aeronave em todos os cartões de drone.' }); continue; }
    if (!d.pilotoId) erros.push({ campo: `drone_${d.chave}`, msg: `${rot}: selecione o piloto.` });
    if (d.estado !== 'finalizado') { erros.push({ campo: `drone_${d.chave}`, msg: `${rot}: finalize o drone antes de fechar o turno.` }); continue; }
    const origem = d.trechos[0]?.inicio ?? '00:00';
    d.trechos.forEach((t, i) => {
      const rotT = d.trechos.length > 1 ? `${rot} (trecho ${i + 1})` : rot;
      const os = idx.os.get(t.osId);
      if (!os) { erros.push({ campo: `drone_${d.chave}`, msg: `${rotT}: OS não encontrada.` }); return; }
      const m = metricasTrecho(t);
      // trecho começando depois da meia-noite pertence ao dia seguinte (convenção: dia de início)
      const dataT = (hhmmParaMin(t.inicio) ?? 0) < (hhmmParaMin(origem) ?? 0) ? addDias(b.data, 1) : b.data;
      const semArea = t.itens.every((it) => !it.areaHa || it.areaHa <= 0);
      const climaticas = t.pausas.filter((p) => MOTIVOS_CLIMATICOS.includes(p.motivo));
      const impedida = semArea && climaticas.length > 0;
      for (const p of t.pausas) {
        const a = rel(t.inicio, p.inicio), z = rel(t.inicio, p.fim);
        if (a === null || z === null || z < a || (t.fim && z > (rel(t.inicio, t.fim) ?? 0))) erros.push({ campo: `drone_${d.chave}`, msg: `${rotT}: pausa "${p.motivo}" com horário fora do trecho.` });
      }
      const r: RascunhoAplicacao = {
        data: dataT, horaInicio: t.inicio, turnoId: b.turnoId, liderId: b.liderId, unidadeId: os.unidadeId, fazendaId: os.fazendaId, osId: os.id,
        campanhaId: os.campanhaId, cultura: ds.campanhas.find((c) => c.id === os.campanhaId)?.cultura ?? '',
        itens: t.itens.filter((it) => it.areaHa !== null && it.areaHa !== 0), aeronaveId: d.aeronaveId, pilotoId: d.pilotoId, auxiliarIds: d.auxiliarIds, equipamentosAuxiliares: '',
        volumeLHa: os.calda.volumeLHa, produtos: os.calda.produtos.map((p) => ({ produtoId: p.produtoId, dosePlanejada: p.dosePlanejada, doseReal: null, unidade: p.unidade, lote: p.lote ?? '' })),
        velocidadeMs: null, alturaVooM: null, faixaM: null, observacoesTecnicas: '', clima: [],
        horaFim: t.fim ?? '', tempoEfetivoMin: impedida ? 0 : m.efetivo,
        paradas: t.pausas.map((p) => ({ motivo: p.motivo, inicio: p.inicio, fim: p.fim ?? '', observacoes: p.observacoes ?? '' })),
        observacoesOperador: '', responsavelEncerramento: b.responsavel,
      };
      const ctxSaldo: ContextoValidacao = {
        ...ctx,
        saldoItem: (osId, talhaoId) => {
          const plan = idx.os.get(osId)?.itens.find((x) => x.talhaoId === talhaoId)?.areaPlanejadaHa;
          return plan === undefined ? null : plan - (jaAplicado.get(chaveItem(osId, talhaoId)) ?? 0);
        },
      };
      const msgs = [
        ...validarEtapa1({ ...r, itens: impedida ? [{ talhaoId: '-', areaHa: 0 }] : r.itens }, ctxSaldo).erros,
        ...(impedida ? [] : validarEtapa3(r, ctxSaldo).erros),
        ...validarEtapa5(r).erros.filter((e) => !(impedida && e.campo === 'tempoEfetivoMin')),
      ];
      msgs.forEach((e) => erros.push({ campo: `drone_${d.chave}`, msg: `${rotT}: ${e.msg}` }));
      if (!impedida) validarEtapa3(r, ctxSaldo).avisos.forEach((a) => avisos.push({ campo: `drone_${d.chave}`, msg: `${rotT}: ${a.msg}` }));
      if (semArea && !impedida) erros.push({ campo: `drone_${d.chave}`, msg: `${rotT}: informe a área aplicada nos talhões (ou registre a pausa climática que impediu a aplicação).` });
      // acumula o que este boletim aplica, para o próximo trecho enxergar o saldo correto
      for (const it of r.itens) { const k = chaveItem(os.id, it.talhaoId); jaAplicado.set(k, (jaAplicado.get(k) ?? 0) + (it.areaHa ?? 0)); }

      // possível duplicidade com registros já gravados (mesmo drone, mesmo dia, horários sobrepostos)
      const iniAbs = hhmmParaMin(t.inicio) ?? 0, fimAbs = iniAbs + m.total;
      const dup = ds.operacoes.find((o) => o.aeronaveId === d.aeronaveId && o.data === dataT && (() => {
        const oi = hhmmParaMin(o.horaInicio) ?? 0; const of = oi + (duracaoTotalMin(o.horaInicio, o.horaFim) ?? 0);
        return oi < fimAbs && iniAbs < of;
      })());
      if (dup) avisos.push({ campo: `drone_${d.chave}`, msg: `${rotT}: já existe operação deste drone em ${dup.data} das ${dup.horaInicio} às ${dup.horaFim} — possível duplicidade.` });

      const opId = gerarId('op');
      // leituras de clima vão para a operação cujo horário as contém (sem duplicar)
      const minhas = leituras.filter((l) => { const x = rel(t.inicio, l.hora); return x !== null && x <= m.total; });
      const clima = minhas.length ? minhas : [];
      if (clima.length) climaUsado = true;
      clima.forEach((l) => leituras.splice(leituras.indexOf(l), 1));
      ops.push({
        id: opId, data: dataT, horaInicio: t.inicio, horaFim: t.fim, osId: os.id, campanhaId: os.campanhaId, cultura: r.cultura,
        turnoId: b.turnoId, liderId: b.liderId, aeronaveId: d.aeronaveId, pilotoId: d.pilotoId, auxiliarIds: d.auxiliarIds,
        status: impedida ? 'impedida_clima' : 'concluida',
        itens: impedida ? [] : r.itens.map((it) => ({ talhaoId: it.talhaoId, areaHa: it.areaHa ?? 0 })),
        tempoEfetivoMin: impedida ? 0 : m.efetivo,
        calda: { volumeLHa: os.calda.volumeLHa, produtos: os.calda.produtos.map((p) => ({ ...p, doseReal: null })) },
        clima, observacoesOperador: b.observacoes, responsavelEncerramento: b.responsavel,
        origem: 'registro_prototipo', criadoEm: agoraISO,
      });
      t.pausas.forEach((p) => paradas.push({
        id: gerarId('pa'), operacaoId: opId, inicio: paradaParaISO(dataT, t.inicio, p.inicio), fim: p.fim ? paradaParaISO(dataT, t.inicio, p.fim) : null,
        motivo: p.motivo, observacoes: p.observacoes, responsavel: nomeCol(b.liderId) || b.responsavel,
      }));
    });
  }
  // leituras fora de qualquer trecho vão para a primeira operação
  if (leituras.length && ops[0]) ops[0].clima.push(...leituras);
  if (!b.clima.length) avisos.push({ campo: 'clima', msg: 'Nenhuma leitura climática registrada no turno.' });
  else if (!climaUsado && !ops.length) avisos.push({ campo: 'clima', msg: 'Leituras climáticas não associadas a nenhuma operação.' });
  return { ops, paradas, erros, avisos };
}
