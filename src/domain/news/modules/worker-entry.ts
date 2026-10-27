import { pathToFileURL } from 'node:url'
import { collectionResultSchema, NEWS_MODULE_LIMITS, type NewsModule, type NewsCheckpoint } from './contract.js'
import { runNewsSupervisor } from './supervisor.js'

/** Private process entry; only v2 receives explicitly bound credentials per request. */
export async function runNewsWorker(): Promise<void> {
  const [entry, moduleId, version] = process.argv.slice(-3)
  const abiVersion = process.argv.includes('--news-abi=2') ? 2 : 1
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
    if (!mod || mod.abiVersion !== abiVersion || mod.moduleId !== moduleId || mod.version !== version || typeof mod.collect !== 'function') throw new Error('Module ABI mismatch')
    output({type:'ready'})
    let buffer = Buffer.alloc(0), busy = false
    process.stdin.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > NEWS_MODULE_LIMITS.request) process.exit(2)
      const newline = buffer.indexOf(10)
      if (newline < 0) return
      if (busy || newline !== buffer.length - 1) process.exit(2)
      let request: {id:number;sourceKey:string;params:Record<string,string|number|boolean>;checkpoint?:NewsCheckpoint;credentials?:Record<string,string>}
      try { request = JSON.parse(buffer.subarray(0, newline).toString('utf8')); if (!Number.isSafeInteger(request.id)) throw new Error('Invalid request') } catch { process.exit(2); return }
      buffer = Buffer.alloc(0); busy = true
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), NEWS_MODULE_LIMITS.collectMs)
      Promise.resolve().then(() => mod.collect({sourceKey:request.sourceKey,params:request.params,...(abiVersion===2?{checkpoint:request.checkpoint??null}:{})},{signal:controller.signal,...(abiVersion===2?{credentials:request.credentials??{}}:{})}))
        .then(result => {
          try {
            const parsed=collectionResultSchema(abiVersion).parse(result)
            output(abiVersion===1?{id:request.id,items:parsed}:{id:request.id,result:parsed})
          } catch { output({id:request.id,error:'Module result violates collection contract'}) }
        })
        .catch(() => { try { output({id:request.id,error:'Module collection failed',...(abiVersion===2?{retryable:true}:{})}) } catch { process.exit(2) } })
        .finally(() => { clearTimeout(timer); busy = false })
    })
    process.stdin.on('end', () => process.exit(0))
    process.stdin.on('error', () => process.exit(2))
  } catch { process.stderr.write('News module startup failed\n'); process.exitCode = 2 }
}

if (!(globalThis as {__OPENALICE_INTERNAL_ROLE_DISPATCH__?:boolean}).__OPENALICE_INTERNAL_ROLE_DISPATCH__) void runNewsWorker()
