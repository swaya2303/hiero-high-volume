import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@hashgraph/sdk'],
  treeshake: true,
  splitting: false,
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
});
