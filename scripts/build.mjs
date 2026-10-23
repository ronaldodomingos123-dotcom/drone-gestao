// Gera dist/index.html em ARQUIVO ÚNICO (JS e CSS embutidos), após checar tipos.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadEsbuild } from './esbuild-path.mjs';

const require = createRequire(import.meta.url);
const tsc = (() => { for (const p of ['typescript/bin/tsc', '/opt/npm-tools/node_modules/typescript/bin/tsc']) { try { return require.resolve(p); } catch { /* próximo */ } } return null; })();
if (tsc && !process.argv.includes('--sem-tipos')) {
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('✖ Erros de tipagem — build interrompido.'); process.exit(1); }
  console.log('✔ Tipagem OK');
}
const esbuild = await loadEsbuild();
const res = await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, write: false, outdir: 'dist', minify: true, format: 'iife',
  target: ['es2020', 'safari15'], legalComments: 'none', logLevel: 'warning',
  nodePaths: ['node_modules', '/opt/npm-tools/node_modules'],
});
const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
// Motor de PDF: pacote separado, guardado como texto e carregado só quando usado (não pesa na abertura)
const motor = await esbuild.build({
  entryPoints: ['src/pdf/motor.ts'], bundle: true, write: false, minify: true, format: 'iife',
  target: ['es2020', 'safari15'], legalComments: 'none', logLevel: 'error',
  nodePaths: ['node_modules', '/opt/npm-tools/node_modules'],
  define: { 'import.meta.url': '"about:blank"' }, supported: { 'top-level-await': false },
});
const motorJs = motor.outputFiles[0].text;
// Motor de exportação (Excel/PDF): também separado e carregado só ao exportar
const exp = await esbuild.build({
  entryPoints: ['src/pdf/exportMotor.ts'], bundle: true, write: false, minify: true, format: 'iife',
  target: ['es2020', 'safari15'], legalComments: 'none', logLevel: 'error',
  nodePaths: ['node_modules', '/opt/npm-tools/node_modules'],
});
const expJs = exp.outputFiles[0].text;
const css = res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const html = readFileSync('index.html', 'utf8')
  .replace('<!--CSS-->', () => `<style>${css}</style>`)
  .replace('<!--JS-->', () => `<script type="text/plain" id="motor-export">${expJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script><script type="text/plain" id="motor-pdf">${motorJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`✔ dist/index.html gerado (${(html.length / 1024).toFixed(0)} KB)`);
