/**
 * Modelo de domínio do protótipo.
 *
 * Hierarquia de localização:  Unidade → Fazenda → Talhão
 * Hierarquia de trabalho:     Campanha → Ordem de Serviço (itens por talhão, com área planejada)
 *                             → Operação (registro de campo) → itens aplicados por talhão
 *                             → Calda → Produtos (classe, dose e unidade próprias)
 *
 * Regra central contra dupla contagem: a ÁREA só existe nos itens (talhão × área) da operação.
 * Produtos e calda nunca carregam área; somar produtos não soma hectares.
 */

import type { MetaOperacional } from './metas';

export type ID = string;

export interface Unidade {
  id: ID;
  nome: string;
  codigo: string;
  municipio: string;
}

export interface Fazenda {
  id: ID;
  unidadeId: ID;
  codigo: string; // número da fazenda (FN)
  nome: string;
  municipio: string;
  /** Estação meteorológica de referência (ligada pelo código na importação ou escolhida no cadastro). */
  estacaoId?: string;
  /** Centro da área aplicada (aprendido do KML de voo), para reconhecer a fazenda nos próximos KML. */
  lat?: number;
  lon?: number;
}

export interface Talhao {
  id: ID;
  fazendaId: ID;
  codigo: string;
  /** Zona (agrupamento de talhões dentro da fazenda), quando houver. */
  zona?: string;
  areaHa: number;
  /** Talhão único criado pela importação da sequência (fazenda ainda sem talhões cadastrados). */
  geral?: boolean;
  /** Contorno do talhão (anel externo, [lon, lat]) vindo do mapa de talhões (KML). */
  poligono?: [number, number][];
  /** Áreas do mapa: plantada (base do programado), total do polígono (com carreador). */
  areaPlantadaHa?: number;
  areaTotalHa?: number;
  /** Restrição de voo indicada no mapa. */
  restricaoVoo?: boolean;
  restricao?: string;
}

export type TipoCampanha = 'Maturador' | 'Inseticida' | 'Fungicida' | 'Herbicida' | 'Dessecação' | 'Fertilizante foliar';

export interface Campanha {
  id: ID;
  nome: string;
  tipo: TipoCampanha;
  cultura: string;
  inicio: string; // AAAA-MM-DD
  fim: string;
  /** Calda padrão da campanha (produtos e doses). Novas OS herdam esta calda. */
  calda?: Calda;
}

export type ClasseProduto = 'Maturador' | 'Inseticida' | 'Fungicida' | 'Herbicida' | 'Adjuvante' | 'Fertilizante foliar';

/** Unidades de DOSE (quantidade de produto por hectare). Volume de calda é outra grandeza (L/ha). */
export type UnidadeDose = 'L/ha' | 'mL/ha' | 'kg/ha' | 'g/ha';

export interface Produto {
  id: ID;
  nome: string;
  /** Código do insumo no sistema da empresa (ex.: coluna CÓDIGO do resumo de insumos). */
  codigo?: string;
  classe: ClasseProduto;
  unidadeDose: UnidadeDose;
  /** Unidade de estoque/quantidade total (L, kg) — usada no cálculo de quantidade total. */
  unidadeTotal: 'L' | 'kg';
}

export interface ProdutoNaCalda {
  produtoId: ID;
  dosePlanejada: number;
  doseReal: number | null;
  unidade: UnidadeDose;
  lote?: string;
}

export interface Calda {
  /** Nome do conjunto de produtos (ex.: "Tratamento 1"). */
  tratamento?: string;
  volumeLHa: number; // volume de calda por hectare (L/ha) — NÃO é dose
  produtos: ProdutoNaCalda[];
}

export type StatusOS = 'aberta' | 'em_execucao' | 'concluida' | 'cancelada';
export type TipoAplicacao = 'Pulverização' | 'Aplicação de sólidos' | 'Semeadura';

export interface ItemOS {
  talhaoId: ID;
  /** Área programada BRUTA do talhão (ex.: 32,70). É a meta da OS. */
  areaPlanejadaHa: number;
  /** Desconto PREVISTO (obstáculo conhecido antes da aplicação). Só informativo: o obstáculo real
   *  é apurado ao concluir a OS (programado − aplicado). */
  naoAplicadoHa?: number;
}

