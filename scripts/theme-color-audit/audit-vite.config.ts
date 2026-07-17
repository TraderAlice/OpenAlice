import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import baseConfig from '../../ui/vite.config.js'
import { themeColorAuditPlugin } from './audit-vite-plugin.js'

const repoRoot = resolve(import.meta.dirname, '../..')
const auditPort = Number.parseInt(process.env['OPENALICE_THEME_AUDIT_PORT'] ?? '41731', 10)

export default defineConfig((environment) => {
  const base = typeof baseConfig === 'function' ? baseConfig(environment) : baseConfig
  return {
    ...base,
    define: { ...(base.define ?? {}), 'import.meta.env.VITE_OPENALICE_FIRST_RUN_GUIDE': JSON.stringify('1') },
    plugins: [themeColorAuditPlugin(repoRoot), ...(base.plugins ?? [])],
    server: { ...base.server, host: '127.0.0.1', port: auditPort, strictPort: true },
  }
})
