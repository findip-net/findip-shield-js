import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'FindIP',
      // UMD in a .cjs file supports require() while the package remains ESM-first.
      // browser globals behave identically (window.FindIP).
      formats: ['umd', 'es'],
      fileName: (format) =>
        format === 'es' ? 'findip-shield.esm.js' : 'findip-shield.cjs',
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
  plugins: [
    {
      name: 'minified-build',
      closeBundle: async () => {
        const { build } = await import('vite');
        await build({
          configFile: false,
          define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
          build: {
            lib: {
              entry: 'src/index.ts',
              name: 'FindIP',
              formats: ['iife'],
              fileName: () => 'findip-shield.min.js',
            },
            outDir: 'dist',
            // The first pass already wrote the unminified + esm bundles here;
            // vite's default emptyOutDir would delete them (the dist-wipe bug).
            emptyOutDir: false,
            sourcemap: true,
            minify: 'esbuild',
            rollupOptions: { output: { extend: true } },
          },
        });

        const minContent = readFileSync('./dist/findip-shield.min.js');
        const hash = createHash('sha384').update(minContent).digest('base64');
        console.log(`\nSRI hash (sha384): sha384-${hash}\n`);
      },
    },
  ],
});
