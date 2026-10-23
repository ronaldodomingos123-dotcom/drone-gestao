/** Carrega o motor de PDF (embutido no próprio arquivo) só na primeira vez que for usado. */
export interface Caixa { x0: number; x1: number }
export interface PdfExtraido { paginas: number; linhas: string[]; caixas: Caixa[][]; caracteres: number }
interface Motor { extrair(dados: ArrayBuffer): Promise<PdfExtraido> }
import { carregarMotor } from './motores';
export const carregarMotorPdf = () => carregarMotor<Motor>('motor-pdf', '__motorPdf');
