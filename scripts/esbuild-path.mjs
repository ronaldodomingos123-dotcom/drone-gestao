// Localiza o esbuild: dependência local (npm i) ou instalação pré-existente do ambiente.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function loadEsbuild() {
  for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) {
    try { return require(p); } catch { /* tenta o próximo */ }
  }
  throw new Error('esbuild não encontrado. Rode: npm install');
}
