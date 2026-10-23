/**
 * Exportação dos relatórios — partes puras (testáveis em Node):
 *   - CSV no padrão do Excel brasileiro (separador ";", vírgula decimal, BOM UTF-8);
 *   - XLSX montado como XML (SpreadsheetML) — o .zip é feito pelo motor de exportação (jszip);
 *   - nome de arquivo seguro.
 * Todos levam o cabeçalho obrigatório: título, período, filtros, data de geração e responsável.
 */
import { formatarValor, type Relatorio, type TipoCol, type Valor } from './relatorios';

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
export const geradoEmBR = (iso: string) => `${dataBR(iso)} ${iso.slice(11, 16)}`;
export function cabecalhoTexto(r: Relatorio): string[] {
  return [
    r.titulo,
    r.periodo ? `Período: ${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)}` : '',
    `Filtros: ${r.filtros.join(' · ')}`,
    `Gerado em: ${geradoEmBR(r.geradoEm)} · Responsável: ${r.responsavel}`,
  ].filter(Boolean);
}

export function nomeArquivo(r: Relatorio, ext: string): string {
  const base = r.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const per = r.periodo ? `_${r.periodo.de}_a_${r.periodo.ate}` : '';
  return `${base}${per}.${ext}`;
}

// ---------------- CSV ----------------
function celCSV(v: Valor, tipo: TipoCol, casas?: number): string {
  let s: string;
  if (v === null || v === undefined) s = '';
  else if (typeof v === 'number') {
    if (!Number.isFinite(v)) s = '';
    else if (tipo === 'min') s = String(Math.round(v)); // minutos como número (melhor para somar no Excel)
    else s = v.toFixed(tipo === 'int' ? 0 : casas ?? (tipo === 'dose' ? 4 : 2)).replace('.', ',');
  } else s = tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dataBR(v) : v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function paraCSV(r: Relatorio): string {
  const linhas: string[] = cabecalhoTexto(r).map((l) => celCSV(l, 'texto'));
  if (r.indicadores.length) { linhas.push(''); for (const i of r.indicadores) linhas.push(`${celCSV(i.rotulo, 'texto')};${celCSV(i.valor, i.tipo)}`); }
  for (const s of r.secoes) {
    linhas.push('', celCSV(s.titulo, 'texto'));
    linhas.push(s.colunas.map((c) => celCSV(c.tipo === 'min' ? `${c.titulo} (min)` : c.titulo, 'texto')).join(';'));
    for (const l of s.linhas) linhas.push(l.map((v, i) => celCSV(v, s.colunas[i].tipo, s.colunas[i].casas)).join(';'));
    if (s.totais) linhas.push(s.totais.map((v, i) => celCSV(v, s.colunas[i].tipo, s.colunas[i].casas)).join(';'));
    if (s.nota) linhas.push(celCSV(s.nota, 'texto'));
  }
  if (r.notas.length) { linhas.push(''); for (const n of r.notas) linhas.push(celCSV(n, 'texto')); }
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

// ---------------- XLSX (XML) ----------------
const xesc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colLetra = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// estilos: 0 normal · 1 título · 2 cabeçalho de tabela · 3 #,##0.00 · 4 #,##0 · 5 0.0% (valor já em %, formato "0,0"%) · 6 data · 7 [h]:mm · 8 #,##0.000 · 9 total texto · 10 total 2 casas · 11 subtítulo cinza
const ESTILO: Record<TipoCol, number> = { texto: 0, int: 4, num: 3, ha: 3, pct: 5, hah: 3, data: 6, min: 7, dose: 8 };
function serialData(iso: string): number { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }

function celXLSX(ref: string, v: Valor, tipo: TipoCol, estiloForcado?: number): string {
  if (v === null || v === undefined || v === '') return '';
  let st = estiloForcado ?? ESTILO[tipo];
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    let n = v;
    if (tipo === 'min') n = v / 1440; // fração de dia → [h]:mm
    if (tipo === 'pct') n = v / 100;
    if (estiloForcado === 10) st = tipo === 'int' ? 13 : tipo === 'pct' ? 14 : tipo === 'min' ? 15 : 10;
    return `<c r="${ref}" s="${st}"><v>${n}</v></c>`;
  }
  if (tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="${estiloForcado === 10 ? 9 : 6}"><v>${serialData(v)}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${estiloForcado === 10 ? 9 : st === 6 ? 0 : st}"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
}

/** Arquivos do pacote .xlsx (caminho → conteúdo XML). Uma aba "Relatório" com todas as seções. */
export function arquivosXLSX(r: Relatorio): Record<string, string> {
  const rows: string[] = [];
  let lin = 0;
  const larg: number[] = [];
  const medir = (i: number, s: string) => { larg[i] = Math.min(60, Math.max(larg[i] ?? 8, s.length + 2)); };
  const linha = (cels: string) => { lin++; rows.push(`<row r="${lin}">${cels}</row>`); };
  const texto = (s: string, st: number) => `<c r="A${lin + 1}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${xesc(s)}</t></is></c>`;
  cabecalhoTexto(r).forEach((t, i) => linha(texto(t, i === 0 ? 1 : 11)));
  if (r.indicadores.length) {
    linha('');
    for (const ind of r.indicadores) { const n = lin + 1; linha(`<c r="A${n}" t="inlineStr" s="2"><is><t>${xesc(ind.rotulo)}</t></is></c>${celXLSX(`B${n}`, ind.valor, ind.tipo)}`); medir(0, ind.rotulo); }
  }
  for (const s of r.secoes) {
    linha(''); linha(texto(s.titulo, 12));
    const nCab = lin + 1;
    linha(s.colunas.map((c, i) => { medir(i, c.titulo); return `<c r="${colLetra(i)}${nCab}" t="inlineStr" s="2"><is><t xml:space="preserve">${xesc(c.titulo)}</t></is></c>`; }).join(''));
    for (const l of s.linhas) { const n = lin + 1; linha(l.map((v, i) => { medir(i, formatarValor(v, s.colunas[i].tipo, s.colunas[i].casas)); return celXLSX(`${colLetra(i)}${n}`, v, s.colunas[i].tipo); }).join('')); }
    if (s.totais) { const n = lin + 1; linha(s.totais.map((v, i) => celXLSX(`${colLetra(i)}${n}`, v, s.colunas[i].tipo, 10)).join('')); }
    if (s.nota) linha(texto(s.nota, 11));
  }
  if (r.notas.length) { linha(''); for (const n of r.notas) linha(texto(n, 11)); }
  const cols = larg.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w ?? 10}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows.join('')}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="[h]:mm"/><numFmt numFmtId="168" formatCode="#,##0.000"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0F2442"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF5B6475"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F2442"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F6"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FF9AA3B2"/></top></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1"/>
<xf numFmtId="3" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs></styleSheet>`;
  const titulo = xesc(r.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xesc(r.titulo)}</dc:title><dc:creator>${xesc(r.responsavel)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xesc(r.geradoEm.slice(0, 19))}Z</dcterms:created></cp:coreProperties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${titulo}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheet,
  };
}
