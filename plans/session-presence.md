# Plan: Session floor presence (active / archived / deleted)

**Status:** active  
**Owner guides:** [[docs/workspace-lifecycle.md]], [[docs/conversation-provenance.md]]  
**Delivery:** serial PRs to `dev` (`area:workspace`). Increment 2 is `review:deep`. Open PR, do not merge.

## Goal

Ask Alice / Quant 名册上的「删」不是拆 TUI 座位，也不是把人从世界上抹掉。员工（`resumeId`）在桌内有三档在职状态：

| 状态 | 含义 |
|---|---|
| 在职 `active` | 花名册上的同事 |
| 归档 `archived` | 从名册收进柜子，人还在，痕迹还在，还能找回 |
| 删除 `deleted` | 软开除：不再上工，但署名和产物仍能找到这个人 |

现有 `lifecycle: retired` **保持原意**：整桌 offboard 时人跟桌子一起走。不拿它当归档。

顺带去掉侧栏截断和行内 Browse（底栏菜单里已有）。

## Why not grow `lifecycle`

`resume-identities.json` 已随 0.89.2+ 发布。`lifecycle` 只有 `active | retired`，且 `retired` 被 offboard / restore / follow-up 写成「跟桌子走了」。

若把 `archived` / `deleted` 塞进同一个字段：

- 旧解析器把未知值当成 `active`（`=== 'retired' ? retired : active`）；
- `recallWorkspace` 会把归档/软删一律拉回在职。

所以拆第二轴，缺省即在职，旧文件不用 migration：

```ts
lifecycle: 'active' | 'retired'   // 桌：在岗 / 跟桌走了（已发布）
presence:  'active' | 'archived' | 'deleted'  // 人：在职 / 归档 / 软删（新，缺省 active）
```

名册一行：`lifecycle === 'active' && (presence ?? 'active') === 'active'`。

## Product rules

| 表面 | `active` | `archived` | `deleted` | `retired`（跟桌） |
|---|---|---|---|---|
| Ask Alice / Quant 侧栏 | 是 | 否 | 否 | 否 |
| Browse：默认 / Archived 筛 | 默认 | Archived 筛 | 不进 Browse | 否 |
| Play / 拉 TUI | 是 | Browse 里可以，**不**自动恢复到名册 | 否 | 否 |
| 新 Issue 选人 | 是 | 否 | 否 | 否 |
| 已指派的 `@resumeId` 再跑 | 是 | 是（归档不是停工） | 否 | 否 |
| Follow-up | exact | exact（人还在） | unavailable `deleted-session` | unavailable `retired-session` |
| 新 headless / `ensure` | 是 | 是 | 拒 | 拒 |

- 侧栏 More 主操作是 **Archive**，不是 Delete。Delete 是二次确认的软开除。
- 正在占班（TUI 或 headless running）时 Archive / Delete 都锁。
- Archive / Delete **不**拆 `SessionRecord`；它是产品 Session 的持久名册记录。`DELETE /sessions/:sid` 只停止实时进程并把 presence 置为 `deleted`；只有 Workspace purge 才物理清除记录。
- 归档可 Restore → `presence=active`。软删可 Undelete → `archived`（先回柜子，不直接站回名册）。
- 真物理删除不存在。产物、Inbox、run 历史、`resumeId` 署名都留着。

## Alternatives considered

1. **只扩 `lifecycle`** — 和已发布的跟桌 `retired`、restore 全员召回冲突。否。
2. **侧栏 Delete = 直接 `deleted`** — 日常整理代价太大。否；主操作是 Archive。
3. **归档即 follow-up unavailable** — 归档只是收纳，不是人走了。否。
4. **Play 归档行则自动 Restore** — 打开档案夹不应把人弹回工位。否。

## Increments

### 1. 侧栏自己滚（无持久化）

Ask Alice 壳（Quant 共用）：

- 去掉 `FOCUSED_CHAT_SESSION_LIMIT`（8）和 `CHAT_SIDEBAR_SESSION_LIMIT`（6）以及行内 `ConversationListFooter`。
- Focused / Workspace 树下列完整名册，现有 `overflow-y-auto` 自己滚。
- Recent across Workspaces 去掉 `ALL_WORKSPACES_SESSION_LIMIT`（30），同样滚。
- Browse 只留在底栏折叠菜单。不在列表底下再放一颗。

验收：60 人的 desk 可以一滚到底；底栏仍能打开 Browse。

### 2. `presence` + Archive（`review:deep`）

- `ResumeIdentityRecord.presence?`；读写缺省 `active`。不改 `resume-identities.json` version，不加 migration。
- `ResumeRegistry.setPresence({ resumeId, presence, now })`：`retired` 身份拒绝改 presence。
- `PATCH /api/workspaces/:id/resumes/:resumeId` body `{ presence }`。409：running / retired / 非法迁移（例如 `deleted → active` 必须先 undelete）。
- Directory 投影 `presence`。Join 仍藏 `retired`；名册再滤非 `active` presence。
- SessionRow More：在职 → Archive；归档行（Browse）→ Restore + Delete。
- `conversation-control`：`deleted` → `deleted-session`；`archived` 仍 exact。
- Issue 选人列表只出在职。owner guide 补 presence 与 `retired` 的分工。
- Demo `/resumes` 带一条 archived 同事，确认不进 Recent。

### 3. Soft-delete 收尾（可与 2 同 PR，若 2 已过大则拆）

- More → Delete（二次确认）→ `deleted`。
- Undelete → `archived`。
- Browse 仍不列出 `deleted`。署名 / 产物 follow-up 走 `deleted-session`，不新雇一个人顶上。
- `ensure` / 新 headless / 新指派拒绝 `deleted`。

## Out of scope

- 物理删 identity / 原生 transcript
- Manager 名册、Automation 调度页
- 侧栏 `createdBy` 徽章
- 把 `DELETE /sessions/:sid` 重解释成 Archive
- 独立「已归档员工」活动页

## Verification

```text
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
```

浏览器（5175 Chat + 一眼 Quant）：

1. 名册可滚完全部在职员工；列表下没有 Browse。
2. Archive 后行消失；Browse → Archived 能 Restore。
3. 占班中不能 Archive。
4. Soft-delete 后 Browse / 名册都没有；`@resumeId` 仍解析为这个人，只是不可上工。
5. Offboard / restore 桌仍只动 `lifecycle`，不把归档人洗成在职。

## Acceptance

- [x] 侧栏按最近占班列出全部在职员工，不再截断
- [x] 行内 Browse 去掉；查找只走底栏
- [x] Archive 把人移出名册，不毁掉 `resumeId`
- [ ] Deleted 是软开除，工作留痕仍找得到人
- [ ] `retired` 仍只表示跟桌走了
- [ ] PR 开出后交给审查，不合

## Checklist

- [x] Increment 1：去掉截断和行内 Browse + 单测
- [x] Increment 2：`presence` + PATCH + 名册/Browse/follow-up + owner guide
- [ ] Increment 3：soft-delete / undelete（若未并进 2）
- [ ] 浏览器走 Chat 与 Quant
