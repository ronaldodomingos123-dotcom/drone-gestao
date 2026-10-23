/** Exporta um elemento da página como PNG (compartilha no celular, baixa no computador). */
import { toBlob } from 'html-to-image';
import { toast } from './dom';

export async function exportarPNG(el: HTMLElement, arquivo: string, titulo: string, botao?: HTMLButtonElement, ocultarClasses: string[] = []) {
  const rotulo = botao?.innerHTML;
  if (botao) { botao.disabled = true; botao.textContent = 'Gerando imagem…'; }
  el.classList.add('exportando');
  try {
    const blob = await toBlob(el, {
      pixelRatio: 2,
      backgroundColor: '#f3f5f9',
      skipFonts: true, // a fonte externa não é embutida; a imagem usa a fonte do sistema
      filter: (n) => !(n instanceof HTMLElement && (ocultarClasses.some((c) => n.classList.contains(c)) || n.dataset.nav !== undefined || n.dataset.semExportar !== undefined)),
    });
    if (!blob) throw new Error('o navegador não gerou a imagem');
    const file = new File([blob], arquivo, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await nav.share({ files: [file], title: titulo });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = arquivo;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    toast('Imagem gerada.', 'ok');
  } catch (err) {
    if ((err as Error).name !== 'AbortError') toast(`Não foi possível gerar a imagem: ${(err as Error).message}`, 'erro');
  } finally {
    el.classList.remove('exportando');
    if (botao && rotulo !== undefined) { botao.disabled = false; botao.innerHTML = rotulo; }
  }
}
