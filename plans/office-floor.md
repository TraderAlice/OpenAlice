# Plan: Office floor

**Status:** active  
**Owner guides:** [[docs/conversation-provenance.md]], [[docs/workspace-issues-and-scheduling.md]], [[docs/ui-interaction-and-motion.md]], [[docs/event-system.md]]  
**Depends on:** [[plans/agent-runtime-log.md]] (occupancy + headless turn assets already land in `agent-runtime.jsonl`)  
**Delivery:** serial PRs to `dev` (`area:workspace`, `theme:reliability`). Increment 1 is the floor projection + sprite adapter. Not `review:deep` unless a persist shape appears.

## Goal

把 `/office` 从时间线升级成一间能看的办公室：

- **Workspace** = 一间办公室
- **`resumeId`（product Session）** = 一名员工
- **每名员工一张桌子** = 工位
- **Workspace 文件** = 办公室里的档案柜
- 员工姿势和头顶气泡由 [[plans/agent-runtime-log.md]] 的日志折出，不另造过程真相

这一阶段的图像资产用 **Codex pet v2**（1536×2288，8×11，192×208 cell；行 0–8 状态，9–10 look）。接口必须松：v2 是当前 pack，不是产品身份。以后换生成器或自制图集时，只换 pack，不改员工/桌子/办公室模型。

## Why now

日志已经能回答「谁在哪张桌、在不在干活、刚说了什么、刚用了哪个工具」。没有画面，Office 仍只是一张表。先做当前态地板，重放滑杆和桌宠 Client 后做。

## Decisions

1. **类比以 Office 表面为准。** [[docs/conversation-provenance.md]] 现在写的是「Workspace = 桌子，Session = 同事」。Office 落地时改那一句：Workspace = 办公室，Session = 坐在自己工位上的员工。身份规则不变：`resumeId` 仍是人，`taskId` 仍是这一班，`SessionRecord.id` 仍是工位附件。
2. **一间办公室 = 一个 Workspace；`/office` 默认看整栋楼。** 名册和文件仍按办公室切开，但画面优先把现有办公室自动排进同一视野：两间（常见 Chat + Quant）桌面并排、窄屏上下叠。不做自由拖拽大楼、不把员工混进一张无名地板。Workspace 选择器不再是进门第一步。可选 `?workspaceId=` 只留给调试/单测。
3. **名册决定谁在场，日志决定他们在干什么。** 地板上只放该 Workspace `presence=active` 的 Session。日志给每人折 `{ mood, bubble, surface, lastSeq }`。已 Archive / deleted 的人不出现；headless 占班的人锁在座位上工作。
4. **画面是投影，不是第二个权威。** 不写新的办公室数据库。`GET /api/office/floor` 默认折出全部业务 Workspace；`asOfSeq` 可选。只读，internally fold 日志 + Session Directory。派单、暂停、打开文件仍走现有 API。
5. **Codex v2 是可替换 pack。** UI 只依赖一个窄接口（见下）。`apps/pet` 继续当实验室，不把 Tauri 播放器嵌进 Office，也不让 `ui/` import `apps/pet`。
6. **画面是空间办公室，不是卡片看板。** 一层像素地板上摆 16-bit 家具（桌、柜、茶水车、盆栽），v2 sprite 站在桌前。两间 Workspace 是同一层里的两个工区。不做 3D、不做写实摄影道具、不做自由拖拽。点桌子先选中，右侧详情栏再打开 Session；档案柜仍开门到 Files。
7. **档案柜是第二刀。** 第一刀只留柜的占位（一间办公室一侧），点进去仍是现有 Files。按员工归档的柜面后做。

### Sprite pack interface (keep loose)

Office 只认大约这个形状。注释写明：Codex v2 是第一个 adapter，不是员工模型的一部分。

```ts
interface OfficeSpritePack {
  readonly id: string
  readonly displayName: string
  readonly sheetUrl: string
  readonly cell: { width: number; height: number }
  /** Map product mood → atlas cell animation. Pack-specific. */
  pose(mood: OfficeEmployeeMood): OfficeSpritePose
}
```

`OfficeEmployeeMood` 是产品态（`idle` / `working` / `talking` / `waiting` / `review` / `failed`），不是 atlas 行名。v2 adapter 再把 `working` 映到 row 7 `running`。换 pack 时只换 `pose()` 和 sheet。

默认 pack：全员共用现在的 `alice-maid`（复制或静态挂到 `ui/public/office/packs/`）。先不为每个 agent 种一张脸。

### Log → mood / bubble

按 `resumeId` 扫日志，后写覆盖前写：

| 最后相关事件 | mood | 气泡 |
|---|---|---|
| `runtime.started` / `runtime.turn.tool` running | working | 工具名（无 I/O） |
| `runtime.turn.text` | talking | clipped 文本 |
| `runtime.turn.error` / `spawn_failed` / `stopped` failed | failed | 短错误 |
| `runtime.rejected` | waiting | 摇头 / 「没派成」 |
| `runtime.stopped` done | review，短时后 idle | `assistantText` 若有 |
| `runtime.stopped` paused / 无后续占用 | idle | 无 |
| 仅 `session.born` | idle | 无 |

