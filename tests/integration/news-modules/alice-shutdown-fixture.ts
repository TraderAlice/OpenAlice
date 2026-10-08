import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NewsModuleManager } from '../../../src/domain/news/modules/manager.js'

if (process.env['OPENALICE_TEST_FAIL_MODULE_CLOSE'] === '1') {
  NewsModuleManager.prototype.close = async function () {
    writeFileSync(join(process.env['OPENALICE_HOME']!, 'state', 'module-close-attempted'), 'failed')
    throw new Error('fixture: news module close rejected')
  }
}

// Patch the real module boundary before Alice imports and constructs the collector.
await import('../../../src/main.js')
