const esbuild = require('esbuild');

esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    target: ['node18'],
    outfile: 'dist/bundle.js',
    sourcemap: true,
    external: [], // add packages you don't want to bundle
}).catch(() => process.exit(1));
