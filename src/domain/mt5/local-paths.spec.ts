import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { resolveJmbMt5Roots } from './local-paths.js'

describe('JMB MT5 local roots', () => {
  it('prefers explicit roots and derives missing protocol roots from explicit Common Files', () => {
    const commonFilesRoot = 'C:\\MT5\\Common\\Files'
    const roots = resolveJmbMt5Roots({
      commonFilesRoot,
      bridgeRoot: 'D:\\bridge',
      researchRoot: 'D:\\research',
      env: {},
      homeDirectory: 'C:\\Users\\tester',
    })

    expect(roots).toEqual({
      bridgeRoot: 'D:\\bridge',
      ledgerRoot: join(commonFilesRoot, 'OpenAliceMt5TradeLedgerV1'),
      policyRoot: join(commonFilesRoot, 'OpenAliceMt5DemoPolicyV1'),
      costModelRoot: join(commonFilesRoot, 'OpenAliceMt5CostModelV1'),
      executionDecisionRoot: join(commonFilesRoot, 'OpenAliceMt5ExecutionDecisionV1'),
      executionRoot: join(commonFilesRoot, 'OpenAliceMt5ExecutionV1'),
      researchRoot: 'D:\\research',
    })
  })

  it('uses environment Common Files before APPDATA and the documented research environment variable', () => {
    const roots = resolveJmbMt5Roots({
      env: {
        OPENALICE_MT5_COMMON_FILES_ROOT: 'D:\\common-files',
        OPENALICE_RESEARCH_ROOT: 'D:\\research-env',
        APPDATA: 'C:\\ignored-appdata',
      },
      homeDirectory: 'C:\\Users\\tester',
    })
    expect(roots.bridgeRoot).toBe(join('D:\\common-files', 'OpenAliceMt5BridgeV1'))
    expect(roots.researchRoot).toBe('D:\\research-env')
  })

  it('derives Common Files from APPDATA and rejects unresolved or relative roots', () => {
    expect(resolveJmbMt5Roots({ env: { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, homeDirectory: 'C:\\Users\\tester' }).bridgeRoot)
      .toBe(join('C:\\Users\\tester\\AppData\\Roaming', 'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5BridgeV1'))
    expect(() => resolveJmbMt5Roots({ env: {}, homeDirectory: 'C:\\Users\\tester' })).toThrow(/absolute Common Files root/i)
    expect(() => resolveJmbMt5Roots({ commonFilesRoot: 'relative', env: {}, homeDirectory: 'C:\\Users\\tester' })).toThrow(/absolute Common Files root/i)
  })
})
