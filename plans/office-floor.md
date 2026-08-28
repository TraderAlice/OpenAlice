# Plan: Office overworld

**Status:** active — scene rebuild in progress
**Owner guides:** [[docs/ui-interaction-and-motion.md]], [[docs/conversation-provenance.md]], [[docs/workspace-lifecycle.md]]
**Depends on:** [[plans/agent-runtime-log.md]]
**Delivery:** serial PR to `dev` (`area:workspace`, `theme:reliability`)

## Goal

把 `/office` 做成一张真正可读、可操作的 4:3 俯视 Office 地图，让用户先看懂
「哪些 Harness 在场、哪些 Workspace 正在活动、每名 Session 在做什么」，再进入日志、
Session、Files 或 provenance。

产品层级固定为：

- **一张连续楼层地图**：OpenAlice 当前运行现场
- **Harness 区域**：Chat、AutoQuant、未来 Harness 的功能邻域，不是房间卡片
- **Workspace 小组**：地图上的家具簇和铭牌
- **product Session 员工**：围绕小组工位活动，身份仍由 `resumeId` 决定
- **Alice**：地图角色和镜头锚点

## Current diagnosis

数据投影、休眠判断、Harness 分类和最小显示数量可以保留；当前视觉场景不可作为终稿继续
修边：

1. Harness 仍被画成带标题和地毯的矩形组件，像多张小场景贴在一起。
2. 正面桌椅素材与俯视地图透视冲突，造成横版卷轴感。
3. HUD 仍像 Dashboard；统计、筛选、Log 长驻抢占游戏画面。
4. 固定三桌加 `+N` 不能解释真实 Session 密度。
5. 底部帮助框长驻遮挡地图；详情和日志仍有网页面板层级。
6. 地图缺少自动构图，空白、遮挡和镜头初始位置依赖手调坐标。
7. Alice 和所有工位员工共用 `alice-maid` 会抹平主角与 NPC 身份；Alice 保留正式 pet
   atlas，员工必须使用同画风、按 runtime 可辨识的正式位图角色，不能退回 CSS 占位人。

## Design decision

### Alternatives

| 方向 | 用户影响 | 结论 |
|---|---|---|
| 继续调整 Harness 矩形区域 | 改动小，但仍是卡片拼图 | 否 |
| Canvas/WebGL 游戏场景 | 资产和镜头自由，但 DOM 可访问性、测试和产品交互成本过高 | 否 |
| DOM + CSS tilemap + 统一场景图 | 能保持按钮、焦点和现有导航，同时得到真正二维构图 | **是** |

### Chosen scene model

1. **地图只有一个地板和一套 tile grid。** Harness 不拥有墙、窗、背景或外框。
2. **Workspace 是地图物件簇。** 由同一套 top-down rug、sign、desk、terminal、
   cabinet 占位物件组成；Harness 只影响物件组合和小型区域标识。
3. **场景布局由统一 packer 负责。** 所有 Workspace pod 进入同一二维网格；布局器在
   接近 4:3 的包围盒内分配 X/Y，不再为每个 Harness 建二级 grid。
4. **Alice 和镜头是同一个坐标系统。** 默认镜头根据 Alice + 可见 pod 包围盒取景；
   鼠标/触控拖动平移，WASD/方向键移动 Alice，Reset 恢复自动取景。
5. **显示优先级为 minimum > awake > sleeping。** 每个 Harness 先保留最近交互的
   `harnessMinimumVisibleGroups` 个 Workspace，再加入其他 awake Workspace；其余只在
   All groups 中出现。默认 `chat=1`、`auto-quant=1`、`other=0`。
6. **休眠是对象状态，不是区域滤镜。** 地板和家具保持同一环境色；只降低员工、
   terminal 指示和铭牌状态。
7. **状态通过角色和物件表达。** working/talking/waiting/review/failed 继续来自
   runtime log；循环动画只用于真实活动，并遵守 reduced motion。

## Interaction model

- 单击员工：选中并在底部打开游戏对话框；再次操作进入 Session。
- 单击 Workspace 铭牌/档案柜：打开该 Workspace Files。
- Alice 靠近员工、档案柜或名册板时，只高亮面向锥形范围内的最佳对象并显示单一游戏
  按键提示；正侧方和背后对象不抢提示。Enter/Space 执行与鼠标点击相同的动作，不用
  键盘用户在地图对象之间 Tab 巡航。
