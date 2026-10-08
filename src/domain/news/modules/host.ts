import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { defaultProcessController, terminateProcessTree } from '@traderalice/guardian-runtime'
import { batchSchema, NEWS_MODULE_LIMITS, type ModuleItem, type NewsSubscription } from './contract.js'
import { WINDOWS_NEWS_JOB, WINDOWS_NEWS_STOP, windowsCommandLine } from './windows-job.js'

const execFileAsync = promisify(execFile)
interface OwnerReceipt { pid:number; startedAt:number|null; machineId:string; jobName:string }
interface Pending { id:number; resolve:(v:ModuleItem[])=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout }

export class NewsWorkerHost {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending: Pending | null = null
  private nextId = 0
  private ready = false
  private faulted = false
  private stopping = false
  private childClosed = false
  private stopInFlight: Promise<void> | null = null
  private readonly jobName = 'Local\\OpenAliceNews-' + randomUUID()
  private readonly receipt: string

  constructor(
    private readonly directory:string, readonly hash:string,
    private readonly launch:{command:string;args:string[]},
    private readonly onFailure?:()=>Promise<void>,
  ) { this.receipt = join(directory, '.owner-' + hash + '.json') }

  private powerShell():string {
    return join(process.env.SystemRoot ?? 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')
  }

  private async terminate(pid:number, jobName:string, terminateRoot=true):Promise<void> {
    if (process.platform === 'win32') {
      await execFileAsync(this.powerShell(), [
        '-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
        Buffer.from(WINDOWS_NEWS_STOP,'utf16le').toString('base64'),
      ], { env:{SystemRoot:process.env.SystemRoot,OPENALICE_NEWS_JOB_NAME:jobName},windowsHide:true,timeout:5000,maxBuffer:65536 })
      if (terminateRoot && defaultProcessController.isAlive(pid)) await terminateProcessTree(pid,{gracefulMs:1000,forceMs:2000})
    } else if (terminateRoot) {
      await terminateProcessTree(pid,{gracefulMs:1000,forceMs:2000})
    } else {
      try { process.kill(-pid,'SIGKILL') }
      catch(e) { if((e as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('Worker stop failed') }
    }
    if (terminateRoot && defaultProcessController.isAlive(pid)) throw new Error('Worker stop not confirmed')
  }

  async recover():Promise<void> {
    let owner:OwnerReceipt
    try { owner = JSON.parse(await readFile(this.receipt,'utf8')) }
    catch(e) { if((e as NodeJS.ErrnoException).code === 'ENOENT')return;throw new Error('Worker ownership unavailable') }
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.machineId !== 'string' || !/^Local\\OpenAliceNews-[a-f0-9-]{36}$/.test(owner.jobName)) throw new Error('Invalid worker ownership; restart blocked')
    if (owner.machineId !== await defaultProcessController.machineId()) { await rm(this.receipt,{force:true});return }
    if (defaultProcessController.isAlive(owner.pid)) {
      const actual = await defaultProcessController.startedAt(owner.pid)
      if(owner.startedAt === null || actual === null || Math.abs(actual-owner.startedAt)>2000) throw new Error('Worker ownership cannot be proven; restart blocked')
      await this.terminate(owner.pid,owner.jobName)
    }
    else if(process.platform==='win32')await this.terminate(owner.pid,owner.jobName,false)
    await rm(this.receipt,{force:true})
  }

  async start(entry:string,moduleId:string,version:string):Promise<void> {
    await this.recover()
    this.faulted=false;this.stopping=false;this.stopInFlight=null
    const args=[...this.launch.args,entry,moduleId,version]
    const env:NodeJS.ProcessEnv={}
    for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL','ELECTRON_RUN_AS_NODE']) if(process.env[key])env[key]=process.env[key]
    if(process.versions.electron)env.ELECTRON_RUN_AS_NODE='1'
    let command=this.launch.command, workerArgs=args
    if(process.platform === 'win32') {
      command=this.powerShell()
      workerArgs=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(WINDOWS_NEWS_JOB,'utf16le').toString('base64')]
      env.OPENALICE_NEWS_LAUNCH=JSON.stringify({commandLine:windowsCommandLine([this.launch.command,...args]),parentPid:process.pid,jobName:this.jobName})
    } else {
      workerArgs=[...this.launch.args,'--news-supervisor',entry,moduleId,version]
      env.OPENALICE_NEWS_SUPERVISOR=JSON.stringify({command:this.launch.command,args,parentPid:process.pid})
    }
    const child=spawn(command,workerArgs,{stdio:'pipe',env,detached:process.platform!=='win32',windowsHide:true,cwd:this.directory})
    this.childClosed=false
    child.once('close',()=>{this.childClosed=true})
    this.child=child
    let buffer=Buffer.alloc(0), stderr=0
    child.stdout.on('data',(chunk:Buffer)=>{
      if(this.faulted)return
      if(buffer.length+chunk.length>NEWS_MODULE_LIMITS.response){buffer=Buffer.alloc(0);this.fail();return}
      buffer=Buffer.concat([buffer,chunk])
      let newline:number
      while((newline=buffer.indexOf(10))>=0) {
        const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1)
        try {
          const message=JSON.parse(line.toString('utf8'))
          if(!this.ready && this.pending?.id===-1 && message.type==='ready'){this.ready=true;this.resolvePending([]);continue}
          if(!this.pending || message.id!==this.pending.id || message.error)throw new Error('Invalid module response')
          this.resolvePending(batchSchema.parse(message.items))
        } catch {this.fail();return}
      }
    })
    child.stderr.on('data',(chunk:Buffer)=>{if(this.faulted)return;stderr+=chunk.length;if(stderr>NEWS_MODULE_LIMITS.stderr)this.fail()})
    child.once('error',()=>this.fail());child.once('exit',()=>this.fail())
    const startup=this.waitFor(-1,NEWS_MODULE_LIMITS.startupMs)
    void startup.catch(()=>{}) // Attach immediately while collecting the owned PID receipt.
    await mkdir(this.directory,{recursive:true})
    if(!child.pid){this.fail();await startup;return}
    const owner:OwnerReceipt={pid:child.pid,startedAt:await defaultProcessController.startedAt(child.pid),machineId:await defaultProcessController.machineId(),jobName:this.jobName}
    await writeFile(this.receipt,JSON.stringify(owner),{mode:0o600})
    await startup
  }

