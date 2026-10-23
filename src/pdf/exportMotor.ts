/**
 * Motor de exportação (carregado só quando o usuário exporta): Excel (.xlsx, via jszip — MIT) e
 * PDF formatado (via pdf-lib — MIT). Roda no aparelho; nada é enviado.
 */
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { arquivosXLSX, cabecalhoTexto, geradoEmBR } from '../domain/exportar';
import { formatarValor, type Coluna, type Relatorio, type Secao, type Valor } from '../domain/relatorios';

async function xlsx(r: Relatorio): Promise<Blob> {
  const z = new JSZip();
  for (const [caminho, conteudo] of Object.entries(arquivosXLSX(r))) z.file(caminho, conteudo);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

// ---------------- PDF ----------------
const TROCA: Record<string, string> = { '≠': '<>', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '−': '-', '✓': 'v', '✔': 'v', '⠿': '', '▲': '^', '▼': 'v', ' ': ' ', ' ': ' ', '…': '...' };
// caracteres fora do Latin-1 que o WinAnsi (fontes padrão do PDF) aceita
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
const seguro = (s: string) => [...s].map((ch) => TROCA[ch] ?? (ch.charCodeAt(0) <= 0xff || WIN_EXTRA.has(ch) ? ch : '?')).join('').replace(/[\u0000-\u001f]/g, ' ');

const COR = { navy: rgb(0.059, 0.141, 0.259), texto: rgb(0.13, 0.15, 0.2), cinza: rgb(0.36, 0.39, 0.46), linha: rgb(0.86, 0.88, 0.92), zebra: rgb(0.965, 0.972, 0.984), total: rgb(0.93, 0.945, 0.965), verde: rgb(0.106, 0.541, 0.353) };

async function pdf(r: Relatorio): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(seguro(r.titulo)); doc.setAuthor(seguro(r.responsavel)); doc.setCreator('Protótipo de gestão de aplicações com drones'); doc.setCreationDate(new Date());
  const F = await doc.embedFont(StandardFonts.Helvetica);
  const B = await doc.embedFont(StandardFonts.HelveticaBold);
  const retrato = r.id === 'tecnico';
  const W = retrato ? 595.28 : 841.89, H = retrato ? 841.89 : 595.28, M = 32;
  const util = W - 2 * M;
  let pg: PDFPage; let y = 0;
  const larg = (t: string, f: PDFFont, s: number) => f.widthOfTextAtSize(seguro(t), s);
  const txt = (t: string, x: number, yy: number, f: PDFFont, s: number, cor = COR.texto) => pg.drawText(seguro(t), { x, y: yy, size: s, font: f, color: cor });
  const cortar = (t: string, f: PDFFont, s: number, w: number) => { let x = seguro(t); if (f.widthOfTextAtSize(x, s) <= w) return x; while (x.length > 1 && f.widthOfTextAtSize(x + '...', s) > w) x = x.slice(0, -1); return x + '...'; };
  const quebrar = (t: string, f: PDFFont, s: number, w: number) => { const out: string[] = []; let at = ''; for (const p of seguro(t).split(/\s+/)) { const tent = at ? `${at} ${p}` : p; if (f.widthOfTextAtSize(tent, s) <= w || !at) at = tent; else { out.push(at); at = p; } } if (at) out.push(at); return out; };
  const cab = cabecalhoTexto(r);
  const novaPagina = () => {
    pg = doc.addPage([W, H]);
    y = H - M;
    pg.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: COR.navy });
    txt(cab[0], M, y - 12, B, 14, COR.navy); y -= 20;
    for (const l of cab.slice(1)) for (const q of quebrar(l, F, 8, util)) { txt(q, M, y - 9, F, 8, COR.cinza); y -= 11; }
    y -= 6;
    pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: COR.linha });
    y -= 10;
  };
  const precisa = (h: number) => { if (y - h < M + 18) { novaPagina(); return true; } return false; };
  novaPagina();

  // indicadores
  if (r.indicadores.length) {
    const n = r.indicadores.length; const gap = 6; const bw = (util - gap * (n - 1)) / n;
    r.indicadores.forEach((ind, i) => {
      const x = M + i * (bw + gap);
      pg.drawRectangle({ x, y: y - 38, width: bw, height: 38, color: COR.zebra, borderColor: COR.linha, borderWidth: 0.6 });
      txt(cortar(ind.rotulo.toUpperCase(), F, 6.5, bw - 10), x + 6, y - 12, F, 6.5, COR.cinza);
      txt(cortar(formatarValor(ind.valor, ind.tipo) + (ind.tipo === 'ha' ? ' ha' : ind.tipo === 'hah' ? ' ha/h' : ''), B, 12, bw - 10), x + 6, y - 30, B, 12, COR.navy);
    });
    y -= 50;
  }

  const tabela = (s: Secao) => {
    precisa(60);
    txt(s.titulo, M, y - 10, B, 10.5, COR.navy); y -= 18;
    if (s.ficha) {
      const kw = Math.min(170, util * 0.32);
      for (const l of s.linhas) {
        const vs = quebrar(String(l[1] ?? '—'), F, 8.5, util - kw - 12);
        const h = Math.max(1, vs.length) * 11 + 6;
        precisa(h);
        pg.drawLine({ start: { x: M, y: y - h }, end: { x: W - M, y: y - h }, thickness: 0.4, color: COR.linha });
        txt(String(l[0]), M + 4, y - 11, B, 8.5, COR.cinza);
        vs.forEach((v, k) => txt(v, M + kw, y - 11 - k * 11, F, 8.5));
        y -= h;
      }
      y -= 12; return;
    }
    // larguras pelo conteúdo, ajustadas à página
    let fs = 7.5;
    const cel = (v: Valor, c: Coluna) => formatarValor(v, c.tipo, c.casas);
    const medir = (s2: number) => s.colunas.map((c, i) => Math.min(220, Math.max(
      Math.max(...quebrar(c.titulo, B, s2, 9999).map((p) => larg(p, B, s2))) * 0.62 + 8,
      ...s.linhas.slice(0, 400).map((l) => larg(cel(l[i], c), F, s2) + 8),
      s.totais ? larg(cel(s.totais[i], c), B, s2) + 8 : 0, 26)));
    let ws = medir(fs);
    let soma = ws.reduce((a, b) => a + b, 0);
    while (soma > util && fs > 6) { fs -= 0.5; ws = medir(fs); soma = ws.reduce((a, b) => a + b, 0); }
    ws = ws.map((w) => (w * util) / soma); // ocupa a largura toda (e encolhe se ainda não couber)
    const dir = (c: Coluna) => c.tipo !== 'texto' && c.tipo !== 'data';
    const linhasCab = s.colunas.map((c, i) => quebrar(c.titulo, B, fs, ws[i] - 6).slice(0, 3));
    const hCab = Math.max(...linhasCab.map((l) => l.length)) * (fs + 2) + 6;
    const cabecalho = () => {
      pg.drawRectangle({ x: M, y: y - hCab, width: util, height: hCab, color: COR.navy });
      let x = M;
      s.colunas.forEach((c, i) => { linhasCab[i].forEach((p, k) => { const w = larg(p, B, fs); txt(p, dir(c) ? x + ws[i] - 3 - w : x + 3, y - fs - 2 - k * (fs + 2), B, fs, rgb(1, 1, 1)); }); x += ws[i]; });
      y -= hCab;
    };
    cabecalho();
    const hl = fs + 5;
    const desenharLinha = (l: Valor[], negrito: boolean, fundo: ReturnType<typeof rgb> | null) => {
      if (precisa(hl)) cabecalho();
      if (fundo) pg.drawRectangle({ x: M, y: y - hl, width: util, height: hl, color: fundo });
      if (negrito) pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: COR.cinza });
      let x = M;
      s.colunas.forEach((c, i) => { const t = cortar(negrito && (l[i] === null || l[i] === undefined) ? '' : cel(l[i], c), negrito ? B : F, fs, ws[i] - 6); const w = larg(t, negrito ? B : F, fs); txt(t, dir(c) ? x + ws[i] - 3 - w : x + 3, y - fs - 1.5, negrito ? B : F, fs); x += ws[i]; });
      y -= hl;
    };
    s.linhas.forEach((l, k) => desenharLinha(l, false, k % 2 ? COR.zebra : null));
    if (!s.linhas.length) { precisa(14); txt('Sem registros para os filtros escolhidos.', M + 4, y - 10, F, 8, COR.cinza); y -= 14; }
    if (s.totais) desenharLinha(s.totais, true, COR.total);
    if (s.nota) for (const q of quebrar(s.nota, F, 7.5, util)) { precisa(10); txt(q, M, y - 9, F, 7.5, COR.cinza); y -= 10; }
    y -= 14;
  };
  r.secoes.forEach(tabela);
  if (r.notas.length) { precisa(20); txt('Notas', M, y - 10, B, 9, COR.navy); y -= 15; for (const n of r.notas) for (const q of quebrar(`• ${n}`, F, 7.5, util)) { precisa(10); txt(q, M, y - 9, F, 7.5, COR.cinza); y -= 10; } }
  // rodapé com paginação
  const pags = doc.getPages();
  pags.forEach((p, i) => {
    pg = p;
    const rod = `Página ${i + 1} de ${pags.length} · Gerado em ${geradoEmBR(r.geradoEm)} · Responsável: ${r.responsavel}`;
    pg.drawLine({ start: { x: M, y: M + 6 }, end: { x: W - M, y: M + 6 }, thickness: 0.4, color: COR.linha });
    txt(rod, W - M - larg(rod, F, 7), M - 4, F, 7, COR.cinza);
    txt(cortar(r.titulo, F, 7, util / 2), M, M - 4, F, 7, COR.cinza);
  });
  return doc.save();
}