- 拖动空地：平移镜头；不得触发员工点击。
- WASD/方向键：移动 Alice；靠近视口安全边缘时镜头跟随，地图保持可键盘聚焦并提供
  可读 label。
- 墙、地标、工位、档案柜和 Harness 道具使用地图坐标脚印阻挡 Alice；Workspace 铭牌
  使用前景深度遮挡而不是横跨小组的整块碰撞墙。
- `Live map` / `All groups`、Replay、Log：收入暂停菜单；主地图只保留当前位置和真实
  活动提示。
- 默认无选中对象时不显示大对话框，只在首次进入时短暂提供操作提示。

## Responsive and accessibility

- 宽屏：保持 4:3 viewport，地图可二维平移。
- 窄屏：viewport 使用可用宽度，不缩小文字和点击目标；暂停菜单与对话框占完整工作区。
- 员工、Workspace 铭牌、Reset 和菜单继续使用原生按钮。
- Office 只使用全局 `--text-xs` / `--text-sm` / `--text-base` 字阶；像素风不得通过
  `6px–11px` 独立字号制造。
- 地图可聚焦，说明拖动和移动方式；隐藏菜单必须同时 `aria-hidden` / `inert`。
- reduced motion 停止 sprite loop、选中跳动和镜头过渡，但保留状态色与文本。

## Asset boundary

`alice-maid` Codex pet v2 是 Alice 唯一使用的正式主角 pack，通过 `OfficeSpritePack`
保持可替换。Session 员工使用独立的 runtime coworker registry；Codex、Claude、Pi、
OpenCode 有正式生成角色，其他 runtime 稳定映射到最接近的 archetype，绝不回退成 Alice。
员工 mood 继续由 runtime log 驱动，并以离散 CSS 动作和状态点表达；未来有可靠的四方向
atlas 后再替换静态 coworker，不把 mood atlas 行误当成方向行。

第一版 top-down 家具占位资产遵守统一规范：

- 16×16 tile 基础网格；人物和桌组可占 32×32 / 48×48；
- 地图主角消费 `alice-maid` v2 adapter；工位、名册和 Agent 档案消费同一 runtime
  coworker asset registry；
- top-down desk、terminal、cabinet、rug corner、sign、plant；
- 所有缺失资产在 asset registry 和 CSS 中保留 `TODO(asset)`，替换资产不得修改场景
  数据模型或布局算法。

## Execution

### 0. Preserve valid projection work

- [x] runtime log → employee mood / bubble / surface
- [x] Workspace sleep threshold configuration
- [x] Workspace template → Harness classification
- [x] per-Harness minimum visible group configuration and API contract
- [x] minimum-first default filtering covered by tests

### 1. Replace nested Harness scene graph

- [x] 增加一个纯函数 Office map packer：输入可见 Harness/Workspace/Session，输出统一
  tile 坐标、地图边界和默认镜头
- [x] OfficeBuilding 直接渲染 shared map objects，不再渲染 Harness-owned room scene
- [x] Workspace pod 使用统一尺寸和 tile-aligned object slots
- [x] Harness 标识降为地图标牌/环境语义，不形成矩形区域
- [ ] 删除 superseded room/group/window/partition CSS，而不是继续追加 override
- [x] 为 1、2、5、17 个 Workspace 写布局 specs：无重叠、二维展开、边界确定

### 2. Establish top-down visual grammar

- [x] 添加生成式 top-down asset registry 和风格母版；第一批透明 PNG 覆盖工位、档案柜、
  终端机和植物，CSS 不再负责绘制已接入物件
- [x] 将 desk/cabinet/terminal 从正面排队改为生成式俯视物件；档案柜成为地图内 Files
  交互，而不是铭牌图标
- [x] Alice 独占 Codex pet v2，员工使用按 runtime 区分的生成角色；水平移动消费 atlas
  正式左右跑步行，纵向移动不伪造缺失的背面帧
- [x] 员工超出 pod 舒适容量时使用可进入/可展开的小组人数提示，不显示 `+58`
- [x] 统一 tile、阴影、像素缩放和主色卡映射

