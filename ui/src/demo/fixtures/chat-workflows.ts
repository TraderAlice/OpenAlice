import { en } from '../../i18n/locales/en'
import { zh } from '../../i18n/locales/zh'
import { zhHant } from '../../i18n/locales/zh-Hant'
import { ja } from '../../i18n/locales/ja'
import { chatLandingExampleGroups } from '../../lib/chat-landing-examples'

/** Match the actual starter catalog, not a second copy of its prompt strings. */
const starters = [en, zh, zhHant, ja].flatMap((catalog) =>
  [undefined, 'nano'].flatMap(product => chatLandingExampleGroups(
    key => catalog.chatLanding[key.replace('chatLanding.', '') as keyof typeof catalog.chatLanding], product,
  ).flat().map(example => ({ ...example, chinese: catalog === zh || catalog === zhHant }))),
)

const replies: Record<string, { en: string; zh: string }> = {
  market: {
    en: `## Three signals to watch together

This is an illustrative desk brief, not today's live market data.

| Signal | Evidence to compare | What it would mean |
| --- | --- | --- |
| Rates vs. growth stocks | Treasury yields, real yields and semiconductor breadth at the same close | A rally with broader participation is more convincing than a handful of leaders rising against higher yields. |
| Dollar vs. commodities | Dollar index, crude and copper at a common observation time | A stronger dollar with weaker industrial commodities would challenge the cyclical-growth story. |
| Price vs. delivery | The demo's VST/VRT research and morning scan | Generation contracts and equipment orders express the same demand theme through different risks. |

**My read:** the useful question is whether the AI-power narrative is turning into delivery. Watch contract milestones, equipment conversion and market breadth together.

**Next check:** compare each observation against its previous close, then record the source and as-of time. No live prices or timestamps were fetched in this preview. The sample power research is available in Inbox.`,
    zh: `## 三个值得放在一起看的信号

这是一份示例晨报，不是今天的实时行情。

| 信号 | 对照证据 | 判断方式 |
| --- | --- | --- |
| 利率与成长股 | 同一收盘时点的国债收益率、实际利率和半导体上涨广度 | 更多股票参与的上涨，比少数龙头顶着利率走高更有说服力。 |
| 美元与商品 | 同一观察时点的美元、原油和铜 | 美元走强而工业商品走弱，会挑战顺周期增长叙事。 |
| 股价与交付 | Demo 中的 VST/VRT 研究及晨间扫描 | 发电合同和设备订单对应同一需求，但兑现风险不同。 |

**我的判断：** 重点是 AI 电力需求有没有变成可兑现的交付，同时看合同节点、设备订单转化和市场广度。

**下一步：** 将每项观察与前收盘对照，记录来源和截至时间。本预览没有获取实时报价；Inbox 中可以查看配套电力研究示例。`,
  },
  portfolio: {
    en: `## Start with shared risk, not ticker count

For this example, assume a portfolio tilted toward semiconductors and AI infrastructure. These are scenario assumptions, not a reading of your accounts.

1. **Correlated exposure.** NVDA, VRT and a semiconductor fund can all depend on the same capex cycle. Group exposure by demand driver before deciding whether the portfolio is diversified.
2. **Delivery risk.** Separate signed demand from revenue recognition. A delay can hurt equipment conversion and generation economics on different schedules.
3. **Hedge mismatch.** An index hedge may soften market beta while leaving single-company earnings gaps exposed. Compare the hedge horizon with the next catalyst.

### Stress cases
- **Capex slows:** recheck backlog quality and customer concentration.
- **Yields rise:** separate valuation compression from deteriorating operating results.
- **A large customer delays a project:** identify which positions share that customer or delivery chain.

**First action:** build a position-to-risk-driver map, then size each scenario using actual holdings and fresh quotes. This demo has not accessed your accounts or placed any orders.`,
    zh: `## 先看共同风险，再看持仓数量

这个示例假设组合偏向半导体与 AI 基础设施，并没有读取你的真实账户。

1. **相关性集中。** NVDA、VRT 和半导体基金可能共同依赖资本开支周期。先按需求驱动因素汇总敞口，再判断分散程度。
2. **交付风险。** 区分已签需求与收入确认。项目延期对设备订单转化、发电收益的影响时间并不一样。
3. **对冲错配。** 指数对冲可能降低市场风险，但仍留下个股财报跳空风险；应将对冲期限与下一催化节点对齐。

### 三个压力情景
- **资本开支放缓：** 复查积压订单质量和客户集中度。
- **利率上升：** 区分估值压缩与经营恶化。
- **大客户延期：** 找出共享客户或交付链的持仓。

**第一步：** 建立持仓与风险驱动因素的对应表，再用真实持仓和新报价测算。此 demo 没有访问真实账户，也没有下单。`,
  },
  thesis: {
    en: `## NVDA: a thesis with an exit condition

**Working hypothesis:** durable inference demand can support growth after the initial training build-out. This is a sample research framework, not a live valuation or recommendation.

### The bull case
Demand broadens beyond a small set of training customers; the software ecosystem and system-level integration support utilization and customer retention.

### The bear case
Customer concentration, custom silicon and lower inference costs weaken pricing or reduce incremental demand. Strong revenue alone would not settle the debate if margins and cash conversion deteriorate.

### Evidence that could change the view
| Question | Confirmation | Invalidation |
| --- | --- | --- |
| Is demand broadening? | More customers and workloads | Growth remains concentrated in a few buyers |
| Is the economics durable? | Stable margins and cash conversion | Persistent pricing pressure or inventory accumulation |
| Does price agree? | Relative strength supported by breadth | Repeated failed rallies despite better operating evidence |

**Next research pass:** reconcile the latest filing, earnings commentary and market observations with their publication times. Define a review threshold before taking a position.

This preview shows the memo inline; it has not saved a new research file.`,
    zh: `## NVDA：一份带退出条件的投资逻辑

**工作假设：** 初始训练建设之后，持续的推理需求仍能支持增长。这是研究框架示例，不是实时估值或投资建议。

### 多头论据
需求扩展到更多客户和推理场景；软件生态与系统集成有助于利用率及客户留存。

### 空头论据
客户集中、自研芯片和推理成本下降可能削弱定价，或减少新增需求。若利润率与现金转化恶化，单看收入增长不足以证明逻辑。

| 核心问题 | 支持证据 | 证伪条件 |
| --- | --- | --- |
| 需求是否扩散 | 更多客户与工作负载 | 增长仍集中于少数买家 |
| 经济性是否持续 | 利润率、现金转化稳定 | 持续降价或库存积压 |
| 价格是否确认 | 相对强势且有市场广度支持 | 经营改善后仍反复冲高失败 |

**下一轮研究：** 将最新财报、业绩会与价格观察按发布时间对齐，先明确复查阈值，再讨论仓位。

本预览把备忘录展示在对话中，没有创建新的研究文件。`,
  },
  workspace: {
    en: `## The demo desk needs three follow-ups

1. **Thesis monitor — interrupted.** The sample watchdog ran late. Check the assigned Session before retrying; an interruption is not a completed review.
2. **CPI reaction note — blocked.** Its missing owner is an intentional recovery example. Reassign responsibility before expecting a reply.
3. **Liquidity risk review — duplicate name.** The board contains the same Issue name in two Workspaces. Resolve which desk owns the work before combining conclusions.

**Suggested order:** recover ownership, inspect the interrupted run, then reconcile duplicate scope. Issues contains these sample states; Inbox contains the power research and morning scan.

This is a walkthrough of the seeded scenario, not a fresh audit of your local files.`,
    zh: `## 示例工作台有三件事值得跟进

1. **Thesis monitor 中断：** 示例中的 watchdog 超时。先检查负责 Session，再决定重试；中断不等于复查完成。
2. **CPI 反应笔记阻塞：** 缺失负责人是特意保留的恢复场景。先重新分配，再等待回复。
3. **Liquidity risk review 重名：** 两个 Workspace 都有同名 Issue。合并结论前先明确谁负责哪部分。

**建议顺序：** 恢复负责人、检查中断运行、厘清重复范围。Issues 可查看这些状态，Inbox 有电力研究与晨报示例。

这是预置场景的讲解，并没有重新扫描你的本地文件。`,
  },
  automation: {
    en: `## A scheduled Issue that earns its place in Inbox

**Work item:** review semiconductor rotation and flag a material change in the research view.

| Setting | Proposed value |
| --- | --- |
| Schedule | Weekdays at 08:30, America/New_York |
| Responsibility | Create one Session on the first run; reuse it afterward |
| Evidence | Breadth, relative returns and relevant company news, each with an as-of time |
| Delivery | Send an Inbox report only when the conclusion materially changes |
| Authority | Research only; no orders |

### Report format
**What changed → supporting evidence → effect on the thesis → next check.** Quiet runs remain in history so silence does not erase the audit trail.

This is a proposed configuration; no new schedule is running. Open the existing Morning movers scan in Issues to inspect the schedule, Session assignment and run history.`,
    zh: `## 让定时 Issue 只在值得打扰时进入 Inbox

**任务：** 复查半导体轮动，在研究判断出现实质变化时提醒。

| 设置 | 建议值 |
| --- | --- |
| 调度 | 每个工作日 08:30，America/New_York |
| 负责人 | 首次运行创建一个 Session，后续复用 |
| 证据 | 市场广度、相对收益、公司新闻，分别记录截至时间 |
| 通知 | 仅在结论实质变化时发送 Inbox 报告 |
| 权限 | 只研究，不下单 |

**报告结构：** 变化 → 证据 → 对逻辑的影响 → 下一次检查。没有变化的运行仍留在历史中。

这是配置草案，没有启动新调度。可以打开 Issues 中已有的 Morning movers scan，查看调度、Session 分配与运行记录。`,
  },
  quant: {
    en: `## A reproducible rotation study

**Hypothesis:** short-term sector rotation predicts next-week relative returns after costs.

1. **Define the universe before testing.** Fix membership rules and point-in-time availability to avoid survivorship and look-ahead bias.
2. **Separate development and evaluation.** Use chronological walk-forward windows. Keep a simple equal-weight baseline beside the candidate signal.
3. **Charge realistic costs.** Report turnover, slippage sensitivity, drawdown and performance by market regime, not just a headline Sharpe ratio.
4. **Keep every run attributable.** Record dataset version, parameters and immutable report references so another Session can reproduce the result.

**Reject the idea** if out-of-sample returns disappear under modest costs or are carried by one short regime.

This preview is the study brief, not a completed backtest. No experiment or trade has been launched.`,
    zh: `## 一项可复现的轮动研究

**假设：** 短期板块轮动在计入成本后，仍能预测下一周相对收益。

1. **先固定样本。** 明确成员规则和数据可得时间，避免幸存者偏差与未来信息。
2. **分开开发与评估。** 用按时间滚动的样本外窗口，对照简单等权基线。
3. **计入成本。** 同时报告换手、滑点敏感性、回撤和分市场状态表现，不只给一个夏普比率。
4. **保留归属。** 记录数据版本、参数和不可变报告引用，让其他 Session 能复现。

**否决条件：** 温和成本就吃掉样本外收益，或结果完全依赖单个短期行情。

此预览是一份研究委派说明，没有运行回测、启动实验或交易。`,
  },
  'code-review': {
    en: '## A bounded Workspace review\n\nStart with the entry point and its tests, then trace unfinished behavior to the smallest responsible module. Rank findings by user impact and attach a concrete reproduction.\n\n**Next three edits:** repair the highest-impact failure, add a regression test that reproduces it, and update the owning guide if the behavior changed.\n\nThis is an example review plan; no repository was inspected or modified.',
    zh: '## 有边界的 Workspace 审阅\n\n从入口及其测试开始，把未完成行为追到最小负责模块；按用户影响排序，并附复现步骤。\n\n**接下来三处修改：** 修复影响最大的失败、补能复现它的回归测试、在行为变化时更新所属文档。\n\n这是审阅计划示例，没有检查或修改真实仓库。',
  },
  inbox: {
    en: '## Triage the demo Inbox\n\n**Read first:** the AI-power research separates generation exposure from equipment delivery risk.\n\n**Compare next:** the morning scan tells you what changed in the same theme.\n\n**Follow up:** open the originating conversation to challenge an assumption before treating the report as a decision.\n\nThese are seeded examples, not a scan of your personal Inbox.',
    zh: '## 整理示例 Inbox\n\n**先读：** AI 电力研究区分发电敞口与设备交付风险。\n\n**再比较：** 晨间扫描说明同一主题出现了什么变化。\n\n**再跟进：** 打开来源对话，先质疑关键假设，再把报告用于决策。\n\n这些是预置示例，没有扫描你的个人 Inbox。',
  },
}