  private waitFor(id:number,ms:number):Promise<ModuleItem[]> {
    let resolve!:(value:ModuleItem[])=>void,reject!:(reason:Error)=>void
    const promise=new Promise<ModuleItem[]>((res,rej)=>{resolve=res;reject=rej})
    this.pending={id,resolve,reject,timer:setTimeout(()=>this.fail(),ms)}
    return promise
  }
  private resolvePending(value:ModuleItem[]):void {
    const pending=this.pending;this.pending=null
    if(pending){clearTimeout(pending.timer);pending.resolve(value)}
  }
  private fail():void {
    const first=!this.faulted;this.faulted=true;this.ready=false
    const pending=this.pending;this.pending=null
    if(pending){clearTimeout(pending.timer);pending.reject(new Error('Module worker failed or exceeded its limits'))}
    if(first&&!this.stopping) {
      void (async()=>{try{await this.onFailure?.()}finally{await this.stop()}})()
        .catch(()=>console.warn('news-module: worker failure cleanup was not confirmed; ownership retained'))
    }
  }
  async collect(subscription:NewsSubscription):Promise<ModuleItem[]> {
    if(!this.ready || !this.child || this.pending)throw new Error('Module worker unavailable')
    const id=++this.nextId,line=JSON.stringify({id,sourceKey:subscription.sourceKey,params:subscription.params})+'\n'
    if(Buffer.byteLength(line)>NEWS_MODULE_LIMITS.request)throw new Error('Module request exceeds limit')
    const reply=this.waitFor(id,NEWS_MODULE_LIMITS.collectMs)
    this.child.stdin.write(line,error=>{if(error)this.fail()})
    return reply
  }
  isLoaded():boolean {return this.ready}
  stop():Promise<void> {
    this.stopInFlight ??= this.stopImpl().catch(error=>{this.stopInFlight=null;throw error})
    return this.stopInFlight
  }
  private async stopImpl():Promise<void> {
    this.stopping=true;this.fail()
    const child=this.child
    if(child?.pid) {
      await this.terminate(child.pid,this.jobName)
      if(!this.childClosed)await new Promise<void>(resolve=>child.once('close',()=>resolve()))
    }
    this.child=null
    await rm(this.receipt,{force:true})
  }
}
