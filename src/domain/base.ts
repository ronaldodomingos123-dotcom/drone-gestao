/**
 * Manutenção da base: migração de versão, status derivado das OS, auditoria e integridade referencial.
 */
import { aplicacoes, aplicadoPorItem, areaPlanejadaOS, chaveItem } from './calc';
import { META_PADRAO } from './metas';
import type { Dataset, EntidadeAuditada, RegistroAuditoria } from './types';

/** Versão do esquema de dados. Bases antigas são MIGRADAS (nunca apagadas). */
export const VERSAO_ESQUEMA = 5;
export const USUARIO_PADRAO = 'Gestor (demo)';

/** Atualiza uma base antiga para o esquema atual, preservando todos os registros. Retorna null se irrecuperável. */
export function migrar(bruto: unknown): Dataset | null {
  const d = bruto as Partial<Dataset> & Record<string, unknown>;
  if (!d || typeof d !== 'object') return null;
  const listas = ['unidades', 'fazendas', 'talhoes', 'campanhas', 'produtos', 'ordens', 'aeronaves', 'colaboradores', 'operacoes', 'paradas'] as const;
  if (listas.some((k) => !Array.isArray(d[k]))) return null;
  if (!Array.isArray(d.turnos)) return null; // v1 (sem turnos) só existiu como demonstração
  const ds = d as Dataset;
  ds.metas ??= { ...META_PADRAO };
  ds.limites ??= { ventoMaxKmh: 10, ventoMinKmh: 2, umidadeMinPct: 55, temperaturaMaxC: 30 };
  ds.auditoria ??= [];
  ds.lancamentos ??= [];
  ds.estacoes ??= [];
  ds.registrosEstacao ??= [];
  ds.origemBase ??= 'demo';
  // OS sem número de sequência: numera por campanha, mantendo a ordem de emissão/número
  for (const c of ds.campanhas) {
    const os = ds.ordens.filter((o) => o.campanhaId === c.id);
    if (os.some((o) => o.sequencia === undefined)) {
      const max = Math.max(0, ...os.map((o) => o.sequencia ?? 0));
      os.filter((o) => o.sequencia === undefined).sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }))
        .forEach((o, i) => { o.sequencia = max + i + 1; });
    }
    // campanha sem calda padrão: herda a calda da primeira OS
    if (!c.calda) { const o = os.find((x) => x.calda?.produtos?.length); if (o) c.calda = JSON.parse(JSON.stringify(o.calda)); }
  }
  // v4→v5: na v0.8.1 a área programada era a "real" (bruta − não aplicado); volta a ser a bruta
  if ((d.versao as number | undefined ?? 0) < 5) {
    for (const o of ds.ordens) for (const it of o.itens) if (it.naoAplicadoHa) it.areaPlanejadaHa = Math.round((it.areaPlanejadaHa + it.naoAplicadoHa) * 1e4) / 1e4;
  }
  ds.versao = VERSAO_ESQUEMA;
  return ds;
}

/** Recalcula o status das OS a partir das áreas aplicadas (cancelada e concluída manual são respeitadas). */
export function recalcularStatusOS(ds: Dataset): void {
  const apl = aplicadoPorItem(aplicacoes(ds));
  for (const os of ds.ordens) {
    if (os.status === 'cancelada') continue;
    if (os.concluidaManual) { os.status = 'concluida'; continue; }
    const plan = areaPlanejadaOS(os);
    const a = os.itens.reduce((s, it) => s + (apl.get(chaveItem(os.id, it.talhaoId)) ?? 0), 0);
    os.status = a <= 0.005 ? 'aberta' : plan > 0 && a >= plan - 0.01 ? 'concluida' : 'em_execucao';
  }
}