/** Lê a 1ª aba de um .xlsx como linhas de células (texto, número ou null). */
async function lerXlsx(dados: ArrayBuffer): Promise<(string | number | null)[][]> {
  const z = await JSZip.loadAsync(dados);
  const txt = async (p: string) => (z.file(p) ? await z.file(p)!.async('string') : '');
  const dom = (x: string) => new DOMParser().parseFromString(x, 'application/xml');
  const wb = dom(await txt('xl/workbook.xml'));
  const rels = dom(await txt('xl/_rels/workbook.xml.rels'));
  const primeira = wb.getElementsByTagName('sheet')[0];
  const rid = primeira?.getAttribute('r:id') ?? primeira?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  let alvo = 'xl/worksheets/sheet1.xml';
  for (const r of Array.from(rels.getElementsByTagName('Relationship'))) if (r.getAttribute('Id') === rid) { const t = r.getAttribute('Target') ?? ''; alvo = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`; }
  const ss = dom(await txt('xl/sharedStrings.xml'));
  const comp = Array.from(ss.getElementsByTagName('si')).map((si) => Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  const sh = dom(await txt(alvo));
  const col = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const linhas: (string | number | null)[][] = [];
  for (const row of Array.from(sh.getElementsByTagName('row'))) {
    const l: (string | number | null)[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const i = col(c.getAttribute('r') ?? 'A'); const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null;
      let val: string | number | null = null;
      if (t === 's') val = v === null ? null : comp[Number(v)] ?? null;
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      else if (t === 'str' || t === 'b' || t === 'e') val = v;
      else val = v === null ? null : Number(v);
      while (l.length < i) l.push(null);
      l[i] = val;
    }
    linhas[Number(row.getAttribute('r') ?? linhas.length + 1) - 1] = l;
  }
  return Array.from(linhas, (l) => l ?? []);
}

(window as unknown as { __motorExport: unknown }).__motorExport = { xlsx, pdf, lerXlsx };
