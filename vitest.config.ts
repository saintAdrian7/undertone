import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    // Testing Library registers its between-test DOM cleanup through a global afterEach.
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // Renderer component tests opt into jsdom with a `// @vitest-environment jsdom` pragma.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main/index.ts', 'src/preload/index.ts', 'src/renderer/main.tsx'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
