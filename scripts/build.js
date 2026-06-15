const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    platform: "node",
    target: ["node18"],
    outfile: "dist/bundle.js",
    sourcemap: true,
    external: [], // add packages you don't want to bundle
    // CJS bundles don't have import.meta.url — inject a __filename-based shim.
    banner: {
      js: "const __import_meta_url = require('url').pathToFileURL(__filename);",
    },
    define: {
      "import.meta.url": "__import_meta_url",
    },
  })
  .catch(() => process.exit(1));
