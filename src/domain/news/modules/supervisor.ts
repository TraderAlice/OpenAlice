import { spawn } from 'node:child_process'

/** POSIX group leader stays outside module code, including a hung module import. */
export function runNewsSupervisor(): void {
  const raw = process.env.OPENALICE_NEWS_SUPERVISOR
  delete process.env.OPENALICE_NEWS_SUPERVISOR
  if (!raw) throw new Error('Missing private supervisor launch')
  const {command,args,parentPid} = JSON.parse(raw) as {command:string;args:string[];parentPid:number}
  const child = spawn(command,args,{stdio:'inherit',env:process.env})
  const stop = () => { try { process.kill(-process.pid,'SIGKILL') } catch { process.exit(2) } }
  child.once('exit',stop); child.once('error',stop)
  process.once('SIGTERM',stop); process.once('SIGINT',stop)
  setInterval(() => { try { process.kill(parentPid,0) } catch { stop() } },250)
}
