import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createActivityPreferenceStore, migrateActivityPreferences } from './activity-preferences.js'
import { DEFAULT_ACTIVITY_PREFERENCES as defaults, allowsActivity, type ActivityPreferences } from './activity-policy.js'
import type { AgentActivitySignal } from './activity-projection.js'
const signal = (kind: AgentActivitySignal['kind']): AgentActivitySignal => ({id:'1',kind,occurredAt:0,revision:1})
describe('activity preferences', () => {
  it('uses explicit choices and keeps delivery gates independent', () => {
    expect(allowsActivity(defaults,signal('conversation'))).toBe(false)
    for(const kind of ['conversation-failed','conversation-completed','inbox','news','conversation-paused'] as const) expect(allowsActivity(defaults,signal(kind))).toBe(true)
    expect(allowsActivity({...defaults,events:{...defaults.events,progress:true}},signal('conversation'))).toBe(true)
    expect(allowsActivity({...defaults,events:{...defaults.events,news:false}},signal('news'))).toBe(false)
    expect(allowsActivity(defaults,{...signal('news'),kind:'unknown' as never})).toBe(false)
    expect(allowsActivity({...defaults,pausedUntil:100},signal('news'),99)).toBe(false)
    expect(allowsActivity({...defaults,enabled:false},signal('news'))).toBe(false)
  })
  it('initializes, persists serial edits/restart, resets only events and validates writes', async () => {
    const dir=mkdtempSync(join(tmpdir(),'oa-notify-'));const path=join(dir,'prefs.json')
    try {
      const store=createActivityPreferenceStore(path);expect(store.get()).toEqual(defaults)
      await Promise.all([store.update({events:{progress:true}}),store.update({brief:false,enabled:false,main:false,pet:false,pausedUntil:100,events:{news:false}})])
      const saved={...defaults,brief:false,enabled:false,main:false,pet:false,pausedUntil:100,events:{...defaults.events,progress:true,news:false}}
      expect(createActivityPreferenceStore(path).get()).toEqual(saved)
      expect(()=>store.update({preset:'all'})).toThrow();expect(()=>store.update({events:{unknown:true}})).toThrow()
      expect(()=>store.update({events:{news:'show'}})).toThrow()
      const before=readFileSync(path,'utf8');expect(()=>store.update({pausedUntil:Infinity})).toThrow();expect(readFileSync(path,'utf8')).toBe(before)
      await store.reset();expect(createActivityPreferenceStore(path).get()).toEqual({...saved,events:defaults.events})
      writeFileSync(path,'{"preset":"bogus"}');expect(createActivityPreferenceStore(path).get()).toEqual(defaults)
    } finally {rmSync(dir,{recursive:true,force:true})}
  })
  it.each(['action','important','all'] as const)('unpacks %s before overrides even while disabled and paused',async(preset)=>{
    const old={...defaults,version:1,defaultsVersion:0,preset,overrides:{news:'show',failure:'hide',progress:'show'},enabled:false,pausedUntil:123456,brief:false,main:false,pet:false}
    Reflect.deleteProperty(old,'events')
    const expected={...defaults,events:{completion:preset!=='action',failure:false,action:true,news:true,progress:true},enabled:false,pausedUntil:123456,brief:false,main:false,pet:false}
    expect(migrateActivityPreferences(old)).toEqual(expected)
    const dir=mkdtempSync(join(tmpdir(),'oa-migrate-'));const path=join(dir,'prefs.json')
    try {
      writeFileSync(path,JSON.stringify(old));const store=createActivityPreferenceStore(path)
      expect(store.get()).toEqual(expected)
      await store.update({events:{action:false}})
      expect(createActivityPreferenceStore(path).get()).toEqual({...expected,events:{...expected.events,action:false}})
      expect(JSON.parse(readFileSync(path,'utf8'))).not.toHaveProperty('preset')
    } finally {rmSync(dir,{recursive:true,force:true})}
  })
  it.each(['action','important','all'] as const)('preserves %s selections without overrides',(preset)=>{
    const {events,...controls}=defaults
    expect(migrateActivityPreferences({...controls,version:1,preset,overrides:{}}).events).toEqual({completion:preset!=='action',failure:true,action:true,news:preset!=='action',progress:preset==='all'})
  })
  it('keeps explicit choices across default versions and rejects future schemas',()=>{
    const old:ActivityPreferences={...defaults,defaultsVersion:0,events:{completion:false,failure:false,action:false,news:false,progress:true}}
    expect(migrateActivityPreferences(old)).toEqual(old)
    expect(()=>migrateActivityPreferences({...old,version:999})).toThrow()
  })
})
