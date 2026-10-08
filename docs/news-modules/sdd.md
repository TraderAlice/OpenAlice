# 可选新闻模块软件设计说明（SDD）

依据：[需求规格](srs.md)、[测试计划](test-plan.md)。状态：推荐方案已批准，正在实现和运行验收；不是交付完成声明。研究与取舍保留在[完整研究](../../plans/news-module-injection-research.md)，实际 ABI 以[公共契约](../../src/domain/news/modules/contract.ts)为准。

## 读者与边界

维护者据此连接管理界面、排查加载故障；社区作者据此交付完整非 RSS 制品。标准 RSS、显式 RSSHub route 和社区结果共用一个采集协调器、去重与 JSONL 归档，不创建逐站旁路。

- RSSHub 是后台可访问的外部运营服务；Alice 不安装或托管它。
- 社区代码须先批准精确内容身份，再启用。批准不是发布者签名。
- 独立 worker 隔离崩溃和卡死，**不是安全沙箱**。获准代码以 Alice 后台 OS 用户权限执行，可访问同一用户权限可读的文件、网络和子进程能力，包括密封凭据文件与本机封存密钥；批准表示操作者信任该代码，不是发布者签名或保密边界。worker 没有 OS 级内存配额，失控模块仍可能耗尽 Alice 后台内存。
- 不自动下载、安装 npm 依赖、升级模块或同步另一后台的制品。

## 制品和公共 ABI

导入一个 JSON 对象：`{manifest, files}`。`files` 将相对路径映射为 UTF-8 文件内容；入口和依赖必须完整包含，推荐使用自包含 `.mjs`。示例：[Hacker News JSON producer](../../examples/news-modules/hacker-news.json)，它读取 Firebase JSON，而不是包装一个 RSS feed。示例不自动安装或批准。

```ts
interface NewsModuleManifest {
  abiVersion: 1
  moduleId: string
  version: string
  name: string
  description: string
  entry: string
  sources: {
    key: string
    name: string
    parameters: {
      key: string
      label: string
      type: "string" | "number" | "boolean"
      required: boolean
    }[]
  }[]
}
interface ModuleItem {
  externalId: string
  title: string
  content: string
  url: string
  publishedAt: string
}
export const newsModule: {
  abiVersion: 1
  moduleId: string
  version: string
  collect(
    input: {sourceKey: string; params: Record<string, string | number | boolean>},
    context: {signal: AbortSignal},
  ): Promise<ModuleItem[]>
}
```

`newsModule` 是 ESM 命名导出。宿主检查 ABI、moduleId、version 和 collect；模块无需自行实现 stdio。来源和参数键唯一，标识符为受限 ASCII；未知字段、未知参数、缺必填值、类型不符均拒绝。普通参数不接收核心密钥。

`publishedAt` 为可解析的带时区 RFC3339；`url` 必须 HTTP(S) 且不含用户名密码。内容仅作文本，不能提交 HTML 执行字段。`externalId` 在整个 moduleId 内稳定：多来源模块自行加入稳定来源域。核心去重键是无歧义的 `[moduleId, externalId]`，不包含版本或订阅 ID。

完整制品 SHA-256 覆盖规范化清单和排序后的全部文件内容。安装到独立 hash 目录；相同内容复用，改变任何成员须重新批准。禁止绝对路径、穿越、链接、大小写冲突、文件/目录冲突、Windows 保留名和核心元数据覆盖。加载前重新核对清单、内容身份及成员字节。发现只读取清单，不导入代码。

## 订阅、配置与操作

现有 `feeds` 保留标准 reader 配置和 GUID/link/hash 去重资格；显式 `rsshubRoute` 归 `builtin.rsshub`，其余绝对 URL 归 `builtin.rss`，不根据 URL 域名猜测。`subscriptions` 仅保存社区来源，两者投影为同一运行时队列，不重复调度相同兼容记录。

社区订阅保存 `id,moduleId,sourceKey,name,source,enabled,params,categories`。`modules` 每个 moduleId 只选一个 `{moduleId,contentHash,enabled}`。订阅不持有版本；卸载不删除订阅或历史。缺失来源不能回退成 URL 假装采集成功。

