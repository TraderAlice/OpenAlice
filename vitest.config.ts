import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
          },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.spec.*', 'packages/**/*.spec.*', 'parity/**/*.spec.*'],
          exclude: ['**/*.e2e.spec.*', '**/*.bbProvider.spec.*', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['ui/**/*.spec.*'],
        },
      },
    ],
  },
})
