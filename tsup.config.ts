import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
    'browser/index': 'src/browser/index.ts',
    'shared/index': 'src/shared/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
})
