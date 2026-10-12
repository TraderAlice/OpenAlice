import { pathToFileURL } from 'node:url'
import { batchSchema, NEWS_MODULE_LIMITS, type NewsModule } from './contract.js'
import { runNewsSupervisor } from './supervisor.js'

/** Private process entry. It never imports Alice, EngineContext, UTA or credentials. */
export async function runNewsWorker(): Promise<void> {
  const [entry, moduleId, version] = process.argv.slice(-3)
  if (process.argv.includes('--news-supervisor')) { runNewsSupervisor(); return }
  const output = (value: unknown) => {
    const line = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(line) > NEWS_MODULE_LIMITS.response) throw new Error('Module response exceeds limit')
    process.stdout.write(line)
  }
  let logged = 0
  const log = () => { if (logged++ < 4) process.stderr.write('News module diagnostic omitted\n') }
  console.log = console.info = console.warn = console.error = console.debug = log
  try {
    const loaded = await import(pathToFileURL(entry).href) as {newsModule?:NewsModule}
    // Artifact entry is selected at runtime; static import cannot load an installed module.
    const mod = loaded.newsModule
    if (!mod || mod.abiVersion !== 1 || mod.moduleId !== moduleId || mod.version !== version || typeof mod.collect !== 'function') throw new Error('Module ABI mismatch')
    output({type:'ready'})
    let buffer = Buffer.alloc(0), busy = false
    process.stdin.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > NEWS_MODULE_LIMITS.request) process.exit(2)
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      if (busy || newline !== buffer.length - 1) process.exit(2)
      let request: {id:number;sourceKey:string;params:Record<string,string|number|boolean>}
      try { request = JSON.parse(buffer.subarray(0, newline).toString('utf8')); if (!Number.isSafeInteger(request.id)) throw new Error('Invalid request') } catch { process.exit(2); return }
      buffer = Buffer.alloc(0); busy = true
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), NEWS_MODULE_LIMITS.collectMs)
      Promise.resolve().then(() => mod.collect({sourceKey:request.sourceKey,params:request.params},{signal:controller.signal}))
        .then(items => output({id:request.id,items:batchSchema.parse(items)}))
        .catch(() => { try { output({id:request.id,error:'Module collection failed'}) } catch { process.exit(2) } })
        .finally(() => { clearTimeout(timer); busy = false })
    })
    process.stdin.on('end', () => process.exit(0))
    process.stdin.on('error', () => process.exit(2))
  } catch { process.stderr.write('News module startup failed\n'); process.exitCode = 2 }
}

if (!(globalThis as {__OPENALICE_INTERNAL_ROLE_DISPATCH__?:boolean}).__OPENALICE_INTERNAL_ROLE_DISPATCH__) void runNewsWorker()
