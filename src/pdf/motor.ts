/**
 * Motor de leitura de PDF (pdf.js, Apache-2.0), empacotado à parte e carregado só quando o usuário
 * abre a importação por PDF. Roda 100% no aparelho: o arquivo não é enviado a lugar nenhum.
 * Reconstrói as LINHAS do PDF a partir das posições do texto; células separadas por TAB
 * quando há espaço visível entre os trechos (colunas de tabela).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker; // "fake worker": sem arquivo externo

interface Trecho { x: number; y: number; w: number; h: number; s: string }
export interface Caixa { x0: number; x1: number }
export interface PdfExtraido { paginas: number; linhas: string[]; caixas: Caixa[][]; caracteres: number }

async function extrair(dados: ArrayBuffer): Promise<PdfExtraido> {
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(dados), isEvalSupported: false, useSystemFonts: true });
  const doc = await tarefa.promise;
  const paginas: number = doc.numPages;
  const linhas: string[] = [];
  const caixas: Caixa[][] = [];
  let caracteres = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    const ts: Trecho[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      ts.push({ x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.height || it.transform[3]) || 8, s: it.str });
      caracteres += it.str.trim().length;
    }
    // agrupa por linha (mesma altura, tolerância de meia linha)
    ts.sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos: Trecho[][] = [];
    for (const t of ts) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(g[0].y - t.y) <= Math.max(2, Math.min(g[0].h, t.h) * 0.5)) g.push(t); else grupos.push([t]);
    }
    for (const g of grupos) {
      g.sort((a, b) => a.x - b.x);
      // células: trechos separados por espaço visível; cada célula guarda onde começa e termina (x)
      const cels: { s: string; x0: number; x1: number }[] = [];
      let fim = -Infinity;
      for (const t of g) {
        const gap = t.x - fim;
        const esp = t.h * 0.25; // ~ largura de um espaço
        const txt = t.s.replace(/\s+/g, ' ').trim();
        const ult = cels[cels.length - 1];
        if (ult && gap <= esp * 3) { ult.s += (gap > esp * 0.6 ? ' ' : '') + txt; ult.x1 = Math.max(ult.x1, t.x + t.w); }
        else cels.push({ s: txt, x0: t.x, x1: t.x + t.w });
        fim = Math.max(fim, t.x + t.w);
      }
      const ok = cels.filter((c) => c.s);
      linhas.push(ok.map((c) => c.s).join('\t'));
      caixas.push(ok.map((c) => ({ x0: Math.round(c.x0 * 10) / 10, x1: Math.round(c.x1 * 10) / 10 })));
    }
    try { pg.cleanup(); } catch { /* opcional */ }
  }
  try { await tarefa.destroy(); } catch { /* liberar memória é opcional */ }
  return { paginas, linhas, caixas, caracteres };
}

(window as unknown as { __motorPdf: unknown }).__motorPdf = { extrair };
