import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'dist-server/**', 'node_modules/**'],
    environment: 'node'
  }
})