export interface OrdemServico {
  id: ID;
  numero: string;
  campanhaId: ID;
  unidadeId: ID;
  fazendaId: ID;
  tipo: TipoAplicacao;
  status: StatusOS;
  emissao: string;
  itens: ItemOS[];
  calda: Calda;
  observacoes?: string;
  /** Ordem de execução na campanha (1 = primeira). */
  sequencia?: number;
  /** Ordem na sequência "Todas as campanhas" (1 = primeira). OS nova entra no fim. */
  sequenciaGeral?: number;
  /** Título/tipo vindo da programação importada (ex.: produto ou finalidade). */
  titulo?: string;
  /** Concluída manualmente (ex.: área real menor que a programada). */
  concluidaManual?: boolean;
}

export type StatusAeronave = 'disponivel' | 'em_operacao' | 'manutencao' | 'indisponivel';

export interface Aeronave {
  id: ID;
  identificacao: string;
  modelo: string;
  numeroSerie: string;
  status: StatusAeronave;
  unidadeId: ID;
  horasAnteriores: number; // horas de voo antes do período registrado no protótipo
  /** Piloto fixo do drone (preenche o Fechamento do dia). */
  pilotoPadraoId?: ID;
}

export type FuncaoColaborador = 'Piloto' | 'Auxiliar de campo' | 'Técnico de calda' | 'Líder de turno' | 'Supervisor';

export type PeriodoTurno = 'Diurno' | 'Noturno';

/** Turno de trabalho com líder responsável. Substitui o conceito de "cliente" nesta operação. */
export interface Turno {
  id: ID;
  nome: string;
  periodo: PeriodoTurno;
  horaInicio: string; // HH:MM
  horaFim: string; // HH:MM (pode virar o dia)
  liderId: ID; // líder padrão do turno
  ativo: boolean;
}

export interface Colaborador {
  id: ID;
  nome: string;
  funcao: FuncaoColaborador;
  unidadeId: ID;
  ativo: boolean;
}

export type MomentoClima = 'inicio' | 'durante' | 'fim';
export type CondicaoChuva = 'sem chuva' | 'garoa' | 'chuva';

export interface LeituraClima {
  momento: MomentoClima;
  hora: string; // HH:MM
  temperaturaC: number | null;
  umidadePct: number | null;
  ventoKmh: number | null;
  rajadaKmh: number | null;
  direcaoVento: string | null;
  chuva: CondicaoChuva | null;
  orvalho: boolean | null;
  origem: string; // ex.: estação portátil, estação fixa, app de previsão
  observacoes?: string;
}

export type StatusOperacao = 'concluida' | 'parcial' | 'impedida_clima' | 'em_andamento';

export interface ItemAplicado {
  talhaoId: ID;
  areaHa: number;
}

export interface Operacao {
  id: ID;
  data: string; // data de INÍCIO da operação (AAAA-MM-DD)
  horaInicio: string; // HH:MM
  horaFim: string | null; // HH:MM; se menor que o início, a operação cruzou a meia-noite
  osId: ID;
  campanhaId: ID;
  cultura: string;
  turnoId: ID;
  /** Líder que respondeu pelo turno nesta operação (pode diferir do líder padrão, ex.: substituição). */
  liderId: ID;
  aeronaveId: ID;
  pilotoId: ID;
  auxiliarIds: ID[];
  equipamentosAuxiliares?: string;
  status: StatusOperacao;
  itens: ItemAplicado[];
  /** Tempo efetivo de aplicação informado (minutos). Não inclui paradas nem deslocamento. */
  tempoEfetivoMin: number;
  calda: Calda;
  velocidadeMs?: number | null;
  alturaVooM?: number | null;
  faixaM?: number | null;
  clima: LeituraClima[];
  observacoesTecnicas?: string;
  observacoesOperador?: string;
  responsavelEncerramento?: string;
  origem: 'demo' | 'registro_prototipo';
  criadoEm: string; // ISO
  /** Data do Fechamento do dia que gerou esta operação (ficha diária); reimportar o dia substitui. */
  fechamentoDia?: string;
  /** Medido no KML de voo: cargas, tempo com o drone no ar, volume pulverizado e taxa real. */
  voo?: { origem: 'kml'; cargas: number; tempoVooMin: number; volumeL: number; taxaLHa: number | null; foraTaxa: number; dividido: boolean };
}