let seq = 0;
export function registrar(ds: Dataset, r: Omit<RegistroAuditoria, 'id' | 'quando' | 'usuario'> & { usuario?: string }): RegistroAuditoria {
  const reg: RegistroAuditoria = {
    id: `au-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    quando: new Date().toISOString(),
    usuario: r.usuario ?? USUARIO_PADRAO,
    ...r,
    antes: r.antes === undefined ? undefined : JSON.parse(JSON.stringify(r.antes)),
    depois: r.depois === undefined ? undefined : JSON.parse(JSON.stringify(r.depois)),
  };
  ds.auditoria.push(reg);
  return reg;
}

/** Onde um registro é usado. Lista vazia = pode ser excluído sem quebrar nada. */
export function referencias(ds: Dataset, entidade: EntidadeAuditada, id: string): string[] {
  const n = (qtd: number, txt: string) => (qtd ? [`${qtd} ${txt}`] : []);
  switch (entidade) {
    case 'unidade': return [...n(ds.fazendas.filter((f) => f.unidadeId === id).length, 'fazenda(s)'), ...n(ds.aeronaves.filter((a) => a.unidadeId === id).length, 'aeronave(s)'), ...n(ds.colaboradores.filter((c) => c.unidadeId === id).length, 'colaborador(es)'), ...n(ds.ordens.filter((o) => o.unidadeId === id).length, 'OS')];
    case 'fazenda': return [...n(ds.talhoes.filter((t) => t.fazendaId === id).length, 'talhão(ões)'), ...n(ds.ordens.filter((o) => o.fazendaId === id).length, 'OS')];
    case 'talhao': return [...n(ds.ordens.filter((o) => o.itens.some((i) => i.talhaoId === id)).length, 'OS'), ...n(ds.operacoes.filter((o) => o.itens.some((i) => i.talhaoId === id)).length, 'operação(ões)')];
    case 'campanha': return [...n(ds.ordens.filter((o) => o.campanhaId === id).length, 'OS'), ...n(ds.operacoes.filter((o) => o.campanhaId === id).length, 'operação(ões)')];
    case 'ordem': return n(ds.operacoes.filter((o) => o.osId === id).length, 'operação(ões)');
    case 'aeronave': return n(ds.operacoes.filter((o) => o.aeronaveId === id).length, 'operação(ões)');
    case 'colaborador': return [...n(ds.operacoes.filter((o) => o.pilotoId === id || o.liderId === id || o.auxiliarIds.includes(id)).length, 'operação(ões)'), ...n(ds.turnos.filter((t) => t.liderId === id).length, 'turno(s) como líder padrão')];
    case 'turno': return n(ds.operacoes.filter((o) => o.turnoId === id).length, 'operação(ões)');
    case 'produto': return [...n(ds.ordens.filter((o) => o.calda.produtos.some((p) => p.produtoId === id)).length, 'OS'), ...n(ds.operacoes.filter((o) => o.calda.produtos.some((p) => p.produtoId === id)).length, 'operação(ões)')];
    default: return [];
  }
}

/** Base vazia do usuário (sai da demonstração). Mantém metas e limites configurados. */
export function baseVazia(atual?: Pick<Dataset, 'metas' | 'limites'>): Dataset {
  return {
    versao: VERSAO_ESQUEMA, geradoEm: new Date().toISOString(), origemBase: 'propria', auditoria: [],
    unidades: [], fazendas: [], talhoes: [], campanhas: [], produtos: [], ordens: [], aeronaves: [], colaboradores: [], turnos: [], operacoes: [], lancamentos: [], estacoes: [], registrosEstacao: [], paradas: [],
    limites: atual?.limites ?? { ventoMaxKmh: 10, ventoMinKmh: 2, umidadeMinPct: 55, temperaturaMaxC: 30 },
    metas: atual?.metas ?? { ...META_PADRAO },
  };
}

/** Normaliza texto para comparar nomes (sem acento, minúsculo, espaços simples). */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Unidade/empresa é OPCIONAL. Valor vindo da tela: '' = sem unidade · id existente · 'nova:<Nome>' =
 * cria (ou reaproveita, se já houver uma com o mesmo nome). Muta ds; devolve o id ('' se nenhuma).
 */
export function resolverUnidade(ds: Dataset, valor: string, gerarId: (p: string) => string): string {
  if (!valor) return '';
  if (!valor.startsWith('nova:')) return ds.unidades.some((u) => u.id === valor) ? valor : '';
  const nomeU = valor.slice(5).trim().replace(/\s+/g, ' ');
  if (!nomeU) return '';
  const existente = ds.unidades.find((u) => normalizar(u.nome) === normalizar(nomeU));
  if (existente) return existente.id;
  const id = gerarId('un');
  ds.unidades.push({ id, nome: nomeU, codigo: '', municipio: '' });
  registrar(ds, { entidade: 'unidade', entidadeId: id, acao: 'criar', resumo: `Criada: ${nomeU}` });
  return id;
}
