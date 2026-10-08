import { fetchAndParseFeed, cleanText } from './rss-parser.js'
import { computeDedupKey, type NewsCollectorStore } from '../store.js'
import type { RSSFeedConfig, NewsRecord } from '../types.js'
import { DEFAULT_RSSHUB_BASE_URL, resolveNewsFeedUrl } from '../config.js'
import { batchSchema, type ModuleSelection, type NewsSubscription } from '../modules/contract.js'
import type { NewsModuleManager } from '../modules/manager.js'
import type { RssHubSecretStore } from '../modules/secrets.js'

interface FeedHealth {
  state:'never_attempted'|'checking'|'healthy'|'error'; lastAttemptAt:number|null;lastSuccessAt:number|null;lastItemCount:number|null;lastNewItemCount:number|null;lastError:string|null
}
const initialHealth=():FeedHealth=>({state:'never_attempted',lastAttemptAt:null,lastSuccessAt:null,lastItemCount:null,lastNewItemCount:null,lastError:null})
function healthIdentity(feed:RSSFeedConfig,base:string):string{return JSON.stringify([feed.id??null,feed.source,resolveNewsFeedUrl(feed,base)])}
export interface CollectorOpts {
  store:NewsCollectorStore;feeds:RSSFeedConfig[];intervalMs:number;rsshubBaseUrl?:string;enabled?:boolean
  manager?:NewsModuleManager;modules?:ModuleSelection[];subscriptions?:NewsSubscription[];secrets?:RssHubSecretStore
  onIngested?:(record:NewsRecord)=>void|Promise<void>
}
interface CollectorConfiguration {feeds:RSSFeedConfig[];intervalMs:number;rsshubBaseUrl?:string;enabled:boolean;modules?:ModuleSelection[];subscriptions?:NewsSubscription[];maxInMemory?:number;retentionDays?:number}
type RuntimeRow = {kind:'rss';feed:RSSFeedConfig;identity:string;moduleId:string}|{kind:'module';subscription:NewsSubscription;identity:string;moduleId:string}

