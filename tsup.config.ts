import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/ui/index.ts'],
  format: ['esm'],
  dts: { resolve: true },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'browser',
  tsconfig: 'tsconfig.build.json',
  esbuildOptions(options) {
    options.alias = { '@': './src' };
  },
});
