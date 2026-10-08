# 可选新闻模块测试计划（Test Plan）

> 依据：[软件需求规格说明](srs.md)；[软件设计说明](sdd.md)。状态：已授权执行，实现与验收进行中；以下矩阵是完成合同，不是通过声明。

## 范围

覆盖 SRS 的 D1–D13、已批准窄 ABI 和资源上限。复用[研究中的验收矩阵](../../plans/news-module-injection-research.md#九真实端到端验收合同)，不以研究复核代替运行证明。

| 范围与依据 | 层次和真实输入 | 正向与失败边界 |
|---|---|---|
| 标准 RSS、可选 RSSHub：D1、D2 | 实际 HTTP reader；受控标准 feed 和锁定版本的可运行本地 RSSHub 实例 | 无模块时标准来源可用；显式 route 随实例切换而普通绝对 URL 不变；200 HTML 不当 feed 成功；响应体按实收字节限流，8 MiB 边界可读，超限流取消且不重试 |
| 仓库外非 RSS：D3、D4 | 固定核心构建、仓库外真实 ESM 制品、本地 JSON 新闻输入、真实 JSONL/界面 | 模块实际转换与归档；把入口改为抛错/错 ABI/不同正文，失败或结果必须相应改变；不能用 manifest 回显证明注入 |
| 批准与离线发现：D5、D7 | 实际制品管理、后台访问控制和入口副作用标记 | 列表/导入未批准包不执行入口；精确身份一致才加载；改版本或内容不继承批准；管理操作沿用后台访问控制；模块导入在 JSON 解析前限制真实请求字节数（Content-Length 缺失/低报也拒绝）；受控 key 验证列表、状态、错误、普通配置及 worker 环境均无明文 |
| 统一管线：D4 | 领域逻辑与真实存储；标准 RSS、RSSHub、非 RSS 三类实际输入 | 完整非法批次不提前写入；合法空批次成功 0；新非 RSS 两模块同 ID 均归档、同模块重复/升级不重复；三类来源均使用核心订阅标签，模块不能伪造核心标签；按同一保留策略检查保留期内与到期清理后的可读性；新归档产生核心事件，去重重复项/拒绝批次不产生虚假新增事件；合法空批次健康成功、非法/上游失败健康报错；写入中断留下实际前缀并重试去重 |
| 条目格式：D4、待审设计的条目契约 | 真实社区批次校验与最终正文展示；以设计条目获准为前提 | 带时区 RFC3339 与缺时区/非法日期两侧；HTTP(S) 链接与 file 等非 HTTP(S) 协议两侧；普通正文和含 `<script>` 字样的正文都只按纯文本显示、不执行，额外 HTML 执行字段因未知字段拒绝；标准 reader 的旧日期/正文规则独立保留，不要求往返 JSON |
| 故障隔离：D6 | 实际工作进程与其他 RSS/聊天路径 | 无限循环、异常退出、截断 JSON、stderr 洪泛、普通与 POSIX detached 子进程；观测失败隔离、停止能确认的后代和其他路径可用，不声称 OS 沙箱或内存隔离 |
| 生命周期与真实状态：D8、D11 | 实际后台操作、进程所有权、配置和活动快照 | 启用/更新/停用/撤销/卸载；旧树停止失败不提交候选且明确报错；候选清理失败阻止重复启动；仅改 pointer 不能显示 loaded |
| 在途与提交恢复：D8、D11 | 实际请求、受控晚响应和受控磁盘失败 | 错 requestId、旧 activationId、重复/主动响应不写当前状态；写配置失败恢复旧批准版本，恢复前显示不可用；新代次提交后崩溃不伪装回滚成功 |
| 历史与迁移：D9、D10 | 迁移前归档、旧格式配置和重启后的实际采集 | 显式 RSSHub route 原去重键/source 保留，迁移后相同条目新增 0；普通 URL 不猜归属；缺 ID 一次持久化；缺包保留历史、不回退旧 URL；迁移快照移除旧显式 route 与 companion URL 的 key/code，但保留普通 direct URL 查询；升级前已生成的备份不被改写 |
| 编辑兼容：D12 | 实际订阅配置及预设更新 | 用户改名/停用不被预设覆盖；展示/标签/间隔变更不误清健康，实际来源/加载身份变更重置相应健康 |
| 发布形态：D13 | 实际源码入口、桌面包、编译命令行产物 | 各自加载同一制品、归档与退出；每种实际入口都执行缺导出/错 ABI/缺依赖负对照，不退回开发路径，不以 Node 测试替代编译运行 |
| 远程后台：D13 | 制品只在后台，浏览器断开重连 | 后台采集持续；重连读取真正 loaded 身份和失败/恢复；另一后台只有配置时显示缺包，浏览器本地文件不是安装证明 |

领域层沿用仓内 Vitest 与现有新闻配置、collector、store 及页面测试先例。真实 HTTP 输入可以控制内容与故障，模块执行、解析转换、归档和生命周期不替换成空壳模拟。模块上传超限必须以真实流验证，不能只测 schema。部分发布负对照可以使用确定性坏制品，不能模拟一个不存在的进程完成退出。

不测与限制：

- 不测试 Alice 托管/一键部署 RSSHub：本次明确采用外部运营实例；但实际 RSSHub HTTP 接入仍须验收。
- 不把公共源站稳定性、RSSHub 全部社区 route 覆盖或第三方 SLA 作为核心确定性测试；记录所用实例、版本和 route 的采样范围。
- 不测试未知恶意代码的 OS 级沙箱或内存硬配额：不在批准的安全承诺中；获准模块具有相同 OS 用户的文件、网络、子进程访问能力，可能耗尽后台内存。
- 不执行真实交易、使用私有用户凭据或访问生产归档；测试用受控输入与隔离数据。
- key 支持与限额已确定：服务凭据绑定完整实例基址，clear → 修改基址 → set；8 MiB 制品、128 文件、导入请求不超过 6 × 制品上限 + 1 MiB、RSS 响应 8 MiB、ready 5 秒、collect 15 秒、worker 请求 64 KiB、响应 2 MiB、stderr 64 KiB、批次 256 条，两侧都必须验证。导入总磁盘无累计配额。

## 完成判据

1. SRS/SDD 的必要接口、失败规则和量化边界获得覆盖本次版本的批准；执行 issue、工作副本和实施计划在对应阶段明确。未批准项不能靠测试默认值消失。
2. 上表每条消费者可见行为和失败边界都有实际证据；无模块、真实外部模块、RSSHub 和非 RSS 均进入同一核心管线。
3. 模块入口变化负对照能使实际执行失败或实际归档内容变化；列表侧副作用负对照不触发，证明发现不是执行。
4. 停止成功观测到归属进程树退出；停止失败、恢复失败和残留重启场景明确失败且无候选激活/重复 worker，不用不存在的 PID 证明清理。Alice 主程序退出单独验收：正常退出树已结束；注入清理失败时留下真实错误/退出结果与持久所有权，下次启动先处理自有残留而非重复启动。
5. native RSS 与显式 RSSHub route 迁移后的相同条目无重复导入、旧来源读取不变，停用和卸载后历史仍可访问。
6. 源码、桌面包、编译命令行和远程后台分别通过正向及负向实际运行；每项记录真实制品 hash、加载身份、请求、存储/界面证据及退出结果。未运行的形态标未验证，不能写通过。
7. 实施计划约定的单项、全套与必要类型/构建检查均记录实际命令、退出码与失败；旧测试失败单独列出，不能未经比较称为既有基线，也不能静默缩窄检查。
8. 实现者自测之后，由未参与实现的验证者执行跨切片验收；父会话核查证据后仍需把实现结果交主人审阅。测试通过不代替主人认可。

## 运行记录

2026-10-05 独立验证者在 Windows Node 源码入口完成离线跨切片验收：真实外部 `.mjs` 读取临时本地 JSON；隔离 home 与制品目录；未批准及内容变更后的 hash 均不执行且不写归档；精确 hash 获批后配置、启动真实 worker，经核心 collector 写入 JSONL，重复采集去重；关闭 collector 后 owner receipt 清零，重开 store 仍读到原记录。其 `pnpm exec vitest run src/domain/news/collector/rss-modules.spec.ts --maxWorkers=1` 为 10/10 通过；另行实际 probe 退出码 0。临时数据已清理。

本地安全回归 `pnpm exec vitest run src/migrations/0045_news_modules.spec.ts src/migrations/runner.spec.ts src/domain/news/config.spec.ts src/domain/news/collector/rss-parser.spec.ts src/webui/routes/news-modules.spec.ts ui/src/pages/NewsCollectorPage.spec.tsx src/domain/news/modules/host.spec.ts --maxWorkers=1`：7 文件、65 通过、1 跳过；POSIX-only detached 子进程场景在 Windows 跳过。`src/webui/routes/config-news-modules.spec.ts` 定向运行 6/6 通过。该证据不覆盖 Electron 包、编译 CLI、远程后台、活体 RSSHub 或 POSIX detached 子进程；此文档不把源码验收等同于所有发布形态通过。

### 独立接管验收账（2026-10-05）

接管候选：`185053ea67cad0c0f4b1ebda80acf1251850c1ba`。本轮从未完成状态开始；上面的旧记录只证明所列 Windows Node 场景，不继承旧会话的全部完成声明。父工作区及用户计划文件不属于本轮写入范围。

| 未完成项 | 本轮所需证据 | 当前状态 |
|---|---|---|
| 源码/UI 跨链 | 实际界面导入、hash 审阅、批准、配置、worker、核心归档、界面读取、重启、停用卸载及负向操作 | 父会话实际 UI 全链、重启、停用卸载；独立 Node/Hono/worker 的错误审批/未批准/改 hash、崩溃、15s 超时、非法整批拒绝、retry；修复后未参与实现者真实 built-source Guardian/HTTP/worker/archive、hash 升级重批、重启及浏览器新闻检索通过，两次普通 down worker 与收据为 0 |
| RSSHub 服务密钥 | 锁定版本的真实服务、临时自有 key 正误、清除替换、实例绑定、HTTPS 与响应/备份脱敏 | 真实锁定 RSSHub /hackernews 正误/清除/替换、实例绑定、重启去重、响应/归档/备份脱敏实测；另以自有非 loopback IP 和进程级临时 CA 完成真正 HTTPS→RSSHub→两条归档，未受信证书被拒绝，明文 HTTP key 被拒绝。两项策略拒绝通用 500 的诊断限制保留 |
| Hacker News 示例 | 公网 JSON 请求、真实模块转换、核心归档与停止 | Windows Node 源码有界运行通过；真实 topstories/item 请求、5 条归档、重复新增 0、重开 archive read 与停止；日志 `pi-unified-exec-6-123cb578.log` |
| Electron 包 | 本候选实际 unsigned 包正向、缺导出/错 ABI/缺依赖负对照、归档与退出 | 标准 native builder 缺 Spectre 库 MSB8040，未通过；npmRebuild=false 真正 unsigned 包的最终 main/worker/UI 指纹由保留命令输出与独立收据审计确认；app:// IPC→批准 worker→一条真实归档、重复/重启新增 0、三坏模块拒绝、原生托盘 Quit 后进程/收据为 0。首个手动 collect 的响应未保留，不宣称其 new=1；原代理收据错误字段已拒绝，以 audited JSON 和原始命令日志为准 |
| 编译 CLI | 本候选编译产物同样的正负运行，不回退源码 worker | 核心修复后独立重建 Windows x64 包：真实同 EXE Guardian/Alice/news-worker，正向、重启去重、三项坏模块拒绝、模块仍启用时普通 down 和 8.5s 正在采集中 down；两次独立核对进程/worker/lock 收据均为 0。真实超时强制后备未诱发，不能称该分支已验证 |
| 远程后台 | 测试拥有的远程入口，后台制品、断开后持续采集、重连状态/历史、另一后台缺包 | 阻塞：现有 Orca/SSH 元数据未标示获授权的测试后台；历史 OpenAlice 远端路径属于生产，未连接；需要独立测试 Machine、隔离 home 与执行授权 |
| POSIX 树退出 | 真实 POSIX Node worker、普通及 detached 后代停止、主程序退出及失败残留 | Arch Linux Node 26.8.2/nobody 真正运行：显式 stop、协议故障、15s 超时清理可见后代；突然 crash 或父 SIGKILL 时 detached 后代重挂父后仍存活，属于已声明的非 OS containment 边界，不称任意后代保证清理 |
| 旧配置与热切换 | 实际迁移、重复为零、历史 source 不变、凭据快照脱敏、切换/恢复失败不误报激活 | 三迁移场景各 24 项、drain/发布、正常回滚、全局启停实测；次级恢复失败误报 disabled 修复后真实 HTTP 8 项回归通过，独立完整 Guardian 后台再次观察旧配置留存、旧 desired:true/failed/unloaded、坏候选不写入/不归档；全局 off 则 selected desired:true/disabled/unloaded，on 恢复 |
| 既有全仓失败 | 调查原日志 55 个失败的关系；本范围修复；不可未经比较称为既有基线 | 已逐项定位：48 Git 安装前置、2 Win32 路径断言、1 Anthropic 双认证头、1 Windows update 夹具、2 broker fixture bad-port、1 watchdog 超时；另有 Electron 装载失败。无干净 dev 对照，不称全为基线或全为候选回归 |
| 最终门禁 | 定向/类型/构建、完整 pnpm test、cargo test --workspace --no-fail-fast 的实际结果 | 本地 Electron 修复后的完整 pnpm test exit 1：914 文件中 5 失败、900 通过、9 跳过；7844 测试中 5 失败、7687 通过、152 跳过，日志 pi-unified-exec-38-385d57f0.log。新闻配置 8 项、HTTP 8 项、真实 IPC 2 项通过；root/tests/UI/desktop/guardian 类型及最终 pnpm build exit 0。Cargo 命令 exit 1，根无 Cargo.toml，不记通过 |
| 独立验收与原 PR | 未参与实现者实际跨链复验；原 #1767 保持 Draft，非 force 更新原 head，不合并发布 | 源码、真编译 CLI、另类 Electron、HTTPS RSSHub、迁移/切换/POSIX 已由独立执行者实际验证所列边界；桌面收据另由未参与运行者对原始执行记录逐项复核。完整合同仍未满足远程/标准 builder 与全仓门禁，不宣称全部完成；原 Draft 的交付说明必须保留这些限制 |

没有运行证据的形态保持未验证；缺真实前置条件的项记录阻塞，不删除合同或改写为通过。

#### 本轮运行证据索引

- UI 正向使用隔离 home `D:/temp/openalice-news-acceptance-20261005`，真实浏览器 `http://127.0.0.1:47932`；导入不执行、错误完整 hash 拒绝、精确批准后新版本 loadedHash 为 `f3a7b893362ee71716a0a61813d364daf6d35aca47f1e90a932ca0b1e69a69d1`。核心归档一条，重复新增零；新闻页把 `<script>` 作为文本，注入标志 false。强制退出整个测试启动树后，用同一 home 重新启动，恢复一条去重记录与相同 loadedHash；停用并更换输入后无新文章，取消版本选择并卸载后历史仍可读。初轮 UI 证据与后续修复后的独立源码复验分别记录，不混称同一次运行。
- UI 浏览器截图：`omp-sshots-159a48247fc63444.webp`（首次新闻读取），`omp-sshots-159a4878c8c63445.webp`（重启后读取）；结构化观察 `D:/temp/openalice-news-ui-evidence.json`。截图及命令日志均在本机 Temp；不上传含临时启动凭据的完整日志。
- 真实 Hacker News 探针：`pi-unified-exec-6-123cb578.log`，exit 0；制品 canonical hash `60fd8f6faab19035dc422659c99cc2474c93fb16216d428637c34cac32c26e69`；5 个独立 module 去重键及来源元数据、关闭后 owner/PID 消失。仅 Windows Node/public sample，不外推其他发布形态。
- 迁移日志：`pi-unified-exec-4-16746928.log`（单一可恢复 key）、`pi-unified-exec-5-9f4ef2ea.log`（不可恢复 code）、`pi-unified-exec-6-a9a0f41b.log`（歧义 key）；均 exit 0。真实 runner 与 Hono 路由，旧 JSONL/历史备份字节不变、新快照脱敏、二次运行无写入；不是 RSSHub 网络请求验收。
- 热切换日志：`pi-unified-exec-3-fca73ffb.log`，exit 0；真实 localhost HTTP/worker，旧 collect 等待时 PUT 保持 pending/磁盘旧版本，释放后旧文章先归档、新 hash 激活；故障版本启动失败 PUT 400，旧运行态与配置恢复，后续采集成功。
- 原全仓分诊来源：`C:/Users/ADMINI~1/AppData/Local/Temp/pi-unified-exec-51-b4a27f69.log`；旧测试开始早于候选提交，日志不能证明当时完整工作树等于最终提交。该日志含 credential-shaped 值，只引用脱敏诊断，不上传原文；Anthropic 双认证头为非新闻安全/正确性缺陷，未获扩大修复授权。
- UI 发现并修正文案错误：已有 installed 制品但未选择版本时，旧文案称“模块未安装”。四语言改为“未选择已安装版本”，未改变审批/启用/归档策略；实际 Vite 页面复验 installed=true、selection=[]，文案正确，截图 `omp-sshots-159a49697e463447.webp`。不用永续源码/措辞断言替代真实状态验收。
- 本轮本地依赖前置 `pnpm rebuild dugite` exit 0（`pi-unified-exec-11-ef7057da.log`）；仅准备当前 checkout 的缺失测试 Git runtime，不修改产品代码或宣称原 48 项失败已通过。
- 真编译包由 Windows preview builder 构造，元数据 contentIdentity `ca76c1163afdfad3`、sourceCommit 对应候选、sourceDirty=true；Guardian/Alice/news-worker 的实际 executable 均为解压 ZIP 的 `bin/openalice.exe`，worker 参数为 `--internal-role news-worker`。正向精确 hash `293bfb59b86cd2af131aaf41c81fd82eac19f673a1279b9eeeb7f755daabd959`、restart 历史与 new=0、三项坏模块 PUT 400/loaded=false/no新增异常归档。普通 down exit 0 但收据 1、存活包进程 0；明确禁用模块后再 down，收据和包进程均 0。本轮不能把该恢复步骤当成普通关闭通过。证据目录 `C:/Users/ADMINI~1/AppData/Local/Temp/oa-compiled-news-evidence-185053ea-20261005`；验收包与隔离 home 已清理，核心修复后须重新构建并复验普通 down。
- POSIX 原始日志 `pi-unified-exec-9-227fdc67.log`（exit 0）记录真实 /proc PID/启动 ticks/进程组与 owner 身份；stop-ordinary、stop-detached、failure-detached、timeout-detached、crash-ordinary 均确认后代不再运行且收据消失。crash-detached 的重挂父子进程仍活且收据消失，父 SIGKILL 的 detached 后代仍活且收据保留；未保证扫描前已脱离的后代。验收最后只按已记录身份清理 23 个自有 PID，survivors=[]。不为扩大 containment 宣称引入 OS 沙箱或宿主级清理能力。
- 源码负向原始日志 `D:/temp/oa-news-negative-accept-20261005/runtime-replay.log`：真正 createNewsWorkerLaunch 的 Windows Node worker，超时 16049ms 后隔离、崩溃后显式 retry、非法批次零追加、改 hash 无审批继承；结束时两个记录后代均停止、owner 0、端口 0。
- 全局启用原始日志 `pi-unified-exec-1-67375080.log`：关闭前 PID 71740，关闭后 worker/owner 消失且输入 B 未导入，重新启用 PID 52876、同 hash，B 归档且重复新增 0；两 PID 最终退出。
- 双故障恢复原始日志 `pi-unified-exec-1-9c855016.log`：旧 worker 正向一条后，仅删除自有临时旧入口，再令获批准候选真实 import 抛错；PUT 500，磁盘/context 仍旧、archive 一条，但旧 desiredEnabled=true/loaded=false 被误报 disabled，不能据此宣称恢复状态通过。
- Electron 证据 `oa-news-electron-evidence-icOEq3/receipt.json` 记录标准 builder 失败及跳过原生重建替代包的身份/实际运行；替代包 app.asar SHA256 `e8cbd2f103393fc3fe71c933487539450403d3f8c3510bb53ea07f705bf75d32`。包和 home 已回收，证据保留本机 Temp，未发布。
- 非 loopback HTTPS 证据 `pi-unified-exec-12-06984dbd.log` 及 `oa-rsshub-https-c98c03eaad/acceptance-result.jsonl`：自有 172.27.208.1:1491 TLS forwarder 转发真正锁定 RSSHub，临时 CA 仅 NODE_EXTRA_CA_CERTS；200 XML 两条，实际 Hono/collector/secret/archive 两条，错 key 403 无新增，11 响应/28 home 文件/7 快照无 key。未受信请求证书错误，明文 HTTP key 未配置。不是远程后台证明；收据 `pi-unified-exec-15-5a803477.log` 确认容器及四 PID 停止、私钥/home 删除，仅脱敏证据保留。
- 修复后 `pnpm exec vitest run src/webui/routes/config-news-modules.spec.ts --maxWorkers=1` exit 0、8 项；`pnpm exec vitest run tests/integration/guardian-process-control/alice-shutdown.spec.ts --maxWorkers=1` exit 0、真实 IPC 清理/断连后备 2 项；日志分别 `pi-unified-exec-13-21d686de.log`、`pi-unified-exec-16-950f9df5.log`。第一次把 hermetic guardian spec 交给 integration-only config 没选中测试（exit 1），已按现有 suites.json 注册 hermetic lane 并正确执行，不把未选中当通过。
- 集成 `pnpm build` exit 0，日志 `pi-unified-exec-15-311177ae.log`；root/UI/desktop/guardian 类型检查 exit 0，日志 `pi-unified-exec-18-c79d7c39.log`。最后把 IPC 停机请求捕获提前至 startup 后，root tsc 再次 exit 0；误调用不存在的 pnpm bundle exit 1，随后按实际 build 脚本执行 `pnpm exec tsup src/main.ts --format esm --dts` exit 0，日志 `pi-unified-exec-22-6b58fa6e.log`。独立制品验收须核对是否包含最后该源码与输出，不用较早包身份替代。
- 较早完整测试 `pi-unified-exec-17-3256b00f.log` exit 1、914 文件/7841 测试，6 测试失败；它开始于最后启动 IPC 捕获修改之前，不作为最终稳定快照证明。随后新闻重试预算修复、本地 Electron 安装修复及完整门禁的实际结果见下文和表格，不以定向绿色抵消全仓红色。
- 编译修复后独立证据 `oa-compiled-evidence-829316c1/acceptance.json`：ZIP sha256 `ffcb96dfa586e034b09acb5c8fa007a87c908e0cd9345117f2cf8b6c521f3a4c`、contentIdentity `a549482db7e5974a`、sourceDirty true；267 个包文件字节/hash 核验，真实同 EXE worker。普通 down 后五个预记录 PID 消失、进程 0、worker/lock 收据 0；重启保留 221 历史条目（220 是启动时公开 feed）和模块去重。8.5s 挂起 collect 期间普通 down 耗时 8106ms，collect 完成，进程与收据仍均为 0；未证明制品强制超时分支或单条 IPC 收到事件。包/home/临时脚本清理，仅脱敏证据保留。
- 新闻配置超时根因证据：两串行失败来源各保留真实 2s retry；仅该行为用例预算由默认 5s 改为 10s，不改产品策略。`pi-unified-exec-23-b71c0e35.log` 定向 exit 0、8 项，该用例实际 5970ms；`pi-unified-exec-24-b23f7078.log` 稳定源码全仓 exit 1、5 失败/7684 通过/152 跳过，不声称所有失败是基线。最终 `pnpm build` exit 0，日志 `pi-unified-exec-25-fad78494.log`。
- 最终源码独立证据 `oa-final-source-MzgVxs/acceptance.json` 与 `news-after-restart-filtered.png`：真实 Guardian/Alice/HTTP/worker，未批准拒绝且无副作用、字节升级精确重批、非法后项整批零归档、恢复失败旧配置不被坏候选覆盖/状态 failed 而不是 disabled；全局 off/on 另行正确。重启后真实 Chromium 新闻页筛选只见一条测试标题，截图 hash `d745a5c55f875b3f664da8ed49a76b71c68dadb66b0485bf2693609b992d3a8f`。两次普通 down exit 0、预记录 worker 死亡、owner 收据为 0。一个临时负向脚本预期 400 而实际次级恢复失败 500，脚本 exit 1；后续独立状态/磁盘检查 exit 0，不把前者称通过。测试 home 含自有 sealing/auth，禁止整体上传，只引用报告/截图。
- 最终 root/UI/desktop/guardian TypeScript exit 0，日志 `pi-unified-exec-28-650b4344.log`；tests/tsconfig.json exit 0，日志 `pi-unified-exec-29-51628d9a.log`。本地 Electron 39.8.10 在 Node 26.7.0/26.3.1 的原厂 installer exit 0 但缺 binary/path.txt：独立诊断 checksum 正确 ZIP 的首成员流停在 674060/679479 字节；已安装 Node 24.21.0 与 .NET 对照读满。只用现有 Node 24 执行同一原厂 install.js 恢复 ignored 本地 binary，无全局 Node/版本/锁文件/工具链变更。父会话独立消费者验收 `pi-unified-exec-35-7fd0752a.log` exit 0、3 项；不把 installer exit 0 当证据，也不把这项本地修复等同 Spectre 标准 builder 通过。
- Electron 另类实包较早证据 `oa-desktop-accept-evidence-3fb49fc9463e4a4fa317b86d0cd5cccb/{report,tray-report}.json`：app:// IPC、批准 worker、归档/重复/重启与三项坏模块拒绝；真实托盘菜单 Quit 后原生 PID/worker PID/归属收据消失，不用 CDP close 替代。首包 backend 指纹 4a73... 早于最终 acdb...，因此后续对最终包逐文件补验，不能用首包推断相同制品。临时 home/包/原始日志与整屏截图已清理，仅脱敏报告及托盘裁剪保留。
- 最终桌面以 `oa-exact-bundle-evidence-7bcdef1907cb4c8db48c8500a1a991f7/acceptance-audited.json` 为可引用记录：独立审计发现原 acceptance.json 错写 EXE/asar、三项坏制品 hash 与 dedupKey，拒绝其整体 PASS。实际命令 `pi-unified-exec-6-cadd6dbe.log` 确认 packaged main 为 acdb3413...、worker/UI 与最终输出逐字节一致，EXE D1CA58A7...、asar 069084F4...；真实 archive key 为 module:["accept.exact","owned-package-20261005"]，重复及重启后响应为 {total:1,new:0}。首个手动 collect 输出未留存，一条归档可能来自启用后的自动采集，不捏造响应或归因。三坏模块实际批准后 enable HTTP 400、不入配置/不新增归档。
- 最终原生托盘 Quit 证据 `pi-unified-exec-14-7786f135.log` 与 `pi-unified-exec-16-b8dfe051.log`：EXE 76564/Alice 81500 消失、package 进程 0、worker 0（排除检查器自身）、guardian/runtime/module 收据消失、archive 仍一条。菜单裁剪保留，不上传整屏。制品/测试 home/原始日志清理；仅脱敏 JSON、菜单裁剪和命令证据保留。
- Electron 恢复后的完整门禁 `pi-unified-exec-38-385d57f0.log` exit 1、5 失败/7687 通过/152 跳过；五失败为 CLI project-control Windows 路径、Anthropic bearer 双认证头、client-update discovery null、headless watchdog 5s 超时、Workspace discoverModels Windows 路径。均已有原日志证据，但无干净 dev 对照，不称既有基线，不扩大到新闻范围外修复。`pi-unified-exec-39-44fd5a6e.log` 记录要求的 Cargo 命令 exit 1/no Cargo.toml。
- 不可变提交 `975538b9b936a1d0bec5d0261c0f2826c0b7d467` 独立全仓门禁：914 文件（6 失败/899 通过/9 跳过）、7844 测试（6 失败/7686 通过/152 跳过），`pnpm test` exit 1。比此前五项新增 desktop port-probe “no free port in range 55375..55378”（63ms，非超时）；原门禁代理误把相邻 headless 5s 超时归到它，已由独立原日志分诊纠正。该用例直接导入未改动的 probe，未运行 Alice/桌面关闭；无直接耦合路径证据，但不能排除并发端口争用，没有干净 dev 对照，不称基线或环境偶发。root/tests/UI/desktop/guardian 五项 TypeScript 与工作区/提交 diff-check exit 0；Cargo 实际 exit 101、无 Cargo.toml。原始门禁日志可能含自有认证数据，只留本地，不整体上传。
- 同提交独立静态审查拒绝关闭逻辑通过：发现 startup/restart 在 await 后可能晚生成未被 shutdown 快照覆盖的子进程、collector.close 失败仍释放 Alice runtime lock、桌面 IPC 回调错误立即 SIGKILL 跳过宽限。这些是具体代码路径推导，尚不是实测复现；旧普通关闭证据不能证明这些异常时序。保持 Draft，先在本范围修复并做独立运行验收。
- 关闭修复回归：真实 Alice 故障注入先红（`pi-unified-exec-42-a118817e.log`，关闭失败退出 1 却删除 runtime lock），修复后正常/失败两项绿（`pi-unified-exec-43-36f51671.log`）。桌面真实 main 的受控边界时序先红：startup/reconcile/return-integrated 四项发生晚 spawn（`pi-unified-exec-44-0282164e.log`）；IPC 断连/回调错误两项提前 force（`pi-unified-exec-6-7d4db145.log`）。修复后五文件 20 项通过（`pi-unified-exec-47-e987e798.log`），含真实 Guardian 子进程/私有配置读取挂起两项、Alice 两项、桌面六项、新闻 HTTP 八项。桌面测试使用受控 Electron/OS 边界，不替代打包原生退出；Guardian fixture 为观察延迟 continuation 暂缓 process.exit，不证明所有 OS 强杀分支。最后 Guardian 的 Windows IPC 错误后备也保留宽限，须由之后完整门禁/运行验收覆盖最终源码。
- 第二轮只读审查未发现所列生产路径的反例，但拒绝 Windows Desktop IPC 测试作为独立行为门禁：当前两项只观察 20ms 无 force 后由测试主动退出 child，移除 Desktop IPC 请求仍可能通过，不能据此证明请求或 10s 后备。正在补齐行为反例检测；不把 20 项绿色全部视为关闭路径证据。Alice 故障注入只覆盖真实进程/root lock（news 禁用、无实际模块 worker），不能证明 worker 收据恢复；启动异常 catch 的 close 顺序仅静态检查，尚未注入 collector 建立后的 startup 故障。
- 第二轮冻结源码/测试全仓门禁实际 `pnpm test` exit 1：917 文件 9 失败/899 通过/9 跳过，7854 测试 20 失败/7682 通过/152 跳过（私有日志 `oa-final-gates-pnpm-1d568fa852b4423c8a0d879bd5d2cca8.log`）。其中 14 项 test-selection 失败由本轮新增 suite ID 与目录不一致引入，不能归为基线；将 ID 从 news-modules-shutdown 修为 news-modules，保持文件原路径，四个 test-selection 文件 34 项实际通过（`pi-unified-exec-51-71f38365.log`）。另六失败分别为 CLI 路径、Anthropic header、client-update、headless watchdog、installer PowerShell manifest/exact-version 5s 超时、Workspace 路径；本轮无旧 port-probe 的 no-free-port 报错，不混用历史分类。五项 tsc 与两项 diff check exit 0；Cargo exit 101、未启动 Rust 测试。修改后的最终全仓门禁仍待执行。
- 第二轮真正编译的 Windows x64 CLI：ZIP SHA-256 `e0b0195ca09528f8ad54c26c32ffda181a9fa94bda9999bc9867043cf7d57f27`，EXE `34d120a7971105cd7ecef6fbb4eb77100391063a07fedd2da53ffe778bda3b7f`，内容身份 `d0e383909925461c`；267/267 manifest 文件 hash/长度相符、无额外文件。匹配上述冻结源码与 main 77e307... 的 dirty preview。正向持久归档 1、重复/重启 `{total:1,new:0}`；首个手动请求同为 new=0（自动采集已归档）。三项精确批准坏制品激活 400、failed/unloaded、旧配置字节不变。第一条综合脚本因读取错误 status JSON 层级 exit 1，不能称整脚本通过；随后纠正脚本实际 exit 0，在 checking=true/HTTP pending 的 8.5s 采集中 down：9844ms、exit 0、状态 absent、所有记录 PID 与同 EXE 进程和 worker/root lock 收据为 0、归档仍 1。原日志 `pi-unified-exec-7-5c4fa515.log`/`pi-unified-exec-14-392cdf36.log`，脱敏收据 `oa-compiled-current-evidence-3d556653072a45178f82b65763ef1985.json`；自有包/home/scripts 清理。不推断直接 IPC acknowledgement 或编译包关闭失败故障分支。
- 第二轮 built Node 源码：`oa-source-final-AYPCNA/receipt.json` 记录精确批准真实 worker/HTTP/核心归档 1、重复 new=0、批准错 ABI 激活 400 且配置/历史不变，普通 stop 两次 exit 0（1497/1452ms）、worker/PID/收据/root lock 为 0，重启 loaded hash/历史不变；实际输出 main 77e307.../worker 3d4fef... 与冻结字节相符（`pi-unified-exec-13-b18eda38.log`）。另真实 Guardian restart race 不暂缓 process.exit：停止时配置 await 恢复仍无新角色/PID、exit 0（`oa-guardian-real-race-GDsbLk/race-receipt.json`）。
- 长挂起关闭探针保持原失败事实：60s module collect 下 Guardian 在 10074ms 退出 1，保留 Alice 两锁与 worker receipt（`oa-source-final-pMTwYV/receipt.json`）。`≤10s 且 exit 0` 是主协调者加到切片的额外断言，不是原 handoff/SRS 的要求；不能据此擅自把排空语义改成取消。原始 stop 后、恢复前快照实际记录旧 Guardian/Alice/worker PID 均不活、Guardian lock 无、两 root lock 与模块收据仍在（`pi-unified-exec-12-e6cdfe80.log`）；不外推为全部未知后代检查。相同 home 随后通过既有恢复重新加载原 hash，历史 1/hash 不变，正常 stop 1584ms/exit 0、worker/两锁/收据为 0（`recovery-receipt.json`/`pi-unified-exec-14-fbe4d850.log`），最终自有 PID 均不活。此为强制退出/恢复边界记录，不记作优雅关闭或整条失败探针通过；尚无证据要求新的 shutdown 取消协议。
- Desktop IPC 行为门禁已替换，未参与实现者在隔离树独立证伪：正常三项通过；临时移除实际 Desktop main 的 IPC 请求后，真实合作子进程在 3s 等待退出时失败（1 failed/2 skipped，`pi-unified-exec-9-75621af8.log`）；临时把 10s grace 改为 0，两项在 0ms 存活断言收到 SIGKILL 而失败（2 failed/1 skipped，`pi-unified-exec-11-e8506dc6.log`）。恢复原字节后三项实际通过（`pi-unified-exec-12-193821f7.log`），main 前后 SHA-256 `85ec82baf2840afe40a8b63f97a553045df4912e7c202a0c73f8e9eed5b5fc52`，spec `a2e958827ba21eeeb686030a1cefc11f7ff8cfff81685b32b1cdeded5d87bbcc`，无代理 delta 落回。正向使用真实 Node IPC child/异步清理/自然退出；Electron 启动与树终止、故障时钟仍受控，不替代原生包装。
- 注册修正与新行为测试后的最终独立全仓 gate：`pnpm test` 实际 exit 1，917 文件 5 失败/903 通过/9 跳过，7855 测试 5 失败/7698 通过/152 跳过，533.96s（私有 `openalice-acceptance-3735e01a312f481f942f98d75edcf3cc/pnpm-test.log`）。新增 Alice/Guardian/Desktop IPC/Desktop race 的 2/4/3/4 项均未列失败，注册 14 项失败不再出现；不把其余五个现有失败称基线。当前失败为 CLI Windows 路径、Anthropic bearer header、client-update blocked discovery、headless watchdog、Workspace 模型发现路径；本次未出现 installer/port-probe 历史报错，不外推“已修复”。五项 tsc 与 working/staged diff check exit 0；强制 root Cargo 命令实际 exit 101/no Cargo.toml。HEAD 975538b9 和所有 core/tests/build fingerprints 前后相同，文档不计入冻结。完整门禁仍红、不声明全部完成，不擅自扩大范围外修复。
- 第二轮当前另类 Electron 实包验收为 INCONCLUSIVE，而非 PASS：unsigned/npmRebuild=false 两个独立新输出的 EXE SHA-256 `8f9ed5dffceaa3e2bd980a880a4f16c15830f015f0d3a1308159616dd89daa1d`，asar `48f944db1df3626928575848f192308da66afca4a79f25e42aaa8bb6f0e49f67`；打包 Electron main f9bbb...、Alice main 77e307...、worker 3d4fef...、UI b609... 均与当前输出相符（`pi-unified-exec-35-07bd0a92.log`）。真实 app:// preload/IPC：导入/批准/启用 200，loaded/running、归档 1、重复 new=0；批准坏 ABI 启用 400/unloaded且配置/历史不变，重启原模块/历史仍可读。当前只观察到原生 companion 菜单 Quit OpenAlice 后启动退出日志 0、预记录 EXE/Alice/worker 与 owners 清零、归档 1（`pi-unified-exec-29-32c90734.log`/`pi-unified-exec-43-747591a7.log`），没有捕获 detached OS exit status。字面托盘 Quit 未达到：Dock_64/PickerHost 覆盖层截获右键，前台接管失败关闭；不关闭用户其他 app、不把 companion 菜单冒充 tray。当前包的 literal tray 与实际 IPC 断连宽限分支未验证；标准 Spectre 仍缺。自有两包/home/脚本清理、端口回收，无源码/vendor 改动。
