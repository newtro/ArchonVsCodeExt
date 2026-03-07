import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/extension/index.ts'],
  bundle: true,
  outfile: 'out/extension/index.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  external: [
    'vscode',
    'better-sqlite3',
    'sqlite-vec',
    'web-tree-sitter',
    'tree-sitter-wasms',
  ],
});
