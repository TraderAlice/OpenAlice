import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { RssHubSecretStore } from '../../domain/news/modules/secrets.js'
import type { Migration } from '../types.js'

export const migration: Migration = {
  id:'0045_news_modules', appVersion:'0.95.0-beta', introducedAt:'2026-10-05',
  affects:['news.json','../news-modules/rsshub-key.json'],
  summary:'Persist news subscription identities and module defaults; move explicit RSSHub service keys out of feed configuration.',
  rationale:'docs/news-modules/sdd.md',
  snapshotNewsConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid legacy news config')
    const copy = structuredClone(config) as Record<string, unknown>
    if (copy.feeds === undefined) return copy
    if (!Array.isArray(copy.feeds)) throw new Error('Invalid legacy news feeds')
    for (const value of copy.feeds) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy news feed')
      const feed = value as Record<string, unknown>
      if (feed.rsshubRoute === undefined) continue
      if (typeof feed.rsshubRoute !== 'string') throw new Error('Invalid legacy RSSHub route')
      const route = new URL(feed.rsshubRoute, 'http://localhost/')
      route.searchParams.delete('key'); route.searchParams.delete('code')
      feed.rsshubRoute = route.pathname.replace(/^\//, '') + route.search
      if (typeof feed.url !== 'string') throw new Error('Invalid legacy RSSHub feed URL')
      if (feed.url) {
        const url = new URL(feed.url)
        url.searchParams.delete('key'); url.searchParams.delete('code')
        feed.url = url.href
      }
    }
    return copy
  },
  up:async ctx=>{
    const raw=await ctx.readJson<Record<string,unknown>>('news.json')
    if(!raw)return
    let changed=false
    if(!Object.hasOwn(raw,'modules')){raw.modules=[];changed=true}
    if(!Object.hasOwn(raw,'subscriptions')){raw.subscriptions=[];changed=true}
    const keys=new Set<string>();let code=false
    if(Array.isArray(raw.feeds))for(const feed of raw.feeds as Record<string,unknown>[]){
      if(!feed || typeof feed!=='object')throw new Error('Invalid legacy news feed')
      if(typeof feed.id!=='string'||!feed.id){feed.id=randomUUID();changed=true}
      if(feed.rsshubRoute!==undefined){
        if(typeof feed.rsshubRoute!=='string')throw new Error('Invalid legacy RSSHub route')
        const route=new URL(feed.rsshubRoute,'http://localhost/')
        const scrub=(url:URL)=>{const oldKeys=url.searchParams.getAll('key');if(oldKeys.length===1)keys.add(oldKeys[0]!);else if(oldKeys.length>1)code=true;if(url.searchParams.has('code'))code=true;url.searchParams.delete('key');url.searchParams.delete('code')}
        scrub(route)
        const nextRoute=route.pathname.replace(/^\//,'')+route.search
        if(nextRoute!==feed.rsshubRoute){feed.rsshubRoute=nextRoute;changed=true}
        if(typeof feed.url!=='string')throw new Error('Invalid legacy RSSHub feed URL')
        if(feed.url){const url=new URL(feed.url);const before=url.href;scrub(url);if(url.href!==before){feed.url=url.href;changed=true}}
      }
    }
    if(keys.size||code){
      const directory=join(ctx.userDataHome(),'data','news-modules'), path=join(directory,'rsshub-key.json'), secrets=new RssHubSecretStore(directory)
      const key=keys.size===1&&!code?[...keys][0]:undefined
      const base=typeof raw.rsshubBaseUrl==='string'?raw.rsshubBaseUrl:'http://127.0.0.1:1200'
      const status=await secrets.status()
      if(!status.configured){
        try{if(!key)throw new Error('Requires reentry');await secrets.set(base,key)}
        catch{await mkdir(directory,{recursive:true});await writeFile(path,JSON.stringify({legacyCredentialRequiresReentry:true}),{mode:0o600})}
      }else if(status.available){
        if(!key||await secrets.get(base)!==key)throw new Error('Existing RSSHub credential conflicts with legacy route credentials; clear it and retry migration')
      }else{
        let isReentryMarker=false
        try{isReentryMarker=JSON.parse(await readFile(path,'utf8')).legacyCredentialRequiresReentry===true}catch{}
        if(!isReentryMarker)throw new Error('Existing RSSHub credential is unavailable; resolve it and retry migration')
      }
    }
    if(changed){
      const destination=join(ctx.configDir(),'news.json'),temp=destination+'.'+randomUUID()+'.tmp'
      try{await writeFile(temp,JSON.stringify(raw,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,destination)}finally{await rm(temp,{force:true})}
    }
  },
}
