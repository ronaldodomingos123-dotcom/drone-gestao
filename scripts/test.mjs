// Compila os testes com esbuild e executa com o test runner nativo do Node (node:test).
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEsbuild } from './esbuild-path.mjs';
const esbuild = await loadEsbuild();
const out = '.test-build';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const entradas = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).map((f) => `tests/${f}`);
await esbuild.build({ entryPoints: entradas, outdir: out, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, logLevel: 'warning' });
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...readdirSync(out).map((f) => `${out}/${f}`)], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
