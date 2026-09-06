import { defineConfig } from 'tsup';

const shared = {
  format: ['esm'] as const,
  sourcemap: true,
  target: 'es2022' as const,
  platform: 'browser' as const,
  tsconfig: 'tsconfig.build.json',
  esbuildOptions(options: { alias?: Record<string, string> }) {
    options.alias = { '@': './src' };
  },
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/ui/index.ts'],
    dts: { resolve: true },
    clean: true,
  },
  {
    ...shared,
    entry: { 'background.worker': 'src/effects/background.worker.ts' },
    dts: false,
    // Run after the main build so `clean: true` above cannot wipe the worker.
    clean: false,
  },
]);