### 3. Simplify game chrome

- [x] HUD 只保留楼层身份和活动信号
- [x] HUD、地图标签、菜单和临时窗口恢复到全局 12/14/16px 字阶
- [x] Live/All、Log、Replay 移入暂停菜单
- [x] 无选择时移除常驻底部大提示
- [x] 员工详情改成底部游戏对话框；Files 和 Session 动作保持可达
- [x] Log 使用暂停菜单内的单一滚动区

### 4. Camera and input hardening

- [x] 默认镜头按 Alice + visible pods 自动取景
- [x] pointer/touch drag 有边界、无点击串扰、切换过滤后保持有效镜头
- [x] WASD/方向键移动、Reset、focus-visible 和 reduced-motion specs
- [x] 窄屏不依靠字体缩小，不把地图对象压成不可点击尺寸

### 5. Browser acceptance loop

每完成一个视觉 increment，都必须在真实 `/office` 路由截图并检查：

- [x] Live map：Chat active + AutoQuant minimum 同屏，视觉属于同一楼层
- [x] All groups：17 个 Workspace 二维展开，无内部滚动框和重叠
- [x] 选中员工：地图上下文仍可见，对话框不遮住目标
- [x] Pause/Log：只有一个临时层，关闭后焦点返回
- [x] 鼠标拖动、键盘移动、Reset 均在真实浏览器执行
- [x] Day/Night、reduced motion、窄 viewport 各走一遍

每轮截图后记录：

1. 最大视觉噪音；
2. 最难理解的层级；
3. 第一个自然动作是否明确；
4. 是否仍存在 Dashboard/card 语言；
5. 下一轮只解决其中最重要的一项。

## Verification