export function demoChatWorkflowTitle(prompt: string): string | undefined {
  return starters.find(example => example.prompt.trim() === prompt.trim() || example.title === prompt.trim())?.title
}

export function demoChatWorkflowReply(prompt: string): string | null {
  const starter = starters.find(example => example.prompt.trim() === prompt.trim() || example.title === prompt.trim())
  if (!starter) return null
  const reply = replies[starter.id]
  if (!reply) return null
  const extras = starter.id === 'market' || starter.id === 'portfolio'
    ? '\n\nAAPL · Demo chart\n\n[[market/alpaca-paper|AAPL/1d]]\n\n' : starter.id === 'quant' ? '\n\nAutoQuant Studio · Synthetic example\n\n[[demo/autoquant-studio.html]]\n\n' : '\n\n'
  return (starter.chinese ? reply.zh : reply.en) + extras + '[[sticker/wave.png]]' + (starter.chinese
    ? '\n\n---\n\n**在你自己的工作台继续：** [安装 OpenAlice](https://github.com/TraderAlice/OpenAlice)，连接你的 Agent 与数据源，用同一个 Chat 界面处理真实研究。本回复为预写 demo 示例。'
    : '\n\n---\n\n**Continue in your own workspace:** [Install OpenAlice](https://github.com/TraderAlice/OpenAlice), connect your agent and data sources, and use this same Chat interface for your research. This response is a prewritten demo example.')
}
