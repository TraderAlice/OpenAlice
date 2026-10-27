<!-- /autoplan restore point: "F:\\projects\\OpenAlice\\.gstack\\tmp\\autoplan\\feat-news-source-management-autoplan-restore-20261010-200530.md" -->
## Implementation plan
# 可选新闻模块：完整落地研究

状态：实施边界已由主人确认并详见第十节；本文件是实施与验收计划，不代表代码已通过验收或已发布。

## 最新进度（2026-10-20）

- Draft PR [#1767](https://github.com/TraderAlice/OpenAlice/pull/1767) 仍为 OPEN / Draft，目标为 `dev`；远端 head 为 `129fb42031e00cfd8fab135d56d522d592f6290a`。本次只 fetch 并核对 GitHub 状态，没有合并远端代码或改动 PR。
- PR 在原候选之后新增 `975538b9`（worker 清理与运行失败状态）和 `129fb420`（关闭竞态与失败归属保留）两笔修复。PR 描述记录的关闭/恢复测试与 `pnpm build`、类型检查有通过证据；完整 `pnpm test` 仍失败，标准 Electron builder、远程后台和字面托盘 Quit 验收仍未完成。未把历史结果当成本次重跑。
- 当前 PR head 的已列 CI 中，Dev PR Clean Build 与 4 个 CLI artifact 验收项为 SUCCESS；Vercel 状态为 FAILURE，链接指向团队 Git 部署授权。检查时间为 2026-10-05，不能代表今天重新运行。
- 本地 `feat/news-source-management` 是 `1b6684e7`，远端 fork 分支已到 `129fb420`，两边有不同的 `dev` 合并历史，不能快进。保留本地未提交的 `PLANS.md`、`plans/news-management-experiment.md` 与本文件；本次不尝试合并/rebase 或 cherry-pick。

研究对象：OpenAlice 候选提交 `1f3a366882c31668127203f81b6f49693a473c68`。现有来源管理为 [Draft PR #1767](https://github.com/TraderAlice/OpenAlice/pull/1767)，目标分支 dev。本文不修改、合并该 PR，也不吸收 #1647。

读者：维护者、实施者和社区模块作者。读后动作：按第十节已确认的边界及第八节分工实施，以第九节的真实端到端场景验收；计划不是实现、发布或 PR 已完成的证明。

## 一、目标与完整完成判据

非标准新闻来源不再由第一方为每个网站写一条采集旁路。标准 RSS 保留；RSSHub 路由主要交给 RSSHub 社区维护；确实不能通过标准 feed 表达的来源，通过可选模块接入唯一新闻采集与归档管线。

完整实现必须同时满足：

1. 明确生产者契约、配置归属和信任边界；新闻生产者不取得交易、聊天、全局凭据或归档写权限。模块进程以 Alice 当前操作系统用户的权限运行，不是 OS 沙箱，可访问该用户有权访问的本地资源；首次批准每个不可变版本前必须明确警告并要求确认，新版本重新确认。
2. 有真实发现、安装、批准、启用、注入、停用、更新和卸载，不是仅增加配置字段或预设列表。
3. RSSHub 通过可选的通用生产者接入；添加普通路由不新增第一方采集脚本或进程。
4. 一个仓库外的社区模块能采集真实非 RSS 测试来源；不改核心源码即可加载并改变实际归档结果。
5. 所有生产者复用核心校验、身份、去重、保留策略、归档、事件、健康状态和现有新闻消费接口。
6. 加载失败、超时、崩溃、在途更新及停用有可观察的边界；支持的源码、桌面、编译 CLI 和远程运行形态分别通过实测。

外部 RSSHub 服务可用不等于 Alice 已具备模块注入；配置支持模块不等于实际模块被执行；生产者返回条目不等于端到端归档正确。
技术验收不证明产品采用或减少维护负担：社区作者意愿、来源维护成本和用户实际价值仍是未验证假设。本计划的端到端结果只证明技术可行，不据此宣称采用率或工作量收益。

## 二、现状与证据

### 2.1 仓库现状

- Alice 主入口直接创建 RSSCollector。optionalPlugins 当前为空；Plugin.start 接收广泛的 EngineContext，该上下文含交易和其他核心能力，不能直接作为社区新闻 ABI。[L1]
- RSSCollector 已有串行配置切换、标准 feed 读取、存储去重、事件和进程内健康状态。它是可复用的中央管线，不应再建一套新闻存储。[L2]
- INewsProvider 是归档读取接口，不是来源生产者接口。[L2]
- UTA Broker Packs 确有外部 ESM 加载、API 版本检查及安装身份；它属于交易子系统，固定引擎表和 Broker API 不能直接变成新闻模块框架，也不提供沙箱。[L3]
- Workspace 模板、bootstrap 和 Connector 静态工厂不是现成的新闻模块注册表；图片资产包也不代表可执行插件机制。[L4]
- 当前配置接口为 PUT /api/config/news。配置文件保存和活动采集器重配置不是一个跨磁盘与运行时的原子事务；新设计不能声称已有这种保证。[L5]

#1767 可复用来源编辑、RSSHub 实例地址、显式 route、配置热更新、手动采集和健康展示；没有模块安装、批准、发现或生产者注入。

实际运行 Node 22 + 仓库 tsx 对当前 schema 和 URL 解析器的探针，结果：

- 输入 modules 字段被当前 schema 丢弃，输出 moduleFieldRecognized 为 false。
- 切换 RSSHub base，显式 rsshubRoute 的有效 URL 从实例 A 切换到 B。
- 普通绝对 RSS URL 不随 base 改变。

这是实际函数行为证据，不是模块加载证据；没有启动 RSSHub、执行社区模块或访问外网。一次 Eval 环境导入失败不用于判定仓库运行失败，以上结果来自实际 Node/tsx 入口。

### 2.2 RSSHub 官方契约

资料固定到应用 `DIYgod/RSSHub@0f80e1beca54d629086689c1464d830cd2b4986c` 和文档 `RSSNext/rsshub-docs@d63d91d35369d59ea7d591cebdb91077fb2b5b79`，不把浮动文档当作永久兼容承诺。

- 官方主要接入方式是实例 HTTP 地址加 route，输出标准 feed；也有 Atom 等输出参数。公共实例有访问与容量限制，不能当作产品 SLA。[R1]
- 存在公开 npm API：init、request 和 registerRoute；固定提交中的 request 签名为 Promise<Data>，返回解析后的 JSON。官方标为实验性。不能说没有公开 API，也不能把它等同于稳定的 RSS HTTP 服务或发布好的 server 可执行载荷。[R2]
- 固定应用版本 engines 为 ^22.22.2 或 ^24.15.0；本次 Alice 探针使用的 Node 22.19.0 不满足这个 RSSHub 版本要求。package.json 没有 bin；声明 dist 服务入口不证明 npm 发布包包含可运行服务。[R2]
- 路由可能依赖浏览器、原生组件和源站凭据；把整个 RSSHub npm 包塞进 Alice 会把这些运行时和升级责任带进第一方。[R2]
- 社区贡献走 RSSHub 路由贡献、PR 和维护者审查，并非任意外置 route 包已具备稳定加载协议。[R3]
- ACCESS_KEY 是 RSSHub 服务访问控制，可通过 key 或 code 查询参数使用；不等同于 Alice 用户认证或模块执行批准。查询参数必须在错误、日志和状态中脱敏。[R4]
- RSSHub 采用 AGPL-3.0。若选择随产品分发或托管修改版本，需要核实具体发布方式的许可义务；本文不作法律结论。

因此建议先消费受支持的 HTTP feed，而非嵌入实验性 npm API。Alice 管理完整 RSSHub 服务是另一个必须明确承诺的运行时范围，不能把它藏在一个“安装包”按钮后面。

## 三、接口方案与选择

| 方案 | 模块返回 | 核心职责 | 适用与不足 |
|---|---|---|---|
| A：endpoint resolver | 经校验的 feed endpoint | HTTP、RSS 解析和归档 | RSSHub 最省代码；不能独立完成任意非 RSS 适配 |
| B：news producer | 经协议表达的条目批次 | 校验、去重、归档、事件和状态 | 能支持真正的非 RSS 来源；执行位置仍需决定 |
| C：进程宿主 | hello/ready 与 collect/result/error 消息 | 调度、身份、停止、超时和管线 | 是 B 的故障隔离方式，不是另一种新闻数据模型，也不是 OS 沙箱 |

建议采用 B 作为逻辑契约，对仓库外可执行社区模块使用 C；标准 RSS 和第一方通用 RSSHub reader 直接复用已有标准 feed 读取能力，不为每个 route 起进程。

具体效果：增加一个 RSSHub route 只增加订阅参数或目录数据；增加一个非 RSS JSON 来源则安装一个独立生产者包。两者最终进入同一 ingest。若只选 A，必须明确产品仅支持标准 feed，这不是本文完整目标的替代完成。

独立审阅意见的分歧已保留：resolver 方案更便宜，适合纯 RSSHub；producer 方案覆盖非 RSS；进程宿主减少崩溃和卡死影响，但增加跨平台生命周期成本。完整非标准来源目标使 B 必要，明确社区执行边界使 C 有意义。

## 四、最小契约与唯一采集管线

### 4.1 职责归属

| 层 | 拥有 | 不拥有 |
|---|---|---|
| 核心 | 订阅身份、调度、批准、校验、归档、去重、标签、保留策略、状态与消费 API | 每个网站的抓取逻辑 |
| native RSS | 已有标准 HTTP/RSS/Atom 读取 | 另一份存储 |
| 可选 RSSHub producer | base + 显式 route 组合、标准 reader 适配 | 嵌入所有 RSSHub route 实现、源站 Cookie |
| 目录/预设 | 展示名、参数示例和版本元数据 | 安装即执行、覆盖用户订阅 |
| 可执行社区 producer | 本来源 HTTP 和非标准数据转换 | 全局 EngineContext、归档写入、交易能力 |
| RSSHub 服务运营者 | RSSHub 运行、缓存、浏览器依赖、源站凭据与服务升级 | Alice 用户权限和核心状态 |

### 4.2 生产者数据协议

核心提供 subscriptionId、sourceKey、该订阅参数、截止时间和取消能力。producer 返回本次采集的完整条目批次，条目包括本来源 externalId、标题、正文、可选标准链接和必需的真实 RFC3339 发布时间；缺失发布时间不得以采集时间替代。内部 reader 可以直接使用 Date；跨进程协议使用带时区的 RFC3339 时间，进入核心时统一解析。

不接受模块指定核心 seq、全局 source、核心标签、去重结论或写入事件。标签和 provenance 由核心根据批准的模块身份与订阅配置生成。完整 JSON 结构、可选字段、正文格式和字段限额应固定为版本化协议，在第一波核心实现中冻结；不得让不同生产者各自决定字段含义。

离线 manifest 提供 moduleId、显示名、版本、协议版本、入口与纯声明式参数描述。发现、列表和表单读取不能 import 插件代码，否则查看已安装模块也会执行未批准代码。参数描述仅支持明确列出的类型/约束，未知格式标为不兼容；复用项目已有校验能力，不假设存在任意 JSON Schema 转 Zod API，也不先造通用插件表单框架。

公共作者 ABI 已由 `src/domain/news/modules/contract.ts` 定义，并在 SDD 与 Hacker News 示例中使用；实施必须以该类型和 `docs/news-modules/sdd.md` 为准，不另造 ABI v1、适配别名或第二种作者入口。manifest 使用 `name` 和 `sources[].key/name/parameters[]`；模块通过 ESM 命名导出 `newsModule` 暴露 `abiVersion: 1`、`moduleId`、`version` 和 `collect(input, context)`。输入为 `{sourceKey, params}`，取消信号为 `context.signal`；返回 `ModuleItem[]`，每项必需 `externalId`、`title`、`content`、HTTP(S) `url` 和带时区 RFC3339 `publishedAt`。未知字段、来源/参数错误、非法 URL/时间、超额数据按权威契约拒绝。

作者不实现 stdio。宿主与 worker 间的私有 IPC 仍由 Alice 包装器负责，消息身份、代次、容量、deadline、stdout 限制及进程树退出要求属于内部实现，不得成为第二份公开作者 ABI。波次 1 先核对并补齐现有类型、SDD、示例和契约测试，再实现 worker；任何契约差异先同步权威定义与所有调用者。

制品 hash 由宿主对规范化 manifest 与排序后的全部文件内容计算。发现和列表只解析 manifest，不导入代码。参数校验只接受契约列出的类型、必填规则与已实现约束；普通订阅参数不接收核心密钥。依赖随制品完整包含，运行时不自动安装依赖。

`externalId` 在整个 `moduleId` 内稳定唯一；多来源模块自行加入稳定来源域。同一条目被多个订阅采到时复用同一 ID，因此 subscriptionId 不进入去重键。核心以无歧义的 `[moduleId, externalId]` 去重。

### 4.3 ingest 不变量

1. 先校验完整批次，再开始写入；非法类型、日期、URL、超额或协议错误整批拒绝，不悄悄截断。合法空批次为成功 0 条。
2. 新的非 RSS 模块 externalId 的核心去重域包含 moduleId，不包含版本；两个模块各返回 ID=1 不互相吞掉，升级同一模块也不重复历史。native RSS 以及通过同一标准 reader 采集的通用 RSSHub producer 保留既有 GUID/link/hash 去重计算，包括从旧显式 rsshubRoute 迁移的订阅；不加新的 moduleId 前缀、不重导历史。该兼容策略由核心绑定第一方标准 reader，不允许任意社区模块自行声明使用旧去重域。
3. 核心记录实际加载的 moduleId、版本和内容身份；旧记录缺少 provenance 保留未知，不从标签或 URL 猜测回填。
4. 核心校验链接协议、必要字段、时间与容量后复用既有存储、事件和保留策略。
5. 生产者无自建计时器、后台推送或直接 ingest；日志只保留脱敏、受限的结构化错误，不回传原始 query、provider body、环境或无限 stderr。
6. JSONL 按条追加而非批次事务。协议或完整批次校验失败必须零写；中途写失败可留下合法前缀并如实报告。若失败留下不完整尾行，后续追加前必须安全隔离并截断该尾部；若无法确认只影响未完成尾部则停止追加并报告可恢复错误，绝不能与坏尾拼接或改写中间已确认记录。若整行已落盘但调用仍报告失败，重试前须将完整尾行纳入去重状态。进程内重试与重启重试都不得重复持久身份，也不得删除已确认记录。

### 4.4 可执行模块宿主

一个活动可执行模块对应一个受 Alice 管理的 worker。更新可先校验制品、批准身份及参数，但候选代码不得在旧 worker 退出前 import 或执行；不是一个网站或一条 RSSHub route 一个守护进程。私有 stdio 通道只接受版本化 hello/ready、collect/result/error。

核心分配 activationId、requestId、subscriptionId；响应必须匹配当前请求和活动代次。错误 JSON、错身份、重复响应、过期响应和主动推送不能写入当前采集。宿主根据实际载荷路径和已校验内容计算加载身份；模块自己回显 contentId 不是运行代码的证据。

超时必须结束旧 worker，不能把下一次请求交给仍在卡死的旧进程。协议错误或崩溃隔离该模块，明确显示不可用，由用户重试或重新启用；普通上游 feed 错误可按原有周期再次采集，不新建一套隐藏重试/重启框架。停用、卸载和 Alice 退出均停止自己拥有的进程树。

建议初始预算：ready 5 秒、collect 15 秒、请求 64 KiB、响应 2 MiB、单批 256 条、stderr 64 KiB。这些是待实测校准的设计参数，不是当前保证。超出时明确拒绝；若真实来源会持续超限，在批准前定义有游标的分页契约及核心收尾规则，不能默默丢掉尾部新闻。

worker 必须通过专用窄入口启动，不能启动完整 Alice 后再隐藏其交易/SEC/全局初始化副作用。编译 Bun 的 Alice 可执行文件不等同于通用 Node 解释器；每种发布形态必须实际证明 worker 入口和依赖能启动。

## 五、发现、批准与生命周期

第一条社区闭环采用“后台导入明确的本地发布制品”：manifest、入口、依赖声明与完整内容身份。自动下载、市场、签名服务和自动更新另行决策；不借此缩水掉本地模块发现和真实注入。

导入时检查路径穿越、包布局、协议兼容性和体积，暂存不可变制品。模块列表读取 manifest 不执行入口；批准明确关联 moduleId、版本及完整制品 hash。校验 hash 证明完整性，不证明作者可信。每个新的不可变版本/hash 均须单独批准，不能把旧版本批准扩展成永远批准该作者代码；同一版本因 hash 改变产生的候选也须重新呈现完整信任警告并由用户明确批准。

每次批准必须明确说明：模块代码可按当前 Alice 用户的 OS 权限执行，可访问同用户可读文件、网络和子进程；hash 只绑定内容，不证明作者可信，也不是沙箱。取消/拒绝不执行入口。

同一 moduleId 的不同 hash 是不同不可变制品，hash 路径不得覆盖。重复导入相同 hash 幂等；任何内容改变均须重新批准，并由版本与 hash 明确区分候选，不要求仅因 hash 改变就人为改 moduleId 或版本。manifest 自报 hash/身份不得替代宿主对实际内容的计算。UI 必须让操作者看清将批准的版本和 hash。

状态明确分成：

- desired：用户选择的版本和启停。
- installed：磁盘上实际存在、验证通过的制品。
- loaded：本次宿主实际加载且 ready 的版本/内容身份。

候选制品与参数的非执行校验通过后，先暂停旧调度、等待当前 collect 的剩余截止时间，再按有界进程树停止旧 worker，并确认宿主及归属进程树退出。只有旧树退出后才能 import 已批准候选并等待 ready；因此切换期间允许短暂不可用，不承诺新旧 worker 并行或 import 无副作用。ready 后原子替换磁盘配置与批准身份，再以无异步间隙的内存快照发布新代次并启动调度。

停旧前的非执行校验失败：保留旧磁盘配置、旧 worker 与 loaded 身份，拒绝更新。旧树停止超时或退出无法确认：保留旧 desired 与制品，不 import 候选、不提交新配置；停止该模块调度并拒收响应，loaded 标为不可用、状态为 termination-failed，不声称旧 worker 仍在服务。确认旧树退出后，方可按原批准身份恢复。旧树已退出后候选 import/ready 或配置写入失败：不提交新 desired；先结束候选并确认退出，再按原批准身份重新加载旧版本。恢复期间 loaded 为空、状态为 restoring/unavailable；确认旧版本重新 ready 后才恢复 loaded。候选或旧树无法确认退出/恢复失败时显示不可用并保留所有权记录，禁止再次启动同一模块。磁盘提交后崩溃，重启按已提交配置重新验证加载；失败显示不可用，不把上次 loaded 当成当前 loaded。配置变更在同一串行队列执行。

termination-failed/unconfirmed-ownership 必须有明确的“重新检查/恢复”操作。该操作只重新检查原 Alice 所有权记录及进程树；确认旧树实际退出后才可恢复原批准版本或允许后续候选切换。未确认退出时保持阻塞、保留所有权，不清除记录、不启动第二 worker，并显示可执行的下一步。普通 retry 不得绕过此门禁。

所有错误通过现有状态/API/UI 提供有限、脱敏的 reason、是否允许 retry、next safe action，以及模块/hash 和操作引用；至少区分坏制品/ABI、参数无效、上游采集失败、停止失败、恢复失败、所有权未确认、配置写入失败和迁移失败。不得回传模块原文、密钥或任意 stderr；UI 文案覆盖 en、zh、ja、zh-Hant。

停止预算提案：发出合作式结束请求后等待 2 秒，再调用平台进程树强制终止并最多等待 3 秒，必须验证宿主及归属子进程实际退出。旧树终止失败发生在磁盘提交前：拒绝更新/停用/卸载，保留原磁盘 desired，取消 loaded 的可用资格，状态为 termination-failed 并报告操作失败；停止该模块调度、拒收响应，不激活候选、不删除旧制品，不宣称停用完成。清理候选也遵循此规则；候选无法结束则保留所有权记录并阻止该模块后续启动。其他来源和聊天继续服务。

宿主为每次 spawn 保留后台本地进程所有权记录（平台任务/进程组标识、PID 加启动身份、activationId 与制品身份），停止失败状态可恢复；不能只凭 PID 杀进程。重启先核对并处理仍存活的自有进程，无法确认所有权或无法结束时显示待人工处理并禁止启动重复 worker。旧树在磁盘提交前已结束，因此不存在“提交成功后还等旧树停止”的正常路径；若新代次在提交后死亡，desired 是新版本而 loaded 不可用，明确报错，重新加载需经过同样清理和批准检查。

未启用、未批准或没有活动订阅的外部模块不启动 worker。只改展示名/标签/间隔不换执行代次；否则健康“保留”规则会被不必要的重启破坏。

停用、卸载和批准撤销使用同一停止门禁；停止失败不回报成功，也不删除磁盘批准记录，但运行时立即拒收该代次结果，明确显示撤销/停止未完成并禁止再次调度。停止成功后提交禁用/撤销配置，卸载删除制品但保留订阅与历史；删除失败显示卸载失败而不是恢复执行。缺包不退回旧 URL 假装健康；重新安装并批准后才能恢复。Alice 退出也执行有界清理，失败留下所有权记录与明确错误，不宣称后台全部结束。

worker 是故障隔离，不是安全沙箱：它仍可能以当前 OS 用户访问文件和网络。社区可执行模块限于用户明确批准的可信代码；窄 API 不会取消 Node/Bun 自身的系统权限。若要求安全运行未知恶意模块，必须补充 OS 级限制、资源与凭据隔离及威胁模型，不能称本方案已经覆盖。

RSSHub 服务访问 key 和源站凭据不得从 Alice 全局配置隐式传给模块。服务 key 若纳入产品，必须使用明确的受限秘密存储/引用与脱敏展示，不把完整密钥 URL 暴露给 UI、健康输出或日志；源站 Cookie 默认由 RSSHub 服务运营者管理。其他模块的秘密能力需另行设计批准。

## 六、旧订阅、健康与归档迁移

- 新订阅拆分稳定 subscriptionId、moduleId、sourceKey、用户展示名和参数。迁移只运行一次并持久化缺失 ID，不在每次启动重新生成。
- 旧绝对 URL 一律保留为 native RSS，即使域名或标签看起来像 RSSHub；禁止启发式改归属。显式 rsshubRoute 可确定性迁移到通用 RSSHub producer，保留 base、route、启停、标签和展示名，并保留原 metadata.source、ingestSource: rss 与同一 GUID/link/hash 去重键，保证重启/迁移后等价条目不重导且旧来源筛选不变。新增实际 producer provenance 只用于新记录，不重写旧历史；不能借迁移静默批准执行外部制品。
- 用户编辑、停用和原有订阅不得被新预设覆盖。重复旧身份不能借用另一行健康状态，歧义时重置。
- 名称、标签或轮询间隔变化不清除健康；来源参数、有效 endpoint、生产者身份或加载代次变化重置对应健康。健康仍是进程内观测，不声称持久 SLA。
- 缺失、不兼容或未批准模块有明确状态和操作，不执行旧地址回退，不用“0 条”掩盖不可用。
- 停用和卸载不删除归档。归档读取与 INewsProvider、聊天新闻工具不得因采集器关闭而失效；需检查启动时条件注册的工具，不把采集开关变成历史读取开关。
迁移前创建去敏配置快照；仅在 `up` 成功后记录迁移版本。采用阻止启动并安全重试，不承诺自动回滚：迁移失败时 runner 记录快照并阻止应用加载，可能留下已提交的部分迁移状态。`0045_news_modules` 必须幂等，重复运行从已写入的密钥状态继续完成配置迁移；仅对歧义/冲突的旧凭据写入 re-entry marker。密钥存储或配置写入等可恢复 I/O 失败必须向上抛出、保持旧 `news.json` 中原明文凭据与迁移状态未完成，修复原因后安全重试；不得吞错转成 re-entry marker 或把失败伪装为成功。迁移元数据使用原子临时文件替换，部分写入不能留下不可解析状态。

离线恢复操作手册必须可在 AliceProject 启动失败、API 不可用时执行：停止受影响的 AliceProject runtime；限制权限地备份 `news.json`、迁移元数据及密封 RSSHub key 文件；绝不手工标记迁移已应用。遇到旧 `code`/多 key 歧义时，离线仅移除 `rsshubRoute` 及其配套 URL 中有歧义的 legacy `key`/`code`，保留 route、启停、标签等路由设置和已有密封 key；重新启动后只通过正常 UI/API 录入预期的唯一 key。若 key 文件或配置写入失败，保留旧配置/明文并修复存储权限或磁盘后重试，不要求用户重新录入。去敏快照不含凭据，不能恢复密钥；既有历史备份可能仍有明文 key，runbook 必须警告且不得声称会自动改写旧备份。

## 七、部署边界与真实支持矩阵

| 形态 | 已有证据 | 新架构还必须证明 |
|---|---|---|
| 源码开发 | 当前 Node/tsx 新闻函数与既有 RSS 运行验证 | 真实模块发现、加载、HTTP、归档和退出 |
| Electron 桌面 | 项目既有后台运行形态 | 打包资源、后台 worker 窄入口、进程树结束 |
| 编译 CLI | 既有 Broker Pack 文档有外部 ESM 实践 | 新新闻 ABI 与 worker 在真实编译产物可执行 |
| 远程访问 | 后台在浏览器断开后继续运行 | 上传/导入目标是后台，断开重连与状态一致 |
| RSSHub HTTP | 官方标准 feed 接口 | 本地实例真实 route 与核心采集闭环 |

这些新验收目前均未执行。Node 单元测试不能替代编译产物，旧 Broker Pack 实践不能替代新新闻模块证明。

实际支持矩阵只覆盖现有发布目标：编译 CLI 的 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`win32-arm64`、`win32-x64`；Electron 发布制品的 Windows x64、macOS arm64、macOS x64。每个目标必须在匹配 OS/架构上运行对应实际发行制品；不可用平台标为未验证/不支持，不以交叉编译或其他目标替代。每次记录制品版本、SHA/build identity、OS/架构、实际启动命令、退出码及脱敏输出。

每个形态在隔离 AliceProject `OPENALICE_HOME` 中执行完整导入、hash 检查、明确批准、选择、真实 collect、JSONL/UI 核对和进程树停止；再执行坏 ABI/导出/缺依赖负对照，并确认失败不回退开发环境依赖路径。远程访问另验证浏览器断开/重连时后台状态与制品身份不变。编译 CLI 的干净环境不得预装或借用未声明的 Node/Bun/npm；必须证明正式入口使用随发行物包含的运行时和依赖。

制品安装和 RSSHub 网络请求发生在 Alice 后台，不是浏览器。remote UI 中 localhost 指向服务的后台运行环境；配置迁移不等于迁移可执行制品，另一台机器只有配置而缺少包时应显示缺少模块。

默认建议用户/运营者提供 RSSHub HTTP endpoint。若要求 Alice 一键管理 RSSHub，完整范围必须包含服务制品来源及锁定、满足实际 engines 的运行时、浏览器和原生依赖、启动/就绪、端口与访问控制、升级/回滚/停用、桌面与 CLI 分发、许可说明。不能用仅能 import 实验性 npm API 的探针代替这些项，也不能擅自选择 Docker。

## 八、实施顺序、边界和 PR 处置

### 波次 1：核心契约与活动状态，父会话实现

先以 `contract.ts` 与已批准 SDD 为作者 ABI 权威，核对并补齐类型、示例和契约测试，不重新设计第二套公共协议；明确订阅/来源身份、单一 ingest、去重域和活动切换状态机，以及在途切换、前缀写入失败和恢复的确定行为。核心设计代码由协调者写，不交给执行 worker 重新推断。
在扩展 UI/API 和外围接线前，先按第七节准确的 release target 矩阵，用每个实际分发形态的最小真实 worker 验证启动、依赖解析和停止；该探针不代替后续完整负对照与端到端验收。失败先修复接线或调整真实支持边界，不继续押注大规模实现。

建议改动边界：现有新闻 types/config/collector/store 和主入口；新的 producer registry、manifest reader、runtime host 与私有 worker entry 放在新闻领域内。具体文件名在实施时按已有结构决定，不冒充已存在。不要复用 UTA Broker API，也不要先造全项目插件平台。

### 波次 2：真实注入闭环

通过 registry 注入 native RSS 和可选 RSSHub producer，复用已有 reader。实现外部制品导入、批准及 C 宿主，使一个社区非 RSS 示例通过真实 HTTP 输入、B 输出进入核心存储。宿主与导入核心状态按冻结接口实施；社区示例与平台调用迁移可在契约明确后分离。

### 波次 3：独立外围切片并行

接口就绪后，把互不重叠的 UI/API 状态展示、旧配置迁移、demo 调用迁移、社区示例制品、各发布形态接线和行为回归分给独立 worker；严格字段校验前，先盘点并同批更新全部仓内调用者。旧形状请求必须收到明确、无副作用的验证错误，不能用默认空数组静默清除新字段。共享入口由父会话集成。每个切片有独立验收，不让 UI 假数据替代宿主真执行。文档和设计保持父会话所有权。

### 波次 4：独立端到端验收与文档收口

作者自测之后，由未参与实现的验证者按下一节实际运行，再由父会话检查跨切片结果。通过后更新来源使用说明、模块作者说明、部署/信任说明、变更记录及项目结构中的过时 add-time base / 保存后重启描述。[L6]

PR 处置：

- 完成全部实现与独立验收后，将本批完整变更更新到现有 Draft PR #1767；不独立合入、不合并、不发布。已有来源管理绿灯不能当作模块架构验收。
- #1647 的直接 Gelonghui provider 与旧 RSSHub 替换方案单独处理；没有证据证明已吸收，不关闭、不并入。若批准迁移为社区模块，再按同一契约迁移，不在核心留下另一条抓取旁路。
- 不修改现有用户的 PLANS.md 或实验计划；本研究独立成文，不把旧原型草稿升级为批准要求。

## 九、真实端到端验收合同

以下为实施后必须执行的验收，不是本研究已通过的结果。每行记录实际制品 hash、加载身份、请求、存储/界面证据、退出状态。局部测试不能取代跨接口场景。

| 场景 | 实际操作和期望 | 必须能失败的负对照 |
|---|---|---|
| 无模块与离线发现 | 默认 native RSS 可用；列表读取 manifest 不加载代码、不联网或安装 | 未批准入口含顶层标记副作用，查看列表后标记仍不存在 |
| OS 权限与批准 | 导入、列表、预检或取消批准均不执行入口；每次批准新不可变版本/hash 前显示同用户权限/非沙箱警告，UI 明示 moduleId、version、hash | 仅加载 manifest 的探针在拒绝后仍创建 worker、触碰标记或产生副作用；更换内容 hash 后仍沿用旧批准且不再警告 |
| 不可变内容身份 | 同一 moduleId/version/hash 重复导入幂等；同一 moduleId/version 的新 hash 不覆盖旧制品，必须单独批准且 UI 清楚显示两个 hash | 新 hash 沿用旧批准、覆盖已批准目录、列表无法区分候选或要求操作者仅为 hash 变化伪造新 moduleId |
| 真外部注入 | 固定核心构建不变，导入仓库外制品，真实 HTTP fixture 被模块读取，结果进入 JSONL 与 UI | 改入口为抛错、错 ABI 或不同正文，加载/结果必须相应失败或变化；不是 manifest 回显 |
| RSSHub 闭环 | 真实本地 RSSHub route 输出标准 feed，经过同一 ingest；切 base 只改变显式 route 来源 | native RSS URL 不变；停用 RSSHub 不影响 native RSS；迁移前归档同一 route 条目，迁移后重启再采集新增为 0、旧来源筛选不变 |
| RSSHub 服务 key | 用真实 UI/API 设置与清除 key；本地受控 RSSHub 使用正确 key 后成功采集并进入统一 ingest；迁移旧 key 后从普通配置移除；换 base 必须清除、改址、重新输入 | 缺失/错误 key 显示明确失败而非“健康但 0 条”；未授权 key 操作失败；普通 config、列表、状态、UI、health、错误和日志均不泄露 key；旧 key 不发往新 base；跨源 redirect 在发 key 前拒绝 |
| 非 RSS 社区闭环 | 模块访问 JSON fixture 并转换；不新增第一方站点分支；重启后去重 | 两模块各返回 ID=1 均保留；同模块升级不重复旧 ID |
| 停用与卸载 | 活动 worker 停止、配置和历史保留、状态可解释；安装批准后恢复 | 注入进程树终止失败，操作明确失败、desired 不提交、loaded 不可用、旧制品保留、无候选激活；重启先处理自有残留而非开重复进程；延迟退出后“重新检查/恢复”确认树已退出才能恢复，未确认时重复操作仍不启动第二 worker或清除所有权 |
| 协议和批次 | 日期/URL/类型/容量不合法、缺少 publishedAt 时整批拒绝；合法空批次成功 0 | 前半合法后半非法不提前写入；缺发布时间不得以采集时间补齐；200 HTML 不是健康 feed |
| 卡死与崩溃 | 超时或崩溃结束该模块及归属子进程，其他 RSS 和聊天仍可用 | 无限循环、断裂 JSON、stderr 洪泛及子进程均受到边界；不声称恶意代码沙箱安全 |
| 在途更新 | 模块/参数变化时身份与健康切换正确，旧响应不冒充新代次 | 错 requestId、旧 activationId、重复/主动响应不写当前状态 |
| 更新失败 | 坏新包、未批准版本或 ready 失败不提交新 desired；按明确的 stop-first 顺序恢复原批准版本，恢复完成前 loaded 为空且不可用；写配置失败也须先结束候选再恢复旧版本 | 只改 pointer 不能显示 loaded；旧树停止失败不提交新配置；候选失败不得声称旧 worker 仍在服务；新代次提交后崩溃显示新 desired/不可用 loaded，不冒充回滚成功 |
| 用户配置与迁移 | 编辑/禁用不被预设覆盖；旧绝对 URL 不改归属；缺 ID 迁移只持久化一次 | RSSHub 样式域名不能触发猜测迁移；另一后台仅有配置时显示缺制品 |
| 迁移中断恢复 | 在隔离 AliceProject 上注入密钥成功后 `news.json` 提交失败；runner 阻止启动并记录快照，重跑完成迁移且只记录一个版本。另注入 secret `set`、配置写入、迁移元数据写入失败，修复后重试；检查原配置/凭据被保留、元数据仍可解析、ID 稳定。去敏快照不含明文 key | I/O 错误被吞掉或转为 re-entry marker、应用继续启动、手工标记迁移已应用、重试生成重复 ID/覆写冲突密钥，或历史备份被宣称已自动去密 |
| 写入中断与恢复 | 全批校验/协议拒绝时零写；分别注入 JSONL 半行失败及整行写入后 promise reject；同进程重试、重启后重试均保持文件可解析、无重复持久身份且保留已确认记录。仅截断确认不完整的最终尾行；无法安全修复时阻止追加并给出恢复指引 | 后续 append 与半行拼接；整行已持久化但去重未重建导致重试重复；误删已确认记录或中间行；把追加失败说成批次回滚或零写 |
| 发布与远程形态 | 在第七节列出的每个现有发行目标，使用匹配平台实际制品和隔离 home 加载同一 hash，记录 OS/架构、构建身份、命令、HTTP/归档、退出与重连证据；至少成功和坏 ABI/导出/缺依赖负对照。远程后台制品与 loaded hash 在浏览器断线重连后保持一致 | 每种实际入口各执行负对照且必须失败、不回退开发路径；编译 CLI 干净环境无未声明 Node/Bun/npm；远程仅后台有制品；不以 Node 门禁、假 PID、交叉编译或浏览器本地路径代替 |
| 配置保存竞态 | 在 News 配置页启动一个延迟 PUT 后编辑两个不同字段；较早请求的回显只能规范化其自身快照，不得覆盖更新的本地脏版本；两个编辑最终持久化 | 较早回显抹掉较新的编辑、重复保存循环，或服务器接受旧快照覆盖后续新值 |
| 采集切换静默 | 多来源周期采集的第一来源仍在请求中时更新/停用模块；第一请求完成或达到 deadline 后不再启动旧代次的下一来源，切换只等待活动请求与明确 stop/start 预算 | 等完整旧来源 sweep 后才开始切换；旧代次继续发起新的来源请求 |
| 迁移离线恢复 | 启动失败且 API 不可用时按 runbook 停止运行时、备份受限文件、离线处理凭据冲突并重启；I/O 故障修复后保留旧凭据并安全重试，歧义凭据经正常 UI/API 重新录入 | 把快照当成含 key 的恢复副本、手工标记迁移完成、删除路由配置或掩盖历史备份可能含明文 key |

测试 fixture 仅用于确定性输入和故障控制；加载、转换、存储与 UI 必须是真实实现。RSSHub route 验收需记录锁定版本和可运行实例，不将公共源站波动当作核心确定性测试。

## 历史记录：实施前边界建议（已由第十节决议取代）

1. **社区执行信任**：建议支持“明确批准的可信社区代码 + 独立 worker 故障隔离”。若仅支持标准 feed，则 A 足够但缩小非 RSS 目标，需明确批准；若必须安全执行未知恶意代码，则 OS 沙箱成为完整范围，当前 C 不能满足。
2. **RSSHub 服务归属**：建议首轮使用用户/运营者提供的 HTTP endpoint；Alice 注入可选通用 producer，但不托管 RSSHub。若原目标包含 Alice 无 Docker 一键管理服务，保留目标并补齐第七节全部部署义务，不自行排除。

以上为实施边界确认前的研究建议，现由第十节已确认方案取代。自动下载、市场、秘密委托、未知恶意代码沙箱及 Alice 托管 RSSHub 不在本次授权范围。

## 证据索引与研究范围

以下定位仅供本次候选提交的研究追溯，不是面向用户的永久 API 文档。

- [L1] src/main.ts:329–439；src/core/types.ts:19–23、32–70。
- [L2] src/domain/news/collector/rss.ts:67–106、136–224；src/domain/news/types.ts:23–43、79–90；新闻 store 的追加与去重段。
- [L3] services/uta/src/domain/trading/brokers/registry.ts:59–138；docs/broker-packs.md:8–115、206–255。
- [L4] src/workspaces/template-registry.ts:138–207；bootstrap-runtime.ts:12–62；services/connector/src/core/adapter.ts:72–100；docs/sticker-packs.md:14–30。
- [L5] src/domain/news/config.ts:20–73、308–327；src/webui/routes/config.ts:441–477；ui/src/pages/NewsCollectorPage.tsx:28–113。
- [L6] docs/project-structure.md:121–165；docs/news-sources.md:45–73。当前项目结构文档与已实现 hot base/config 行为不一致，实施文档收口时同步。
- [L7] docs/local-runtime.md:122–153；docs/remote-access.md:57–82、524–534；docs/managed-workspace-runtime.md:30–55。
- [R1] [RSSHub guide](https://github.com/RSSNext/rsshub-docs/blob/d63d91d35369d59ea7d591cebdb91077fb2b5b79/src/guide/index.md) 及该提交的 parameters、deploy/index。
- [R2] [应用 package.json](https://github.com/DIYgod/RSSHub/blob/0f80e1beca54d629086689c1464d830cd2b4986c/package.json)、[公开 lib/pkg.ts](https://github.com/DIYgod/RSSHub/blob/0f80e1beca54d629086689c1464d830cd2b4986c/lib/pkg.ts)。
- [R3] [官方路由贡献说明](https://github.com/RSSNext/rsshub-docs/blob/d63d91d35369d59ea7d591cebdb91077fb2b5b79/src/joinus/new-rss/submit-route.md)。
- [R4] [部署配置](https://github.com/RSSNext/rsshub-docs/blob/d63d91d35369d59ea7d591cebdb91077fb2b5b79/src/deploy/config.md)。

研究执行：三个只读证据切片分别检查仓库模块机制、新闻全链路和 RSSHub 官方契约；两位讨论者和一位接口设计者比较 resolver、producer、宿主；父会话核查关键源码和官方固定资料，并执行上述 schema/URL 探针。本文需经独立冷读核查后交审。

本轮只新增研究文档；没有实现新闻模块、部署新 RSSHub、执行社区包、证明新发布形态、修改用户草稿、提交/push 或更改两个 PR。

## 十、已授权实施与文件级工作分解

主人已确认“支持，推荐 搞定在pr 上去”：首版支持 RSSHub 服务 key，采用推荐的可信模块与本地完整制品方案，完整落实后推送现有 Draft #1767，不合并或发布。工作分支 `feat/news-source-management`，实施基线 `1f3a366882c31668127203f81b6f49693a473c68`；用户的 `PLANS.md` 和 `plans/news-management-experiment.md` 不纳入本次提交。

| 依赖/片 | 文件与职责 | 完成证据 |
|---|---|---|
| 父核心 | `src/domain/news/modules/{contract,registry,worker-entry,supervisor,windows-job,host,manager,secrets}.ts` | 未批准不执行、精确 hash、实际非 RSS worker、故障与归属树退出 |
| 父采集集成 | `collector/rss.ts`、RSS parser、store、main、news config | 同一串行协调器和 ingest；旧 RSS 去重/标签保持；代次切换及持久化失败不伪成功 |
| 父状态迁移 | 当前树已有 `src/migrations/0045_news_modules/index.ts`、显式 registry/index 与迁移 specs；核查并补齐已批准行为，不重复创建编号迁移 | 按现有迁移机制验证旧源保留、缺 ID 稳定持久一次、模块默认字段、旧 key 移出普通配置，以及部分失败后的可恢复/重试行为；已有用例不是整套验收证明 |
| 并行 UI 管理 | `NewsCollectorPage` 与 `components/news-modules` | 导入/批准/选定版本/启停/重试/卸载、订阅参数编辑和独立 key 操作真实可用 |
| 并行客户端和 demo | `ui/src/api`、demo fixtures/handlers | 同一 HTTP 契约、普通配置不带秘密；demo 不执行外部代码 |
| 并行后台接口 | `src/webui/routes/{news,config}.ts` | 配置写与 lifecycle/key 操作过核心协调器，鉴权及非回显真实验证 |
| 并行启动/打包 | module launch、CLI internal-role/Bun entry、build scripts | 源码、dist/Electron、编译 Bun 使用窄入口；每种实际产物单独验收 |
| 并行行为回归 | module host、collector、secrets、HTTP specs | 真实子进程/本地 HTTP/临时 home，完整坏批次零写入和稳定去重 |
| 父社区示例与文档 | `examples/news-modules/hacker-news.json`、news owner guide、中文 SRS/SDD/test-plan | 真实 Firebase JSON 生产者，不用 RSS 伪装模块；声明实现与未验证边界 |
| 独立验收 | 与作者不同的验收代理及父表面检查 | 端到端运行与负对照；不是只采纳 worker 自测 |

实施限额：制品 8 MiB、至多 128 文件；请求 64 KiB、响应 2 MiB、每批 256 条、stderr 64 KiB、启动 5 秒、collect 15 秒。停止沿用归属进程观测，失败阻止下一身份；Windows 使用 CREATE_SUSPENDED 分配到 kill-on-close Job Object 后才恢复，POSIX 窄监督器拥有独立进程组。这些是实现约束，仍需实际平台证据。

接口与限额以 `modules/contract.ts` 为权威。管理端点使用 `/api/news/modules`、`/api/news/rsshub-key`；选定身份与订阅仍通过 `/api/config/news` 保存。缺少新数组字段的旧整节写入必须拒绝而不是默认空数组清除状态。key 绑定规范化实例基址；只有目标 URL 与规范化配置实例同源时才允许携带 key，跨源 redirect 必须在发送 key 前拒绝。替换实例采用显式清除 → 改基址 → 重录；不用旧 key 请求新实例。更新时旧 worker 树完全退出后才 import 新代码，接受切换空窗。

验收顺序：合并本批代码 → 新闻和迁移相关行为测试 → 全工作区测试/源码与 UI 类型检查/正式 dev PR 门禁 → 实际服务端和 UI 操作 → 各发布形态实际 worker/负对照 → 独立验收 → scoped commit/push → 更新并核实 Draft PR。未执行项和失败在记录中明确保留；不把历史 55 failures 宣称为本轮既存基线。


<!-- autoplan-accepted:ceo -->
- Deliver the approved first release on `feat/news-source-management`: explicitly approved trusted code from complete local artifacts, RSSHub service-key support, complete implementation and independent acceptance, then update Draft PR #1767; do not merge or release.
- Preserve the approved contract: no unapproved code execution; exact artifact identity; supervised worker boundary; shared serialized news ingestion; legacy RSS behavior and deduplication.
- For updates: non-executing candidate checks first; stop and confirm the old process tree exits before importing candidate code; accept the cutover gap. If stopping times out, retain old desired/artifact, reject candidate, mark loaded unavailable/termination-failed, and do not claim the old worker is serving. On candidate/import/config-write failure, stop it and restore the old approved worker; show loaded unavailable until restoration is confirmed.
- Keep registry/runtime module state and secrets outside ordinary news config; preserve desired selections and subscription parameters in `/api/config/news` as defined above. Preserve existing sources and user edits; persist missing IDs once; support import, approval, version selection, enable/disable, retry, uninstall, subscription parameter editing, and separate key operations. Only send the RSSHub key to the configured normalized base origin; reject cross-origin redirects before sending it.
- Implement the documented API, UI, client, demo, startup/packaging paths, and real Firebase JSON example without executing external code in demo mode. Update the news owner guide and Chinese SRS/SDD/test plan with implemented and unverified boundaries.
- Verify migration, ingestion, secrets/key redirects, lifecycle, HTTP, missing/invalid publication times and batch failures; validation/protocol-rejected batches write nothing, while append/I/O failures may leave a truthfully reported prefix with deduplicated retry. Run full workspace/source/UI gates; exercise actual service/UI and each shipped worker runtime with negative controls; obtain independent end-to-end acceptance. Record actual evidence only.
<!-- /autoplan-accepted:ceo -->
## Review record
<!-- autoplan-accepted:ceo -->
- 已确认决策：切换更新先停止并确认旧 worker 进程树退出，再 import 候选；接受不可用空窗。迁移采用 fail-closed startup 与安全重试，不自动回滚跨文件状态。`0045_news_modules` 必须幂等，runner 仅在 `up` 成功后记录版本；失败保留快照、阻止启动并由 runbook 离线处置，禁止手工标记迁移已完成。密钥存储/config/元数据 I/O 故障须保留旧配置和可解析元数据，修复后重试；恢复测试必需。
<!-- /autoplan-accepted:ceo -->
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"aa0f6e02a0bca429593dd7c365c71b6a4b73b140465e51f88a4aaa445e7207f1","replacements":[{"oldText":"状态：研究建议，待主人确认执行边界；不是已实现的架构或已通过的模块验收。\n","newText":"状态：实施边界已由主人确认并详见第十节；本文件是实施与验收计划，不代表代码已通过验收或已发布。\n"},{"oldText":"读者：维护者、实施者和社区模块作者。读后动作：确认第十节的两项边界，按第八节分工实施，以第九节的真实端到端场景验收。文中的新接口、路径和参数均为设计建议，不是现有 API。\n","newText":"读者：维护者、实施者和社区模块作者。读后动作：按第十节已确认的边界及第八节分工实施，以第九节的真实端到端场景验收；计划不是实现、发布或 PR 已完成的证明。\n"},{"oldText":"核心提供 subscriptionId、sourceKey、该订阅参数、截止时间和取消能力。producer 返回本次采集的完整条目批次，条目包括本来源 externalId、标题、正文、可选标准链接与发布时间。内部 reader 可以直接使用 Date；跨进程协议使用带时区的 RFC3339 时间，进入核心时统一解析。\n","newText":"核心提供 subscriptionId、sourceKey、该订阅参数、截止时间和取消能力。producer 返回本次采集的完整条目批次，条目包括本来源 externalId、标题、正文、可选标准链接和必需的真实 RFC3339 发布时间；缺失发布时间不得以采集时间替代。内部 reader 可以直接使用 Date；跨进程协议使用带时区的 RFC3339 时间，进入核心时统一解析。\n"},{"oldText":"一个活动可执行模块对应一个受 Alice 管理的 worker；更新可以有一个尚未调度 collect 的暂存 worker，提交前必须结束旧代次。不是一个网站或一条 RSSHub route 一个守护进程。私有 stdio 通道只接受版本化 hello/ready、collect/result/error。\n","newText":"一个活动可执行模块对应一个受 Alice 管理的 worker。更新可先校验制品、批准身份及参数，但候选代码不得在旧 worker 退出前 import 或执行；不是一个网站或一条 RSSHub route 一个守护进程。私有 stdio 通道只接受版本化 hello/ready、collect/result/error。\n"},{"oldText":"只改 active 指针不能声称 loaded 更新成功。启用前先验证参数、制品与 ready，再切换活动快照；失败保留旧的有效配置和活动版本。持久化与运行时切换必须定义提交顺序、恢复及回滚，不能复用现有先存文件再 configure 的顺序却声称事务完成。\n","newText":"候选制品与参数的非执行校验通过后，先暂停旧调度、等待当前 collect 的剩余截止时间，再按有界进程树停止旧 worker，并确认宿主及归属进程树退出。只有旧树退出后才能 import 已批准候选并等待 ready；因此切换期间允许短暂不可用，不承诺新旧 worker 并行或 import 无副作用。ready 后原子替换磁盘配置与批准身份，再以无异步间隙的内存快照发布新代次并启动调度。\n"},{"oldText":"推荐提交顺序：在暂存代次验证批准的新制品/参数并 ready，旧代次继续服务；暂停旧调度，最多等待现有请求的剩余 collect 截止时间，再执行下面的有界进程树停止。只有观测到旧树完全退出，才原子替换磁盘配置及批准身份，然后以无异步间隙的内存快照发布新代次并启动调度。写文件失败则保留旧磁盘配置、结束暂存 worker；确认清理后重新加载旧批准版本，成功前 loaded 为空且显示恢复中/不可用，不能声称已停止的旧进程仍在服务。磁盘提交后崩溃，重启按已提交配置重新验证加载；失败显示不可用，不把上次 loaded 当成当前 loaded。配置变更在同一串行队列执行。\n","newText":"停旧前的非执行校验失败：保留旧磁盘配置、旧 worker 与 loaded 身份，拒绝更新。旧树停止超时或退出无法确认：保留旧 desired 与制品，不 import 候选、不提交新配置；停止该模块调度并拒收响应，loaded 标为不可用、状态为 termination-failed，不声称旧 worker 仍在服务。确认旧树退出后，方可按原批准身份恢复。旧树已退出后候选 import/ready 或配置写入失败：不提交新 desired；先结束候选并确认退出，再按原批准身份重新加载旧版本。恢复期间 loaded 为空、状态为 restoring/unavailable；确认旧版本重新 ready 后才恢复 loaded。候选或旧树无法确认退出/恢复失败时显示不可用并保留所有权记录，禁止再次启动同一模块。磁盘提交后崩溃，重启按已提交配置重新验证加载；失败显示不可用，不把上次 loaded 当成当前 loaded。配置变更在同一串行队列执行。\n"},{"oldText":"- #1767 保持来源管理 Draft。可复用其编辑、URL 和健康基础，不能把已有绿灯当作模块架构验收。决定先独立合入还是由模块分支承接时，以实际 diff 和 review 为准，不在研究中替维护者合并。\n","newText":"- 完成全部实现与独立验收后，将本批完整变更更新到现有 Draft PR #1767；不独立合入、不合并、不发布。已有来源管理绿灯不能当作模块架构验收。\n"},{"oldText":"| RSSHub 闭环 | 真实本地 RSSHub route 输出标准 feed，经过同一 ingest；切 base 只改变显式 route 来源 | native RSS URL 不变；停用 RSSHub 不影响 native RSS；迁移前归档同一 route 条目，迁移后重启再采集新增为 0、旧来源筛选不变 |\n","newText":"| RSSHub 闭环 | 真实本地 RSSHub route 输出标准 feed，经过同一 ingest；切 base 只改变显式 route 来源 | native RSS URL 不变；停用 RSSHub 不影响 native RSS；迁移前归档同一 route 条目，迁移后重启再采集新增为 0、旧来源筛选不变 |\n| RSSHub 服务 key | 用真实 UI/API 设置与清除 key；本地受控 RSSHub 使用正确 key 后成功采集并进入统一 ingest；迁移旧 key 后从普通配置移除；换 base 必须清除、改址、重新输入 | 缺失/错误 key 显示明确失败而非“健康但 0 条”；未授权 key 操作失败；普通 config、列表、状态、UI、health、错误和日志均不泄露 key；旧 key 不发往新 base；跨源 redirect 在发 key 前拒绝 |\n"},{"oldText":"| 协议和批次 | 日期/URL/类型/容量不合法时整批拒绝；合法空批次成功 0 | 批次前半合法后半非法不提前写入；200 HTML 不是健康 feed |\n","newText":"| 协议和批次 | 日期/URL/类型/容量不合法、缺少 publishedAt 时整批拒绝；合法空批次成功 0 | 前半合法后半非法不提前写入；缺发布时间不得以采集时间补齐；200 HTML 不是健康 feed |\n"},{"oldText":"| 更新失败 | 坏新包、未批准版本或 ready 失败保留旧有效活动状态；写配置失败时按旧版本恢复而非伪装原 worker 活着 | 只改 pointer 不能显示 loaded；旧树停止失败不提交新配置；新代次提交后崩溃显示新 desired/不可用 loaded，不冒充回滚成功 |\n","newText":"| 更新失败 | 坏新包、未批准版本或 ready 失败不提交新 desired；按明确的 stop-first 顺序恢复原批准版本，恢复完成前 loaded 为空且不可用；写配置失败也须先结束候选再恢复旧版本 | 只改 pointer 不能显示 loaded；旧树停止失败不提交新配置；候选失败不得声称旧 worker 仍在服务；新代次提交后崩溃显示新 desired/不可用 loaded，不冒充回滚成功 |\n"},{"oldText":"| 写入中断与恢复 | 人为使中途追加失败，展示真实错误和已写前缀，重试不重复 | 不宣称整批回滚或未写任何项 |\n","newText":"| 写入中断与恢复 | 全批校验/协议拒绝时零写；人为使 JSONL 中途追加失败时报告真实错误与已写前缀，重试不重复 | 不宣称追加失败整批回滚；不把已有前缀说成零写 |\n"},{"oldText":"## 十、实施前需要主人确认的两项边界\n","newText":"## 历史记录：实施前边界建议（已由第十节决议取代）\n"},{"oldText":"两项未确认前，不安装或执行社区代码，不选择 RSSHub 托管方式，也不把建议写成已批准产品要求。自动下载、市场与秘密委托没有被本轮授权。\n","newText":"以上为实施边界确认前的研究建议，现由第十节已确认方案取代。自动下载、市场、秘密委托、未知恶意代码沙箱及 Alice 托管 RSSHub 不在本次授权范围。\n"},{"oldText":"接口与限额以 `modules/contract.ts` 为权威。管理端点使用 `/api/news/modules`、`/api/news/rsshub-key`；选定身份与订阅仍通过 `/api/config/news` 保存。缺少新数组字段的旧整节写入必须拒绝而不是默认空数组清除状态。key 绑定规范化实例基址，替换实例采用显式清除 → 改基址 → 重录；不用旧 key 请求新实例。旧 worker 停止后才 import 新代码，接受切换空窗而不承诺 import 无副作用。\n","newText":"接口与限额以 `modules/contract.ts` 为权威。管理端点使用 `/api/news/modules`、`/api/news/rsshub-key`；选定身份与订阅仍通过 `/api/config/news` 保存。缺少新数组字段的旧整节写入必须拒绝而不是默认空数组清除状态。key 绑定规范化实例基址；只有目标 URL 与规范化配置实例同源时才允许携带 key，跨源 redirect 必须在发送 key 前拒绝。替换实例采用显式清除 → 改基址 → 重录；不用旧 key 请求新实例。更新时旧 worker 树完全退出后才 import 新代码，接受切换空窗。\n"}]} -->
## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope and strategy | 1 session; not separately logged | COMPLETE | Scope accepted without cuts/deferrals; native CEO score 8/10, six findings integrated. Spec loop attempt 3 scored 9/10 PASS. |
| Outside Review | Codex review attempt | Independent second opinion | 1 attempt; not separately logged | UNAVAILABLE | Command/helper setup failed; returned plan-level suggestions but did not inspect source. Not counted as completed external review. |
| Eng Review | Engineering review (native agent) | Architecture and tests | 1 native session (this review) | ISSUES OPEN | Six engineering findings integrated as implementation and acceptance requirements; actual runtime/artifact evidence remains pending. |
| Design Review | `DesignReview` | UI/UX gaps | 1 session; not separately logged | COMPLETE | Two findings integrated: repeat trust warning for each hash and safe recovery after unconfirmed termination. |
| DX Review | `DXReview` | Developer experience gaps | 1 session; not separately logged | COMPLETE | Four findings integrated: authoritative ABI, offline migration recovery, actionable sanitized diagnostics, exact release-target proof. |

**OUTSIDE COVERAGE:** Codex, plan review, unavailable after one tool attempt; it did not inspect source. Native CEO, design, DX, and engineering reviews completed; their findings are represented above. No completed external reviewer is available for cross-model comparison.

**VERDICT:** The scope and implementation decisions are settled; the plan is ready for implementation subject to its listed migration, lifecycle, UI, and per-target runtime acceptance gates. This review does not claim feature implementation, release readiness, or external source-review coverage.

NO UNRESOLVED DECISIONS
