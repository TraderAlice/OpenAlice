import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
})