气泡是瞬态 UI，不是新日志。TUI/WebPi 没有 turn 块时，只能靠 started/stopped 切 working/idle。

### Alternatives considered

| 方案 | 用户影响 | 结论 |
|---|---|---|
| 继续只做时间线 | 能值班，看不出「办公室」 | 否；时间线留在地板下方当调试条 |
| 3D / 游戏画布 | 炫，但无障碍和窄屏都差，资产一换全毁 | 否 |
| 把 `apps/pet` Tauri 嵌进页面 | 立刻能播 v2 | 否；进程边界错，耦合死 |
| 所有 Workspace 的员工混成一张无名地板 | 一眼全员，但柜和桌丢了办公室边界 | 否；一 Workspace 仍是一间房 |
| 默认整栋楼、房间自动排版 | 俩办公室一张画面 | 是；两间并排，更多换行 |
| 客户端 fold 全部 jsonl、不写 floor API | 少一个路由 | 日志一长会卡；Increment 1 仍加只读 floor 投影 |
| 每员工生成独特宠物 | 好看 | 否；本阶段共用 v2 pack |

**选定：** 一 Workspace 一间办公室；`/office` 默认排整栋楼（两间并排优先一屏）；网格工位；日志投影心情和气泡；v2 pack 经窄接口接入；时间线降为附属。

### Increment 2–3 interaction

档案柜（Increment 2）比较过三种做法：柜面内嵌第二套文件树；点柜只开门到现有 Files；工位上再挂 provenance 抽屉。选定后两者一起：办公室侧柜打开该 Workspace 的 Files 面板（`setFiles(true)` + 现有 workspace tab），不复制文件浏览器；每名员工的抽屉是只读 provenance 列表，报告走 file-viewer，Issue 走 issue-detail，Inbox 选中条目。工位卡片改成 `article`，开 Session 的按钮和抽屉条目不嵌套。

重放（Increment 3）比较过客户端重折 jsonl、把投影函数搬进 UI、以及 `GET /api/office/floor?asOfSeq=`。选定查询参数：只存在一份 `projectOfficeFloor`。滑到 `lastSeq` 或省略参数是直播（墙钟 `now`，继续轮询）；往回拖则按 `seq <= asOfSeq` 切片，并用最后一条纳入事件的时间当 `now`，这样 review→idle 在历史上也成立。滑杆是原生 `range`，放在地板和占用日志之间。不在这一刀做桌宠窗口。

### Chrome gate

Activity Bar 的 Office 入口默认关闭。Settings → Beta 里有本机开关；不打开就不出现按钮。`/office` 直链仍采用，方便开发和书签。不把半成品挂在 Beta 分组里让每个人看见。偏好走 zustand persist（和 Appearance 一样），不进 backend preferences。`apps/pet` Tauri 播放器仍是实验室，不进这一刀。

## Increments

### 1. Floor + sprite adapter

- [x] `OfficeSpritePack` + Codex v2 adapter（注释：可替换）+ 默认 `alice-maid` 静态 pack
- [x] 纯函数 `projectOfficeFloor(roster, events) → employees[]` + spec（mood/bubble 表）
- [x] `GET /api/office/floor`（默认全部办公室；可选 workspaceId / asOfSeq；demo handler）
- [x] `/office`：整栋楼自动排版 + 工位网格 + sprite + 气泡；时间线收到下面
- [x] 无障碍：每桌是按钮，可读名称 `@resumeId` / Session 名 / mood；`prefers-reduced-motion` 停在第一帧
- [x] 更新 [[docs/conversation-provenance.md]] 办公室类比；i18n en 为源
- [x] 本计划勾选与 [[PLANS.md]] 同步

### 2. Filing cabinets

- [x] 每间办公室一侧档案柜：打开该 Workspace Files
- [x] 按 `resumeId` 的近期产物（provenance）挂在「这名员工的抽屉」

### 3. Replay

- [x] 时间滑杆按 seq 重放整栋楼的 `projectOfficeFloor`
- [x] 不在这一刀做桌宠独立窗口；Pet Lab 若订阅，只消费同一投影函数

### 4. Activity Bar gate

- [x] Settings → Beta 分类 + Office 开关，默认关，本机 persist
- [x] Activity Bar 仅在开关打开时显示 Office；`/office` 直链仍采用

## Verification

Increment 1–3:

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`（floor 投影、整栋楼 API、v2 pose、抽屉、asOfSeq、Office 页空楼）
- Playwright：`/office` 同时看到 Chat 和 Quant 两间房；工位、档案柜、重放滑杆；reduced-motion 不循环
- 窄屏：两间房上下叠，不出现第二层 sidebar
- 换 pack 的烟雾：只改 adapter 的 sheet/pose，员工模型编译不过则失败

## Completion

Increment 1–3 完成当且仅当：打开 `/office` 能在同一层看到各 Workspace 房间（两间优先并排）、在职员工各坐一桌、心情和气泡来自日志投影、柜打开 Files、抽屉打开 provenance、滑杆按 seq 重放、sprite 只通过 pack 接口碰到 v2。整份计划在画面被接受或明确砍掉后删除。
