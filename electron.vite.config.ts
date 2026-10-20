import { defineConfig, type UserConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ command }) => {
  // The dev server injects an inline React Refresh preamble and talks over localhost; production needs neither.
  process.env.VITE_CSP_EXTRA = command === 'serve' ? "'unsafe-inline' http://localhost:* ws://localhost:*" : ''
  return config
})

const config: UserConfig = {
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // A sandboxed renderer can only load a CommonJS preload.
    build: { rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
  },
}
