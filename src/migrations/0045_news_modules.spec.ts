import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { migration } from './0045_news_modules/index.js'
import type { MigrationContext } from './types.js'
import { createMigrationSnapshot } from './runner.js'

let home:string, context:MigrationContext
beforeEach(async()=>{
  home=await mkdtemp(join(tmpdir(),'news-migration-'))
  const config=join(home,'data','config');await mkdir(config,{recursive:true})
  context={
    readJson:async<T>(name:string)=>{try{return JSON.parse(await readFile(join(config,name),'utf8')) as T}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e}},
    writeJson:async(name,value)=>{await writeFile(join(config,name),JSON.stringify(value))},
    removeJson:async name=>{await rm(join(config,name),{force:true})},
    configDir:()=>config,userDataHome:()=>home,launcherRoot:()=>join(home,'workspaces'),
  }
})
afterEach(async()=>{await rm(home,{recursive:true,force:true})})

it('preserves duplicate legacy sources, explicit RSSHub ownership and existing choices with stable distinct IDs',async()=>{
  const direct={name:'Legacy absolute RSSHub-looking URL',url:'http://localhost:1200/cls/telegraph',source:'legacy',enabled:false,categories:['macro'],description:'User edited'}
  const explicit={name:'Relative route',url:'',rsshubRoute:'cls/telegraph?limit=10',source:'cls',enabled:true,id:'user-id'}
  await context.writeJson('news.json',{enabled:false,intervalMinutes:17,rsshubBaseUrl:'http://localhost:1200',feeds:[direct,direct,explicit]})
  await migration.up(context)
  const first=await context.readJson<{feeds:Array<Record<string,unknown>>;modules:unknown[];subscriptions:unknown[];enabled:boolean;intervalMinutes:number}>('news.json')
  expect(first).toMatchObject({enabled:false,intervalMinutes:17,modules:[],subscriptions:[],feeds:[direct,direct,explicit]})
  expect(first!.feeds[0].id).not.toBe(first!.feeds[1].id)
  expect(first!.feeds[0].id).toEqual(expect.any(String))
  expect(first!.feeds[2].id).toBe('user-id')
  const persisted=await readFile(join(context.configDir(),'news.json'),'utf8')
  await migration.up(context)
  expect(await readFile(join(context.configDir(),'news.json'),'utf8')).toBe(persisted)
})
it('removes credentials from legacy RSSHub routes and companion URLs, but preserves direct-feed query parameters',async()=>{
  const direct={name:'Direct',url:'https://direct.invalid/feed?key=direct-key&code=direct-code',source:'direct'}
  const explicit={name:'old',url:'http://remote.invalid/cls?key=companion-key&code=one-way-code&display=1',source:'cls',rsshubRoute:'cls/telegraph?code=one-way-code&limit=8'}
  await context.writeJson('news.json',{rsshubBaseUrl:'http://remote.invalid',feeds:[direct,explicit]})
  await migration.up(context)
  const config=await context.readJson<{feeds:Array<{url:string;rsshubRoute?:string}>}>('news.json')
  expect(config!.feeds[0]!.url).toBe(direct.url)
  expect(config!.feeds[1]!.url).toBe('http://remote.invalid/cls?display=1')
  expect(config!.feeds[1]!.rsshubRoute).toBe('cls/telegraph?limit=8')
  expect(JSON.stringify(config)).not.toContain('companion-key')
  expect(JSON.stringify(config)).not.toContain('one-way-code')
  expect(JSON.stringify(config)).toContain('direct-key')
  expect(JSON.parse(await readFile(join(home,'data/news-modules/rsshub-key.json'),'utf8'))).toEqual({legacyCredentialRequiresReentry:true})
})

it('projects legacy credentials out of the pre-migration snapshot without changing live config',async()=>{
  const raw={rsshubBaseUrl:'http://localhost:1200',feeds:[
    {name:'direct',url:'https://direct.invalid/feed?key=direct-key'},
    {name:'explicit',url:'http://localhost:1200/cls?key=companion-key&display=1',rsshubRoute:'cls/telegraph?key=route-key&code=legacy-code'},
  ]}
  await context.writeJson('news.json',raw)
  const snapshot=await createMigrationSnapshot(context.configDir(),join(home,'data','_backup'),'pre-0045',migration.snapshotNewsConfig)
  const backup=JSON.parse(await readFile(join(snapshot!,'news.json'),'utf8'))
  expect(JSON.stringify(backup)).not.toContain('route-key')
  expect(JSON.stringify(backup)).not.toContain('companion-key')
  expect(JSON.stringify(backup)).not.toContain('legacy-code')
  expect(backup.feeds[1]).toMatchObject({url:'http://localhost:1200/cls?display=1',rsshubRoute:'cls/telegraph'})
  expect(backup.feeds[0].url).toContain('direct-key')
  expect(await context.readJson('news.json')).toEqual(raw)
})
