/**
 * Leitura do código de exportação do app de acompanhamento diário ("ACOMP1:" + JSON em base64).
 * Somente leitura: o app de origem não é alterado. Cada dia fechado vira uma ficha do Fechamento do dia
 * (FichaDia), com as pendências que impedem gravar (fazenda sem OS, drone não cadastrado etc.).
 */
import { textosDigitados } from './diario';
import { normalizar } from './base';
import { fichaVazia, type FichaDia } from './fechamentoDia';
import { numeroBR } from './importacao';
import type { PausaCampo } from './boletim';
import type { Dataset, MotivoParada } from './types';

export interface EventoAcomp { tipo: string; hora: string; texto?: string }
export interface DiaAcomp {
  data: string; campanha: string; horaIni: string; horaFim: string;
  t70d: number | null; t70a: number | null; totalDia: number | null;
  fazendas: { nome: string; area: number | null }[];
  timeline: EventoAcomp[];
  tempIni: number | null; tempFim: number | null; umidIni: number | null; umidFim: number | null; ventoIni: number | null; ventoFim: number | null;
  obs: string[];
  /** quando o dia foi fechado no app (ISO, UTC) */
  fechadoEm: string;
}
export interface LeituraAcomp { campanha: string; meta: number | null; dias: DiaAcomp[]; seq: Record<string, { aplicado: number | null; concluida: boolean }>; diaAberto: string | null; erro: string | null }