所有配置、制品生命周期和密钥写操作经过同一个服务端串行协调器。普通整节配置写必须显式包含 modules/subscriptions，旧客户端省略它们时拒绝，不能以默认空数组清掉现有状态。

| HTTP 操作 | 请求与结果 |
|---|---|
| GET `/api/news/modules` | `{modules}`，发现不执行代码 |
| POST `/api/news/modules` | `{artifact}` → 已安装清单/hash/批准状态 |
| POST `/api/news/modules/:hash/approve` | 批准精确制品 → 已安装状态 |
| POST `/api/news/modules/:hash/retry` | 对选定且启用的故障制品明确重试 → `{modules}` |
| DELETE `/api/news/modules/:hash` | 先解除选定身份，停止并核对后卸载 → `{ok:true}` |
| PUT `/api/config/news` | 完整配置，经停止/加载/持久化门禁保存 |
| GET `/api/news/rsshub-key` | `{configured,available,baseUrl}`，不含 key |
| PUT `/api/news/rsshub-key` | `{operation:"set",key}` 或 `{operation:"clear"}` → 状态 |

沿用既有后台访问控制，不新增匿名管理入口。desiredEnabled 是配置意图；loaded/loadedHash 仅依据真正就绪的 worker。失败和配置启用不是同一状态，不能由磁盘选择推断加载成功。
全局 enabled=false 时保留模块的 desiredEnabled 意图，但无既有故障的 worker 正常未运行应为 disabled；全局启用且已批准的所选模块未加载应为 failed。状态判断依据 collector 当前配置和真实 worker/故障记录，不把失败候选遗留的内部选择当作已生效配置。

订阅的封存提示表示未选择可用的已安装版本；不是声称安装清单为空。取消版本选择会停止该模块订阅，但不删除已导入的制品、审批或历史新闻；installed、selected、desiredEnabled、loaded 分别呈现。

## 加载、切换和故障

1. 排空在途采集，暂停调度，校验制品批准与参数。
2. 确认旧归属树停止，再 import 候选；接受切换空窗，不承诺 import 没有副作用。
3. 候选 ready 后原子 rename 提交配置、发布内存配置，再恢复调度。
4. 启动或写盘失败，结束候选、恢复旧批准配置；恢复失败明确不可用，不假成功。
5. 协议错误、卡死或崩溃留下持久故障标记，直到明确 retry；不做隐蔽自动重启。后台启动时单模块故障不阻断其他来源与聊天。

私有 stdio 每行 UTF-8 JSON，每个 worker 同时一个请求。宿主生成单调请求 ID；不接收主动推送、错 ID 或重复结果。console 在 import 前被限制到 stderr；直接写 stdout 会破坏协议并导致故障。模块的 AbortSignal 是合作取消，宿主截止时间仍可强制结束忽略 signal 的代码。

Windows 由窄启动器将 CREATE_SUSPENDED 子进程加入 kill-on-close Job Object 后恢复。POSIX 用不导入模块的独立进程组监督器；停止时先枚举可见后代并由叶到根发信号，再确认 PID 退出。已自行 daemonize、在扫描前已脱离父子关系的进程可能不再可归属，因此 POSIX 进程组/树清理不是对抗恶意同用户代码的 OS containment。所有权记录持久保存 PID、启动身份、机器身份和随机任务身份；恢复不凭裸 PID 杀进程。停止失败保留所有权、阻止替换/卸载，退出也报告失败而非宣布已清理；不要把停止 worker 等同于沙箱。

