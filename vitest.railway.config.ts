import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'railway-local',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'scripts/railway-entrypoint.spec.ts',
      'scripts/railway-fence-pty.spec.ts',
    ],
    // Both files may lock the real /dev/shm mount inode on Linux. Keep them in
    // one explicit worker so a local safety contract cannot race itself.
    fileParallelism: false,
    maxWorkers: 1,
    // The Linux fence fixture intentionally waits up to 30s for a competing
    // owner. Leave Vitest enough time to surface the fixture's own assertion.
    testTimeout: 35_000,
  },
})
