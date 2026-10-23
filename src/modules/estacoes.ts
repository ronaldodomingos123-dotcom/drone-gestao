/**
 * Estações meteorológicas: importar o relatório da plataforma da estação (xlsx/csv, diário ou por
 * intervalo), ligar estações às fazendas e ver o clima dos dias com aplicação.
 */
import { registrar } from '../domain/base';
import { contextoClima, deltaT, importarEstacao, resumoDiario, lerRelatorioEstacao, nomeCurtoEstacao, type LeituraRelatorio } from '../domain/estacao';
import { alterar, estado, nome, redesenhar } from '../state';
import { aviso, cabecalhoPagina } from '../ui/components';
import { barras, CORES, legenda, linhas } from '../ui/charts';
import { abrirModal, esc, fmtData, fmtNum, toast } from '../ui/dom';
import { icone } from '../ui/icons';
import { carregarMotor } from '../ui/motores';

let estacaoSel = '';

function lerCSV(texto: string): (string | number | null)[][] {
  const ls = texto.replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const sep = (ls[0] ?? '').includes(';') ? ';' : (ls[0] ?? '').includes('\t') ? '\t' : ',';
  return ls.map((l) => { const out: string[] = []; let at = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === sep && !q) { out.push(at); at = ''; continue; } at += ch; } out.push(at); return out.map((c) => c.trim()); });
}

export async function lerArquivoEstacao(f: File): Promise<LeituraRelatorio> {
  if (/\.xlsx$/i.test(f.name)) {
    const m = await carregarMotor<{ lerXlsx(b: ArrayBuffer): Promise<(string | number | null)[][]> }>('motor-export', '__motorExport');
    return lerRelatorioEstacao(await m.lerXlsx(await f.arrayBuffer()));
  }
  return lerRelatorioEstacao(lerCSV(await f.text()));
}

