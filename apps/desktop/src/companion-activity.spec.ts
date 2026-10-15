import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const handlers = vi.hoisted(()=>new Map<string, (event:unknown,input?:unknown)=>unknown>())
const state = vi.hoisted(()=>({home:''}))
vi.mock('electron',()=>({app:{getPath:()=>state.home},ipcMain:{handle:(name:string,fn:(event:unknown,input?:unknown)=>unknown)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)}}))
import { installCompanionActivity } from './companion-activity.js'
function windowStub(){const frame={};const contents=Object.assign(new EventEmitter(),{mainFrame:frame,send:vi.fn()});return Object.assign(new EventEmitter(),{webContents:contents,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,restore:vi.fn(),show:vi.fn(),focus:vi.fn()})}
afterEach(()=>{vi.useRealTimers();handlers.clear();if(state.home)rmSync(state.home,{recursive:true,force:true})})
describe('companion notification IPC',()=>{
  it('accepts only owning main frame settings and rejects subframes/other windows; no URL/code actions',async()=>{
    vi.useFakeTimers();state.home=mkdtempSync(join(tmpdir(),'oa-ipc-'));const owner=windowStub(),pet=windowStub();installCompanionActivity(owner as never,pet as never)
    const event={sender:owner.webContents,senderFrame:owner.webContents.mainFrame}
    const get=handlers.get('openalice:activity:preferences')!;expect(get(event)).toMatchObject({events:{news:true,progress:false},brief:true})
    expect(()=>get({...event,senderFrame:{}})).toThrow('Unauthorized')
    expect(()=>get({sender:pet.webContents,senderFrame:pet.webContents.mainFrame})).toThrow('Unauthorized')
    const update=handlers.get('openalice:activity:update-preferences')!;await expect(update(event,{enabled:'yes'})).rejects.toThrow()
    await expect(update(event,{events:{news:false}})).resolves.toMatchObject({events:{news:false}})
    const open=handlers.get('openalice:activity:open')!;expect(open(event,{url:'javascript:evil'})).toBe(false)
    expect(()=>open({...event,senderFrame:{}},'anything')).toThrow('Unauthorized')
    pet.emit('closed');expect(handlers.size).toBe(0)
  })
  it('ignores destroyed owner state during transitions and pet retirement',()=>{
    vi.useFakeTimers();state.home=mkdtempSync(join(tmpdir(),'oa-ipc-'))
    const owner=windowStub(),pet=windowStub()
    installCompanionActivity(owner as never,pet as never)
    owner.isDestroyed=()=>true
    owner.isVisible=()=>{throw new Error('Object has been destroyed')}
    owner.isMinimized=()=>{throw new Error('Object has been destroyed')}
    expect(()=>owner.emit('hide')).not.toThrow()
    pet.isDestroyed=()=>true
    expect(()=>pet.emit('closed')).not.toThrow()
    expect(handlers.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