export type MotivoParada =
  | 'Vento acima do limite'
  | 'Umidade abaixo do limite'
  | 'Chuva'
  | 'Orvalho'
  | 'Manutenção'
  | 'Abastecimento/reabastecimento'
  | 'Falta de insumos'
  | 'Problemas de equipe'
  | 'Falha de equipamento'
  | 'Deslocamento'
  | 'Fim de tarefa'
  | 'Troca de turno'
  | 'Refeição/intervalo'
  | 'Aguardando liberação'
  | 'Outros';

export const MOTIVOS_PARADA: MotivoParada[] = [
  'Vento acima do limite',
  'Umidade abaixo do limite',
  'Chuva',
  'Orvalho',
  'Manutenção',
  'Abastecimento/reabastecimento',
  'Falta de insumos',
  'Problemas de equipe',
  'Falha de equipamento',
  'Deslocamento',
  'Fim de tarefa',
  'Troca de turno',
  'Refeição/intervalo',
  'Aguardando liberação',
  'Outros',
];

export const MOTIVOS_CLIMATICOS: MotivoParada[] = ['Vento acima do limite', 'Umidade abaixo do limite', 'Chuva', 'Orvalho'];

export interface Parada {
  id: ID;
  operacaoId: ID;
  inicio: string; // ISO local AAAA-MM-DDTHH:MM
  fim: string | null;
  motivo: MotivoParada;
  observacoes?: string;
  responsavel: string;
}

/** Limites climáticos de referência — SEMPRE configuráveis; devem seguir bula/recomendação técnica. */
export interface LimitesClima {
  ventoMaxKmh: number;
  ventoMinKmh: number;
  umidadeMinPct: number;
  temperaturaMaxC: number;
}

/**
 * Lançamento de área aplicada sem o registro técnico do voo (sem drone, horário, clima): vem da edição
 * do "Aplicado" na Sequência ou da ficha diária. Conta na área aplicada, saldo, obstáculo e evolução;
 * NÃO entra em produtividade (ha/h) nem em indicadores por drone/piloto/turno.
 */
export interface LancamentoArea {
  id: ID;
  data: string; // AAAA-MM-DD
  osId: ID;
  campanhaId: ID;
  itens: ItemAplicado[];
  origem: 'manual' | 'ficha_diaria';
  observacao?: string;
  criadoEm: string;
}

export interface Dataset {
  versao: number;
  geradoEm: string;
  unidades: Unidade[];
  fazendas: Fazenda[];
  talhoes: Talhao[];
  campanhas: Campanha[];
  produtos: Produto[];
  ordens: OrdemServico[];
  aeronaves: Aeronave[];
  colaboradores: Colaborador[];
  turnos: Turno[];
  operacoes: Operacao[];
  /** Área aplicada lançada sem operação de campo (editada na Sequência ou importada da ficha diária). */
  lancamentos: LancamentoArea[];
  /** Estações meteorológicas importadas e seus registros (diário ou por intervalo). */
  estacoes: import('./estacao').EstacaoMet[];
  registrosEstacao: import('./estacao').RegistroEstacao[];
  paradas: Parada[];
  limites: LimitesClima;
  metas: MetaOperacional;
  /** Dias sem aplicação registrados (chuva, vento…), por campanha ou para todas. */
  diasParados?: import('./dias').DiaParado[];
  /** Meta e período da safra, independentes das campanhas. */
  safra?: import('./dias').Safra;
  /** 'demo' = dados fictícios; 'propria' = base do usuário (nunca é regenerada automaticamente). */
  origemBase: 'demo' | 'propria';
  auditoria: RegistroAuditoria[];
}

export type EntidadeAuditada = 'unidade' | 'fazenda' | 'talhao' | 'campanha' | 'ordem' | 'aeronave' | 'colaborador' | 'turno' | 'produto' | 'operacao' | 'lancamento' | 'base' | 'configuracao';

export interface RegistroAuditoria {
  id: ID;
  quando: string; // ISO
  usuario: string;
  entidade: EntidadeAuditada;
  entidadeId: string;
  acao: 'criar' | 'editar' | 'excluir' | 'inativar' | 'reativar' | 'importar' | 'concluir' | 'reabrir' | 'corrigir' | 'reordenar' | 'base';
  resumo: string;
  motivo?: string;
  antes?: unknown;
  depois?: unknown;
}