const n = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? numeroBR(v.replace(/\s*ha(\/h)?$/i, '')) : null);
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Decodifica o código (aceita também o JSON puro). */
export function lerCodigoAcomp(texto: string): LeituraAcomp {
  const vazio: LeituraAcomp = { campanha: '', meta: null, dias: [], seq: {}, diaAberto: null, erro: null };
  let bruto = texto.trim();
  if (!bruto) return { ...vazio, erro: 'Cole o código de exportação.' };
  let obj: Record<string, unknown>;
  try {
    if (bruto.startsWith('{')) obj = JSON.parse(bruto);
    else {
      bruto = bruto.replace(/^ACOMP\d*:/i, '').replace(/\s+/g, '');
      const bin = atob(bruto + '='.repeat((4 - (bruto.length % 4)) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      obj = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    }
  } catch {
    return { ...vazio, erro: 'Código inválido ou incompleto. Copie de novo em Configurações → Exportar dados, no app de acompanhamento.' };
  }
  const dias = (Array.isArray(obj.diasFechados) ? obj.diasFechados : []).map((x: Record<string, unknown>): DiaAcomp => ({
    data: s(x.data), campanha: s(x.campanha), horaIni: s(x.horaIni), horaFim: s(x.horaFim),
    t70d: n(x.t70d), t70a: n(x.t70a), totalDia: n(x.totalDia),
    fazendas: (Array.isArray(x.fazendas) ? x.fazendas : []).map((f: Record<string, unknown>) => ({ nome: s(f.nome), area: n(f.area) })).filter((f: { nome: string }) => f.nome),
    timeline: (Array.isArray(x.timeline) ? x.timeline : []).map((e: Record<string, unknown>) => ({ tipo: s(e.tipo), hora: s(e.hora), texto: s(e.texto) })),
    tempIni: n(x.tempIni), tempFim: n(x.tempFim), umidIni: n(x.umidIni), umidFim: n(x.umidFim), ventoIni: n(x.ventoIni), ventoFim: n(x.ventoFim),
    obs: (Array.isArray(x.obs) ? x.obs : []).map((o: unknown) => (typeof o === 'string' ? o : s((o as Record<string, unknown>)?.texto))).filter(Boolean),
    fechadoEm: s(x.fechadoEm),
  })).filter((d: DiaAcomp) => /^\d{4}-\d{2}-\d{2}$/.test(d.data)).sort((a: DiaAcomp, b: DiaAcomp) => a.data.localeCompare(b.data));
  const seq: LeituraAcomp['seq'] = {};
  if (obj.seqDados && typeof obj.seqDados === 'object') for (const [k, v] of Object.entries(obj.seqDados as Record<string, Record<string, unknown>>)) seq[k] = { aplicado: n(v?.aplicado), concluida: v?.concluida === true };
  const temDiaAberto = !!(s(obj.horaIni) || (Array.isArray(obj.fazendas) && obj.fazendas.length));
  return { campanha: s(obj.campanha), meta: n(obj.meta), dias, seq, diaAberto: temDiaAberto ? s(obj.data) : null, erro: dias.length ? null : 'O código não tem dias fechados (só o dia em andamento). Feche o dia no app de acompanhamento e exporte de novo.' };
}

/** Motivo da parada pelo texto da linha do tempo. */
export function motivoDoTexto(t: string): MotivoParada {
  const x = normalizar(t);
  if (/\bur\b|umidade/.test(x)) return 'Umidade abaixo do limite';
  if (/vento|rajada/.test(x)) return 'Vento acima do limite';
  if (/chuva|garoa/.test(x)) return 'Chuva';
  if (/orvalho/.test(x)) return 'Orvalho';
  if (/mudanca de area|desloc|transporte|mudanca/.test(x)) return 'Deslocamento';
  if (/abastec|bateria|recarga|carga/.test(x)) return 'Abastecimento/reabastecimento';
  if (/manut/.test(x)) return 'Manutenção';
  if (/quebr|falha|defeito|pane|gerador/.test(x)) return 'Falha de equipamento';
  if (/insumo|produto|calda/.test(x)) return 'Falta de insumos';
  if (/equipe|operador|piloto/.test(x)) return 'Problemas de equipe';
  return 'Outros';
}

/** Pausas da linha do tempo: pausa/manutenção abre, retorno/retomada fecha; o fim fecha a pausa aberta. */
export function pausasDaTimeline(tl: EventoAcomp[], horaFim: string): PausaCampo[] {
  const out: PausaCampo[] = [];
  let aberta: PausaCampo | null = null;
  for (const e of tl) {
    const tipo = normalizar(e.tipo);
    if (/^(pausa|manutencao|parada)/.test(tipo)) {
      if (aberta) { aberta.fim = e.hora; out.push(aberta); }
      aberta = { motivo: tipo.startsWith('manut') ? 'Manutenção' : motivoDoTexto(e.texto ?? ''), inicio: e.hora, fim: null, observacoes: e.texto || undefined };
    } else if (/^(retorno|retomada|reinicio)/.test(tipo) || tipo === 'fim') {
      if (aberta) { aberta.fim = e.hora; out.push(aberta); aberta = null; }
    }
  }
  if (aberta) { aberta.fim = horaFim || aberta.inicio; out.push(aberta); }
  return out.filter((p) => p.fim && p.fim !== p.inicio);
}

const chaveFaz = (t: string) => normalizar(t).replace(/^(fazenda|faz\.?|sitio|sit\.?|estancia|chacara)\s+/, '').replace(/[^a-z0-9 ]/g, '').trim();

export interface FichaAcomp { ficha: FichaDia; pendencias: string[]; avisos: string[]; jaGravado: number }

/** Dia (local, America/Sao_Paulo = UTC−3) em que o dia foi fechado no app. */
export function diaDoFechamento(d: DiaAcomp): string | null {
  const t = Date.parse(d.fechadoEm);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
}
/**
 * Data provavelmente errada: o dia foi fechado mais de 1 dia depois da data registrada (ou antes dela).
 * O fechamento normal acontece no mesmo dia ou na madrugada/manhã seguinte.
 */
export function dataSuspeita(d: DiaAcomp): string | null {
  const f = diaDoFechamento(d);
  if (!f) return null;
  const dias = Math.round((Date.parse(`${f}T00:00Z`) - Date.parse(`${d.data}T00:00Z`)) / 86_400_000);
  if (dias > 1) return `Data ${d.data.split('-').reverse().join('/')} registrada no app, mas o dia foi fechado em ${f.split('-').reverse().join('/')} (${dias} dias depois). Confira a data.`;
  if (dias < 0) return `O dia foi fechado em ${f.split('-').reverse().join('/')}, antes da data registrada. Confira a data.`;
  return null;
}

/** Monta a ficha do Fechamento do dia para um dia do app, casando fazenda → OS e T70 D/A → aeronave. */
export function fichaDoDiaAcomp(ds: Dataset, l: LeituraAcomp, dia: DiaAcomp, base: Pick<FichaDia, 'turnoId' | 'liderId' | 'responsavel'> & { volumeLHa?: number | null }, dataCorrigida?: string): FichaAcomp {
  const pendencias: string[] = [], avisos: string[] = [];
  const data = dataCorrigida && /^\d{4}-\d{2}-\d{2}$/.test(dataCorrigida) ? dataCorrigida : dia.data;
  const f: FichaDia = { ...fichaVazia(data), ...base, inicio: dia.horaIni, fim: dia.horaFim };
  if (data !== dia.data) { f.substituiDia = dia.data; f.observacoes = `Data corrigida: no app de acompanhamento constava ${dia.data.split('-').reverse().join('/')}.`; }
  else { const sus = dataSuspeita(dia); if (sus) avisos.push(sus); }
  f.pausas = pausasDaTimeline(dia.timeline, dia.horaFim);
  const fimEv = dia.timeline.find((e) => normalizar(e.tipo) === 'fim' && e.texto);
  // observação que já está em OUTRO turno do mesmo dia (o app de acompanhamento mantém o texto ao trocar de turno) não é repetida
  const jaEmOutroTurno = new Set(ds.operacoes.filter((o) => o.fechamentoDia === data && o.turnoId !== f.turnoId).flatMap((o) => textosDigitados(o.observacoesOperador)).flatMap((t) => [t, ...t.split(/\s+·\s+/).map((x) => x.trim())]));
  const digitadas = [fimEv ? `Encerramento: ${fimEv.texto}` : '', ...dia.obs].filter((t) => t && !jaEmOutroTurno.has(t.replace(/^Encerramento:\s*/i, '').trim()));
  f.observacoes = [f.observacoes, ...digitadas].filter(Boolean).join(' · ');
  f.clima = { tIni: dia.tempIni, urIni: dia.umidIni, vIni: dia.ventoIni, tFim: dia.tempFim, urFim: dia.umidFim, vFim: dia.ventoFim };
  // drones
  for (const [rot, area, re] of [['T70 D', dia.t70d, /t\s*70\s*-?\s*d\b/], ['T70 A', dia.t70a, /t\s*70\s*-?\s*a\b/]] as const) {
    if (area === null || area <= 0) continue;
    const ac = ds.aeronaves.find((a) => re.test(normalizar(a.identificacao)));
    if (!ac) { pendencias.push(`Cadastre a aeronave "${rot}" (Aeronaves e equipamentos), com o piloto fixo.`); f.drones.push({ aeronaveId: '', pilotoId: '', area, inicio: '', fim: '', pausas: [] }); continue; }
    if (!ac.pilotoPadraoId) pendencias.push(`Aeronave ${ac.identificacao}: informe o piloto fixo no cadastro (ou escolha o piloto na ficha).`);
    f.drones.push({ aeronaveId: ac.id, pilotoId: ac.pilotoPadraoId ?? '', area, inicio: '', fim: '', pausas: [] });
  }
  // fazendas → OS (aberta, com saldo, preferindo a campanha de mesmo tipo)
  const ultimoDiaDaFazenda = (nome: string) => [...l.dias].reverse().find((d) => d.fazendas.some((x) => chaveFaz(x.nome) === chaveFaz(nome)))?.data;
  for (const fz of dia.fazendas) {
    const cands = ds.fazendas.filter((x) => chaveFaz(x.nome) === chaveFaz(fz.nome));
    const oss = ds.ordens.filter((o) => o.status !== 'cancelada' && cands.some((c) => c.id === o.fazendaId));
    const doTipo = oss.filter((o) => normalizar(ds.campanhas.find((c) => c.id === o.campanhaId)?.tipo ?? '') === normalizar(dia.campanha || l.campanha));
    const escolha = (doTipo.length ? doTipo : oss).sort((a, b) => b.emissao.localeCompare(a.emissao));
    const os = escolha[0];
    if (!cands.length) pendencias.push(`Fazenda "${fz.nome}" não está no protótipo: importe o PDF da OS dela (Sequência → Importar sequência → PDF da OS).`);
    else if (!os) pendencias.push(`Fazenda "${fz.nome}": nenhuma OS aberta no protótipo. Importe o PDF da OS.`);
    else if (escolha.length > 1) avisos.push(`"${fz.nome}" tem ${escolha.length} OS; usada a OS ${os.numero} (confira na ficha).`);
    const conc = Object.entries(l.seq).find(([k]) => chaveFaz(k) === chaveFaz(fz.nome))?.[1]?.concluida === true && ultimoDiaDaFazenda(fz.nome) === dia.data;
    // desconto previsto na OS (ñ aplicado por talhão) já vem marcado
    f.fazendas.push({ osId: os?.id ?? '', real: fz.area, concluir: !!os && conc, descontoEm: os ? os.itens.filter((i) => (i.naoAplicadoHa ?? 0) > 0).map((i) => i.talhaoId) : [] });
  }
  // conferências do próprio dia
  const sd = (dia.t70d ?? 0) + (dia.t70a ?? 0), sf = dia.fazendas.reduce((a, x) => a + (x.area ?? 0), 0);
  if (Math.abs(sd - sf) > 0.005) avisos.push(`No app: drones ${sd.toFixed(2).replace('.', ',')} ha × fazendas ${sf.toFixed(2).replace('.', ',')} ha.`);
  if (dia.t70d && dia.t70a && Math.min(dia.t70d, dia.t70a) / Math.max(dia.t70d, dia.t70a) < 0.6 && !f.pausas.length) {
    const menor = dia.t70d < dia.t70a ? 'T70 D' : 'T70 A';
    avisos.push(`${menor} fez bem menos área que o outro drone no mesmo horário. Se ele parou ou começou depois, informe o horário próprio dele na ficha — senão o ha/h dele sai subestimado.`);
  }
  const jaGravado = ds.operacoes.filter((o) => o.fechamentoDia === data).length;
  const comDataAntiga = data !== dia.data ? ds.operacoes.filter((o) => o.fechamentoDia === dia.data).length : 0;
  if (comDataAntiga) avisos.push(`Há ${comDataAntiga} voo(s) gravados com a data antiga (${dia.data.split('-').reverse().join('/')}); ao gravar com a data corrigida, eles são substituídos.`);
  return { ficha: f, pendencias, avisos, jaGravado };
}
