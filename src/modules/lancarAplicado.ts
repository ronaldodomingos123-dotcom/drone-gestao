/**
 * Aplicado da OS e onde ficou o desconto. Toda área vem de voo: aqui não se acrescenta área (isso é
 * feito no Fechamento do dia). Serve para concluir a OS (o que faltar vira OBSTÁCULO) e indicar o
 * talhão do desconto — os voos do fechamento são redistribuídos entre os talhões, sem mudar o total.
 */
import { round } from '../domain/calc';
import { distribuirDesconto, situacaoOS } from '../domain/lancamento';
import { registrar } from '../domain/base';
import { redistribuirEstimados } from '../domain/fechamentoDia';
import { numeroBR } from '../domain/importacao';
import { alterar, estado, nome, redesenhar } from '../state';
import { aviso } from '../ui/components';
import { abrirModal, esc, fmtNum, toast } from '../ui/dom';
import { icone } from '../ui/icons';

export function abrirLancarAplicado(osId: string, opcoes: { concluir?: boolean } = {}) {
  const ds = estado.ds;
  const os = ds.ordens.find((o) => o.id === osId);
  if (!os) return;
  const sit = situacaoOS(ds, osId);
  const plan = round(sit.talhoes.reduce((s, t) => s + t.programado, 0), 4);
  const lancAnt = (ds.lancamentos ?? []).filter((l) => l.osId === osId);
  const atualPorTalhao = new Map(sit.talhoes.map((t) => [t.talhaoId, t.voos + lancAnt.reduce((s, l) => s + l.itens.filter((i) => i.talhaoId === t.talhaoId).reduce((a, i) => a + i.areaHa, 0), 0)]));
  const atualTotal = [...atualPorTalhao.values()].reduce((s, x) => s + x, 0);
  const tal = (id: string) => ds.talhoes.find((t) => t.id === id);
  // parte "fixa" por talhão: voos registrados talhão a talhão + aplicado anterior importado (o que vem do
  // Fechamento do dia tem divisão por talhão estimada e pode ser redistribuído)
  const fixoT = new Map<string, number>();
  for (const o of ds.operacoes) if (o.osId === osId && !o.fechamentoDia) for (const i of o.itens) fixoT.set(i.talhaoId, (fixoT.get(i.talhaoId) ?? 0) + i.areaHa);
  for (const l of lancAnt) for (const i of l.itens) fixoT.set(i.talhaoId, (fixoT.get(i.talhaoId) ?? 0) + i.areaHa);
  const tlFix = sit.talhoes.map((t) => ({ ...t, voos: fixoT.get(t.talhaoId) ?? 0 }));
  const marcadoAntes = (id: string) => (atualPorTalhao.get(id) ?? 0) < (sit.talhoes.find((t) => t.talhaoId === id)!.programado - 0.005) && atualTotal > 0;
  const m = abrirModal(`Aplicado · OS ${os.numero} · ${nome.fazenda(os.fazendaId)}`, `
    <div class="lanc">
      <div class="chips-info"><span>Programado <b>${esc(fmtNum(plan, 2))} ha</b></span><span>Registrado em voos <b>${esc(fmtNum(sit.voos, 2))} ha</b></span>${sit.lancado > 0 ? `<span>Aplicado anterior importado <b>${esc(fmtNum(sit.lancado, 2))} ha</b></span>` : ''}</div>
      <div class="form-grade">
        <label class="campo"><span>Aplicado total da OS</span><div class="com-unidade"><input data-l="total" inputmode="decimal" value="${esc(fmtNum(atualTotal, 2))}" readonly><span>ha</span></div><small>Soma dos voos registrados — toda área vem de voo</small></label>
        <div class="campo"><span>&nbsp;</span><a class="btn btn-sec" href="#/fechamento">${icone('aplicacao', 15)} Registrar voos do dia (Fechamento do dia)</a></div>
      </div>
      <h3 class="sec-tit">${icone('area', 16)} Onde ficou o desconto?</h3>
      <p class="nota">Marque o(s) talhão(ões) com o desconto real (obstáculo, carreador, APP, falha). Os demais ficam com o programado. A área dos voos do Fechamento do dia é redistribuída entre os talhões; o total não muda.</p>
      <div class="tabela-rolagem"><table class="tab-talhoes lanc-tab"><thead><tr><th>Zona</th><th>Talhão</th><th class="num">Programado</th><th class="num">Voos</th><th class="centro">Desconto aqui</th><th class="num">Aplicado</th><th class="num">Desconto</th></tr></thead>
      <tbody>${sit.talhoes.map((t) => `<tr data-t="${esc(t.talhaoId)}"><td>${esc(tal(t.talhaoId)?.zona ?? '—')}</td><td><b>${esc(tal(t.talhaoId)?.codigo ?? '—')}</b></td><td class="num">${esc(fmtNum(t.programado, 2))}</td><td class="num">${t.voos ? esc(fmtNum(t.voos, 2)) : '—'}</td><td class="centro"><input type="checkbox" data-l="desc" ${marcadoAntes(t.talhaoId) ? 'checked' : ''} aria-label="Desconto neste talhão"></td><td class="num"><input data-l="apl" inputmode="decimal" value="${esc(fmtNum(atualPorTalhao.get(t.talhaoId) ?? 0, 2))}" aria-label="Aplicado no talhão"></td><td class="num" data-l="dsc">—</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2"><b>Total</b> · ${sit.talhoes.length} talhão(ões)</td><td class="num">${esc(fmtNum(plan, 2))}</td><td class="num">${esc(fmtNum(sit.voos, 2))}</td><td></td><td class="num" data-l="t-apl"></td><td class="num" data-l="t-dsc"></td></tr></tfoot></table></div>
      <label class="chk campo-largo lanc-concluir"><input type="checkbox" data-l="concluir" ${opcoes.concluir || os.concluidaManual ? 'checked' : ''}><span>Concluir a OS<small>O que faltar para o programado fica registrado como <b>obstáculo</b>.</small></span></label>
      <div data-l="msgs"></div>
    </div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-l="salvar">Salvar aplicado</button>' });
  const r = m.el;
  const q = <T extends HTMLElement>(k: string) => r.querySelector(`[data-l="${k}"]`) as T;
  const linhas = () => [...r.querySelectorAll<HTMLTableRowElement>('tbody tr[data-t]')];
  const lerAlvo = () => new Map(linhas().map((tr) => [tr.dataset.t!, numeroBR((tr.querySelector('[data-l="apl"]') as HTMLInputElement).value) ?? 0]));
  const totais = () => {
    let ta = 0, td = 0;
    for (const tr of linhas()) {
      const t = sit.talhoes.find((x) => x.talhaoId === tr.dataset.t)!;
      const a = numeroBR((tr.querySelector('[data-l="apl"]') as HTMLInputElement).value) ?? 0;
      const d = round(t.programado - a, 4);
      ta += a; td += Math.max(0, d);
      const c = tr.querySelector('[data-l="dsc"]') as HTMLElement;
      c.textContent = d > 0.005 ? fmtNum(d, 2) : '—';
      c.classList.toggle('seq-obst', d > 0.005);
      c.classList.toggle('txt-critico', d < -0.005 || a < (fixoT.get(t.talhaoId) ?? 0) - 0.005);
    }
    q('t-apl').innerHTML = `<b>${esc(fmtNum(ta, 2))}</b>`;
    q('t-dsc').innerHTML = td > 0.005 ? `<b class="seq-obst">${esc(fmtNum(td, 2))}</b>` : '—';
    return { ta, td };
  };
  const distribuir = () => {
    const total = numeroBR(q<HTMLInputElement>('total').value);
    const msgs = q<HTMLElement>('msgs');
    if (total === null) { msgs.innerHTML = ''; totais(); return; }
    const marc = linhas().filter((tr) => (tr.querySelector('[data-l="desc"]') as HTMLInputElement).checked).map((tr) => tr.dataset.t!);
    const d = distribuirDesconto(tlFix, total, marc);
    msgs.innerHTML = d.erros.length ? aviso('atencao', esc(d.erros[0])) : '';
    if (!d.erros.length) for (const tr of linhas()) (tr.querySelector('[data-l="apl"]') as HTMLInputElement).value = fmtNum(d.aplicado.get(tr.dataset.t!) ?? 0, 2);
    totais();
  };
  r.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-l]') as HTMLElement | null;
    if (!b) return;
    const k = b.dataset.l;
    if (k === 'salvar') {
      const { ta } = totais();
      const alvo = lerAlvo();
      const concluir = q<HTMLInputElement>('concluir').checked;
      if (concluir && ta <= 0.005) { q<HTMLElement>('msgs').innerHTML = aviso('critico', 'Nenhuma área registrada em voos: toda a área viraria obstáculo. Registre os voos no Fechamento do dia antes de concluir.'); return; }
      if (Math.abs(ta - atualTotal) > 0.005) { q<HTMLElement>('msgs').innerHTML = aviso('critico', `O aplicado tem de ser o registrado nos voos (${esc(fmtNum(atualTotal, 2))} ha). Para acrescentar área, registre os voos no Fechamento do dia.`); return; }
      const mudou = [...alvo.entries()].some(([t, v]) => Math.abs(v - (atualPorTalhao.get(t) ?? 0)) > 0.005);
      const erro = alterar((d) => {
        if (mudou) { const e = redistribuirEstimados(d, osId, alvo); if (e) return e; }
        const o = d.ordens.find((x) => x.id === osId)!;
        if (concluir && !o.concluidaManual) {
          o.concluidaManual = true;
          registrar(d, { entidade: 'ordem', entidadeId: osId, acao: 'concluir', resumo: `OS ${o.numero} concluída: ${fmtNum(ta, 2)} de ${fmtNum(plan, 2)} ha · obstáculo ${fmtNum(Math.max(0, plan - ta), 2)} ha` });
        }
        return null;
      });
      if (erro) { q<HTMLElement>('msgs').innerHTML = aviso('critico', esc(erro)); return; }
      m.fechar();
      const obst = Math.max(0, plan - ta);
      toast(`Aplicado: ${fmtNum(ta, 2)} de ${fmtNum(plan, 2)} ha${concluir ? ` · OS concluída · obstáculo ${fmtNum(obst, 2)} ha` : ''}.`, 'ok');
      redesenhar();
    }
  });
  r.addEventListener('input', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.l === 'apl') totais();
  });
  r.addEventListener('change', (e) => { if ((e.target as HTMLElement).dataset.l === 'desc') distribuir(); });
  totais();
}