export function renderEstacoes(raiz: HTMLElement) {
  const ds = estado.ds;
  const est = [...(ds.estacoes ?? [])].sort((a, b) => Number(a.pic || 999) - Number(b.pic || 999));
  if (!est.some((e) => e.id === estacaoSel)) estacaoSel = est.find((e) => ds.fazendas.some((f) => f.estacaoId === e.id))?.id ?? est[0]?.id ?? '';
  const regs = ds.registrosEstacao ?? [];
  const ultimo = regs.length ? regs[regs.length - 1].inicio.slice(0, 10) : null;
  const horario = regs.some((r) => !r.diario);
  raiz.innerHTML = `${cabecalhoPagina('Estações meteorológicas', 'Importe o relatório da plataforma da estação (Excel ou CSV). O clima entra nas aplicações, no Diário e nos relatórios.', `<label class="btn btn-pri">${icone('camadas', 16)} Importar relatório<input type="file" accept=".xlsx,.csv,.txt" data-est="arquivo" hidden></label>`)}
    ${!est.length ? aviso('info', 'Nenhuma estação importada. No site da estação, exporte o <b>relatório horário</b> (ideal: dá a condição no horário de cada voo) ou o <b>diário</b> (contexto do dia) em Excel e importe aqui.') : `
    <div class="chips-info"><span>Estações <b>${est.length}</b></span><span>Com sensor de vento <b>${est.filter((e) => e.temVento).length}</b></span><span>Registros <b>${regs.length}</b></span><span>Tipo <b>${horario ? 'horário/intervalo' : 'diário'}</b></span><span>Último dado <b>${ultimo ? esc(fmtData(ultimo)) : '—'}</b></span><span>Fazendas ligadas <b data-est-ligadas>${ds.fazendas.filter((f) => f.estacaoId).length}/${ds.fazendas.length}</b></span></div>
    ${horario ? '' : aviso('atencao', 'Só há dados <b>diários</b>: o app mostra o <b>contexto do dia</b> (chuva, rajada máx., UR mín., T máx., ΔT estimado na pior hora). Para a condição no horário do voo, importe o relatório horário.')}
    <div class="grade-graficos">
      <section class="cartao meio"><header class="cartao-cab" style="flex-wrap:wrap"><h2>Estação</h2><select data-est="sel" style="max-width:100%;min-width:0;flex:1 1 180px">${est.map((e) => `<option value="${esc(e.id)}" ${e.id === estacaoSel ? 'selected' : ''}>${esc(nomeCurtoEstacao(e))}${e.temVento ? '' : ' (sem vento)'}</option>`).join('')}</select></header>
        ${legenda([{ nome: 'T máx.', cor: CORES.operacional }, { nome: 'T mín.', cor: CORES.efetiva }])}<div id="g-est-t"></div></section>
      <section class="cartao meio"><header class="cartao-cab"><div><h2>Chuva por dia (mm)</h2><p>Total do relatório diário; sem ele, soma das horas</p></div></header><div id="g-est-chuva"></div></section>
    </div>
    <section class="cartao"><header class="cartao-cab"><h2>Registros da estação</h2></header><div class="tabela-rolagem" id="est-tab"></div></section>
    <section class="cartao"><header class="cartao-cab"><div><h2>Aplicações × estação</h2><p>Operações das fazendas ligadas a uma estação, com o clima da estação e os alertas contra os limites.</p></div></header><div class="tabela-rolagem" id="est-ops"></div></section>`}
    <section class="cartao"><header class="cartao-cab"><div><h2>Fazendas ↔ estação</h2><p>Ligadas automaticamente pelo código da fazenda no nome da estação. Para fazenda sem estação própria, escolha a mais próxima.</p></div></header><div class="tabela-rolagem" id="est-faz"></div></section>`;
  const desenharEstacao = () => {
    const e = est.find((x) => x.id === estacaoSel);
    if (!e) return;
    const rs = regs.filter((r) => r.estacaoId === e.id);
    const agg = resumoDiario(estado.ds, e.id); const dias = agg.map((a) => a.data);
    linhas(raiz.querySelector('#g-est-t') as HTMLElement, dias, [{ nome: 'T máx.', cor: CORES.operacional, valores: agg.map((a) => a.tmax) }, { nome: 'T mín.', cor: CORES.efetiva, valores: agg.map((a) => a.tmin) }], { unidade: '°C', rotuloX: (r, i, n) => (n <= 10 || i % Math.ceil(n / 8) === 0 ? fmtData(r).slice(0, 5) : null), titulo: (r) => fmtData(r) });
    barras(raiz.querySelector('#g-est-chuva') as HTMLElement, agg.map((a) => ({ rotulo: a.data, valor: a.chuva ?? 0, titulo: `${fmtData(a.data)} · ${a.fonte === 'diario' ? 'relatório diário' : `${a.horas} h do relatório horário`}` })), { cor: CORES.planejado, unidade: 'mm', rotuloX: (r, i, n) => (n <= 10 || i % Math.ceil(n / 8) === 0 ? fmtData(r).slice(0, 5) : null) });
    const f = (v: number | null, c = 1) => (v === null ? '—' : esc(fmtNum(v, c)));
    (raiz.querySelector('#est-tab') as HTMLElement).innerHTML = `<table class="tabela tabela-simples rel-t"><thead><tr><th>Início</th><th>Fim</th><th class="dir">Chuva (mm)</th><th class="dir">T mín./méd./máx. (°C)</th><th class="dir">UR mín./méd./máx. (%)</th><th class="dir">Vento (km/h)</th><th class="dir">Rajada (km/h)</th><th class="dir">ΔT pior (°C)</th><th class="dir">ET₀ (mm)</th></tr></thead><tbody>
      ${rs.slice(-300).reverse().map((r) => { const dt = deltaT(r.diario ? r.tmax : r.tmed, r.diario ? r.urmin : r.urmed); return `<tr><td>${esc(fmtData(r.inicio.slice(0, 10)))}${r.inicio.length > 10 ? ` ${esc(r.inicio.slice(11))}` : ''}</td><td>${r.fim.length > 10 ? esc(r.fim.slice(11)) : esc(fmtData(r.fim))}</td><td class="dir">${f(r.chuva)}</td><td class="dir">${f(r.tmin)} / ${f(r.tmed)} / ${f(r.tmax)}</td><td class="dir">${f(r.urmin, 0)} / ${f(r.urmed, 0)} / ${f(r.urmax, 0)}</td><td class="dir ${r.vento !== null && r.vento > ds.limites.ventoMaxKmh ? 'txt-critico' : ''}">${f(r.vento)}</td><td class="dir ${r.rajada !== null && r.rajada > ds.limites.ventoMaxKmh ? 'txt-critico' : ''}">${f(r.rajada)}</td><td class="dir ${dt !== null && dt > 8 ? 'txt-critico' : ''}">${f(dt)}</td><td class="dir">${f(r.et0)}</td></tr>`; }).join('')}</tbody></table>`;
  };
  const desenharOps = () => {
    const ds = estado.ds;
    const host = raiz.querySelector('#est-ops') as HTMLElement | null;
    if (!host) return;
    const ops = ds.operacoes.map((op) => ({ op, c: contextoClima(ds, op) })).filter((x) => x.c).sort((a, b) => (b.op.data + b.op.horaInicio).localeCompare(a.op.data + a.op.horaInicio)).slice(0, 200);
    const f = (v: number | null, c = 1) => (v === null ? '—' : esc(fmtNum(v, c)));
    host.innerHTML = ops.length ? `<table class="tabela tabela-simples rel-t"><thead><tr><th>Data</th><th>Fazenda / OS</th><th>Drone</th><th>Estação</th><th>Base</th><th class="dir">Chuva</th><th class="dir">T máx.</th><th class="dir">UR mín.</th><th class="dir">Rajada</th><th class="dir">ΔT pior</th><th>Alertas</th></tr></thead><tbody>
      ${ops.map(({ op, c }) => `<tr><td>${esc(fmtData(op.data))} ${esc(op.horaInicio)}</td><td>${esc(nome.fazenda(ds.ordens.find((o) => o.id === op.osId)?.fazendaId ?? ''))}<small class="bloco muted">OS ${esc(nome.os(op.osId))}</small></td><td>${esc(nome.aeronave(op.aeronaveId))}</td><td>PIC ${esc(c!.estacao.pic)}</td><td>${c!.diario ? '<span class="selo selo-neutro">dia</span>' : '<span class="selo selo-info">voo</span>'}</td><td class="dir">${f(c!.chuva)}</td><td class="dir">${f(c!.tmax)}</td><td class="dir">${f(c!.urmin, 0)}</td><td class="dir">${f(c!.rajada)}</td><td class="dir">${f(c!.deltaTPior)}</td><td>${c!.alertas.filter((a) => a !== 'estação sem sensor de vento').map((a) => `<span class="selo selo-atencao">${esc(a)}</span>`).join(' ') || '<span class="selo selo-ok">ok</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="vazio-txt">Nenhuma operação em data/fazenda coberta pelas estações importadas.</p>';
  };
  const desenharFaz = () => {
    const host = raiz.querySelector('#est-faz') as HTMLElement;
    host.innerHTML = ds.fazendas.length ? `<table class="tabela tabela-simples"><thead><tr><th>Fazenda</th><th>Estação de referência</th></tr></thead><tbody>${[...ds.fazendas].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })).map((f) => `<tr><td>${esc(nome.fazenda(f.id))}</td><td><select data-est="faz" data-id="${esc(f.id)}"><option value="">Sem estação</option>${est.map((e) => `<option value="${esc(e.id)}" ${f.estacaoId === e.id ? 'selected' : ''}>${esc(nomeCurtoEstacao(e))}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>` : '<p class="vazio-txt">Nenhuma fazenda cadastrada.</p>';
  };
  raiz.addEventListener('change', async (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.est === 'sel') { estacaoSel = el.value; desenharEstacao(); }
    if (el.dataset.est === 'faz') {
      const erro = alterar((d) => { const f = d.fazendas.find((x) => x.id === el.dataset.id)!; const antes = f.estacaoId; if (el.value) f.estacaoId = el.value; else delete f.estacaoId; registrar(d, { entidade: 'fazenda', entidadeId: f.id, acao: 'editar', resumo: `Estação de ${f.nome}: ${el.value ? nomeCurtoEstacao(d.estacoes.find((e) => e.id === el.value)!) : 'nenhuma'}`, antes: { estacaoId: antes }, depois: { estacaoId: f.estacaoId } }); });
      if (erro) toast(erro, 'erro'); else { toast('Estação da fazenda atualizada.', 'ok'); desenharOps(); const b = raiz.querySelector('[data-est-ligadas]'); if (b) b.textContent = `${estado.ds.fazendas.filter((f) => f.estacaoId).length}/${estado.ds.fazendas.length}`; }
    }
    if (el.dataset.est === 'arquivo' && el.files?.[0]) {
      const arq = el.files[0]; el.value = '';
      try { const l = await lerArquivoEstacao(arq); previaImportacao(l, arq.name); } catch (e) { toast(`Não foi possível ler o arquivo: ${(e as Error).message}`, 'erro'); }
    }
  });
  if (est.length) { desenharEstacao(); desenharOps(); }
  desenharFaz();
}

function previaImportacao(l: LeituraRelatorio, arquivo: string) {
  const m = abrirModal('Importar relatório da estação', `
    <p><b>${esc(arquivo)}</b></p>
    ${l.erros.length ? aviso('critico', `<ul>${l.erros.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`) : `
    <div class="chips-info"><span>Estações <b>${l.estacoes.length}</b></span><span>Registros <b>${l.registros.length}</b></span><span>Tipo <b>${l.diario ? 'diário' : 'horário/intervalo'}</b></span><span>Período <b>${l.periodo ? `${esc(fmtData(l.periodo.de))} a ${esc(fmtData(l.periodo.ate))}` : '—'}</b></span><span>Com vento <b>${l.estacoes.filter((e) => e.temVento).length}</b></span></div>
    ${l.diario ? aviso('atencao', 'Relatório <b>diário</b>: servirá como contexto do dia. Para a condição no horário dos voos, importe também o relatório horário.') : ''}
    ${l.avisos.length ? aviso('atencao', `<b>Conferir:</b><ul>${l.avisos.slice(0, 8).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>${l.avisos.length > 8 ? `+${l.avisos.length - 8} aviso(s)` : ''}`) : ''}
    <div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>PIC</th><th>Estação</th><th>Vento</th><th class="dir">Registros</th></tr></thead><tbody>${l.estacoes.map((e) => `<tr><td>${esc(e.pic || '—')}</td><td>${esc(e.nome)}</td><td>${e.temVento ? 'sim' : '—'}</td><td class="dir">${l.registros.filter((r) => r.estacaoId === e.id).length}</td></tr>`).join('')}</tbody></table></div>
    <p class="nota">Reimportar o mesmo período substitui os registros (não duplica). Fazendas cujo código aparece no nome da estação são ligadas automaticamente.</p>`}`,
  { largura: 'lg', rodapeHTML: `<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-est-ok ${l.erros.length ? 'disabled' : ''}>Importar ${l.registros.length} registro(s)</button>` });
  m.el.querySelector('[data-est-ok]')?.addEventListener('click', () => {
    let r: ReturnType<typeof importarEstacao> | null = null;
    const erro = alterar((d) => { r = importarEstacao(d, l); });
    if (erro) { toast(erro, 'erro'); return; }
    m.fechar();
    const x = r! as ReturnType<typeof importarEstacao>;
    toast(`Estação importada: ${x.registros} registro(s)${x.substituidos ? ` (${x.substituidos} substituído(s))` : ''}; ${x.fazendasLigadas} fazenda(s) ligada(s).`, 'ok');
    redesenhar();
  });
}
