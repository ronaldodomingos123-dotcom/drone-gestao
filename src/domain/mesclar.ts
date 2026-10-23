/**
 * Mesclagem em 3 vias (base × local × nuvem) para quando duas pessoas gravam ao mesmo tempo, ou quando um
 * aparelho volta a ter internet depois de lançar sem sinal.
 *
 * Regra por item (listas com `id`) ou por valor:
 *   • só um lado mudou            → fica a mudança desse lado (inclusive exclusão);
 *   • os dois mudaram o MESMO item → fica a versão deste aparelho (local) e conta como conflito;
 *   • item novo de qualquer lado   → entra (nada se perde).
 * Ordem das listas: a da nuvem, com os itens novos deste aparelho no fim.
 */

export function iguais(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => iguais(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => iguais((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

type ComId = { id: string };
const listaComId = (v: unknown): v is ComId[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && typeof (x as ComId).id === 'string');

export interface ResultadoMescla<T> { valor: T; conflitos: string[] }

function mesclarLista(chave: string, b: ComId[], l: ComId[], r: ComId[], conflitos: string[]): ComId[] {
  const mb = new Map(b.map((x) => [x.id, x])), ml = new Map(l.map((x) => [x.id, x])), mr = new Map(r.map((x) => [x.id, x]));
  const decidir = (id: string): ComId | undefined => {
    const bi = mb.get(id), li = ml.get(id), ri = mr.get(id);
    if (iguais(li, bi)) return ri;           // só a nuvem mudou (ou ninguém)
    if (iguais(ri, bi)) return li;           // só este aparelho mudou
    if (li === undefined) return ri;         // apagado aqui, alterado na nuvem → mantém o da nuvem
    if (ri === undefined) return li;         // apagado na nuvem, alterado aqui → mantém o daqui
    if (!iguais(li, ri)) conflitos.push(`${chave}:${id}`);
    return li;                               // os dois mudaram: vale o deste aparelho
  };
  const out: ComId[] = [];
  const vistos = new Set<string>();
  for (const x of r) { vistos.add(x.id); const v = decidir(x.id); if (v) out.push(v); }
  for (const x of l) if (!vistos.has(x.id)) { vistos.add(x.id); const v = decidir(x.id); if (v) out.push(v); }
  return out;
}

export function mesclar3<T extends object>(base: T, local: T, remoto: T): ResultadoMescla<T> {
  const conflitos: string[] = [];
  const out: Record<string, unknown> = {};
  const B = base as Record<string, unknown>, L = local as Record<string, unknown>, R = remoto as Record<string, unknown>;
  for (const k of new Set([...Object.keys(R), ...Object.keys(L)])) {
    const b = B[k], l = L[k], r = R[k];
    let v: unknown;
    if (iguais(l, b)) v = r;
    else if (iguais(r, b)) v = l;
    else if (listaComId(l) && listaComId(r) && (b === undefined || listaComId(b))) v = mesclarLista(k, (b as ComId[] | undefined) ?? [], l, r, conflitos);
    else { v = l; if (!iguais(l, r)) conflitos.push(k); }
    if (v !== undefined) out[k] = v;
  }
  return { valor: out as T, conflitos };
}
