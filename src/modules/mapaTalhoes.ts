/** Importar o mapa de talhões (KML de polígonos) — guarda o contorno dos talhões das fazendas do protótipo. */
import { aplicarMapaTalhoes, lerMapaTalhoes, type LeituraMapa } from '../domain/mapaTalhoes';
import { novoId } from '../data/repository';
import { alterar, estado, redesenhar } from '../state';
import { aviso } from '../ui/components';
import { abrirModal, esc, fmtNum, toast } from '../ui/dom';
import { icone } from '../ui/icons';

export function abrirImportarMapa() {
  const m = abrirModal('Importar mapa de talhões (KML)', `
    <p class="nota">KML com um polígono por talhão (campos <b>cod_zona</b>, <b>cod_talhao</b>, <b>area_plantada</b>…). O contorno é ligado ao talhão do protótipo pela <b>zona</b> (= código da fazenda) e pelo número do talhão. Só são guardadas as fazendas que já existem no protótipo. O arquivo é lido neste aparelho.</p>
    <label class="btn btn-pri">${icone('camadas', 15)} Escolher arquivo .kml<input type="file" accept=".kml" data-mp="arq" hidden></label>
    <div data-mp="res"></div>`, { largura: 'lg', rodapeHTML: '<button class="btn btn-sec" data-fechar>Cancelar</button><button class="btn btn-pri" data-mp="ok" disabled>Importar contornos</button>' });
  const r = m.el;
  const res = r.querySelector('[data-mp="res"]') as HTMLElement;
  let l: LeituraMapa | null = null;
  const previa = () => {
    if (!l) return;
    const ds = estado.ds;
    const zonasProt = new Set(ds.fazendas.map((f) => f.codigo.replace(/^0+(?=\d)/, '')));
    const doProt = l.talhoes.filter((t) => zonasProt.has(t.zona));
    const fazendas = [...new Set(doProt.map((t) => t.zona))];
    const existentes = doProt.filter((t) => ds.talhoes.some((x) => !x.geral && x.codigo.replace(/^0+(?=\d)/, '') === t.talhao && ds.fazendas.find((f) => f.id === x.fazendaId)?.codigo.replace(/^0+(?=\d)/, '') === t.zona)).length;
    res.innerHTML = `<div class="chips-info"><span>Talhões no mapa <b>${l.talhoes.length}</b></span><span>Zonas <b>${l.zonas}</b></span><span>Fazendas do protótipo encontradas <b>${fazendas.length}</b> de ${ds.fazendas.length}</span><span>Talhões dessas fazendas <b>${doProt.length}</b> (${existentes} já cadastrados)</span></div>
      ${fazendas.length ? `<div class="tabela-rolagem"><table class="tabela tabela-simples"><thead><tr><th>Zona</th><th>Fazenda no mapa</th><th class="dir">Talhões</th><th class="dir">Plantada</th><th class="dir">Restrição de voo</th></tr></thead><tbody>${fazendas.map((z) => { const ts = doProt.filter((t) => t.zona === z); return `<tr><td>${esc(z)}</td><td>${esc(ts[0].nomeZona || ts[0].nomeFazenda)}</td><td class="dir">${ts.length}</td><td class="dir">${esc(fmtNum(ts.reduce((s, t) => s + (t.plantada ?? 0), 0), 2))} ha</td><td class="dir">${ts.filter((t) => t.restricaoVoo).length}</td></tr>`; }).join('')}</tbody></table></div>` : aviso('atencao', 'Nenhuma fazenda do protótipo aparece no mapa (a fazenda é ligada pela zona = código da fazenda).')}
      <label class="chk campo-largo"><input type="checkbox" data-mp="criar" checked><span>Criar os talhões do mapa que ainda não existem no protótipo<small>Com a área plantada. Útil para o cruzamento achar aplicação fora da OS.</small></span></label>
      <label class="chk campo-largo"><input type="checkbox" data-mp="area"><span>Atualizar a área dos talhões com a área plantada do mapa<small>As OS não mudam.</small></span></label>`;
    (r.querySelector('[data-mp="ok"]') as HTMLButtonElement).disabled = !fazendas.length;
  };
  r.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.mp !== 'arq' || !el.files?.[0]) return;
    res.innerHTML = '<p class="muted">Lendo o mapa…</p>';
    l = lerMapaTalhoes(await el.files[0].text());
    if (l.erros.length) { res.innerHTML = aviso('critico', l.erros.map(esc).join('<br>')); l = null; return; }
    previa();
  });
  r.querySelector('[data-mp="ok"]')!.addEventListener('click', () => {
    if (!l) return;
    let out: ReturnType<typeof aplicarMapaTalhoes> | null = null;
    const criar = (r.querySelector('[data-mp="criar"]') as HTMLInputElement).checked, area = (r.querySelector('[data-mp="area"]') as HTMLInputElement).checked;
    const erro = alterar((d) => { out = aplicarMapaTalhoes(d, l!, { criarTalhoes: criar, atualizarArea: area }, novoId); });
    if (erro) { toast(/quota|exceed|cheio/i.test(erro) ? 'Sem espaço no navegador para guardar os contornos.' : erro, 'erro'); return; }
    const o = out! as ReturnType<typeof aplicarMapaTalhoes>;
    m.fechar();
    toast(`Mapa importado: ${o.ligados} contorno(s) em ${o.fazendas} fazenda(s); ${o.criados} talhão(ões) criado(s).${o.avisos.length ? ` ${o.avisos.length} diferença(s) de área.` : ''}`, 'ok');
    redesenhar();
  });
}