Required:

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
pnpm --filter open-alice-ui build
```

Focused:

- Office projection / route / hook specs
- map packer geometry specs
- OfficeBuilding pointer + keyboard specs
- semantic color contract
- real browser `/office` walkthrough and screenshots

Current verification (2026-08-16):

- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 535 files / 4425 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed
- Browser passed: Live minimums, All groups, employee dialog, pause/log, keyboard move,
  pointer pan, Reset, Day and Night, 760px narrow viewport, and emulated reduced motion
- Pause menu uses the shared Popover primitive; Escape dismissal, focus return, menu roles,
  viewport containment, and the occupancy dialog path were rechecked after the migration

Generated-asset increment (2026-08-29):

- Generated and alpha-checked a 16-bit top-down furniture style master plus standalone
  workstation, filing-cabinet, terminal-kiosk, and plant sprites
- Integrated the workstation into every pod and replaced the CSS plant / water-cooler placeholders
  with generated plant / terminal assets; the filing cabinet is registered but not yet promoted to
  the Files interaction object
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 587 files / 4965 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed
- Browser rechecked the real `/office` demo route after asset integration

Environment-asset increment (2026-08-29):

- Generated and alpha-checked a repeating wall/window module, seamless floor texture, and
  Workspace rug from the same locked style master
- Replaced CSS grid flooring and CSS-drawn windows with generated environment assets while
  preserving one continuous floor and DOM-native map controls
- Promoted the generated filing cabinet to a focusable map object that opens Workspace Files;
  removed the Files icon from the Workspace sign
- Repaired the Office demo projection so its Workspace, Session, and `resumeId` identities resolve
  against the shared demo roster; browser-confirmed Files opens instead of `Workspace not found`
- Browser rechecked Alice keyboard movement, employee selection, generated asset scaling, and the
  employee dialog with the map context preserved
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 588 files / 4966 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Harness-neighborhood increment (2026-08-29):

- Compared three ways to distinguish Harnesses: stronger pod colors/borders, complete room-specific
  backgrounds, and generated set dressing on the shared floor. Chose generated set dressing because
  it adds readable world semantics without restoring card boundaries or fragmenting the continuous map.
- Generated and alpha-checked a Chat coffee station and AutoQuant server rack from the locked Office
  style master; Prediction retains the generated terminal kiosk and generic groups retain the plant.
- Rebuilt employee inspection as a compact RPG dialogue: the real animated employee sprite is the
  portrait, live activity becomes dialogue, state/location stay readable, and drawers act as inventory.
- Repaired the demo drawer provenance path to open an actual shared demo Workspace artifact instead of
  ending at a file-not-found state.
- Browser-confirmed the real `/office` route, both Harness props, employee selection, responsive field
  wrapping, Open session to the recorded WebPi session, and drawer-to-file navigation.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 589 files / 4967 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Operations-journal increment (2026-08-29):

- Real-browser replay found the next largest visual discontinuity: opening Occupancy log replaced the
  game floor with a generic admin timeline, tiny text tags, default-looking action buttons, and no
  visual grammar for lifecycle, message, tool, or alert events.
- Compared three approaches: reskin the existing timeline, build a two-pane event inspector, or turn
  the chronological feed into a GBA action journal. Chose the single-column action journal because it
  keeps scan order and narrow-screen behavior while making every event readable as a game record.
- The journal keeps all real runtime facts in text; generated assets only encode four stable event
  categories. This avoids decorative fiction and lets status, Workspace, Session, surface, cause,
  metrics, and Run navigation remain authoritative.
- Generated four transparent 16-bit badges from the locked Office style master: lifecycle door,
  message transcript, tool kit, and alert beacon. The existing generated logbook also replaces the
  remaining vector header glyph.
- Rebuilt each event as a bordered journal record with sequence, relative time, Session, agent,
  Workspace, narrative detail, metadata chips, and an explicit `A · Open Runs` action. Replay remains
  native and keyboard-operable inside a physical fold-out deck.
- Added a map-only modal scrim and bound the journal to stable Office seed colors after real Night-mode
  play exposed unreadable theme mixing. Day and Night now share the same paper, ink, teal, and brass
  contrast instead of washing the window gray.
- Browser-confirmed Day, Night, 760 px narrow layout, Replay expansion, Escape focus return to the
  operations board, and the real Open Runs navigation path.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4993 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Night-environment increment (2026-08-29):

- Real-browser Day/Night comparison found that Night was only a theme-variable wash: physical Office
  UI lost contrast, Alice and HUD labels faded, while the windows and floor still described daytime.
- Compared reusing Day unchanged, applying one blue filter to the whole game, and authoring a true
  after-hours environment state. Chose the third option so indoor UI stays readable and night is
  communicated by the world rather than by dimming text and characters.
- The interaction model is unchanged. Office physical UI now owns a stable 16-bit seed palette across
  app themes; Night swaps only the window view, floor ambience, and restrained machine glow.
- Edited the generated wall/window module into a geometry-locked night variant with deep-blue exterior
  glass, tiny distant building lights, and warm indoor walls. A second background-extraction pass
  converted the baked checkerboard into genuine alpha without replacing the daytime asset.
- Browser-verified explicit Day and Night, Auto resolving to Night under the system dark preference,
  the Night pause menu and Agent file, and a 760 px-wide Night viewport. The generated module tiled
  without a seam and physical labels, prompts, status colors, and focusable controls stayed legible.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- focused Office and semantic-color specs passed: 3 files / 10 tests
- `pnpm test` passed: 599 files / 4993 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Proximity-interaction increment (2026-08-29):

- Compared collision-triggered actions, a permanent interaction list, and proximity interaction.
  Chose a 78px nearest-target radius with an explicit Enter/Space action: it behaves like a GBA
  overworld without accidental navigation or Dashboard chrome.
- Projected the four visible employee desks and Workspace filing cabinet into the shared map coordinate
  system; the same employee ordering now drives both rendering and keyboard target positions.
- Added nearest-object highlight, a compact game-button prompt, Enter/Space dispatch, and camera
  following inside a viewport safe area. Mouse and focusable-button behavior remain intact.
- Browser-played the real `/office` demo from Alice spawn to the Chat cabinet and employee desk;
  confirmed Enter opens Workspace Files, Space opens employee dialogue, and a 17-step walk keeps Alice
  visible while the camera follows.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 590 files / 4970 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Map-collision increment (2026-08-29):

- Compared whole-pod collision, DOM hit testing, and shared-coordinate furniture footprints. Chose
  deterministic footprint rectangles so the same tile geometry works in browser, tests, and large maps.
- Added collision for the generated wall, global plant/terminal landmarks, all four workstation slots,
  filing cabinets, and Harness props. Alice keeps an intentionally small foot hitbox and returns a
  directional 140ms bump rather than sliding through an object.
- Changed Workspace signs from a physical wall to a foreground depth layer after real play showed that
  a full-width sign collider created a needless detour. Alice now passes behind the sign while desks and
  furniture remain solid.
- Increased the nearest-object action radius from 78px to 84px so collision never strands a valid action
  just outside reach.
- Browser-played the real `/office` route: confirmed the generated wall stops Alice at y=144, empty desks
  stop a straight-line path, the employee remains reachable by walking around the desk, cabinet collision
  leaves Files in range, and the bump state appears without violating reduced motion.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 591 files / 4974 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Roster-board increment (2026-08-29):

- Compared expanding every pod, rotating visible employees through four desks, and adding a dedicated
  world object. Chose a generated personnel board because it preserves the readable four-desk map while
  making every Session discoverable through an intentional game interaction.
- Generated and alpha-checked a freestanding personnel board from the locked Office style master; it is
  rendered only for Workspace groups with more than four Sessions and participates in proximity targeting
  and map collision.
- Added a keyboard-accessible GBA party-style roster window. It sorts active employees first, lists the
  full group rather than a truncated projection, and routes selection into the existing Agent-file dialogue.
- Expanded the shared Office demo from one hand-authored employee to all six real Chat Sessions, preserving
  their actual Session IDs, resume IDs, agents, states, surfaces, and the verified provenance drawer.
- Browser-played the real Demo route: Enter opened the board from Alice's spawn, all six employees appeared,
  the hidden fifth/sixth Session could be inspected, Open session resolved to
  `/workspaces/demo-chat-ws/s/demo-chat-headless-codex`, and Escape returned focus to the board.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 592 files / 4978 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Runtime-coworker increment (2026-08-29):

- Compared palette-shifting Alice, generating complete directional atlases, and introducing authored
  static overworld coworkers with discrete mood motion. Chose the static runtime archetypes because they
  immediately restore protagonist/NPC identity while keeping a clean upgrade path to future atlases.
- Generated Codex, Claude, Pi, and OpenCode coworkers against the locked environment master and Alice
  proportion reference. Rejected the first outputs because their checkerboard was baked into RGB, then
  background-extracted, alpha-checked, and losslessly packaged the corrected assets as WebP.
- Added one runtime asset registry shared by map desks, the six-person roster, and Agent-file portraits.
  Known aliases map intentionally; unknown runtimes receive a stable archetype and never render as Alice.
- Replaced always-on activity bubbles and nameplates with progressive disclosure: the map stays readable,
  while hover/focus/proximity/selection reveals identity and proximity reveals the current activity.
- Browser-played the real Demo route at native viewport: all four runtime silhouettes are visible on the
  shared floor, approaching Claude reveals only Claude's name/activity, the roster shows six correctly
  mapped portraits, and the Agent file preserves the selected Claude portrait while Alice keeps her atlas.
- Repaired the semantic-color integration after the first full run rejected literal runtime accents;
  coworker badges now consume theme-owned terminal color roles in Day and Night modes.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 594 files / 4981 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Facing-interaction increment (2026-08-29):

- Replaced pure nearest-distance selection with a facing-aware interaction cone. The cone keeps a small
  foot-level tolerance, widens in front of Alice, and rejects objects directly to the side or behind her.
- Movement updates facing before collision resolution, so pressing toward a solid desk, cabinet, or roster
  board turns Alice in place and immediately exposes that object without allowing her to walk through it.
- Preserved mouse behavior and the single Enter/Space prompt; only keyboard/game interaction targeting
  changed. Existing collision, camera, cabinet, employee, and roster routes remain DOM-native.
- Browser-played the real Demo route: spawn faces the cabinet rather than the roster behind Alice; moving up
  then bump-turning left selects the roster without changing position; navigating around the rug and bumping
  down into a desk selects the Pi employee; Enter opens the correct roster, Agent file, and Workspace Files.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 594 files / 4982 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Y-depth increment (2026-08-29):

- Compared keeping fixed component layers, sorting complete Workspace pods, and sorting every map object
  from its floor contact point. Fixed layers preserve the paper-doll look, while whole-pod sorting fails
  when Alice walks among furniture inside a pod. Chose one shared Y-depth function because it matches the
  painter algorithm used by classic top-down maps and keeps DOM-native controls intact.
- Workspace signs, all four workstation slots, cabinets, personnel boards, Harness props, wall landmarks,
  and Alice now consume the same map-space depth scale. Rugs remain on the floor, while activity bubbles
  and labels remain local overlays inside their correctly sorted world object.
- Removed the desk-list stacking context and the fixed Alice/sign/prop layers that previously forced Alice
  to paint over furniture everywhere. The sign remains non-solid: Alice visibly disappears behind it when
  walking north and reappears in front after crossing its floor line.
- Browser-played the real Demo route across both sides of a Workspace sign: at y=264 Alice paints behind
  the sign's y=284 floor line, then paints in front at y=312. Rechecked the six-person roster and focus
  return, employee collision/inspection, spawn-facing cabinet prompt, and Files navigation after sorting.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 595 files / 4984 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Operations-board increment (2026-08-29):

- Compared shrinking the one-row map, filling the north aisle with decorative set dressing, and turning
  the existing occupancy log into a world landmark. Chose the Operations Board because it gives the empty
  aisle a gameplay purpose and spatializes an existing action without adding another Dashboard surface.
- Used the locked Office style master with the built-in image generator to create a freestanding 16-bit
  mission console on a flat magenta key. Removed the key locally, verified an RGBA asset with transparent
  alpha, and registered `operations-board-v1.png` in the generated furniture pack.
- The board owns a real map coordinate, Y-depth, collision footprint, facing-aware interaction target,
  mouse button, keyboard prompt, active-screen pulse, and reduced-motion fallback. Enter opens the same
  occupancy log/replay as the pause menu; closing returns focus to the board when that was the entry point.
- Browser-played the real Demo route in Day and Night: four north steps expose the board prompt at y=264,
  a fifth step bumps without moving Alice, Enter opens the occupancy log, and close returns focus to
  `office-operations-board`. The original spawn-facing cabinet prompt remains the default first action.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 595 files / 4985 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Alice-walk-cycle increment (2026-08-29):

- Compared a CSS-only bob, generating a replacement four-direction Alice, and consuming the authored
  movement rows already present in the canonical Alice v2 atlas. Chose the existing right/left run rows
  plus a restrained vertical step bob: it improves game feel without replacing Alice or mislabeling a
  side-running frame as a nonexistent back-facing frame.
- Replaced the employee-mood adapter with an Alice-specific pose contract: idle, walk-right, and walk-left.
  Horizontal steps now animate the eight authored run frames; vertical steps retain the correct frontal
  silhouette while sharing the discrete footfall motion.
- Added a 96ms three-step map-position transition and a 150ms walking hold so taps read as tile steps and
  held keys maintain a continuous run cycle. Collision immediately cancels walking before the directional
  bump, and reduced motion disables both interpolation and bobbing while preserving pose/state feedback.
- Browser-played the real Demo route: a right step enters `walk-right` and advances to frame 1 before
  returning to idle; a left step selects the separately authored `walk-left`; northward movement keeps
  the frontal pose and walking state; collision at the Operations Board cancels walking and shows bump
  without changing the y=264 logical position.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 596 files / 4987 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Workspace-placard increment (2026-08-29):

- Compared restyling the existing CSS card, baking one image per Workspace, and placing live DOM text
  over a generated blank prop. Chose the generated physical prop plus DOM overlay: it adds material and
  perspective without freezing Workspace names, localization, or agent counts into raster text.
- Used the locked Office style master with the built-in image generator to create a wide walnut-framed,
  deep-teal 16-bit placard on a flat magenta key. Removed the key locally, cropped the transparent canvas,
  verified RGBA alpha, and registered `workspace-sign-v1.png` in the generated furniture pack.
- Rebuilt the label hierarchy as Harness and agent-count metadata above a two-line Workspace title. The
  sign consumes fixed Office palette seed roles so its cream/teal lettering remains part of the physical
  prop in both Day and Night instead of washing into theme-dependent gray.
- Browser-checked the real Demo route in Day and Night: `Semis and supply chain` renders at the global
  14px text scale without ellipsis or overflow, both pods remain readable, and the signs now read as
  world objects rather than floating webpage cards.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 596 files / 4987 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Interactive-placard increment (2026-08-29):

- Replayed the generated placard on current `dev` and found that its visual affordance contradicted its
  semantics: the largest Workspace object was a non-focusable `header`, while the much smaller filing
  cabinet was the only direct Files control.
- Compared leaving the sign informational, opening a new Workspace inspector, and making the sign share
  the cabinet's existing Files action. Chose the native-button Files action because it fulfills the world
  object's promise without adding another modal, menu, or Dashboard layer.
- Added explicit hover, pressed, focus-visible, sleeping, and reduced-motion states to the physical prop.
  The generated image and live text remain unchanged; only the interaction contract now matches what the
  object already communicates visually.
- Browser-verified pointer click and native Enter activation to `/workspaces/demo-chat-ws`; rechecked Day
  and Night, a 760px viewport with both 264×64 controls unclipped, a visible focus ring, and emulated
  reduced motion with transitions effectively disabled.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 596 files / 4987 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

World-action-prompt increment (2026-08-29):

- Replayed current `dev` and compared the two remaining motion/HUD candidates. Coworkers already consume
  live mood-specific stepped animation; the larger defect was the fixed 360px action window, which
  covered the floor and truncated `Open Semis and supply chain files` to an ambiguous ellipsis.
- Compared widening the fixed window, moving it into the bottom HUD, and attaching it to the current
  world target. Chose the target-attached callout because it preserves the relationship between action
  and object instead of making another screen-space toolbar.
- Added a pure four-side placement function. It places the callout beyond the target and away from Alice,
  then uses the current camera and measured viewport—not invisible map bounds—to flip the callout inward
  before it reaches a clipped edge. ResizeObserver keeps that decision current across responsive changes.
- Rebuilt the prompt as a compact teal 16-bit speech plaque with a directional pixel tail, live DOM key
  and action text, two-line wrapping, stable Office palette seed colors, and a reduced-motion entrance.
- Browser-played the cabinet and Operations Board routes. The first narrow pass exposed bottom clipping,
  and the first Night pass exposed gray text; both were repaired. Final checks passed at 1280×720 and
  760×900, Day and Night, emulated reduced motion, full long text, and Enter navigation to the real
  Workspace route.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 597 files / 4990 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Pixel-control-HUD increment (2026-08-29):

- Replayed current `dev` and compared keeping the permanent help strip, replacing it with a larger
  command panel, and turning it into a first-use game tutorial. Chose the one-time tutorial because the
  target-attached world prompt already teaches Enter, while movement only needs to be taught once.
- Used the locked Office style master with the built-in image generator to create separate 16-bit D-pad
  and recenter-compass controls on flat magenta keys. Removed the keys locally, cropped and resized the
  sprites to 128px RGBA PNGs, and registered them in an Office HUD asset pack.
- The movement plaque now folds away after the first keyboard step or meaningful pointer pan. The pixel
  compass remains as the native, focusable reset control, and resetting preserves the learned state for
  the current visit instead of replaying the tutorial.
- Browser-played the real Demo route at 1280×720 in Day and Night and at 760×900. The initial HUD stays
  inside the map, a keyboard step collapses it from the full tutorial to the 28px compass, Reset recenters
  Alice without replaying the hint, and emulated reduced motion suppresses the stepped transition.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 598 files / 4991 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Pause-command-menu increment (2026-08-29):

- Replayed the employee Agent file, six-person roster, and pause menu on current `dev`. The character and
  roster windows already read as game panels, but the portalled pause menu lost every Office-local palette
  variable: its background was transparent, its 8px text disappeared into the windows, and its plain
  Popover buttons did not support arrow-key menu navigation.
- Compared a CSS-only contrast patch, a compact GBA command window with generated glyphs, and a full-screen
  pause scene. Chose the compact command window because it keeps the map spatially present while fixing the
  broken surface and replacing the remaining Menu/Close/ScrollText vectors in that interaction.
- Used the locked Office style master with the built-in image generator to create transparent 16-bit menu
  terminal, four-room grid, and operations-log icons. Cropped each to a 128px RGBA sprite; Live Map reuses
  the existing compass so the vocabulary remains consistent.
- Replaced the plain Popover with the shared Base UI DropdownMenu primitives. Pointer selection, Up/Down,
  Enter, Escape, radio state, menu dismissal, and trigger focus return now follow the repository control
  contract; the hidden default vector indicator is replaced visually by the Office pixel diamond.
- The portal now owns stable GBA seed colors, 14px command labels, 44px targets, a physical title plate,
  focus/selected states, and reduced-motion suppression. Browser-played Day at 1280×720 and Night at
  760×900 with no horizontal overflow; keyboard All Groups and pointer Occupancy Log both reached their
  real destinations.
- `npx tsc --noEmit` passed
- `cd ui && npx tsc -b` passed
- `pnpm test` passed: 598 files / 4991 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Command-glyph increment (2026-08-29):

- Real-browser replay of the Team roster and Agent file found the remaining visual discontinuity:
  generic Lucide line icons still represented the live signal, roster, close, open-session, file, and
  empty-selection actions inside otherwise physical 16-bit windows.
- Compared CSS-drawn pixel symbols, reusing the small existing HUD set, and generating a complete Office
  command-glyph family. Chose the generated family so each action has a distinct physical object and the
  same teal, cream, charcoal, brass, and cyan-light material language as the map.
- Generated five independent transparent sprites against the locked style master: a radio receiver,
  personnel badge, mechanical close latch, terminal doorway, and drawer record. The first Session doorway
  baked in a checkerboard, so a second background-extraction pass produced genuine RGBA before packaging.
- Replaced every remaining `lucide-react` use under `ui/src/office/`; live labels, button semantics, focus
  rings, keyboard behavior, and accessible names remain DOM-owned rather than baked into the images.
- Browser-verified the Night Roster and Agent file at 1280×720 and 760×900. The glyphs retain readable
  silhouettes, the generated close latch keeps visible autofocus, and the responsive windows do not add
  horizontal overflow.
- Browser-rechecked Day after the responsive pass; the physical glyph palette remains independent of the
  surrounding app theme and every close action still returns through the existing dialog lifecycle.
- The quiet-floor path is projection-tested with the same generated receiver and no SVG fallback.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- focused Office glyph/window specs passed: 4 files / 6 tests
- `pnpm test` passed: 599 files / 4993 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

North-facing Alice increment (2026-08-29):

- Real-browser movement found a spatial credibility break: Alice's interaction cone and collision state
  faced north, but the character kept showing her front-facing idle pose. Compared preserving that shortcut,
  transforming the side-run frames, and generating the missing identity-consistent rear view. Chose a real
  rear view so direction reads immediately without distorting the canonical Alice art.
- Used the built-in image generator with the canonical `alice-maid` atlas as the identity reference to create
  one straight rear-view 16-bit sprite. The service twice returned a baked RGB checkerboard, so packaging
  preserved the generated character pixels and removed only the connected light background locally. The
  shipped `back-v1.png` is a 192×208 RGBA asset with a clean silhouette at map scale.
- Moved sheet, cell, and atlas ownership from the whole pack to each pose. North-facing Alice now selects the
  generated one-cell rear sheet while front idle and both authored eight-frame horizontal runs stay on the
  canonical Codex v2 atlas. Walking north keeps the existing CSS step motion instead of inventing fake frames.
- Browser-played Day at 1280×720 and Night at 760×900. Turning north selects `idle-back`, turning south restores
  `idle`, the loaded image URL resolves to the generated asset, and neither layout adds horizontal overflow.
- Focused sprite-pack and Alice component specs passed: 2 files / 3 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4994 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

## Completion

计划只在 maintainer 接受真实浏览器中的 Live、All groups、employee dialog 和 pause/log
四个状态后删除。完成标准不是“CSS 编译通过”，而是：

- 看起来是一张连续的俯视游戏地图；
- Harness、Workspace、Session 层级无需解释即可辨认；
- 2D 构图、拖动镜头和 Alice 移动自然；
- 主画面没有 card nesting、横版卷轴构图或 Dashboard chrome；
- 数据密集状态仍然可读、可操作并通过完整验证。
