/**
 * Exporta um trecho da tela como imagem PNG, sem biblioteca externa e sem enviar nada para fora:
 * o HTML é clonado com a folha de estilo do próprio app dentro de um SVG (foreignObject), desenhado num
 * canvas e baixado. O layout é o da tela atual (computador → layout de computador; celular → layout de
 * celular), para os gráficos saírem exatamente como estão. Fontes externas não entram no SVG: usa a fonte do sistema.
 */

function cssDoApp(): string {
  return [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n').replace(/\]\]>/g, '');
}

/** Copia o estado de selects/inputs para atributos (o clone não leva o valor digitado). */
function fixarValores(orig: HTMLElement, clone: HTMLElement) {
  const o = orig.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
  const c = clone.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
  o.forEach((el, i) => {
    const k = c[i];
    if (!k) return;
    if (el instanceof HTMLSelectElement) [...(k as HTMLSelectElement).options].forEach((op, j) => { if (j === el.selectedIndex) op.setAttribute('selected', ''); else op.removeAttribute('selected'); });
    else if (el instanceof HTMLTextAreaElement) k.textContent = el.value;
    else if (el.type === 'checkbox' || el.type === 'radio') { if ((el as HTMLInputElement).checked) k.setAttribute('checked', ''); else k.removeAttribute('checked'); }
    else k.setAttribute('value', el.value);
  });
}

const ESTILO_BASE = "font-family:var(--fonte);font-size:14px;line-height:1.45;color:var(--texto);background:var(--bg);-webkit-font-smoothing:antialiased;font-feature-settings:'tnum' 1;";

/** Mede a altura do conteúdo numa janela da largura pedida (as regras de celular/computador seguem essa largura). */
async function medirAltura(html: string, css: string, largura: number): Promise<number> {
  const fr = document.createElement('iframe');
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = `position:fixed;left:-20000px;top:0;width:${largura}px;height:800px;border:0;visibility:hidden;`;
  document.body.appendChild(fr);
  try {
    const d = fr.contentDocument!;
    const tema = document.documentElement.getAttribute('data-theme');
    d.open(); d.write(`<!doctype html><html${tema ? ` data-theme="${tema}"` : ''}><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0;${ESTILO_BASE}">${html}</body></html>`); d.close();
    await new Promise((r) => setTimeout(r, 60));
    const cx = d.body.firstElementChild as HTMLElement | null;
    return Math.ceil(cx ? cx.getBoundingClientRect().height : d.body.scrollHeight);
  } finally { fr.remove(); }
}

export interface OpcoesImagem { nomeArquivo: string; cabecalhoHTML?: string; largura?: number; escala?: number; remover?: string; /** a imagem termina no bloco que contém este seletor (o resto da página fica de fora) */ cortarApos?: string; /** CSS só da imagem (ex.: letras maiores) */ cssExtra?: string }

export async function exportarImagem(el: HTMLElement, o: OpcoesImagem): Promise<void> {
  // mesma largura de tela (as regras de celular/computador e os gráficos ficam iguais ao que se vê)
  const vw = Math.max(document.documentElement.clientWidth, 320);
  const pad = vw < 700 ? 14 : 28;
  const largura = o.largura ?? Math.ceil(el.getBoundingClientRect().width) + pad * 2, escala = o.escala ?? (vw < 700 ? 3 : 2);
  const clone = el.cloneNode(true) as HTMLElement;
  fixarValores(el, clone);
  clone.querySelectorAll(o.remover ?? '[data-sem-imagem]').forEach((x) => x.remove());
  clone.removeAttribute('id');
  if (o.cortarApos) {
    // remove tudo o que vem depois do bloco, em cada nível até a raiz (inclui cartões seguintes da mesma grade)
    let alvo = clone.querySelector(o.cortarApos)?.closest('.cartao') ?? clone.querySelector(o.cortarApos);
    while (alvo && alvo !== clone) { while (alvo.nextElementSibling) alvo.nextElementSibling.remove(); alvo = alvo.parentElement; }
  }
  const css = cssDoApp() + (o.cssExtra ? `\n${o.cssExtra.replace(/\]\]>/g, '')}` : '');
  // monta o conteúdo como DOM e serializa como XHTML (o SVG exige XML bem formado)
  const caixa = document.createElement('div');
  caixa.className = 'img-exp';
  caixa.setAttribute('style', `width:${largura}px;box-sizing:border-box;padding:${pad}px;${ESTILO_BASE}`);
  caixa.innerHTML = o.cabecalhoHTML ?? '';
  caixa.appendChild(clone);
  const corpo = new XMLSerializer().serializeToString(caixa);
  const altura = Math.min(await medirAltura(corpo, css, vw), 16000);
  const tema = document.documentElement.getAttribute('data-theme');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${altura}"${tema ? ` data-theme="${tema}"` : ''}><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${vw}px"><style><![CDATA[${css}]]></style>${corpo}</div></foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  await new Promise<void>((ok, erro) => { img.onload = () => ok(); img.onerror = () => erro(new Error('Não foi possível montar a imagem.')); img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = largura * escala; cv.height = altura * escala;
  const g = cv.getContext('2d')!;
  g.scale(escala, escala);
  g.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
  g.fillRect(0, 0, largura, altura);
  g.drawImage(img, 0, 0, largura, altura, 0, 0, largura, altura); // recorta só o conteúdo
  const blob = await new Promise<Blob | null>((ok) => { try { cv.toBlob(ok, 'image/png'); } catch { ok(null); } });
  if (!blob) {
    // navegador bloqueou o PNG (alguns Safari): entrega o SVG, que abre no navegador e pode ser impresso
    baixar(new Blob([svg], { type: 'image/svg+xml' }), o.nomeArquivo.replace(/\.png$/i, '.svg'));
    throw new Error('Este navegador não gerou o PNG; foi baixada a versão SVG (abre no navegador).');
  }
  baixar(blob, o.nomeArquivo);
}

function baixar(b: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
