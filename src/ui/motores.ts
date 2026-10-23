/** Carrega motores embutidos (texto dentro do próprio HTML) só quando usados. */
const cache = new Map<string, Promise<unknown>>();
export function carregarMotor<T>(idScript: string, global: string): Promise<T> {
  let p = cache.get(idScript) as Promise<T> | undefined;
  if (!p) {
    p = new Promise<T>((res, rej) => {
      const w = window as unknown as Record<string, T | undefined>;
      if (w[global]) { res(w[global]!); return; }
      const src = document.getElementById(idScript)?.textContent;
      if (!src) { rej(new Error('Recurso não incluído nesta versão do arquivo.')); return; }
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { URL.revokeObjectURL(url); if (w[global]) res(w[global]!); else rej(new Error('Falha ao iniciar o recurso.')); };
      s.onerror = () => rej(new Error('Falha ao carregar o recurso.'));
      document.head.appendChild(s);
    }).catch((e) => { cache.delete(idScript); throw e; });
    cache.set(idScript, p);
  }
  return p;
}

/** Entrega o arquivo: no celular abre o compartilhamento (salvar/enviar); no computador, baixa. */
export async function entregarArquivo(blob: Blob, nome: string): Promise<'compartilhado' | 'baixado'> {
  const arq = typeof File !== 'undefined' ? new File([blob], nome, { type: blob.type }) : null;
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  const toque = matchMedia('(pointer: coarse)').matches;
  if (toque && arq && nav.canShare?.({ files: [arq] })) {
    try { await nav.share({ files: [arq], title: nome }); return 'compartilhado'; } catch (e) { if ((e as Error).name === 'AbortError') return 'compartilhado'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'baixado';
}