内置 Guardian 和桌面用父进程独占的 child IPC `openalice:shutdown` 请求 Alice 执行同一个幂等关闭函数；不增加 HTTP 停机面。Alice 在 startup await 前捕获请求，关闭函数可用后处理，不丢掉启动途中收到的请求。Windows 的 SIGTERM 不会执行 Node/Bun 的信号清理，故 IPC 是优雅阶段，10 秒后仍未退出保留强制后备。Guardian 在子进程确认退出后才释放 owner，强制后最多再等 2 秒；未确认时保留归属。CLI down 的现有返回条件仍是 Guardian absent，不单独证明新闻 owner 收据消失；实际验收须检查收据、进程和历史，不以请求发出或退出码替代。开发 watch 包装器仍走原树停止路径。
关闭标志设置后，Guardian/桌面的每个实际 spawn 同步拒绝新增子进程；已跨 await 的启动、重启和回到集成模式检查关闭状态，关闭后才返回的归属直接释放、不发布。桌面 IPC 失败在 POSIX 后备为原生 SIGTERM，在 Windows 等待现有宽限后强制，不因回调错误立即杀树。Alice 收集器关闭未确认或其他清理失败时退出非零且不主动释放 runtime lock；启动异常也先尝试关闭收集器。已退出 PID 的锁会按现有恢复逻辑视为 stale，不能把保留 Alice 锁说成永久阻止接管；worker 的身份收据和 recovery 门禁仍是独立边界。

## 统一写入和历史

完整批次校验并转换后才写第一条。坏类型、日期、链接、空清洗标题或超限整批拒绝；合法空数组成功 0。核心添加订阅 source/categories、真实 moduleId/version/contentHash/externalId/subscriptionId，模块不能伪造核心序号或归档归属。

JSONL 逐条追加，不是整批事务。追加中断可能留成功前缀，报告失败；成功追加后才提交去重缓存，重试不会吞掉此前追加失败条目。标准 reader 保持旧 source、ingestSource 和 GUID/link/hash；不重写或猜测旧历史 provenance。关停采集或卸载不取消归档工具。

## RSSHub 服务 key

复用核心 seal/unseal，独立私有 sealed 文件，不进普通配置、模块参数、worker 环境、状态或错误。绑定规范化完整实例基址（包括路径）。带 key 时更换实例须 **clear → 改基址 → set**；不把旧 key 发往新实例。损坏或无法解密明确 unavailable，不当作无凭据匿名请求。密封保护静态落盘，不隔离同一 OS 用户获准代码对用户数据目录和封存密钥的访问。

仅实际 RSSHub fetch 前临时附加 key query；直接 RSS 不接收。带凭据请求拒绝重定向，非 loopback 必须 HTTPS。RSSHub route 及其 companion URL 不允许 key/code 参数；普通 direct RSS URL 的查询语义不变。迁移移出旧显式 route 的访问 key；不可恢复的 code/歧义凭据移除后留下需重录状态，不假装仍可认证。迁移前配置快照会剔除这些凭据；此前已生成的旧备份不会自动改写或删除，运营者应按含明文凭据处理并安全清理。运营者的源站 Cookie/Token 仍由 RSSHub 自己管理。

## 限额和运行形态

| 资源 | 限制 |
|---|---|
| 完整 JSON 制品 | 8 MiB，最多 128 文件；单制品限制，不是已安装制品总量上限 |
| 模块导入 HTTP 请求体 | 解析 JSON 前最多 6 × 制品上限 + 1 MiB，超出返回 413 |
| RSS/Atom HTTP 响应 | 8 MiB 实收字节；Content-Length 只作提前拒绝，超限取消响应且不重试 |
| ready / collect | 5 秒 / 15 秒 |
| worker 请求 / 响应 / 累计 stderr | 64 KiB / 2 MiB / 64 KiB |
| 每批条目 | 256 |
| 单条标题 / 正文 / externalId / URL | 4096 / 262144 / 1024 / 8192 字符 |

超限拒绝，不静默截掉新闻。限额是实现约束，不是性能测量。当前没有 worker OS 内存硬限制，也没有所有已导入制品的总数或总磁盘配额；导入由可信后台操作者管理。源码、dist/实际 Electron、编译 Bun CLI、远程后台各走窄 worker 入口；不启动另一完整 Alice，也不回退开发路径。远程的实例 localhost 与制品目录都属于后台，浏览器断开不停止采集。

支持声明以[测试计划](test-plan.md)的逐形态正向/负向运行证据为准；Node 源码 smoke 不能证明 Electron 包或编译 CLI。当前完成状态由验收记录确定，不由本设计文档宣称。
