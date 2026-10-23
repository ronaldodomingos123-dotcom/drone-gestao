/**
 * Previsão de término da área programada pelo ritmo REAL.
 *
 * Entrada: área aplicada em cada dia CORRIDO da janela-base (dias sem operação entram como 0,
 * porque folgas, chuva e manutenção também consomem calendário).
 *
 *   ritmo corrido (ha/dia)      = área da janela ÷ dias corridos da janela
 *                               = média por dia de aplicação × fração de dias com aplicação
 *   dias necessários            = área restante ÷ ritmo corrido   (arredondado para cima)
 *   data prevista               = data-base + dias necessários
 *
 * Faixa provável (~80%): incerteza do ritmo MÉDIO estimada pela variabilidade diária,
 *   ritmo ± 1,28 × desvio-padrão ÷ √n
 * Supõe que os próximos dias se comportem como os da janela-base (mesma frota, clima e escala).
 * Não é uma garantia; é uma extrapolação transparente.
 */
import { addDias, safeDiv } from './calc';

export interface ResultadoPrevisao {
  concluida: boolean;
  semRitmo: boolean;
  diasCorridos: number;
  diasComAplicacao: number;
  fracDiasAplicacao: number | null;
  mediaPorDiaAplicacao: number | null;
  ritmoCorrido: number | null;
  desvioDiario: number | null;
  diasNecessarios: number | null;
  data: string | null;
  faixa: { otimista: { dias: number; data: string }; pessimista: { dias: number; data: string } | null } | null;
}

const Z80 = 1.2816;

export function preverTermino(restanteHa: number, areaPorDiaCorrido: number[], dataBase: string): ResultadoPrevisao {
  const n = areaPorDiaCorrido.length;
  const soma = areaPorDiaCorrido.reduce((a, b) => a + b, 0);
  const comApl = areaPorDiaCorrido.filter((v) => v > 0);
  const ritmo = safeDiv(soma, n);
  const media = ritmo ?? 0;
  const desvio = n > 1 ? Math.sqrt(areaPorDiaCorrido.reduce((a, v) => a + (v - media) ** 2, 0) / (n - 1)) : null;
  const base: ResultadoPrevisao = {
    concluida: restanteHa <= 0.005,
    semRitmo: !ritmo,
    diasCorridos: n,
    diasComAplicacao: comApl.length,
    fracDiasAplicacao: safeDiv(comApl.length, n),
    mediaPorDiaAplicacao: safeDiv(soma, comApl.length),
    ritmoCorrido: ritmo,
    desvioDiario: desvio,
    diasNecessarios: null,
    data: null,
    faixa: null,
  };
  if (base.concluida) return { ...base, diasNecessarios: 0, data: dataBase };
  if (!ritmo) return base;
  const dias = Math.ceil(restanteHa / ritmo);
  let faixa: ResultadoPrevisao['faixa'] = null;
  if (desvio !== null && n >= 3) {
    const erro = (Z80 * desvio) / Math.sqrt(n);
    const otim = Math.ceil(restanteHa / (ritmo + erro));
    const lentoRitmo = ritmo - erro;
    const pess = lentoRitmo > 0 ? Math.ceil(restanteHa / lentoRitmo) : null;
    faixa = { otimista: { dias: otim, data: addDias(dataBase, otim) }, pessimista: pess === null ? null : { dias: pess, data: addDias(dataBase, pess) } };
  }
  return { ...base, diasNecessarios: dias, data: addDias(dataBase, dias), faixa };
}

/** Ritmo necessário (ha/dia corrido) para concluir até o prazo. Prazo vencido ou inválido → null. */
export function ritmoNecessario(restanteHa: number, dataBase: string, prazo: string): number | null {
  if (restanteHa <= 0) return 0;
  const d = diasEntre(dataBase, prazo);
  return d > 0 ? restanteHa / d : null;
}

/** Diferença em dias de calendário (b − a). */
export function diasEntre(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