/** One serialized coordinator, one scheduling queue and one durable ingestion path. */
export class NewsCollector {
  private timer:NodeJS.Timeout|null=null
  private config:CollectorConfiguration
  private chain:Promise<void>=Promise.resolve()
  private fetchInFlight:Promise<{total:number;new:number}>|null=null
  private health=new Map<RuntimeRow,FeedHealth>()
  private runtimeRows:RuntimeRow[]
  private closed=false
  constructor(private readonly opts:CollectorOpts){this.config={...opts,enabled:opts.enabled??true,modules:opts.modules??[],subscriptions:opts.subscriptions??[]};this.runtimeRows=this.buildRows(this.config)}
  private exclusive<T>(action:()=>Promise<T>,allowClosed=false):Promise<T>{const next=this.chain.then(()=>{if(this.closed&&!allowClosed)throw new Error('News collector closed');return action()});this.chain=next.then(()=>{},()=>{});return next}
  async initialize():Promise<void>{await this.exclusive(async()=>{await this.opts.manager?.configure(this.runtimeModules(this.config),this.config.subscriptions??[],true)})}
  private runtimeModules(c:CollectorConfiguration){return (c.modules??[]).map(m=>({...m,enabled:c.enabled&&m.enabled}))}
  configure(next:CollectorConfiguration,persist?:()=>Promise<void>):Promise<void>{
    return this.exclusive(async()=>{
      const old=this.config;this.stop()
      try{
        if ((next.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL).replace(/\/+$/,'') !== (old.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL).replace(/\/+$/,'')) await this.opts.secrets?.assertBase(next.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL)
        // Manager validates the complete candidate once before any worker cutover.
        await this.opts.manager?.configure(this.runtimeModules(next),next.subscriptions??[])
        await persist?.()
        this.config={...next,modules:next.modules??[],subscriptions:next.subscriptions??[]}
        if(next.maxInMemory!==undefined && next.retentionDays!==undefined)this.opts.store.configureMemory(next.maxInMemory,next.retentionDays)
        const previous=new Map<string,FeedHealth|null>()
        for(const row of this.runtimeRows)previous.set(row.identity,previous.has(row.identity)?null:this.health.get(row)??initialHealth())
        this.runtimeRows=this.buildRows(this.config)
        const counts=new Map<string,number>()
        for(const row of this.runtimeRows)counts.set(row.identity,(counts.get(row.identity)??0)+1)
        this.health=new Map(this.runtimeRows.map(row=>[row,counts.get(row.identity)===1?previous.get(row.identity)??initialHealth():initialHealth()]))
      }catch(error){
        try{await this.opts.manager?.configure(this.runtimeModules(old),old.subscriptions??[])}catch{throw new Error('News configuration failed and module recovery is unavailable')}
        throw error
      }finally{if(this.config.enabled&&!this.closed)this.start()}
    })
  }
  private rows():RuntimeRow[]{return this.runtimeRows}
  private buildRows(config:CollectorConfiguration):RuntimeRow[]{
    const base=config.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL
    return [
      ...config.feeds.map(feed=>({kind:'rss' as const,feed,identity:healthIdentity(feed,base),moduleId:feed.rsshubRoute?'builtin.rsshub':'builtin.rss'})),
      ...(config.subscriptions??[]).map(subscription=>({kind:'module' as const,subscription,identity:JSON.stringify([subscription.id,subscription.moduleId,config.modules?.find(module=>module.moduleId===subscription.moduleId)?.contentHash??null,subscription.sourceKey,subscription.source,subscription.params]),moduleId:subscription.moduleId})),
    ]
  }
  getStatus(){return this.rows().map(row=>{
    const feed=row.kind==='rss'?row.feed:row.subscription
    const enabled=this.config.enabled && feed.enabled!==false && (row.kind==='rss'||this.config.modules?.some(m=>m.moduleId===row.moduleId&&m.enabled))
    return {...this.health.get(row)??initialHealth(),id:feed.id,name:feed.name,source:feed.source,moduleId:row.moduleId,
      url:row.kind==='rss'?resolveNewsFeedUrl(row.feed,this.config.rsshubBaseUrl):'',state:!enabled?'disabled' as const:this.health.get(row)?.state??'never_attempted'}
  })}
  getModules(){return this.exclusive(async()=>this.opts.manager?.list(this.config.modules??[],this.config.enabled)??[],true)}
  importModule(value:unknown){return this.exclusive(async()=>{if(!this.opts.manager)throw new Error('Module manager unavailable');return this.opts.manager.importArtifact(value)})}
  approveModule(hash:string){return this.exclusive(async()=>{if(!this.opts.manager)throw new Error('Module manager unavailable');return this.opts.manager.approve(hash)})}
  retryModule(hash:string){return this.exclusive(async()=>{if(!this.config.enabled||!this.opts.manager)throw new Error('News collection disabled');await this.opts.manager.retry(hash);return this.opts.manager.list(this.config.modules??[])})}
  uninstallModule(hash:string){return this.exclusive(async()=>{if(!this.opts.manager)throw new Error('Module manager unavailable');await this.opts.manager.uninstall(hash)})}
  async getRssHubKeyStatus(){return this.opts.secrets?.status()??{configured:false,available:true,baseUrl:null}}
  updateRssHubKey(operation:'set'|'clear',key?:string){return this.exclusive(async()=>{if(!this.opts.secrets)throw new Error('RSSHub secret store unavailable');if(operation==='clear')await this.opts.secrets.clear();else await this.opts.secrets.set(this.config.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL,key??'');return this.opts.secrets.status()})}
  start():void{
    if(this.closed||!this.config.enabled||this.timer)return
    void this.fetchAll().catch(()=>console.warn('news-collector: collection failed'))
    this.timer=setInterval(()=>{void this.fetchAll().catch(()=>console.warn('news-collector: collection failed'))},this.config.intervalMs)
  }
  stop():void{if(this.timer){clearInterval(this.timer);this.timer=null}}
  async close():Promise<void>{this.closed=true;this.stop();await this.exclusive(async()=>{await this.opts.manager?.close()},true)}
  fetchAll():Promise<{total:number;new:number}>{
    if(this.fetchInFlight)return this.fetchInFlight
    const result=this.exclusive(()=>this.collectRows())
    this.fetchInFlight=result
    void result.then(()=>{if(this.fetchInFlight===result)this.fetchInFlight=null},()=>{if(this.fetchInFlight===result)this.fetchInFlight=null})
    return result
  }
  private async collectRows():Promise<{total:number;new:number}>{
    if(!this.config.enabled||this.closed)return {total:0,new:0}
    let total=0,added=0
    for(const row of this.rows()){
      const feed=row.kind==='rss'?row.feed:row.subscription
      if(feed.enabled===false || (row.kind==='module'&&!this.config.modules?.some(m=>m.moduleId===row.moduleId&&m.enabled)))continue
      const health=this.health.get(row)??initialHealth();this.health.set(row,health);health.state='checking';health.lastAttemptAt=Date.now()
      try{
        const inputs=row.kind==='rss'?await this.rssInputs(row.feed):await this.moduleInputs(row.subscription)
        total+=inputs.length;health.lastItemCount=inputs.length;health.lastNewItemCount=0
        // Batch validation precedes every append; report any durable prefix honestly.
        for(const input of inputs){const record=await this.opts.store.ingestRecord(input);if(record){added++;health.lastNewItemCount++;await this.opts.onIngested?.(record)}}
        health.state='healthy';health.lastSuccessAt=Date.now();health.lastError=null
      }catch(error){health.state='error';health.lastError=row.kind==='rss'&&error instanceof Error&&/^RSS (fetch|response) failed:/.test(error.message)?error.message:'News request, module processing or ingestion failed';console.warn('news-collector: source collection failed')}
    }
    return {total,new:added}
  }
  private async rssInputs(feed:RSSFeedConfig){
    let url=resolveNewsFeedUrl(feed,this.config.rsshubBaseUrl)
    if(feed.rsshubRoute){const key=await this.opts.secrets?.get(this.config.rsshubBaseUrl??DEFAULT_RSSHUB_BASE_URL);if(key){const request=new URL(url);request.searchParams.set('key',key);url=request.href}}
    const items=await fetchAndParseFeed(url,1,Boolean(feed.rsshubRoute))
    return items.map(item=>{
      const dedupKey=computeDedupKey({guid:item.guid??undefined,link:item.link??undefined,title:item.title,content:item.content})
      return {title:item.title,content:item.content,pubTime:item.pubDate??new Date(),dedupKey,metadata:{source:feed.source,link:item.link,guid:item.guid,ingestSource:'rss',dedupKey,producerId:feed.rsshubRoute?'builtin.rsshub':'builtin.rss',...(feed.categories?{categories:feed.categories.join(',')}:{}),...(item.image?{image:item.image}:{})}}
    })
  }
  private async moduleInputs(subscription:NewsSubscription){
    if(!this.opts.manager)throw new Error('Module manager unavailable')
    const items=batchSchema.parse(await this.opts.manager.collect(subscription)),identity=await this.opts.manager.identity(subscription.moduleId)
    return items.map(item=>{
      const title=cleanText(item.title),content=item.content,dedupKey='module:'+JSON.stringify([subscription.moduleId,item.externalId])
      if(!title)throw new Error('Module article has no plain-text title')
      return{title,content,pubTime:new Date(item.publishedAt),dedupKey,metadata:{source:subscription.source,link:item.url,ingestSource:'module',dedupKey,moduleId:identity.moduleId,moduleVersion:identity.version,contentHash:identity.contentHash,externalId:item.externalId,subscriptionId:subscription.id,categories:subscription.categories.join(',')}}
    })
  }
}
