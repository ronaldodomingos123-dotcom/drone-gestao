/**
 * Camada de persistência.
 *
 * A interface `Repositorio` isola o resto do sistema do meio de armazenamento.
 * Fase 1–2: adaptador local (localStorage do navegador), com prefixo EXCLUSIVO do protótipo,
 * para nunca colidir com chaves de outros aplicativos hospedados no mesmo domínio.
 * Fase 4: um adaptador de banco centralizado (ex.: PostgreSQL) implementará a mesma interface.
 */
import type { Dataset, Operacao, Parada } from '../domain/types';
import { gerarDemo } from './demo';
import { migrar, recalcularStatusOS } from '../domain/base';

export const PREFIXO = 'dap-proto-v1:';
const CHAVE_DATASET = `${PREFIXO}dataset`;

/**
 * Ganchos da nuvem (Fase 4): `antes` pode recusar a gravação (lança erro com a mensagem), `depois` agenda o
 * envio. A gravação local continua sendo a primeira e a fonte do que se vê na tela.
 */
export const ganchosNuvem: { antes?: (novo: Dataset) => void; depois?: (ds: Dataset) => void } = {};

export interface Repositorio {
  carregar(): Dataset;
  salvar(ds: Dataset): void;
  /** Grava só neste aparelho, sem ganchos (usado pela sincronização ao receber dados da nuvem). */
  salvarLocal(ds: Dataset): void;
  adicionarOperacao(op: Operacao, paradas: Parada[]): Dataset;
  /** Grava várias operações de uma vez (tudo ou nada). */
  adicionarOperacoes(ops: Operacao[], paradas: Parada[]): Dataset;
  restaurarDemo(): Dataset;
  readonly tipo: 'localStorage' | 'memória';
}

function storageDisponivel(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const k = `${PREFIXO}__teste`;
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}


export function criarRepositorio(): Repositorio {
  const storage = storageDisponivel();
  let memoria: Dataset | null = null;

  const repo: Repositorio = {
    tipo: storage ? 'localStorage' : 'memória',
    carregar() {
      if (storage) {
        try {
          const bruto = storage.getItem(CHAVE_DATASET);
          if (bruto) {
            const ds = migrar(JSON.parse(bruto));
            if (ds) return ds;
            // base irrecuperável: guarda uma cópia antes de recriar, para não perder nada
            storage.setItem(`${PREFIXO}dataset-irrecuperavel-${Date.now()}`, bruto);
          }
        } catch (e) {
          /* dado corrompido: guarda o texto e recria a demonstração */
          console.error('Base local ilegível:', e);
          try { const b = storage.getItem(CHAVE_DATASET); if (b) storage.setItem(`${PREFIXO}dataset-irrecuperavel-${Date.now()}`, b); } catch { /* sem espaço */ }
        }
      } else if (memoria) return memoria;
      const ds = gerarDemo();
      repo.salvarLocal(ds);
      return ds;
    },
    salvar(ds) {
      recalcularStatusOS(ds); // status das OS sempre coerente com as áreas no que é gravado (e no backup)
      ganchosNuvem.antes?.(ds);
      repo.salvarLocal(ds);
      ganchosNuvem.depois?.(ds);
    },
    salvarLocal(ds) {
      if (storage) {
        try {
          storage.setItem(CHAVE_DATASET, JSON.stringify(ds));
          return;
        } catch (e) {
          throw new Error(`Não foi possível salvar no armazenamento local: ${(e as Error).message}`);
        }
      }
      memoria = ds;
    },
    adicionarOperacao(op, paradas) {
      const ds = repo.carregar();
      if (ds.operacoes.some((o) => o.id === op.id)) throw new Error('Registro duplicado: já existe uma operação com este identificador.');
      ds.operacoes.push(op);
      ds.paradas.push(...paradas);
      repo.salvar(ds);
      return ds;
    },
    adicionarOperacoes(ops, paradas) {
      const ds = repo.carregar();
      const ids = new Set(ds.operacoes.map((o) => o.id));
      if (ops.some((o) => ids.has(o.id))) throw new Error('Registro duplicado: identificador de operação já existe.');
      ds.operacoes.push(...ops);
      ds.paradas.push(...paradas);
      repo.salvar(ds); // uma única gravação: ou entra tudo, ou nada
      return ds;
    },
    restaurarDemo() {
      const ds = gerarDemo();
      repo.salvar(ds);
      return ds;
    },
  };
  return repo;
}

export function novoId(prefixo: string): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefixo}-${Date.now().toString(36)}-${r}`;
}
