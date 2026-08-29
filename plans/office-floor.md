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
7. Alice 和所有工位员工共用一套角色图会抹平主角与 NPC 身份；Alice 使用 Office 专用
   四方向 overworld atlas，员工使用同画风、按 runtime 可辨识的正式位图角色。

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
   All groups 中出现。默认 `chat=1`、`auto-quant=1`、`prediction=1`、`other=0`。
6. **休眠是对象状态，不是区域滤镜。** 地板和家具保持同一环境色；只降低员工、
   terminal 指示和铭牌状态。
7. **状态通过角色和物件表达。** working/talking/waiting/review/failed 继续来自
   runtime log；循环动画只用于真实活动，并遵守 reduced motion。

## Interaction model

- 单击地图对象：Alice 沿真实碰撞网格走到面向锥形范围内，再执行该对象的操作；任意
  手动移动、拖图、Reset、Menu 或新目标都能取消路线，绝不隔空打开或传送。
- 单击员工：走近后选中并在底部打开游戏对话框；再次操作进入 Session。
- 单击 Workspace 铭牌/档案柜：走近后打开该 Workspace 的 Office 档案柜。
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

`alice-overworld-v1.png` 是 Alice 唯一使用的正式 Office 主角 pack，通过 `OfficeSpritePack`
保持可替换。Session 员工使用独立的 runtime coworker registry；Codex、Claude、Pi、
OpenCode 有正式生成角色，其他 runtime 稳定映射到最接近的 archetype，绝不回退成 Alice。
员工 mood 继续由 runtime log 驱动，并以离散 CSS 动作和状态点表达；未来有可靠的四方向
atlas 后再替换静态 coworker，不把 mood atlas 行误当成方向行。

第一版 top-down 家具占位资产遵守统一规范：

- 16×16 tile 基础网格；人物和桌组可占 32×32 / 48×48；
- 地图主角消费 Office 专用四方向 adapter；工位、名册和 Agent 档案消费同一 runtime
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
- [x] 删除 superseded room/group/window/partition CSS，而不是继续追加 override
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
  style master; generic groups retain the plant.
- Added the existing Auto Prediction demo Workspace to the Office floor as a third first-class pod, then
  generated and alpha-checked a dedicated probability-and-evidence console so Prediction no longer reuses
  the generic terminal kiosk.
- Rebuilt employee inspection as a compact RPG dialogue: the real animated employee sprite is the
  portrait, live activity becomes dialogue, state/location stay readable, and drawers act as inventory.
- Repaired the demo drawer provenance path to open an actual shared demo Workspace artifact instead of
  ending at a file-not-found state.
- Browser-confirmed the real `/office` route, all three first-class Harness props, employee selection, responsive field
  wrapping, Open session to the recorded WebPi session, and drawer-to-file navigation.
- Rechecked the three-pod desktop composition, 390x844 pannable map with no page-level horizontal overflow,
  and the Prediction sign-to-cabinet interaction after adding the third demo pod.
- Root/UI TypeScript, the 606-file Vitest run (5,027 passing; one file and nine tests skipped), and the UI
  production build passed after the Prediction increment.
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

First-touch interaction increment (2026-08-29):

- Replayed the current reset path and found that Alice spawned 79px from the nearest filing cabinet while
  the 84px interaction radius immediately painted a large Files prompt. That made opening a Workspace look
  like the intended first action instead of letting the movement tutorial lead exploration.
- Compared moving the spawn point, delaying the prompt, and tightening the facing cone. Chose a 72px radius:
  it clears the neutral spawn while every employee, cabinet, roster board, and Operations Board remains
  reachable from outside its collision footprint. The existing directional side/back gates remain unchanged.
- Browser movement also found that the roster and Occupancy log left the map prompt/highlight visible behind
  their modal windows. `OfficePage` now explicitly suspends world interaction for every Office overlay;
  `OfficeBuilding` clears its nearby target, prompt, and highlight for the complete suspended state.
- Browser-played reset, two-step roster approach, Enter activation, roster close, and Operations log. Reset
  has no target or prompt, the roster prompt appears only after approaching, and both windows leave the
  underlying scene inert with no nearby highlight or prompt.
- Rechecked the neutral reset state at 760×900 in the dark Office surface: no horizontal overflow, no
  premature target, and no visible text below the 12px Office minimum.
- Focused interaction, OfficeBuilding, and OfficePage specs passed: 3 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4995 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Spawn-compass environment increment (2026-08-29):

- Replayed the neutral spawn after removing the premature Files prompt. The interaction was now correct,
  but Alice still appeared on an algorithmically empty patch of floor with no arrival or gathering meaning.
- Compared a CSS marker, reusing the Workspace rug, and generating a dedicated floor inlay. Chose a new
  inlay because CSS would regress to programmer-drawn vector language and a rug would imply a third Workspace.
- Used the built-in image generator with the locked Office style master to create a flat orthographic
  Operations compass: worn brass, teal enamel, parchment highlights, four restrained cardinal notches,
  no words, arrows, glow, button depth, or interaction promise. Generated on a flat magenta key, removed
  locally with the ImageGen skill helper, and packaged as a 144×144 RGBA PNG with transparent corners.
- Registered the asset in the Office furniture pack and anchored it to `mapLayout.alice`. It remains at the
  reset point when Alice walks away, paints below every actor and prop, and owns no collision or pointer target.
- Browser-checked Night and Day at 1280×720 plus Day at 760×900. The medallion reads as a floor inset,
  stays centered under Alice at reset, leaves the movement and prompt rules unchanged, and adds no overflow.
- Focused furniture and OfficeBuilding specs passed: 2 files / 4 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4995 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Quiet-floor scene increment (2026-08-29):

- Audited the true zero-Workspace route and the filtered all-sleeping route. The former abandoned Office
  completely for a page-level paragraph; the latter covered the whole map with a Dashboard-like empty card.
- Compared keeping the page copy, retaining the full-map overlay, and preserving the floor with a compact
  in-world system notice. Chose the in-world notice so the map, Alice, spawn compass, landmarks, Operations
  Board, movement controls, and day/night atmosphere remain the product even when there are no desks.
- Empty map layout now has an explicit 960×672 zero-pod scene with Alice centered at (480, 336), rather than
  inheriting a phantom one-pod calculation. OfficePage always renders the game surface when floor data exists.
- The generated signal receiver now anchors a single physical 16-bit notice below Alice. A truly empty Office
  explains where active Sessions will appear without offering a meaningless filter action; an all-sleeping
  Office offers All groups and restores its hidden pods in place.
- Added layout, building, and page coverage for the centered zero state, generated receiver, map retention,
  absence of the All groups action when nothing exists, and the sleeping-to-all-groups transition.
- Browser-played the standard two-group floor, true zero-Workspace floor, and all-sleeping floor. At
  1280×720 and 760×900 the notice stays inside the camera without covering Alice, the Operations Board,
  or movement controls; All groups restores both hidden pods and no scenario adds horizontal overflow.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4998 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Workstation-crew increment (2026-08-29):

- Real-browser close inspection found the map still compressed full-body, front-facing portrait art into
  48px desk seats. The result loaded correctly but read as a pile of unrelated character and furniture
  layers, and contradicted the workstation's upward-facing chair/monitor projection.
- Compared tuning the portrait scale, reviving the unused CSS circle-and-block agent, and generating a
  dedicated seated map pose. Chose generated poses because map-scale silhouettes need their own camera and
  spatial direction; neither a smaller portrait nor programmer-drawn tokens fixes the underlying art model.
- Used the built-in image generator with the Office style master, each existing coworker portrait, the
  workstation projection, and a locked Codex sample pose. Added Codex, Claude, Pi, and OpenCode rear-view
  seated sprites with identity-specific hair, headgear, outerwear, and accents. Checkerboard outputs went
  through background-extraction edits; all four packaged PNGs have genuine alpha.
- Map desks now select the `desk` pose while roster and Agent windows retain the full portrait. The four
  characters face their monitors, occupy the chair footprint, preserve mood/reduced-motion animation, and
  remain distinguishable without enlarging the workstation hit target.
- Removed the abandoned CSS-only top-down desk and agent primitives so there is one authored workstation
  composition rather than a hidden parallel vector-like implementation.
- Focused sprite, desk, roster, and Agent-window specs passed: 4 files / 5 tests.
- Browser-played the normal floor at 1280×720 and 760×900. All four desk assets load with the `desk` pose,
  keep their mood animations, add no horizontal overflow, and remain visually separate from Alice and the
  workstation furniture. Clicking a worker still opens the inert Agent window with the correct full portrait.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 4998 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Exceptional-state emote follow-up (2026-08-29):

- Compared the new crew against Pokémon Emerald, Golden Sun, and Mother 3 interior scenes. Their useful
  shared constraint is selective signaling: the world stays quiet, exceptional NPC state gets one short
  overhead symbol, and detailed copy waits for the interaction window. Persistent labels would turn the
  map back into a dashboard.
- Generated a quiet three-dot parchment bubble for `waiting` and a jagged warning bubble for `failed`, each
  on a flat magenta key. Processed both with the ImageGen chroma-key helper, validated alpha coverage and
  transparent corners, and packaged them as 12KB and 20KB map assets.
- Exceptional emotes render only at waiting/failed desks. An actual nearby/selected tool bubble takes
  priority and removes the emote, so one worker never stacks two messages. Normal work remains unlabelled;
  both emotes keep stepped animation and honor reduced motion.
- Browser-played working, waiting, failed, idle, and selected-with-tool states at 1280×720 and 760×900.
  Both emotes remain readable without covering Alice, Workspace signs, or map controls, and add no overflow.
- Focused coworker registry and desk specs passed: 2 files / 6 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 5001 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Vacant-workstation follow-up (2026-08-29):

- Real-browser inspection found that a zero-agent Workspace still owned four semantic desk slots, but the
  generic disabled-button opacity and a second station opacity multiplied to roughly 19%. Auto Quant read
  as an empty rug and unfinished asset load instead of a dormant department.
- Compared leaving the rug empty, adding explanatory UI copy, and keeping physical powered-down furniture.
  Chose powered-down furniture: classic overhead rooms communicate function through persistent scenery,
  while copy would turn a world-state distinction into another dashboard empty state.
- Generated one empty-chair workstation variant that preserves the occupied station footprint while turning
  off the monitor and tower glow. It was produced on a flat magenta key, processed with the ImageGen
  chroma-key helper, alpha-checked, and packaged as a 256×256 RGBA PNG.
- Vacant Session slots now select the powered-down asset at a restrained 82% opacity. They remain disabled,
  never show interaction prompts or selection state, and preserve the existing workstation collision box.
- Browser-played the normal two-group floor in Day and Night at 1280×720 plus Day at 760×900. All four
  vacant assets load at native 256×256, add no horizontal overflow, remain legible without competing with
  occupied bright-screen desks, and stop Alice without pretending to be interactive.
- Focused desk and furniture specs passed: 2 files / 5 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 599 files / 5002 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Filing-cabinet interaction follow-up (2026-08-29):

- Played the map-to-detail interaction chain and found that the Workspace sign and physical filing cabinet
  immediately navigated out of Office into the ordinary Workspaces surface. The first interaction therefore
  discarded the game world instead of examining the object Alice had approached.
- Compared retaining the teleport, duplicating the full Workspace file browser inside Office, and adding an
  in-world cabinet manifest with explicit exits. Chose the manifest: it keeps the first interaction spatial,
  avoids copying another feature's file-tree ownership, and preserves a deliberate path to deeper work.
- Added a modal 16-bit filing-cabinet window that aggregates real employee drawer records, sorts them newest
  first, identifies the coworker who filed each record, and reuses generated Office command glyphs. Record
  selection still opens its real report/issue/inbox destination; a separate portal enters full Workspace files.
- Empty cabinets receive an authored in-world empty state rather than a blank panel. Escape and the generated
  close control restore focus to the exact sign or cabinet that opened the window, while the map stays inert.
- Browser-played a populated Semis cabinet and empty Auto Quant cabinet at 1280×720 and 760×900. The first
  click remains in Office, the window has no horizontal overflow, the real report opens correctly, and only
  the explicit Workspace portal leaves the map.
- Focused cabinet, building, and page specs passed: 3 files / 8 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 600 files / 5004 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Operations-journal follow-up (2026-08-29):

- Played the Agent file and Operations Board windows. Agent inspection already reads as a compact character
  dialogue, but Operations still rendered every event as a full independent card with a repeated Runs button.
  The pixel border changed the skin without changing the dashboard-feed information architecture.
- Compared a glyph-only polish pass, Session grouping, and a GBA-style journal with a compact index plus one
  selected detail. Chose the journal because it preserves every event and real exit without inventing grouping
  semantics, while making scanning and reading distinct player actions.
- Rebuilt the live runtime feed as a scrollable event directory and a single detail pane. Poll refreshes keep
  the current selection when that sequence still exists; otherwise the newest event becomes active. Mouse,
  Arrow Up/Down, Home, and End all move the selected record and its detail together.
- Replaced the last raw close `×` and CSS letter-button with the generated Office close and Session-portal
  glyphs. Reduced-motion mode disables journal row movement as well as the shared window opening animation.
- Browser-played six live Demo events at 1280×720 and 760×900. Selection, detail kind, keyboard focus, generated
  asset loads, Runs exit, and zero horizontal overflow all hold; the narrow layout stacks index above detail.
- Focused runtime and page specs passed: 2 files / 6 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 600 files / 5004 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Context-action follow-up (2026-08-29):

- Played the map at 1280×720 and 760×900 and found that approaching a busy desk stacked its task bubble,
  nameplate, and a 280px `Enter + full sentence` banner. The callout obscured adjacent furniture on desktop
  and crossed roughly half a Workspace on the narrow layout, undoing the world-first interaction model.
- Compared a reskinned sentence banner, a fixed bottom command bar, and a compact object-bound action badge.
  Chose the badge because it keeps the target relationship, avoids competing with the bottom Agent window,
  and lets the highlighted world object carry identity while the prompt carries only the available action.
- Generated `talk-bubble-v1.png` with the built-in image generator from the Office style master: one cream
  parchment conversation glyph with charcoal pixel outline and teal dots on a flat magenta key. Ran the shared
  chroma-key removal helper, cropped and nearest-neighbor packaged it as a 128×128 RGBA PNG, and verified four
  transparent corners plus 64.38% non-empty subject coverage.
- Rebuilt nearby prompts as generated glyph + short localized action + Enter. Employee, cabinet, roster, and
  operations targets use TALK, FILES, ROSTER, and REVIEW respectively; full target-aware sentences remain the
  accessible status names. Existing generated drawer, roster, and occupancy glyphs provide the other actions.
- The first 196px version still repeated a truncated target name and touched Alice, so real-browser feedback
  removed that redundant line. The final 176px maximum keeps every English action untruncated without hiding
  the task bubble, target highlight, or player label.
- Browser-played all four prompt kinds at 760×900 and the operations prompt at 1280×720. Generated image loads,
  side placement, complete labels, Agent-file Enter interaction, Operations-log Enter interaction, and map
  visibility all hold with no new horizontal overflow.
- Focused building, placement, and HUD-asset specs passed: 3 files / 8 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 600 files / 5004 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Roster-navigation follow-up (2026-08-29):

- Played the six-member team roster into an Agent file and found that closing the file discarded the roster
  and returned to the floor. A party-list-to-character-detail flow therefore lost both its menu layer and the
  member the player had just inspected, unlike a coherent RPG menu stack.
- Compared keeping the current floor exit, stacking two simultaneous modal windows, and replacing the roster
  with Agent detail while retaining an explicit return edge. Chose replacement plus return: it preserves one
  modal at a time, keeps the map inert, and makes Back return to the exact originating menu context.
- Generated `window-back-v1.png` with the built-in image generator from the Office style master: one cream
  left arrow with charcoal pixel outline, teal shadow, and native transparent background. Cropped and packaged
  it with nearest-neighbor scaling as a 128×128 RGBA PNG; all four corners are transparent and subject coverage
  is 29.86%.
- Agent files now remember whether they came from a map desk or team roster. Roster-origin files show the
  generated Back control; button activation or Escape recreates the same roster and autofocuses the originating
  employee row. A second Escape closes the roster and restores the physical personnel-board focus.
- Direct map-desk inspection deliberately retains the generated Close control and restores the desk focus, so
  the two entry paths no longer share an incorrect exit. Freshly opened rosters still autofocus Close; only a
  returning roster autofocuses its prior member.
- Browser-played roster → second employee → Back → focused member → Escape → map at 1280×720 and 760×900.
  Also verified the direct-map Close path, generated asset load, single-dialog semantics, responsive layout,
  and no new horizontal overflow.
- Focused page, Agent-file, roster, and HUD-asset specs passed: 4 files / 8 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 600 files / 5006 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Touch-controls follow-up (2026-08-29):

- Played Office inside the 760px mobile shell and found that its only movement guidance was `WASD / ARROWS`.
  Touch users could view the floor but could neither move Alice nor execute the nearby Enter interaction, so
  the game surface was functionally keyboard-only at the breakpoint where the application becomes mobile.
- Compared retaining keyboard-only controls, adding click-to-teleport/pathfinding, and promoting the existing
  generated move-pad into a real directional controller. Chose the controller because it preserves Alice's
  facing, collision, nearby-target, and camera rules instead of introducing a second movement model.
- The generated 16-bit move-pad is now an actual four-way touch control at narrow widths. A tap advances one
  24px world step; holding a direction repeats after a short deliberate delay. Pointer release, cancellation,
  capture loss, unmount, and collision all stop safely through the same movement path used by the keyboard.
- Nearby world badges are now real buttons as well as live status announcements. Touch players can tap the
  object-bound TALK, FILES, ROSTER, or REVIEW action directly; keyboard Enter/Space and full accessible target
  labels remain intact. Four locales include explicit movement and action names.
- Browser-played the 760x900 route using only the D-pad to approach a personnel board and tap the world action
  into its team roster. At 1280x900 the pad is absent and keyboard movement still works. Both widths retain zero
  horizontal overflow, and the narrow control does not replace or bypass map collision.
- Focused building spec passed: 1 file / 5 tests, including press-and-hold repetition and tappable interaction.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 600 files / 5007 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Click-to-interact pathfinding follow-up (2026-08-29):

- Played the finished desktop floor and found that every desk, filing cabinet, personnel board, sign, and
  Operations board still opened from across the map. Alice's movement and collision loop was therefore an
  optional skin: the shortest way to use Office was to ignore its player character and click through scenery.
- Compared disabling distant objects until Alice was nearby, showing a `move closer` rejection, and translating
  a click into collision-aware walk-to-interact. Chose walk-to-interact because it keeps the spatial rule without
  making mouse users imitate a D-pad; touch and keyboard movement remain first-class manual controls.
- Added a deterministic 24px-grid breadth-first pathfinder over the real Office collision graph. It searches for
  the shortest reachable tile whose facing cone contains the requested object, animates each existing Alice walk
  step, follows with the existing camera, turns toward the target, and only then invokes the real interaction.
- Workspace signs are now interaction targets and physical obstacles rather than labels Alice can walk through.
  All world-object clicks route through the same interaction graph; the selected destination receives a restrained
  amber lock highlight while a polite live status announces where Alice is walking.
- Manual keyboard movement, touch-pad input, map dragging, Reset, Menu, layout changes, and a second target click
  cancel the current route immediately. Unreachable routes fail closed instead of teleporting or opening remotely.
- Browser-played a distant Auto Quant sign at 1280x800 and 760x900. The cabinet remained closed during the walk,
  Alice navigated around real signs and furniture, faced upward on arrival, and only then opened the empty cabinet.
  Also captured an in-progress desk route with its target lock and verified blank-map input cancels the route before
  selection. The narrow route retains its D-pad and zero horizontal overflow.
- Focused path, target, collision, and building specs passed: 4 files / 20 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 601 files / 5011 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Alice-overworld animation follow-up (2026-08-29):

- Played the new automatic routes and found that Alice exposed a split asset model on every turn: left/right
  used eight-frame side-running rows from the large desktop-pet atlas, north used one generated rear still, and
  south reused the front idle row with a CSS vertical bob. The main character therefore changed density and
  animation language as the pathfinder changed direction.
- Compared generating only north/south strips, keeping the mixed atlas with stronger CSS motion, and replacing
  all directions with one Office-native overworld sheet. Chose one sheet because mixed proportions would preserve
  the visible transformation bug; Office does not need compatibility with the desktop-pet atlas.
- Used the built-in image generator with the canonical Alice maid sheet and prior rear view as identity references.
  Generated exactly twelve transparent late-GBA sprites: down, left, right, and up rows with left-step, neutral,
  and right-step columns. Alice retains her gold hair, black bow, blue maid dress, white apron, and black shoes.
- Packaged the output as `alice-overworld-v1.png`: removed disconnected generation artifacts, normalized every
  frame to one baseline, nearest-neighbor reduced to native 48x48 cells, binarized alpha, and quantized the whole
  144x192 atlas to a shared 64-color palette. The old 1536x2288 pet atlas, one-off rear PNG, and pet manifest were
  removed from Office instead of leaving a second unused runtime path.
- `OfficeSpritePack` now exposes dedicated idle and three-frame walk poses for all four directions. The player is
  rendered at its native 48px scale; the previous up/down CSS bob and direction-specific source switching are gone.
- Night-mode QA exposed a separate camera-state leak: enlarging a previously panned narrow viewport retained an
  out-of-range negative offset and revealed the campus checkerboard beyond the map edge. Resize observation now
  reclamps both camera axes against current viewport and map dimensions; a regression spec covers narrow-to-wide.
- Browser-played an automatic route at 1280x800 and sampled down, left, and up walk poses plus advancing side
  frames. At 760x900, D-pad taps resolved to four distinct idle poses from the same generated sheet. The new player
  remains legible beside coworkers, the route completes correctly, and both widths retain zero horizontal overflow.
  Day and Night remain readable; resizing 760→1280 now leaves the map covering the full campus with a 0px gap.
- Focused Alice, sprite-pack, and building specs passed: 3 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 601 files / 5011 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed
- The preceding route increment's Linux and Windows CI both exposed the same near-boundary test timeout: the
  reduced-motion sign route completed locally just under Testing Library's one-second default while saturated
  runners missed it. The interaction assertion now carries an explicit ten-second asynchronous-route budget;
  the focused Office page spec passes 1 file / 4 tests locally.

Route-breadcrumb follow-up (2026-08-29):

- Replayed the current generated floor after click-to-interact shipped. The target lock and screen-reader status
  prove that a click registered, but the large shared floor still gives no visible preview of the route Alice will
  take; the empty aisle reads as unused space during the most game-like interaction on the surface.
- Compared adding ambient clutter, enclosing each Workspace with low partitions, and drawing the remaining route
  on the floor. Ambient props would fill pixels without improving an action. Partitions conflict with the existing
  open-neighborhood contract and would recreate room/card boundaries. Chose route breadcrumbs because they add
  direct input feedback, navigation legibility, and useful motion while preserving one continuous Office floor.
- Interaction model: a generated 24px floor inlay points in the direction of each remaining grid step; visited
  markers disappear as Alice advances, the last marker receives a distinct destination treatment, and every
  existing route-cancellation path removes the trail immediately. The trail is decorative and hidden from the
  accessibility tree because the existing live status already announces the named destination.
- Responsive behavior: markers live in world coordinates and therefore follow the same camera transform at every
  viewport width. Reduced motion keeps the static inlays but removes their pulse; no new persistent HUD is added.
- Generated `route-chevron-v1.png` with the built-in image generator after rejecting a first variant that looked
  too much like the spawn compass. The accepted double-chevron was chroma-key extracted, hard-matted, and
  nearest-neighbor packaged as a native 24x24 RGBA tile.
- `OfficeRouteTrail` renders the remaining route in world coordinates, thins long straight runs while retaining
  endpoints and turns, rotates the one generated tile for four directions, and gives the final tile a stronger
  destination treatment. Each completed step disappears; cancellation clears both trail and target lock.
- Browser-played routes to both Workspace signs at 1280x800 and 760x900 in Day and Night. Turn markers remained
  readable on bare floor and rugs, the camera carried them with Alice, narrow width retained 0px horizontal
  overflow, and clicking blank floor cleared 12 visible route markers plus the target lock immediately.
- Focused trail, building, and furniture specs passed: 3 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 602 files / 5013 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Collision-impact follow-up (2026-08-29):

- Replayed manual movement into the Operations board. Runtime state correctly reported `bumped=true`, but the
  current 140ms Alice-only shake was nearly invisible at map scale and overlapped the nearby REVIEW prompt; the
  player could not reliably distinguish collision feedback from an interactable target.
- Compared amplifying the CSS shake, adding a text toast, and generating a directional four-frame impact effect.
  A stronger shake still does not identify the blocked edge, while a toast would reintroduce dashboard language.
  Chose the world-space effect because it confirms the input and the collision direction without persistent HUD.
- Interaction model: every blocked manual step restarts a short effect between Alice and the attempted tile. One
  upward-authored atlas is rotated for all four directions; repeated bumps restart from frame one. The effect is
  decorative, pointer-inert, and cleared independently from nearby interaction prompts. Reduced motion shows one
  static impact frame for the same short lifetime instead of playing the sheet.
- Generated `collision-impact-v1.png` with the built-in image generator as contact, star, arc, and fragment frames;
  sliced the transparent source into four cells, normalized each frame, hard-matted alpha, and nearest-neighbor
  packaged the result as a native 96x24 RGBA atlas.
- Added a serial-keyed world-space effect that restarts on every blocked step, rotates for the attempted direction,
  and clears after 380ms. The bright star frame receives the longest useful dwell; reduced motion holds that frame
  statically for 220ms. Effects sit 30px beyond Alice's center so they clear her silhouette.
- Browser QA found that a bottom-boundary effect initially landed outside the map and was clipped. Impact placement
  now clamps to a 12px interior safe area, keeping furniture effects outside Alice while pinning map-edge effects
  visibly against the boundary.
- Browser-played repeated Operations-board collisions at desktop width, bottom-boundary collisions, and the same
  board collision at 760x900. The effect remained directionally distinct from REVIEW, retriggered on repeated input,
  the boundary frame stayed visible, and the narrow page retained 0px horizontal overflow.
- Focused impact, building, and furniture specs passed: 3 files / 10 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5016 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

World-object identity follow-up (2026-08-29):

- Replayed employee and cabinet interactions in sequence and found a completion-breaking hit-target bug: after
  closing an Agent file, clicking the visible cabinet could reopen `Open issue scan` instead of the cabinet.
- Runtime inspection showed that target IDs and activation closures were correct. The nearby-interaction prompt sat
  above the cabinet at world depth and re-enabled pointer events on its inner button; its `<kbd>` occupied the
  cabinet's center, so the visible world object and the object receiving the click could disagree.
- Compared collision-aware prompt placement, lowering the prompt behind world objects, and making the prompt a
  non-interactive game hint. Chose the hint model: keyboard Enter/Space already owns nearby interaction, while every
  world object is directly clickable and touch has a dedicated D-pad. A second overlapping click target adds no
  capability and violates object identity.
- The prompt remains a named live status with the same action art and key legend, but its presentation is now fully
  pointer-inert and removed from the tab order. Mouse and touch clicks therefore pass through to the visible desk,
  cabinet, sign, roster board, or Operations object underneath.
- Browser-played employee → Close → cabinet at 1280x800 and 760x900. Element hit-testing now resolves the cabinet
  image itself at the previously broken center point; the cabinet dialog opens, the Agent file stays closed, and
  the narrow page retains 0px horizontal overflow.
- Focused building and page specs passed: 2 files / 11 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5016 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Service-landmark asset follow-up (2026-08-29):

- Replayed the default two-Workspace floor after the interaction fixes. The functional neighborhood is concentrated
  in the middle while the guaranteed lower margin is an undifferentiated checkerboard, making the most common map
  read as a finished interaction prototype placed inside an unfinished room.
- Compared adding more route-like floor decals, scattering decorative clutter, and building a small office service
  edge. Decals would compete with route breadcrumbs and arbitrary clutter would add pixels without structure.
  Chose two service landmarks because water/mail and copy/archive functions create recognizable wayfinding anchors
  without inventing new product actions.
- Used the built-in image generator with the locked Office style master to author a water-cooler/mail-sorting nook
  and a copier/archive-trolley nook as one matched source sheet. Chroma-key removal, baseline alignment,
  nearest-neighbor reduction, binary alpha, and a shared 64-color palette produced two 120x104 RGBA runtime PNGs
  at roughly 10KB each; no full-resolution generated image ships at runtime.
- `officeServiceLandmarks` places the pair symmetrically around the map center only when the layout has exactly one
  Workspace row. Empty and dense multi-row maps receive no extra objects. This uses the otherwise guaranteed lower
  service margin without blocking active pods or increasing clutter as the floor grows.
- Both landmarks are pointer-inert scenery with lower-footprint collision rectangles and world-depth sorting. Alice
  can walk behind their upper silhouettes but stops at the cabinet, cooler, copier, and trolley base; the existing
  collision effect confirms the blocked direction.
- Desktop QA initially found the archive trolley underneath the fixed movement HUD. Re-centering both landmarks as
  a service corridor removed the overlap without raising scenery over controls. At 760x900, camera follow reveals
  both landmarks together, the D-pad remains clear, horizontal overflow is 0px, and Alice stops at y=576 with a
  visible impact instead of crossing the mail nook.
- Focused building, collision, and furniture specs passed: 3 files / 15 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5017 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Coworker work-animation follow-up (2026-08-29):

- Replayed the settled cabinet, roster, Agent file, and occupancy-log menus before choosing the next change. Their
  opaque GBA window stack, focus return, and portrait hierarchy are already coherent; the larger remaining break in
  the `Live agent floor` promise is that every seated coworker remains a still image while only Alice moves.
- Compared stronger CSS bobbing, a generic keyboard sparkle overlay, and authored second work poses. CSS motion
  moves the whole body without describing work, while a generic effect would float above four different silhouettes.
  Chose second poses because visible shoulder and forearm movement turns `working` into a game action rather than a
  status label. Idle, waiting, failed, and portrait states intentionally keep their existing visual semantics.
- Used the built-in image generator with all four generated desk poses plus the locked Office style master to author
  alternate keyboard phases for Codex, Claude, Pi, and OpenCode. A first OpenCode result weakened its purple headset,
  so that cell was rejected and regenerated from the exact OpenCode source with stricter identity constraints.
- Chroma-key extraction, exact-canvas resizing, binary alpha, and palette reduction produced four sibling
  `*-desk-work-v1.png` assets. To prevent generated hair or clothing texture from flickering, packaging composites
  each original head and central torso pixel-for-pixel over the generated shoulder and forearm movement; only the
  intended action regions change between frames.
- Working desk poses now alternate original/work frames with discrete 760ms timing. Each runtime has a different
  negative phase so a room of active agents does not move in lockstep. Portraits continue to render exactly one
  standing WebP, and reduced motion leaves the original desk frame visible with the work layer at zero opacity.
- Browser sampling proved all three active demo coworkers load their authored work asset and swap complementary
  base/work opacity across a 410ms interval while occupying different phases. At 760x900 the animation stays legible,
  horizontal overflow remains 0px, and opening Pi's Agent file yields one portrait image with no work frame.
- Focused desk, sprite-registry, and building specs passed: 3 files / 15 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5018 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Native environment-pack follow-up (2026-08-29):

- Audited the rendered Office and its asset graph after the coworker animation. No Lucide, inline SVG, or generic
  vector icons remain in the Office runtime. The actual residual asset problem was pixel density and payload: fifteen
  generated furniture masters between 1K and 1.7K pixels were still shipped directly and displayed at 40-288px,
  totaling 12.49 MiB before coworker and HUD assets.
- Compared optimizing only the repeated workstation, leaving browser scaling in place, and packaging the entire
  environment at its authored runtime canvases. Chose a complete v2 pack because a partial conversion would preserve
  mismatched texture density between the floor, walls, rugs, pods, and landmarks; Office has no compatibility need
  for the oversized runtime sources.
- Locked native canvases from current CSS composition rather than arbitrary thumbnails: 96x96 floor tile, 204x102
  wall module, 264x64 Workspace sign, 264x138 rug, 112x84 workstation, 176x132 Operations board, and 48-80px prop
  canvases. `fill` assets retain current geometry; `contain` assets retain source aspect and transparent margins.
- Nearest-neighbor sampling, hard alpha, and compact 48/64-color palettes produced fifteen sibling v2 PNGs totaling
  106.5 KiB, a 99.2% reduction. A contact-sheet audit confirmed complete silhouettes, matching day/night wall
  geometry, uncut shadows, and readable teal-screen, walnut, parchment, and olive details at native scale.
- Runtime references now use the v2 pack. The fifteen matching high-resolution v1 files and five already-hidden
  early desk/chair/cabinet/coffee/plant PNGs were removed; `OfficeDesk` no longer renders the dead legacy layers and
  their CSS selectors are gone. Native v1 route, impact, and service assets remain because they were already packed.
- Browser A/B verified the default two-Workspace floor in Day, Night, and 760x900. All v2 images reported their
  expected natural dimensions, night selected `wall-window-night-v2`, repeated floor/wall textures had no visible
  seams, cabinet interaction still opened the correct dialog, no image failed, and horizontal overflow stayed 0px.
- Focused furniture, desk, and building specs passed: 3 files / 12 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5018 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Native coworker-portrait follow-up (2026-08-29):

- Audited the remaining Office asset graph after the environment pack. The desk poses, exceptional-state emotes,
  HUD, log icons, and Alice atlas were already close to their rendered dimensions. The four standing coworker
  portraits were the clear outlier: each 1024x1536 generated WebP was displayed at only 33x46 or 51x71, for a
  combined 1.18 MiB and a visibly undersized silhouette inside the roster cards.
- Compared repacking only the four portraits, repacking the complete coworker family, and replacing portraits with
  head-only busts. Chose portrait-only native packaging because the two-frame desk family already has purposeful
  generated motion and reasonable canvases, while busts would break the full-body NPC language shared with Alice.
- Trimmed each alpha-checked generated portrait master to its real silhouette, nearest-neighbor fitted it onto a
  shared 72x104 RGBA canvas, and hard-matted alpha. The four v2 portraits total about 30 KiB, a 97.5% reduction,
  while their larger in-card silhouette makes runtime identity and clothing accents legible at GBA scale.
- Runtime and tests now point only at `*-portrait-v2.png`; the four oversized WebPs were removed because Office has
  no compatibility requirement. A registry spec locks the native canvas so future generated portraits cannot
  silently reintroduce full-resolution masters.
- Browser-checked the team roster and Agent file at 1280x720 and 760x900. Every image reports natural 72x104,
  roster and detail cards preserve the full head-to-feet silhouette, no text or actions are occluded, no image is
  broken, and both widths retain 0px horizontal overflow.
- Focused coworker registry, roster, and Agent-file specs passed: 3 files / 8 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5019 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Native HUD-pack follow-up (2026-08-29):

- Opened the real Menu, Occupancy log, roster, and Agent-file window after the portrait pass and measured every
  generated UI image against its rendered box. Journal art is already appropriately sized at 96px for 40-54px
  display, but all twelve HUD controls were 128px masters repeatedly reduced to 18-38px; the narrow D-pad used a
  particularly awkward 128-to-96 non-integer scale.
- Compared repacking only the four Menu images, repacking HUD and journal together, and packaging the complete HUD
  family on one shared canvas. Chose the complete HUD family because Menu-only would leave window controls at a
  different density, while journal art is not an outlier and should remain untouched.
- Nearest-neighbor sampling and hard alpha produced twelve native 48x48 v2 RGBA controls totaling 29.1 KiB instead
  of 173.3 KiB, an 83.2% reduction. The canvas covers the live signal, Menu, floor modes, D-pad, recenter, roster,
  conversation, provenance, session, back, and close actions without changing any DOM label or focus behavior.
- Runtime and tests now use only v2 HUD paths; the twelve 128px sources were removed. The HUD registry spec locks
  PNG RGBA encoding and the 48x48 canvas so future generated masters must be packaged before shipping.
- Browser-checked the desktop Menu and the Occupancy log at 760x900. All visible HUD images report natural 48x48,
  the D-pad scales exactly to 96x96, action silhouettes remain legible, no image is broken, and horizontal overflow
  remains 0px.
- Focused HUD, Building, roster, Agent-file, cabinet, and Office-page specs passed: 6 files / 16 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5019 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Adaptive filing-cabinet follow-up (2026-08-29):

- Replayed click-to-route from the spawn point into both Workspace filing cabinets. The route, destination lock,
  and arrival all read as game actions, but the result was a fixed 390px administrative panel even for zero or one
  record. Most of the paper field was empty, hiding the map precisely when the interaction should feel in-world.
- Compared decorating only the empty state, shrinking every cabinet to one fixed size, and making the cabinet window
  content-adaptive. Chose the adaptive RPG drawer: zero through four records use measured compact heights, while
  larger inventories retain the existing capped internal scroll. This preserves dense-data behavior without making
  common one-item and empty Workspaces pay for it.
- Used the built-in image generator with the locked Office style master and shipped cabinet identity to create one
  open cream two-drawer cabinet whose upper drawer is visibly empty. The prompt forbade paper, folders, text, room,
  UI, characters, logos, and multiple variants. The transparent master was trimmed, hard-matted, and nearest-neighbor
  packaged as `empty-cabinet-v1.png` on a native 96x88 RGBA canvas.
- Cabinet windows now expose their record count to presentation. Empty cabinets render at 286px with the generated
  open drawer; one or two desktop records render at 246px; three or four render at 320px; larger inventories keep
  the 390px cap. Narrow layouts increase only the multi-row cases because records become single-column.
- Browser-played AutoQuant empty and Semis one-record cabinets at 1280x720 and 760x900. The empty illustration loads
  at exact natural/display 96x88, one-row lists have equal client/scroll height with no fake scrollbar, map context
  remains visible above and below, no image is broken, and both viewports retain 0px horizontal overflow.
- Focused Cabinet, native-furniture, and Building specs passed: 3 files / 10 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5020 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Replay-floor mode follow-up (2026-08-29):

- Played Operations board → Occupancy log → Replay as a complete workflow. The floor data already accepted an
  `asOfSeq`, but replay existed only inside the large journal window. Closing it returned to a map still labelled
  `Live agent floor`, with the live receiver icon and no direct route back to current state; the visible UI could
  therefore claim Live while rendering historical data.
- Compared changing only the title, adding a theatrical full-map rewind transition, and establishing a persistent
  Replay mode. Chose the mode because it corrects state truth, makes the historical floor explorable, and provides
  an immediate exit without slowing every scrub with an animation.
- The replay panel now combines its range with GBA-style previous/next event buttons built from the native back-arrow
  asset. This gives mouse, keyboard, and touch an exact one-sequence control while retaining rapid range scrubbing.
  The previously named `scrubs seq` spec now actually asserts the range change callback as well as both step buttons.
- Historical selection exposes `View replay floor`. The map HUD then uses the generated occupancy-log signal,
  changes its title to `Replay floor · Seq N`, receives a restrained water-color replay treatment, and adds a compact
  `Live` action beside Menu. Returning Live restores the receiver icon, title, polling mode, and removes the action.
- Interaction model: selecting a sequence updates the historical projection while the journal remains open; View
  replay floor closes only the journal and preserves the sequence; Live clears the sequence from either replay
  control surface. The floor remains navigable and its normal object interactions continue to use the projected data.
- Browser-played Live → previous event → View replay floor → Live at 1280x720 and 760x900. Seq 5 appeared in both
  journal and HUD, the correct generated icons swapped, the dialog closed without clearing history, Live restored
  all current-state affordances, no image broke, and both widths retained 0px horizontal overflow.
- Focused ReplayBar, Building, and Office-page specs passed: 3 files / 15 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5021 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Operations perimeter follow-up (2026-08-29):

- Replayed the default Day, Night, desktop, and narrow floors after the Replay work. The generated furniture and
  game windows were coherent, but five identical window modules dominated the upper boundary and made the room
  read like a repeated test tile rather than a deliberately furnished workplace.
- Compared adding loose floor clutter, replacing the floor texture again, and building a modular perimeter fixture.
  Chose the perimeter fixture after reviewing classic GBA lab/office interiors: functional shelving and machines
  belong against the boundary, where they create landmarks without narrowing the player route or competing with
  click-to-walk breadcrumbs.
- Used the built-in image generator with the locked Office style master and shipped wall geometry to author one
  built-in archive-and-network utility module plus a geometry-matched after-hours state. Connected background
  extraction, nearest-neighbor fitting, hard alpha, and 64-color packaging produced two native 204x102 RGBA PNGs.
- Replaced the single repeated window nearest the Operations axis with this generated fixture. It remains decorative
  and collision-free, but visually connects the wall to the Operations board below; every other wall segment keeps
  the exterior-window rhythm and the map remains one continuous floor.
- Browser-checked Day and Night at 1280x720 and Night at 760x900. Both assets loaded at exact natural/display size,
  the utility module remained visible and centered behind Operations, the Night screen retained restrained cyan
  light, no image broke, and horizontal overflow remained 0px. The saved theme was restored to Auto after QA.
- Focused native-furniture and Building specs passed: 2 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 603 files / 5021 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

First-minute diegesis follow-up (2026-08-29):

- Replayed first movement, click-to-walk, employee inspection, roster, and return-to-floor as one new-player loop.
  The windows settled into opaque game surfaces correctly; the persistent break was smaller but always visible:
  Alice carried an HTML `ALICE` badge while moving, and coworker bubbles exposed raw tool identifiers such as
  `workspace_list` and `research`.
- Compared shrinking the player badge, replacing it with a permanent cursor, and removing it. Chose removal because
  Alice already has a unique four-direction sprite, camera follow, accessible map label, and generated spawn compass;
  another marker only adds HUD noise. Employee nameplates remain transient because they identify real selectable NPCs.
- Compared preserving raw tool names, collapsing every tool to generic `Working`, and translating stable tool families
  into in-world actions. Chose localized action families because they retain useful activity distinctions without
  leaking transport vocabulary. Workspace/session, research/search, read/list, write/edit, and shell/run tools now
  resolve to compact verbs; unknown names are humanized rather than showing snake case.
- The exact tool identifier remains on the action bubble tooltip for inspection. Text/error bubbles remain verbatim,
  and Alice keeps `role=img` plus the localized accessible name even though her visible debug badge is gone.
- Browser-played click-to-walk into the Pi coworker at 1280x720 and inspected the settled Agent file, then rechecked
  the same selected state at 760x900. `workspace_list` rendered as `Checking the office…` both overhead and in the
  file, Alice had no visible text node, the route and dialogue still completed, no image broke, and overflow was 0px.
- Focused bubble, Desk, and Building specs passed: 3 files / 14 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 604 files / 5023 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Portrait-viewport follow-up (2026-08-29):

- Rechecked the selected Agent file after the first-minute cleanup. At 760px, the window exposed 212px of a 288px
  profile: `Open session` was clipped by 13px and the drawer was fully hidden. At 390px, the root cause became clear:
  Office was still forced into a 4:3 card only about 252px tall while hundreds of pixels above and below went unused.
- Compared adding a permanent page-down control, hiding profile facts to fit the old card, and making the game
  viewport responsive to portrait screens. Chose the responsive viewport because it fixes the world and every
  temporary Office window instead of adding one more control or discarding real Session data.
- Wide and tablet layouts keep the 4:3 frame. At the existing 760px container breakpoint, Agent files may grow to
  320px or the available map height, whichever is smaller. At phone width (`<=580px`), the Office frame drops its
  forced aspect ratio and consumes the available vertical work area with the same 8px physical-frame margin.
- Responsive behavior remains spatial: the world keeps its fixed 960x672 coordinate system, camera bounds and D-pad
  operate against the taller viewport, and modal windows remain inside the Office frame. No font, target, or sprite
  is reduced; the layout spends previously blank page space instead.
- Browser-measured the one-drawer Agent file before and after at 760x900: 212/288 scroll client/content became
  288/288, with both `Open session` and the drawer fully visible and 220px of map context retained. Desktop 1280x720
  remained a compact 215px window with 207/207 content.
- Browser-played 390x844 after the portrait-frame change. The Office frame grew to 374x748, Agent file content fit
  at 354/354 without scrolling, close/session/drawer actions were visible, and after closing the window the generated
  96px D-pad moved Alice down one tile. Broken images and horizontal overflow remained zero at every width.
- Focused Agent-file and Building specs passed: 2 files / 10 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 604 files / 5023 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Touch-action follow-up (2026-08-29):

- Played the phone-sized Menu, Occupancy log, roster, and both filing-cabinet states after the portrait pass. Their
  bounds, internal scrolling, and dismissal behavior held at 390x844, but the floor exposed only a left-thumb D-pad;
  its nearby prompt still asked touch players to press `Enter` and supplied no controller-native action.
- Compared relabelling the prompt as `Tap`, making the world prompt itself clickable, and adding one right-thumb
  action button. Chose the native A button because a text-only hint does not complete the touch loop, while turning
  the floating prompt into a target would duplicate the object hit area and reintroduce ambiguous click ownership.
- Used the built-in image generator with the shipped D-pad and Office style master as references to author one round,
  raised pixel-art A button. The prompt required a single exact `A`, transparent background, hard pixels, the locked
  charcoal/teal/cream palette, and no controller body, glow, UI, or extra objects. The result is hard-alpha packaged
  as `action-button-v1.png` on a native 72x72 RGBA canvas for its primary touch hit target.
- The phone controller now follows a conventional two-thumb layout: movement remains on the left and A sits on the
  right. A is disabled when no world action is available, adopts the exact nearby target's accessible name when
  active, and invokes the same guarded employee, sign, cabinet, roster, or Operations activation used by Enter.
  Nearby prompts retain `Enter` on desktop and switch their visible keycap to `A` at the touch breakpoint.
- Browser-played the complete 390x844 touch loop: D-pad reset, left-left-down-down-down to the Semis filing cabinet,
  prompt activation, and A-button click. The prompt rendered `FILES A`, the 72px control changed from muted to active,
  and clicking it opened the existing compact one-record cabinet without a second navigation or dialog path. At
  1280x720 both touch controls remained hidden and the page retained 0px horizontal overflow.
- Focused HUD and Building specs passed: 2 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 604 files / 5023 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

Native movement-pad follow-up (2026-08-29):

- Replayed the complete 390x844 touch controller after adding A. The four movement targets occupied the intended
  96x96 area, but their v2 art was a thin 48px command icon enlarged at runtime. Its narrow charcoal-and-teal cross
  merged visually with the generated mail machine directly underneath, while the new A button read immediately.
- Compared adding a CSS controller plate, cropping and enlarging the existing glyph, and generating a native movement
  control. Chose native generation because the plate would return to web decoration around pixel art and cropping
  would retain the equipment-panel silhouette that caused the ambiguity.
- Used the built-in image generator with the v2 pad, companion A button, and locked Office style master as references.
  The prompt required one centered orthographic four-arm D-pad, a bold GBA-era silhouette, cream stepped bevels,
  charcoal molded plastic, restrained teal face accents, genuine transparency, no text/arrows/controller body, and
  enough visual separation for the existing 3x3 DOM hit grid.
- Hard-alpha thresholding, nearest-neighbor fitting, and 64-color packaging produced `move-pad-v3.png` on its exact
  96x96 touch canvas, with an 87x88 visible silhouette and 56 RGBA colors. Runtime no longer scales the touch asset;
  the same source remains legible at the desktop tutorial's 24x24 display. The superseded v2 PNG was removed.
- Browser-played v3 at 390x844: its natural and displayed dimensions both measured 96x96, all four DOM directions
  moved Alice to the Semis cabinet, the `FILES A` prompt appeared, and A opened the cabinet. At 1280x720 the 24px
  movement hint remained crisp, touch controls stayed hidden, broken images and horizontal overflow were both zero.
- Focused HUD and Building specs passed: 2 files / 9 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 604 files / 5023 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

RPG route-target follow-up (2026-08-29):

- Replayed the desktop movement, click-to-route, arrival, Agent-file, and return-to-floor loop. The generated floor
  chevrons communicated the path, but every destination still received an object-sized coral highlight. On desks it
  appeared as a literal 92x70 rectangle, reading like a collision/debug overlay rather than an authored game state.
- Compared restyling the rectangle, reusing the destination floor diamond, and introducing a separate floating target
  cursor. Chose the cursor so route chevrons describe where Alice will walk, one world pointer names what she is
  approaching, and the existing blue nearby treatment remains reserved for actions available now.
- Used the built-in image generator with the route chevron, A button, and locked Office style master as references to
  create one downward GBA-style cursor. The prompt required a cream-gold leading edge, restrained teal inset, charcoal
  outline, hard pixels, one exact downward silhouette, genuine transparency, and no box, floor tile, path, text,
  character, object, detached shadow, halo, or additional arrows.
- Hard-alpha thresholding, nearest-neighbor fitting, and 48-color packaging produced
  `route-target-pointer-v1.png` on a native 32x32 RGBA canvas. A shared `OfficeRouteTargetPointer` now owns its DOM,
  reduced-motion behavior, depth, and kind-specific anchors; the sign, desk, cabinet, roster, and Operations route
  selectors no longer draw alert backgrounds, inset borders, glow boxes, or target pulses. Desk hover likewise uses
  only the existing brightness and one-pixel lift instead of leaving a pale rectangular field under the cursor.
- Browser-played distant employee, Workspace sign, AutoQuant cabinet, and Operations routes at 1280x720. The cursor
  landed over each physical object, the first-row employee anchor was adjusted below the sign text, and arrival
  removed both pointer and trail before opening the correct Agent file. At 390x844 the rightmost cabinet pointer was
  nudged 8px inward to retain a 3px frame margin; touch movement cancelled pointer and trail together. Broken images
  and horizontal overflow remained zero.
- Focused pointer, route-trail, furniture, and Building specs passed: 4 files / 14 tests.
- `npx tsc --noEmit` and `cd ui && npx tsc -b` passed
- `pnpm test` passed: 605 files / 5026 tests, 1 file / 9 tests skipped
- `pnpm --filter open-alice-ui build` passed

HUD status-semantics follow-up (2026-08-29):

- The three-pod Demo made the HUD's terse `3 ACTIVE · 6 AGENTS · 3/3 GROUPS` easy to misread: the active count was
  correctly derived from non-idle employees, but the unit appeared only on the adjacent total and the repeated
  threes looked like the empty AutoQuant and Prediction pods were being counted as active.
- Compared spelling out `ACTIVE AGENTS` while retaining three metrics, exposing every mood count, and combining the
  employee counts into one ratio. Chose `3/6 AGENTS ACTIVE · 3/3 GROUPS`: it names the numerator and denominator,
  removes one repeated HUD item, and remains self-explanatory when the narrow layout keeps only its first metric.
- The ratio continues to use the existing employee mood projection, keeps the green live indicator when any employee
  is non-idle, and adds localized copy plus a zero-occupancy regression assertion.
- Browser-confirmed `3/6 AGENTS ACTIVE · 3/3 GROUPS` at desktop and the standalone `3/6 AGENTS ACTIVE` metric at
  390x844. Both stayed inside the HUD, and the narrow page retained zero horizontal overflow.

Workspace-landmark semantics follow-up (2026-08-29):

- Real play exposed that every Workspace sign and its filing cabinet used the same drawer icon, `FILES` prompt, and
  cabinet window. Two visually distinct landmarks therefore offered one duplicated action, while the map lacked a
  direct Workspace entrance.
- Compared making the sign decorative, routing it to the roster, and using it as the Workspace entrance. Chose the
  entrance model because a sign naturally names the destination, remains useful for empty groups, and lets the
  cabinet retain exclusive ownership of filed records. The sign now uses the session-portal icon and `ENTER`; the
  cabinet keeps the drawer icon and `FILES`.
- The sign route walks Alice to the same physical interaction range before opening the Workspace with Files collapsed.
  Prediction now supplies the explicit `prediction` source, while Chat and AutoQuant retain their existing shells.
  The cabinet still opens the in-world record window and restores focus to the physical cabinet on close.
- Browser-played the Auto Prediction sign from the desktop floor through its route pointer into
  `/prediction/workspaces/demo-ws-auto-prediction`, then replayed the Prediction cabinet and confirmed it remained
  on `/office`. At 390x844 the Chat sign entered `/workspaces/demo-chat-ws`; its cabinet window measured 344x246 at
  x=23..367, stayed inside the 390px viewport, and preserved zero page-level horizontal overflow.
- Focused Building, OfficePage, and interaction-target specs passed: 3 files / 19 tests.
- Root/UI TypeScript, the 606-file Vitest run (5,028 passing; one file and nine tests skipped), and the UI production
  build passed after the landmark responsibility split.

Workspace-entry transition follow-up (2026-08-29):

- Replayed the new sign-owned Workspace entrance and found that Alice arrived at the physical sign, then the entire
  Office vanished in a hard route cut. The destination was correct, but the last step still felt like ordinary web
  navigation rather than leaving one room in a top-down game.
- Compared retaining the hard cut, adding a confirmation dialog, and using a short map-only departure curtain. Chose
  the curtain because the sign and `ENTER` prompt already express intent; another confirmation would add friction,
  while a 260ms transition gives the action a visible consequence without delaying routine movement.
- The floor now closes from its horizontal center in stepped dark-teal pixels while the persistent HUD remains in
  place. A centered panel reuses the existing session-portal sprite and names the Workspace being entered. Movement,
  pointer routing, keyboard interaction, and touch A are locked during departure so repeated input cannot dispatch a
  second route. Callback cleanup also restores the floor when an embedding handles entry without navigating.
- `prefers-reduced-motion: reduce` bypasses the curtain and enters immediately. The transition is scoped to the map
  frame, uses `aria-busy` plus a concise live status, and keeps the destination name localized in English, Simplified
  and Traditional Chinese, and Japanese.
- Browser-played Auto Prediction entry at 1280x720 and captured the visible mid-transition state before reaching
  `/prediction/workspaces/demo-ws-auto-prediction`. At 390x844 the curtain stayed inside the physical Office frame
  (368px wide at x=11) with no page-level overflow. CDP-emulated reduced motion navigated directly with zero departure
  overlays rendered.
- Focused Building and OfficePage specs passed: 2 files / 14 tests.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, and the UI production build passed. The 606-file Vitest run passed with
  5,028 tests (one file and nine tests skipped); its first pass also caught and removed a literal shadow color so the
  curtain continues to obey the shared semantic-color contract.

World-object hit ownership follow-up (2026-08-29):

- Replayed Menu, Operations, Agent file, roster, and their return-to-floor paths at desktop and phone widths. A direct
  click on the visible Semis personnel board consistently opened Occupancy log instead of Team roster. Live hit
  inspection found that the 176x132 Operations console button physically covered the roster's 42x58 rectangle, so
  the higher-depth console owned the pointer even though the player aimed at the board.
- Compared lowering the console's depth, shrinking its rectangular hitbox, and moving personnel boards into a clear
  aisle. Chose the aisle because depth changes would corrupt scene ordering and a smaller hitbox would make an
  important object harder to use. The chosen placement also makes the standing board read as deliberate furniture
  instead of a prop tucked under the central console.
- Personnel boards now use the outer edge of their Workspace pod: left-half pods place the board on the left and
  right-half or centered pods place it on the right. One shared `officeRosterCenter` owns the rendered position,
  route target, collision rectangle, and side metadata, eliminating the previous 49px mismatch between the visible
  asset and its interaction geometry.
- Browser-played the Semis board at 1280x720. Its center changed from an Operations-owned hit to a roster-owned hit;
  clicking it set only the roster route state and opened `Team roster · Semis and supply chain`. The Operations
  console center remained self-owned and still opened Occupancy log.
- At 390x844, eleven real D-pad moves brought Alice and the camera into the left aisle. The board remained fully
  visible at x=68..110, a coordinate-level click opened Team roster rather than the log, closing restored focus to
  `office-roster-demo-chat-ws`, and page-level horizontal overflow remained zero.
- Focused interaction-target, collision, and Building specs passed: 3 files / 22 tests. The new geometry assertion
  requires two-column boards to sit beyond the Operations console's horizontal footprint.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, and the UI production build passed. The 606-file Vitest run passed with
  5,029 tests (one file and nine tests skipped).

Player-preserving camera follow-up (2026-08-29):

- Continued the world-object ownership audit across every visible desktop target, then replayed the phone controller.
  The lower-right compass was labelled `Reset map view`, but it also reset Alice's world position, facing, walking
  state, and active route. Three left steps moved Alice from x=480 to x=408; pressing the view control silently
  teleported her back to the spawn compass at x=480.
- Compared renaming the control to `Return to spawn`, retaining the combined player-and-camera reset, and making it a
  true camera recenter. Chose camera recenter because a permanent one-tap teleport needs explicit game-world framing
  and confirmation, while the compass already occupies the conventional “find my character” control position.
- The compass now computes a clamped camera centered on `aliceRef.current`. It does not mutate Alice's position,
  direction, walking cycle, nearby interaction, or click-to-walk route. The old `resetMap` locale contract was
  replaced directly with `Center map on Alice` copy in English, Simplified and Traditional Chinese, and Japanese.
- Browser-played the 390x844 controller: after three real D-pad moves Alice remained at x=408 while the compass moved
  the map transform from -296px to -224px and retained focus. At 1280x720, pressing the compass during the Auto
  Prediction route still completed the route, departure curtain, and navigation to the Prediction Workspace.
- The Building integration spec now asserts that recentering during a route preserves both Alice's exact coordinates
  and the route trail, and it no longer uses the old teleport side effect as setup for unrelated interaction tests.
  Focused Building specs passed: 1 file / 9 tests.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, and the UI production build passed. The 606-file Vitest run passed with
  5,029 tests (one file and nine tests skipped).

Directional D-pad feedback follow-up (2026-08-29):

- Replayed repeated phone movement after the camera fix. The native 96px D-pad still exposed its implementation when
  a direction was hovered, pressed, or keyboard-focused: the transparent 32px hit cell became a translucent cyan
  square with a cream rectangular inset, visibly cutting the generated controller into a web-style 3x3 grid.
- Compared depressing the complete D-pad, generating four state-specific controller images, and lighting the inset
  on the selected direction arm. Chose the arm highlight because it communicates the exact direction like a physical
  rocker, reuses the authored v3 geometry, and avoids four redundant assets whose alignment could drift.
- The four hit targets remain 32px and semantically unchanged, but no longer paint backgrounds, borders, or shadows.
  Hard-edged pseudo-elements sit directly over the asset's existing slots: 8x16 for up/down and 16x8 for left/right,
  with a cream face and two-pixel water inset. Focus-visible and active states illuminate the arm; hover is limited to
  fine pointers so real touch input does not leave a sticky post-tap state.
- Browser-checked all four directions at 390x844. Every button retained a transparent computed background and no box
  shadow while only its correctly oriented slot reached full opacity. Programmatic keyboard focus visibly selected
  the right arm without a rectangular DOM outline; moving the pointer away restored the down arm to zero opacity.
  The 96x96 control stayed at x=21..117 and y=727..823, broken images remained zero, and horizontal overflow was zero.
- Focused Building specs passed: 1 file / 9 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest
  run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Alice ground-contact follow-up (2026-08-29):

- Replayed Alice away from the spawn compass at desktop and phone widths. Generated furniture, coworkers, service
  machines, and world landmarks all carried contact shadows, but Alice's 48px sprite ended directly on the floor.
  Once separated from the compass, she read like a flat overlay rather than a character standing in the room.
- Compared movement-only footstep dust, baking a shadow into every authored pose, and giving the shared Alice wrapper
  one ground-contact layer. Chose the wrapper because it grounds idle and moving poses alike, follows every direction
  and collision bump automatically, and does not duplicate pixels across the sixteen pose/frame slots.
- Alice now owns a static 22x6 stepped shadow built from a 22x2 horizontal bar and a 14x6 center bar. Both use a
  42-percent theme-ink mix, remain behind the sprite through explicit local depth, and contain no blur, radius,
  continuous animation, semantic DOM, or pointer surface.
- Browser-played Alice at 390x844 while idle, in the right-facing walk frame, and during a blocked upward movement.
  The shadow kept the same baseline and dimensions in all three states while the player sprite and collision bump
  remained above it; horizontal overflow stayed zero. At 1280x720 the shadow remained subtle at native scale,
  broken images were zero, and emulated reduced motion reported the shadow present with `animation: none`.
- Focused Building and Alice-sprite specs passed: 2 files / 11 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the
  606-file Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Touch action feedback follow-up (2026-08-29):

- Replayed the phone controls after the D-pad pass and keyboard-focused the generated A button. Its circular pixel
  art was surrounded by a 72x72 cream browser-style square, and the shared hover/focus/active rule also depressed the
  control when it merely had keyboard focus. Both details made the controller feel like an image inside a web button.
- Compared a smooth circular outline, separate generated focus/pressed assets, and a hard alpha-contour around the
  existing sprite. Chose the alpha-contour because it follows the authored silhouette without anti-aliased geometry,
  duplicated image states, or a theme-specific baked highlight.
- Keyboard focus now draws a two-pixel cream contour with four zero-blur drop shadows while leaving the button at its
  resting height. Actual press alone moves it down two pixels and scales it to 96 percent; fine-pointer hover only
  brightens the asset, so touch input cannot leave a sticky hover state. Disabled styling, the 72x72 hit target, and
  the existing accessible labels remain unchanged. Reduced-motion mode removes the transform transition.
- Browser-played the 390x844 controller from the disabled spawn state through three upward moves. The button changed
  from `No nearby action` at 42-percent opacity to `Check live operations`; activating it opened Occupancy log. The
  focused state used the sprite-shaped contour with no DOM outline, page overflow and broken images remained zero,
  and the control returned to `display: none` at 1280x720.
- Focused Building specs passed: 1 file / 9 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest
  run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Modal scene hierarchy follow-up (2026-08-29):

- Played Occupancy log, Agent file, Team roster, and Filing cabinet on the real floor. Every window declared itself
  modal and correctly made the map inert, but only Occupancy log visually paused the scene. Agent file in particular
  competed with full-brightness coworkers, bubbles, signs, and furniture behind its large cream dialogue panel.
- Compared preserving the bright map, blurring or desaturating the scene, and sharing the existing 28-percent hard
  ink curtain. Chose the shared curtain because it already belongs to the Office journal vocabulary, preserves the
  limited-layer look of a 16-bit game, and avoids modern glass effects. This was an autonomous design choice for the
  ongoing Office iteration, not a claim of maintainer approval.
- `OfficePage` now derives one modal-open state for scene accessibility, movement suspension, and presentation. A
  single non-interactive curtain renders for log, Agent file, roster, or cabinet; switching between roster and Agent
  file cannot stack curtains. Escape and generated close controls remain the only dismissal paths, preserving the
  deliberate game-window interaction and existing focus return targets.
- Browser-played all four window families. The curtain stayed inside the physical floor below its HUD: 842x578 at
  1280x720 and 368x690 at 390x844. Agent file, roster, and cabinet each reported one curtain and an inert scene with
  zero page overflow. Closing the cabinet removed the curtain, restored the live floor, and returned focus to
  `office-cabinet-demo-chat-ws`.
- Focused OfficePage specs passed: 1 file / 5 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Coworker map-label follow-up (2026-08-29):

- Clicked an occupied workstation and inspected the route state before Alice arrived. The map nameplate had 86px of
  usable width but contained the 290px Session title `What's moving in semiconductors today?`, so the only visible
  route feedback was the meaningless fragment `Wha… mov…`. The same label appeared on hover and proximity.
- Compared widening the plate across adjacent desks, scrolling the title like a marquee, and using the stable Session
  short name as the map identity. Chose the short name because an RPG-world nameplate should answer “which character”
  immediately; the long assignment already belongs to the accessible object label, activity bubble, and Agent file.
- Occupied desks now render their required `name` as the visible world label while preserving the descriptive
  `officeCoworkerLabel` for the button, sprite, and detailed window. The pod-local plate uppercases the short name in
  CSS, so `p1`, `x1`, `c1`, and `o1` read as compact `P1`, `X1`, `C1`, and `O1` without mutating semantic text.
- Browser-played the first desk from route selection through Agent file at 1280x720 and 390x844. Its plate changed
  from 290px scroll content clipped inside 86px to a fully fitting 29px `p1` label; the full task title remained in
  the accessible desk label and Agent file. All four occupied demo desks exposed distinct short names, broken layout
  did not appear, and page-level overflow stayed zero at both widths.
- Focused OfficeDesk specs passed: 1 file / 4 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

In-world floor terminal follow-up (2026-08-29):

- Audited the remaining high-salience floor props and found the generated 52x78 glowing terminal on the right wall
  was a dead object: a `div` with no name, no role, and `pointer-events: none`. Its screen, pedestal, night glow, and
  shared HUD icon language promised a stronger interaction than several objects that already supported pathfinding.
- Compared leaving it decorative, duplicating the central Operations log action, and making it the world entrance to
  the existing Floor view menu. Chose the Floor terminal because it fulfils the prop's visual promise without adding
  a parallel workflow: Live map, All groups, and Occupancy log remain owned by the one existing menu.
- The terminal is now a named world button and interaction target with shared collision-aware pathfinding, route
  trail, generated destination pointer, nearby facing-cone selection, Enter/Space, and touch A support. Hover,
  proximity, and keyboard focus lift and light the generated bitmap without a rectangular DOM outline. Its stable
  map center and route-pointer lift live with the other landmark geometry instead of being inferred from the DOM.
- Opening from the terminal records a world-menu origin, focuses `Live map` after the controlled popup mounts, and
  returns focus to the terminal on Escape. HUD-origin menus still return to the HUD trigger, while choosing Occupancy
  log leaves focus ownership to its modal window. This preserves the existing menu as the single UI primitive while
  giving the in-world route a complete keyboard lifecycle.
- Browser-played the 1280x720 route: after 260ms Alice had advanced from x=480 to x=624 with nine trail steps left,
  the pointer identified `floor-terminal`, and arrival ended at x=816/y=192 facing right. The menu focused Live map;
  Escape restored `office-floor-terminal`. At 390x844 the nearby prompt read `Menu / Enter / A`, touch A opened the
  same focused menu, the terminal retained its image-only focus glow, and page overflow remained zero.
- The first full-suite pass caught the menu's delayed focus restoration stealing focus from a newly opened Occupancy
  log. Menu restoration now aborts whenever an Office modal already owns focus; the focused OfficePage coverage and
  the subsequent full run confirm that Escape closes the log again without weakening terminal focus return.
- Focused Office interaction specs passed: 4 files / 23 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the
  606-file Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Floor-terminal return provenance follow-up (2026-08-29):

- Followed every Floor terminal menu exit instead of stopping at menu-open success. Choosing Occupancy log correctly
  focused its Close control, but closing the log always returned to the top HUD Menu. Alice was still beside the
  terminal and the terminal prompt was active, so keyboard focus and the visible game world disagreed.
- Compared keeping one generic menu return, reopening Floor view after closing the log, and preserving the exact log
  origin. Chose provenance: Operations, HUD Menu, and Floor terminal are three real entry points and should each own
  their return without adding another intermediate screen.
- The shared Office log origin now includes `floor-terminal`. Floor terminal menu actions pass that origin through
  `OfficeBuilding`; `OfficePage` restores the generated terminal after the modal closes, while Operations still
  restores its board and HUD-origin logs still restore the HUD trigger.
- Combined Building/Page tests exposed a focus race in which Base UI briefly focused the HUD trigger while opening a
  controlled terminal menu, overwriting the terminal origin. HUD provenance is now recorded only from actual pointer,
  key, or click input on the HUD trigger; programmatic transition focus cannot mutate it. Office modal ownership also
  continues to suppress any delayed menu restoration while the log is open.
- Browser-played the three branches at 1280x720. Terminal -> log focused Close and returned to
  `office-floor-terminal`; HUD -> log returned to `.oa-office-pause-trigger`; the terminal remained nearby. At
  390x844, touch A -> log -> Close also returned to the terminal, restored the ready A action, and kept zero overflow.
- Focused Building/Page specs passed: 2 files / 14 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Pixel replay scrubber follow-up (2026-08-29):

- Opened Occupancy log and expanded Replay on the real frontend. The disclosure and transport buttons already used
  the Office game-window language, but the 569x20 timeline still reported `appearance: auto`: a browser-native cyan
  pill track with a smooth circular thumb surrounded by hard pixel borders and generated controls.
- Compared one button per journal event, a generated fixed-width slider image, and restyling the native range. Chose
  the native range because it retains drag, arrow, Home/End, and screen-reader value behavior while allowing the one
  mismatched visual primitive to join the 16-bit vocabulary. Event-button layouts would not scale and bitmap tracks
  would couple authored pixels to viewport width and theme.
- `OfficeReplayBar` now derives an exact progress percentage from retained `firstSeq`, current value, and `lastSeq`.
  The range exposes that percentage as a CSS custom property while keeping its numeric min/max/value and ARIA text.
  WebKit and Firefox tracks use a zero-radius three-pixel ink frame, hard water/floor progress split, stepped inset
  shade, and square cream mechanical thumb. Keyboard focus adds a two-pixel water contour without a DOM rectangle.
- Browser-played Live and Seq 5 at 1280x720. The range changed from `appearance: auto` at 568.9x20 to `none` at
  568.9x24; Live rendered 100-percent water progress, Previous entered Replay floor and moved both semantic value and
  hard split to 80 percent. At 390x844 the same Seq 5 track fit at 313.4x24 inside the 352px log window, with zero
  page overflow.
- Focused ReplayBar specs passed: 1 file / 3 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest
  run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Handheld replay transport follow-up (2026-08-29):

- Replayed the expanded Occupancy log at 390x844 in both Live and Seq 5. The historical state forced Previous,
  the two-line `REPLAY / Seq 5` label, Next, `View replay floor`, and Live into one row; the floor action wrapped to
  three lines and the status copy collided visually with the transport buttons. Live repeated its state in both the
  central label and a disabled action.
- Compared reducing the floor action to an unlabeled icon, merging floor navigation into the range, and using a
  handheld-console layout. Chose the console layout because time selection and entering the replay map remain two
  distinct actions: Previous / current state / Next form one stable control row, the range owns the second row, and
  historical actions share a third row only when they can do something.
- The status label is now a bordered one-line display rather than another Replay heading. Live uses the moss display
  and animated signal dot; historical values use the floor display and exact Seq text. The disabled duplicate Live
  action and its dead styles were removed. At the 480px container breakpoint, the transport spans the window and the
  two historical actions become equal-width controls below the slider.
- Browser-played Seq 5 and Live at 390x844, then repeated both at 1280x720. The mobile historical controls no longer
  overlap or wrap; Live removes the empty action row and produces an 86px-high panel with a 304x36 transport. The
  desktop Live label expands to 492.9x36, while desktop history keeps a 296.6px transport beside 264.4px of actions.
  Both viewports kept zero page overflow and the journal remained independently scrollable.
- Focused ReplayBar specs passed: 1 file / 3 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest
  run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Mobile roster status follow-up (2026-08-29):

- Played the complete Team roster -> Agent file -> Team roster loop at 1280x720 and 390x844. Return provenance was
  already correct: Back restored focus to the exact `demo-resume-chat` teammate. The apparent data loss on return was
  instead a responsive rule that hid every `.oa-office-roster__status` below 760px, turning the party-status menu into
  a plain contact list precisely where the touch UI needs fast state recognition.
- Compared hiding portraits, encoding mood only through card color, and reflowing mobile cards into a compact party
  layout. Chose reflow: character art, identity, and explicit working/idle/failed text are all primary RPG roster
  information. Color-only state would weaken accessibility, while dropping portraits would undo the generated
  coworker material work.
- At the 760px container breakpoint, roster cards now use a portrait spanning two rows, identity on row one, a status
  badge on row two, and the action arrow spanning both rows. Status is no longer suppressed. Across sizes, the badge
  now uses a bordered mono label and square shadowed pixel lamp instead of a floating modern circular dot.
- Browser verification found six of six statuses visible at both widths with zero page overflow. Desktop cards remain
  340x72 with an 83x19 working badge. Mobile cards are 306x85; the first 83x19 badge sits below `pi · p1` without
  stealing the title line. Entering the first Agent file and returning restored its focus and kept all six statuses
  visible in the independently scrolling 344x380 roster window.
- Focused RosterWindow specs passed: 1 file / 1 test. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest
  run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Cabinet record exit follow-up (2026-08-29):

- Played Filing cabinet -> `ai-chain-2026-06-02.md` at 1280x720. The record card ended in the same cyan `▶` used by
  in-window roster disclosure, but activated a different class of action: it immediately left Office for the
  Workspace file viewer. The card's visual promise and navigation outcome disagreed even though the destination URL
  and file rendering were correct.
- Compared copying the file reader into Office, adding a confirmation window, and marking the record itself as a
  cross-scene exit. Chose the explicit exit because Office should not duplicate Workspace file ownership or add a
  redundant click. The existing bottom `Enter Workspace files` control already established the generated session
  portal as this window's doorway symbol.
- Record buttons now use a localized accessible name that states `Open <record> in Workspace`. Their generic arrow is
  replaced by a divided destination plaque containing the same generated session-portal bitmap and localized Open
  action. The first `Workspace` plaque copy was rejected during browser QA because the global readable 14px minimum
  truncated it; keeping that font size and shortening the visible verb produced a complete label while the semantic
  name retains the exact destination.
- Browser-played the updated exit at 1280x720 and 390x844. Desktop produced a 318.5x66 card with a complete 36px Open
  label; mobile produced a 309x66 card and the same complete label inside the 344x246 cabinet. Both layouts retained
  zero page overflow. Activating the explicitly named record still reached the encoded Workspace file URL, proving
  that only the Office affordance changed.
- Focused CabinetWindow specs passed: 1 file / 2 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Effective floor-view menu follow-up (2026-08-29):

- Opened Floor view on the real three-pod demo and switched Live map -> All groups. Both modes rendered the same
  Chat, AutoQuant, and Prediction pods, the same stats, and the same centered camera because each harness has only
  its configured minimum group. The radio selection changed but the game world did not, leaving a prominent fake
  choice in the primary map menu.
- Compared adding a cosmetic camera transition, always disabling All groups, and making the option conditional on a
  real hidden-group delta. Chose the conditional model: a game menu action should promise an observable state change,
  not manufacture feedback for equivalent data. `showAll` is now effective only while at least one default-filtered
  group exists, so changing live data cannot leave the menu in an impossible selected mode.
- Floor view omits All groups when `building.offices` and `defaultGroups` have equal length. When sleeping groups are
  hidden, the option appears with the generated group-grid bitmap plus a localized count such as `1 sleeping group`.
  The radio item keeps the concise All groups accessible name and associates the count as its description. English,
  Simplified Chinese, Traditional Chinese, and Japanese plural keys ship together.
- Browser-played the no-delta demo at 1280x720 and 390x844. Both menus now contain one radio mode plus Occupancy log,
  measure 224x148, and keep zero page overflow. The existing mixed-awake/sleeping component scenario proves the
  complementary path: one hidden quant group exposes All groups, renders the count, and selecting it adds the hidden
  pod to the continuous map.
- Focused OfficeBuilding specs passed: 1 file / 9 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Agent-file record exit follow-up (2026-08-29):

- Played the first desk's Agent file at 1280x720. Its archived record was still presented as a plain drawer icon and
  filename even though activating it, like a cabinet record, immediately leaves Office for the Workspace file viewer.
  This preserved the cross-scene ambiguity after the cabinet itself had adopted an explicit doorway language.
- Compared embedding a viewer, adding confirmation, and reusing the cabinet's generated portal exit. Chose the shared
  exit language because it keeps Workspace ownership intact, adds no redundant step, and lets every Office record
  promise the same navigation outcome. The compact Agent-file rail uses a horizontal variant so the filename remains
  primary inside its 206px desktop width.
- Agent-file records now end in a divided destination plaque with the generated session portal and localized Open
  action. Their accessible name explicitly says `Open <record> in Workspace`. The same generic translation keys now
  serve cabinet and Agent-file records instead of leaking cabinet-specific naming into a shared interaction pattern.
- Browser-played the new exit at 1280x720 and 390x844. Desktop preserved the full filename beside the portal plaque;
  mobile deliberately ellipsized the long filename while keeping the portal and Open action complete, with no page
  overflow. Activating the record reached the encoded `rotation/ai-chain-2026-06-02.md` Workspace route.
- Focused InspectRail and CabinetWindow specs passed: 2 files / 4 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`,
  the 606-file Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Occupancy-log menu cursor follow-up (2026-08-29):

- Played the Occupancy log at 1280x720 and found every event row ending in the same Unicode `▶`. The glyph was the
  last non-material control inside the otherwise generated log UI, and showing it on every row made a single-choice
  detail list read like six navigation links instead of an RPG selection menu.
- Compared keeping a cursor on every row, revealing it only on hover, and using one persistent current-item cursor
  with a lighter hover/focus preview. Chose the current-item model because it preserves keyboard discovery while
  keeping the selected event and right-hand detail causally obvious.
- Generated a transparent 16-bit mechanical right-pointing cursor with dark ink, cream highlight, and cyan interior,
  then alpha-cropped and nearest-neighbor packaged it as `journal-cursor-v1.png` on a native 32x32 canvas. The runtime
  index replaces the text glyph with the bitmap, reserves a stable 22px column, and uses a two-step three-pixel idle
  nudge only for the selected row. Reduced-motion removes both the nudge and cursor transition.
- Browser-played selection from Seq 6 to Seq 5 at 1280x720; the generated cursor followed the pressed row and its
  detail. At 390x844, the cursor remained a complete 22x22 control inside a 301x58 event row, the 328px journal list
  retained spare horizontal space, and the page stayed exactly 390px wide without overflow.
- Focused OfficeRuntimeSection and HUD-asset specs passed: 2 files / 4 tests. The asset contract now records the
  cursor's intentional 32x32 native size alongside 48px command icons, the 72px action button, and 96px move pad.
  `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file Vitest run (5,029 passing; one file and nine tests skipped),
  and the UI production build all passed.

Roster-card hierarchy follow-up (2026-08-29):

- Played Team roster at 1280x720. Its two-column party overview was useful, but each status badge and Unicode `▶`
  occupied the title row: the first 284px session title received only 151px and rendered as `What's moving in s…`,
  while even the 157px NVDA title was clipped. The Agent-file entry hid its primary identity on a wide desktop.
- Compared changing the roster to one column, keeping one-line truncation with a tooltip, and reflowing each two-column
  card. Chose reflow because six teammates should remain scannable as a party while their session identity remains
  readable without hover. Titles now span the metadata and status columns with a two-line cap; agent/seat and explicit
  mood share the second row beneath it.
- Replaced the final roster Unicode arrow with the generated journal cursor. It remains at 42-percent opacity as a
  touch-discoverable Agent-file affordance, then becomes fully opaque and shifts three pixels on hover or keyboard
  focus. Reduced-motion keeps the state change but removes its transition.
- Browser-played the six-person roster at 1280x720: the first title received 234px and rendered completely in two
  lines, the second rendered completely in one, all three rows fit the 334px body with no scroll, and cards measured
  82px high. At 390x844, cards measured 306x82 with 200px titles, the roster scrolled independently, and the page
  remained exactly 390px wide. Agent file -> Back restored focus to the original teammate, raising its cursor from
  0.42 to 1 opacity and applying the interaction step.
- Focused RosterWindow specs passed: 1 file / 1 test. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Single-view pause-menu follow-up (2026-08-29):

- Played Floor terminal on the real three-pod demo. After the earlier effective-view cleanup, Floor view contained
  one checked `Live map ◆` radio and no alternative. The row remained focusable and clickable even though activating
  it could not change camera, groups, or floor state: a status was still masquerading as a game command.
- Compared hiding Floor view entirely, keeping a disabled radio, and converting the lone mode into a current-state
  plate. Chose the plate because the pause menu should still orient the player, while only observable transitions
  belong in its command sequence. When a sleeping group creates a real delta, the existing Live map / All groups
  radio group still appears.
- The no-delta menu now renders a non-focusable generated-compass plate with Live map and a localized CURRENT badge.
  Floor terminal focuses the first actual menu item, Occupancy log, instead of querying a radio that may not exist.
  True radio selections replace the CSS Unicode diamond with the generated journal cursor, so both branches retain
  one material selection language.
- Browser-played Floor terminal -> Occupancy log -> Close at 1280x720. The single-view menu exposed zero radios,
  focused Occupancy log immediately, contained no `◆`, and restored focus to `office-floor-terminal` after closing
  the log. At 390x844, the current plate measured 208x44 inside the 224x148 menu, its right edge stayed at 379px,
  and the page remained exactly 390px wide. Component coverage verifies the complementary two-radio path.
- Focused OfficeBuilding specs passed: 1 file / 9 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 606-file
  Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Occupancy event-stat follow-up (2026-08-29):

- Played the empty Auto Quant cabinet first. Its generated cabinet illustration, explicit zero-record copy, and single
  portal exit already formed a coherent game empty state, so no change was made merely to create activity. Continuing
  through Operations board exposed the real gap: event detail rendered `headless · — · done · 2 text · 1 tools` as
  four unlabeled debug chips, including a meaningless missing-value placeholder and incorrect singular grammar.
- Compared tooltips, prefixed flat chips, and labeled pixel stat cartridges. Chose cartridges because event metadata
  should scan like an RPG status panel on mouse, keyboard, and touch. Each field now has a dark uppercase category
  cap and a cream value cell; cartridges wrap as units instead of breaking label/value ownership.
- Surface, cause, status, output, reason, and error code are now typed metadata entries. Missing values are omitted
  rather than rendered as `—`. Text blocks, tool calls, and failures use localized plural-aware strings in English,
  Simplified Chinese, Traditional Chinese, and Japanese; the demo now correctly reads `2 text blocks · 1 tool call`.
- Browser-played the selected stopped event at 1280x720: Surface, Status, and Output formed three complete cartridges
  across an 83.98px metadata area with no placeholder. At 390x844, the detail card measured 328x315.8, the 253x84
  cartridge area kept the complete output value, the 628px log body required no additional scroll, and the page stayed
  exactly 390px wide.
- Focused OfficeRuntimeSection specs passed: 1 file / 3 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the
  606-file Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Replay-floor interaction boundary follow-up (2026-08-29):

- Played Seq 5 on the real three-pod replay floor and found every real-time map entry still enabled: Workspace signs,
  occupied desks, cabinets, Team roster, Floor terminal, and Operations board. A historical reconstruction could
  therefore leave its own timestamp and open live Workspace or Agent-file state without explaining the time jump.
- Compared blocking only cross-scene buttons, locking the whole replay map, and treating replay as an explorable
  museum floor. Chose the museum model: Alice can still walk, Operations board remains the review control, and Live
  remains the explicit return to current time; every object whose content is not historical is frozen. This preserves
  the game-world benefit of replay without implying that live records belong to Seq 5.
- Replay now removes non-operations objects from proximity targeting and guards programmatic route requests as well
  as disabling their buttons. Workspace signs receive a localized SNAPSHOT stamp; signs, desks, cabinets, roster,
  and Floor terminal share a localized historical-snapshot explanation. The map itself has a replay-specific
  accessible label in English, Simplified Chinese, Traditional Chinese, and Japanese.
- Browser-played replay at 1280x720: all 20 historical object buttons were disabled, Operations board still opened
  Occupancy log, three Workspace signs showed complete SNAPSHOT stamps, and the page had zero overflow. At 390x844,
  the same 20 controls stayed frozen with zero overflow. The first responsive pass exposed a clipped Live button, so
  replay now omits redundant HUD stats below 760px and keeps both Live and Menu fully visible. Returning Live restored
  the normal map label and Workspace sign interaction and removed every snapshot stamp.
- Focused OfficeBuilding and OfficeDesk specs passed: 2 files / 13 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`,
  the 606-file Vitest run (5,029 passing; one file and nine tests skipped), and the UI production build all passed.

Phone live-HUD hierarchy follow-up (2026-08-29):

- Continued playing from an Agent file back onto the 390px live floor and found the Menu squeezed past the HUD's
  right edge. Only its generated terminal icon remained visible; the Menu label and most of its hit area were clipped
  because floor identity, live Agent status, and actions still occupied three desktop columns.
- Compared reducing Menu to an unexplained icon, removing the live status, and reflowing the phone HUD. Chose a
  two-row game status bar below 520px: floor identity and the complete Menu share the first row, while the live Agent
  ratio remains visible on a ruled second row. This retains both orientation and current-state information instead of
  solving responsive pressure by deleting one of them.
- Browser-played the updated HUD at 390x844. The 66.7px Live-floor Menu button became a complete 78.7px control ending
  eight pixels inside the HUD; its 224x148 Floor view menu opened fully on-screen, status occupied the complete 352px
  second row, and the page kept zero overflow. At a 523px Office container the existing single-row HUD still fit, and
  the 1280px desktop HUD retained its original 52px height and three-column hierarchy.
- A focused CSS contract now protects the phone grid areas and full-width status row. The contract plus existing
  OfficeBuilding coverage passed: 2 files / 11 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 607-file Vitest
  run (5,031 passing; one file and nine tests skipped), and the UI production build all passed.

Coworker interaction-dialogue follow-up (2026-08-29):

- Played the route from an Agent file back to the desk cluster and caught a deterministic information-layer conflict:
  an employee's live work bubble appears whenever that desk is nearby, exactly when the Talk prompt appears. On both
  desktop and phone the two independently positioned pixel plates competed around Alice and obscured one another.
- Compared moving the desk bubble farther away, hiding it near Alice, and merging status with the interaction prompt.
  Chose one RPG dialogue plate: Talk and Enter/A remain the primary row, while `Researching…` or the current live work
  copy becomes a quieter second row. The action retains a complete combined accessible name, so visual consolidation
  does not remove the employee state from keyboard or screen-reader play.
- Removed the standalone desk bubble and its obsolete station layer/CSS rather than retaining a compatibility path.
  Waiting and failed generated emotes remain on the coworker sprite; detailed live copy now belongs to the shared
  interaction prompt while the selected Agent file continues to own its full status quote.
- Browser-played the integrated prompt at 1280x720: it measured 198.8x46px, rendered the full Talk, Researching, and
  Enter hierarchy, produced zero standalone bubbles, and kept zero page overflow. At 390x844, a 168px compact layout
  reduces the generated icon and A-key columns just enough to preserve the full status copy with a 17px viewport
  margin. A native phone load and a desktop-to-phone hot resize were both exercised.
- Focused building, desk, prompt, bubble-copy, station, and responsive-contract specs passed: 6 files / 23 tests.
  `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 607-file Vitest run (5,033 passing; one file and nine tests
  skipped), and the UI production build all passed.

Agent-file command hierarchy follow-up (2026-08-29):

- Continued the Talk flow into the real Agent file. Its phone layout already read like a coherent RPG character card,
  but the desktop four-column grid stretched Open session into a 138px-tall right rail. The navigation command carried
  more visual weight than portrait, Session identity, live quote, status, Office, Surface, and the filed record.
- Compared keeping the large right command, squeezing it beside the long Session title, and sharing the phone card's
  vertical reading order. Chose the shared order: desktop keeps portrait/dialogue/facts in one information row, then
  presents Open session as a 38px full-width command bar, followed by desk records as the inventory/exit row.
- The desktop Agent file now uses three information columns and a full-width action grid row. Its content-driven
  window ceiling increased from 220px to 270px so the extra row expands upward over the map rather than clipping or
  introducing an internal scroll. The 760px phone rule continues to own its independent stacked layout and height.
- Browser-played the final card at 1280x720: the rendered window settled at 817.9x260px, the command measured
  751.9x38px, the record ended 14px above the window bottom, scrollHeight equaled clientHeight, and page overflow was
  zero. At 390x844, the existing 344x362px character card, 278x36px command, record row, and zero-overflow behavior
  were unchanged. A focused CSS contract protects the information columns, command span, and desktop height ceiling.
- Focused Agent-file component and style-contract specs passed: 2 files / 3 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,034 passing; one file and nine tests skipped), and the UI
  production build all passed.

Replay Live-exit ownership follow-up (2026-08-29):

- Played Occupancy log -> Replay -> Seq 5 at 390px and found two controls both labeled Live: one in the active Replay
  panel and one in the floor HUD behind the modal. Both only cleared `asOfSeq`, but the HUD lived inside the inert
  background scene, so it looked actionable while being intentionally unreachable.
- Compared renaming the foreground control, dimming every Office modal background more aggressively, and giving Live
  ownership to the active layer. Chose active-layer ownership: while any Office window suspends the replay floor, its
  HUD Live exit is not rendered; the Replay panel owns the only current-time command. Closing the log with View replay
  floor restores the HUD exit immediately.
- Browser-played the full phone transition. Seq 5 inside the log exposed exactly one 141.5x36px Live button inside the
  Replay panel and HUD actions contained only Menu. View replay floor removed the dialog and restored exactly one
  66.7x32px Live button in the HUD. Both states kept zero page overflow and the historical floor remained visibly
  stamped and frozen.
- Focused OfficeBuilding and OfficeReplayBar specs passed: 2 files / 13 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,035 passing; one file and nine tests skipped), and the UI
  production build all passed.

Replay-deck material latch follow-up (2026-08-29):

- Continued through the real Occupancy log at desktop and phone sizes. Its window, event icons, journal cursor,
  transport buttons, and close latch were generated game materials, but the Replay deck still opened with an 8x12
  CSS border triangle. The default disclosure silhouette was the remaining browser-control seam in the log header.
- Compared keeping the generic triangle, borrowing the generated route chevron, and giving the replay deck its own
  physical control. Chose a dedicated latch because route guidance and panel disclosure are different interaction
  languages, while a small rotating part can communicate both closed and open states without adding copy.
- Generated a transparent cyan-enamel log latch with a dark outline, cream highlight, and brass pivot. It was
  alpha-cropped, hard-alpha packaged with nearest-neighbor sampling on a native 32x32 RGBA canvas, and registered as
  `replay-latch-v1.png`. The DOM-owned summary keeps its complete text, keyboard behavior, 38px hit area, and native
  details semantics; only the decorative part rotates downward when open. Reduced-motion removes its stepped turn.
- Browser-played the collapsed and expanded deck at 390x844: the latch remained legible at 22x22, rotated to the
  expected downward state, and did not change the 38px summary height or phone overflow. At 1280x900, the same part
  aligned with the log title and transport deck without competing with the larger Occupancy log identity icon.
- Focused OfficePage and HUD-asset specs passed: 2 files / 6 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the
  608-file Vitest run (5,035 passing; one file and nine tests skipped), and the UI production build all passed.

Large-viewport map-boundary follow-up (2026-08-29):

- Played the three-pod floor at 1280x900 and measured a 1034x722 campus around the fixed 960x672 world. The map was
  pinned at the campus origin, exposing all 74px of horizontal surplus on the right and all 50px of vertical surplus
  below it. The one-sided green checker read as an unfinished map extension, while the grab cursor and accessible
  instruction still promised panning even though the world was smaller than the viewport and could not move.
- Compared stretching world geometry, continuing floor tiles into non-interactive space, and centering the bounded
  world inside an intentional perimeter. Chose centering because it keeps 24px movement, collision, interaction, and
  prop coordinates authoritative; fake floor would imply walkable space, while stretching would distort the level.
- Camera clamping now centers any axis whose viewport is at least as large as the world and retains bounded negative
  offsets on smaller axes. At 1280x900 this creates symmetric 37px side and 25px top/bottom perimeter bands. A fully
  visible world no longer captures drag gestures or shows a grab cursor, and its localized map label omits the false
  drag instruction in English, Simplified Chinese, Traditional Chinese, and Japanese.
- Browser-played both directions of the responsive boundary. On a native 390x844 load, Alice remained visible at the
  initial `-296,0` camera, the campus kept its grab affordance and drag label, and a 150px touch drag moved the camera
  to `-446,0` with zero page overflow. Returning to 1280x900 clamped to `37,25`; the same drag gesture left that
  camera unchanged and the cursor remained default.
- Focused camera, OfficeBuilding, and OfficePage specs passed: 3 files / 22 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,036 passing; one file and nine tests skipped), and the UI
  production build all passed.

Adaptive game-stage follow-up (2026-08-29):

- Played Office at 844x390 landscape and found the remaining 4:3 frame contract reduced a 784px-wide layout to a
  402x300 game panel. Nearly half the horizontal space became inert app background while the HUD wrapped to 80px and
  the touch controls competed inside a 402x220 map viewport. The world and camera already supported arbitrary viewport
  geometry, so the outer screenshot ratio—not the level—was limiting play.
- Compared retaining 4:3 with smaller controls, adding a landscape-only exception, and making the Office panel an
  adaptive game stage at every size. Chose the adaptive stage because the viewport is a camera into the fixed 960x672
  world, not a game asset itself. One sizing contract now consumes the layout content box; the redundant phone-only
  override and forced 4:3 ratio were removed rather than kept as compatibility branches.
- The wider landscape stage exposed an older initial-camera shortcut that only centered vertically when the map was
  taller than 720px. A 672px world inside a 272px landscape viewport therefore started with Alice below the screen.
  Initial and explicit recentering now share a pure camera-centering function, which centers Alice first and then uses
  the existing per-axis world clamp for both smaller and larger viewports.
- Browser-played 844x390, 1280x900, and 390x844. Landscape expanded the panel from 402x300 to 756x330 and the map
  viewport from 402x220 to 750x272; Alice landed exactly at its center with camera `-105,-200`, zero page overflow,
  and a 52px single-row HUD. Desktop filled its available stage while preserving symmetric map perimeter, and portrait
  retained its 374x748 panel, touch controls, centered Alice, and zero overflow. Landscape Occupancy log also kept its
  close latch visible and independently scrolled a 460px journal through a 210px body.
- Focused responsive-style, camera, and OfficeBuilding specs passed: 3 files / 22 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,038 passing; one file and nine tests skipped), and the UI
  production build all passed.

Landscape party-window density follow-up (2026-08-29):

- Followed a real auto-walk into the six-member Team roster at 844x390. The route trail, arrival, modal focus, and
  independent scrolling were correct, but the 718px roster body inherited the same one-column rule as a 368px phone
  because touch controls and window reflow shared one `max-width: 760px` container query. Its 176px viewport showed
  only one complete 688px-wide card despite having room for a game-like two-column party grid.
- Compared shrinking cards, using orientation queries, and separating input-density from content-density breakpoints.
  Chose separate container thresholds: touch HUD remains available through 760px, while roster/cabinet windows keep
  their desktop grid until the Office stage is genuinely narrower than 680px. This follows the actual component width
  and avoids coupling window information architecture to whether touch controls are present.
- Browser-played the updated roster at 844x390. It now renders two 328px columns, shows both first-row teammates in
  full plus the next row's entry edge, and restores the selection hint; the body scroll height fell from 604px to
  334px. At 390x844 it still renders one 306px column, hides the optional hint, shows three complete members before
  scrolling, and keeps zero page overflow. The landscape Filing cabinet likewise retained two 315.5px columns, its
  record, hint, and Workspace-files exit inside a 680x222 window.
- Focused responsive-style, roster, and cabinet specs passed: 3 files / 8 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,039 passing; one file and nine tests skipped), and the UI
  production build all passed.

Landscape Agent-file hierarchy follow-up (2026-08-29):

- Continued from the two-column landscape Team roster into a real member's Agent file at 844x390. The 726x240
  window inherited the phone card reflow at 760px: facts dropped under the portrait and dialogue, raising content
  scroll height to 288px inside a 232px client area. The session command remained visible, but both record drawers
  began below the window edge, so the most useful history looked absent until the player discovered internal scroll.
- Compared making every short-landscape modal taller, compressing the card's typography and controls, and separating
  the Agent-file content breakpoint from the touch-HUD breakpoint. Chose the breakpoint split: the card keeps its
  three-column game dossier through 680px, while genuinely narrow stages retain the established two-column portrait
  and dialogue with facts, actions, and records stacked below. This preserves readable text and touch targets instead
  of trading them for density.
- Browser-played the result at 844x390. The dossier now resolves into 76px / 238px / 322px columns inside a 726x260
  window; its 252px client height equals scroll height, and the Open session command plus record drawer finish inside
  the visible frame. At 390x844 it still uses 64px / 202px columns, stacks every lower section, fits its 344x362
  window without internal or page overflow, and Back restores focus to the initiating roster member.
- Focused Agent-file style, component, and OfficePage specs passed: 3 files / 9 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 608-file Vitest run (5,040 passing; one file and nine tests skipped), and the UI
  production build all passed.

Floor-menu pause ownership follow-up (2026-08-29):

- Played Menu and Floor terminal together on the real desktop floor and reproduced a broken layer contract: opening
  Menu cancelled an existing route, but the still-live map could immediately start another one. Alice walked behind
  the translucent menu, and the terminal interaction prompt competed with its Floor view choices.
- Compared event-handler guards alone, replacing the compact menu with a full-screen pause page, and making the
  existing menu own a true gameplay pause. Chose the last option: the compact route selector remains fast, while its
  open state now suspends target discovery, keyboard movement, panning, auto-walk requests, touch movement, and the
  action button. The campus becomes `inert` and `aria-hidden`, and a 4px pixel-grid veil visibly freezes and recedes
  the world without obscuring the menu or inventing another navigation layer.
- Browser-played 1280x900, 844x390, and 390x844. The 224x148 menu stayed entirely in view at every size; landscape's
  750x272 floor and phone's 368x662 floor both kept zero page overflow. While paused, all four D-pad directions were
  disabled, direct map interaction was rejected, and Alice remained at `480,336`. Closing Menu removed the inert
  state, returned focus to its origin, and the next right input moved Alice to `504,336` immediately.
- Focused OfficeBuilding and pause-style specs passed: 2 files / 11 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 609-file Vitest run (5,041 passing; one file and nine tests skipped), and the UI
  production build all passed.

Input-capability HUD follow-up (2026-08-29):

- Played the adaptive 844x390 stage with a real fine pointer and found that its 750x272 floor still inferred touch
  input from width alone. A 96x96 D-pad and 72x72 A button covered both lower corners while the useful WASD/Arrow and
  Enter prompts were hidden, even though the browser reported `pointer: fine` and `hover: hover`.
- Compared shrinking the virtual controls, keeping a width-plus-input double gate, and letting primary input
  capability own the control scheme. Chose capability ownership: shrinking would preserve the wrong controls, while
  the double gate would strand wide touch tablets without movement. Coarse-pointer or no-hover devices now receive
  the D-pad, A button, and touch prompt at every stage width; fine-pointer devices keep the keyboard HUD at every
  width. Container queries continue to own layout only.
- Browser-played fine-pointer 1280x900, 844x390, and 390x844 stages. All three hid the virtual controls, showed the
  keyboard HUD, and retained zero page overflow. On landscape, four real W inputs moved Alice from `480,336` to
  `480,264`; the nearby Operations prompt exposed Enter and kept A hidden. The recovered corners made the short map
  materially easier to read without changing its 750x272 camera geometry.
- Focused responsive-style and OfficeBuilding specs passed: 2 files / 16 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 609-file Vitest run (5,042 passing; one file and nine tests skipped), and the UI
  production build all passed.

Play-ready keyboard focus follow-up (2026-08-29):

- Reloaded the real Office route and found its first input contradicted the HUD: focus correctly remained on BODY,
  but W left Alice at `480,336` because movement was owned only by the focusable campus. The player had to discover
  an undocumented click-to-arm step before the advertised WASD controls became real.
- Compared auto-focusing the map, capturing every page key, and accepting ambient game keys only from an otherwise
  idle page. Chose the scoped ambient model: BODY and the campus itself may issue movement or nearby interaction,
  while buttons, menus, inputs, selected Agent files, departures, and paused floors retain ordinary UI ownership.
  Ctrl, Meta, Alt, default-prevented, and IME-composition events are ignored so application and browser shortcuts do
  not move Alice. One document listener replaces the old campus-only handler and is removed with the floor.
- Browser-played fresh 1280x900, 844x390, and 390x844 routes. In every viewport, the first W moved Alice directly
  from `480,336` to `480,312` with zero page overflow. W then S returned her to spawn on desktop; after Menu focus was
  restored to its button, pressing D left Alice unchanged, proving that ambient play does not leak into controls.
- The focused OfficeBuilding suite passed: 1 file / 10 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 609-file
  Vitest run (5,042 passing; one file and nine tests skipped), and the UI production build all passed.

In-world focus re-entry follow-up (2026-08-29):

- Continued the keyboard route through W x4 -> Enter -> Occupancy log -> Close. The dialog correctly returned focus
  to Operations board for accessibility, but S then left Alice at `480,264`: the ambient-key boundary treated an
  in-world object exactly like the HUD Menu and silently stranded the player after every inspected object.
- Compared discarding focus restoration, allowing movement from every button, and distinguishing world objects from
  shell controls. Chose spatial ownership: movement keys from any campus descendant explicitly return focus to the
  campus and resume Alice, while Enter/Space remain with the focused object's native action. Menu, activity rail, and
  other controls outside the campus still ignore movement keys; modifier and paused-state guards remain unchanged.
- Browser-played the complete loop at 1280x900, 844x390, and 390x844. Close restored Operations board focus at
  `480,264`; the next S moved Alice to `480,288` and moved focus to `office-floor` in all three viewports, with zero
  page overflow. The focused component test also proves Menu + D leaves Alice still while Operations board + D moves
  her and hands focus back to the map.
- The focused OfficeBuilding suite passed: 1 file / 10 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 609-file
  Vitest run (5,042 passing; one file and nine tests skipped), and the UI production build all passed.

Responsive game-window identity follow-up (2026-08-29):

- Walked to the empty Auto Prediction cabinet at desktop and phone sizes. Its generated open-drawer material, empty
  copy, and Workspace-files exit were already complete, but the 344px window broke `AUTO PREDICTION · FILING
  CABINET` after FILING, leaving CABINET as an accidental orphan in the green title bar. The long Team roster title
  inherited the same browser-wrap behavior.
- Compared shrinking the title type, forcing one-line ellipsis, and giving game windows a structured location/type
  identity. Chose the shared structured title: shrinking would violate Office readability, while ellipsis would hide
  the exact window the player entered. Cabinet and roster now expose separate room, separator, and window-type nodes;
  wide stages align them in one line, and the 520px container rule deliberately stacks room over type.
- Browser-played the empty Auto Prediction cabinet and six-person Semis roster. At 390x844 both titles resolved into
  two balanced 14px lines inside the unchanged 38px header; at 844x390 and 1280x900 they returned to one line. The
  cabinet remained 344x286 on phone, the roster retained its scrolling party list, and every measured state kept zero
  page overflow.
- Focused cabinet, roster, and responsive-style specs passed: 3 files / 10 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 609-file Vitest run (5,043 passing; one file and nine tests skipped), and the UI
  production build all passed.

Roster party-menu navigation follow-up (2026-08-29):

- Opened the six-member Team roster with the keyboard and found a browser form inside a GBA party-screen shell:
  initial focus landed on Close, ArrowDown stayed on Close, and the player had to Tab through ordinary buttons even
  though every card already carried a visible selection cursor.
- Compared moving initial focus only, linear next/previous arrows, and geometry-aware party navigation. Chose the
  spatial model: the first teammate (or the teammate returned from an Agent file) owns the single roving tab stop;
  Left/Right and Up/Down select the nearest card in that physical direction, Home/End select the first/last member,
  Enter preserves native Agent-file activation, and edge input stays put. Tab cycles only between the current member
  and Close, keeping the modal keyboard-contained without turning all six cards into tab stops.
- Browser-played the 1280px two-column roster from first -> Right second -> Down fourth -> Home first. At 390x844,
  Down selected the next single-column member; opening that Agent file and returning restored the same member, and
  the next Down continued to the third. At 844x390, Right moved from the third to fourth physical card. All states
  retained their selection cursor, independently scrolling list, and zero page overflow.
- Focused roster component and spatial-navigation specs passed: 2 files / 3 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 610-file Vitest run (5,045 passing; one file and nine tests skipped), and the UI
  production build all passed.

Physical map-boundary follow-up (2026-08-29):

- Replayed the three-pod floor at 1280x900 and found that the strongest remaining completion break was outside the
  map itself: two wide strips of the old bright green checkerboard remained visible whenever the 960px map was
  narrower than the available stage. They read as an unfinished texture or grass and made the hard collision edge
  look accidental.
- Compared extending the walkable floor, replacing the checkerboard with a flat shadow, and giving the non-playable
  perimeter its own physical building material. Chose the physical boundary: extending the floor would lie about
  collision space, while a flat void would remove the bug without adding world semantics. The generated dark
  structural foundation is deliberately lower-luminance than the Office, and a double hard outline now marks the
  exact playable floor without changing map size, camera clamps, or collision coordinates.
- Used the built-in image generator with `style-master-v1.png` as the locked reference, then packaged the opaque
  result as the native 192x192 `building-foundation-v1.png` runtime tile. It contains no text, characters, furniture,
  checkerboard, grass, path, or UI and is registered and dimension-checked with the rest of the furniture pack.
- Browser-played 1280x900, 390x844, and 844x390. Desktop now exposes the dark foundation as intentional building
  depth; portrait's wider map remains pannable with no invented side material; landscape shows the same boundary at
  the short lower edge. The live computed campus background resolved to the new asset and every size retained zero
  page overflow.
- Focused furniture and responsive-style specs passed: 2 files / 9 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 610-file Vitest run (5,046 passing; one file and nine tests skipped), and the UI
  production build all passed. The first full-suite attempt used a PTY and invalidated the installer's explicit
  no-TTY test; the authoritative rerun used ordinary pipes and passed completely.

Office excursion-return follow-up (2026-08-29):

- Played the natural employee path all the way through `Talk -> Agent file -> Open session -> browser Back` and
  reproduced a broken game-world exit: the internal lightweight-tab URL projection had replaced the Office history
  entry, so Back first fell out to the browser's blank start. A simple native history copy changed the URL without
  changing the focused view, proving that URL restoration alone was not an interaction contract.
- Compared adding an Office button to every destination surface, embedding a complete Workspace inside the game
  window, and making the Office departure itself create a Router-recognized checkpoint. Chose the last option: a
  passive `/office/return` route temporarily distinguishes Router location without adopting or stealing a tab; the
  existing focused Workspace still opens normally, while Back reaches the ordinary `/office` adopter and re-focuses
  the floor. All Office exits use the same checkpoint, including signs, cabinets, reports, Issues, Inbox records,
  trade decisions, and employee Sessions.
- Alice position and facing are tracked in Office-owned tab-lifetime memory on every real movement without writing
  persistent configuration. The returning Office validates that point against current map bounds and collision
  rectangles before restoring it; invalid or
  stale geometry falls back to the current spawn. The restore effect keys its initialization by map dimensions so
  React Strict Mode's duplicate layout-effect pass cannot turn a valid return into a false map-change reset.
- Browser-played the complete employee Session round trip at 1280x900, 390x844, and 844x390. Every size moved from
  `312,240,left` into the real recorded Workspace Session and returned to `/office` at exactly `312,240,left`, with
  the Agent file closed, the nearby TALK prompt immediately available, the Office view focused, and zero page-level
  horizontal overflow. Portrait also exposed a separate next-increment candidate: the restored TALK prompt can be
  clipped at the left camera edge.
- Focused excursion, collision, OfficeBuilding, OfficePage, and URL-adopter specs passed: 5 files / 42 tests.
  `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 611-file Vitest run (5,052 passing; one file and nine tests skipped),
  and the UI production build all passed.

Camera-edge interaction prompt follow-up (2026-08-29):

- Replayed the previously noted portrait `TALK` position at `312,240,left`. The prompt was not clipped in current code,
  so no stale screenshot fix was applied. Current play instead showed the real conflict: the existing inward edge flip kept
  the prompt visible by painting its detailed action strip directly over Alice.
- Compared keeping the direct opposite-side flip, moving interaction copy into fixed HUD chrome, and retaining a world
  callout with perpendicular edge fallback. Chose the world callout: it first uses the side away from Alice, then the
  perpendicular side with more camera room, and only uses the side toward Alice as a last resort. This preserves the
  spatial target relationship without sacrificing player readability.
- The shared placement primitive now models the prompt and Alice bounds, rejects placements that cover the player,
  cross-axis clamps a perpendicular prompt into the camera, and shifts its pixel tail back toward the target. Detailed
  prompts use a deliberate 216px desktop width and 168px narrow width so placement geometry and rendered geometry agree.
- Browser-played the same employee interaction at 1280x900, 390x844, and 844x390. Desktop retained the natural left-side
  callout; portrait and short landscape used an unobstructed below-target callout, remained fully visible, and still
  opened the Agent file with `Enter`.
- Focused prompt, OfficeBuilding, and responsive-style specs passed: 3 files / 25 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 611-file Vitest run (5,054 passing; one file and nine tests skipped), and the UI production
  build all passed.

Workspace-destination prompt follow-up (2026-08-29):

- Played the complete Auto Prediction sign path rather than treating the third pod as map decoration: click the sign,
  watch Alice follow the route trail, depart into the real Prediction Workspace, and use browser Back to return to the
  same `336,336,down` approach point. The route worked, but the returned contextual prompt read `ENTER [ENTER]`.
- Compared removing the keycap, renaming every sign action to generic `OPEN`, and letting the action line carry the
  destination harness identity. Chose `CHAT / AUTOQUANT / PREDICTION [ENTER]`: the physical sign and portal icon already
  communicate entry, while the prompt now identifies which of the three game locations is actionable and still teaches
  the keyboard control. Sign targets therefore own their harness identity, and the obsolete generic entry-action locale
  key was deleted instead of retained as compatibility baggage.
- Browser play caught a second-order truncation at the old 176px generic prompt width. Workspace destinations now use a
  deliberate 200px prompt width, preserving the complete `PREDICTION` label without shrinking pixel type or introducing
  abbreviations; the existing camera-edge placement still bounds it on narrow screens.
- Short-landscape play then caught the contextual prompt colliding with the persistent `MOVE · WASD / ARROWS` tutorial.
  Nearby actions now temporarily own that teaching layer: the movement strip collapses and becomes assistive-technology
  hidden while any action is ready, while the camera-reset control remains available. Leaving interaction range clears
  the contextual state; ordinary movement still uses the existing learned-control behavior.
- Browser-played the Prediction departure-and-return prompt at 1280x900, 390x844, and 844x390. The full destination name,
  keycap, prompt tail, and map target remained visible at every size; portrait edge adjustment stayed bounded, and the
  landscape action no longer competed with movement teaching.
- Focused target, prompt, OfficeBuilding, and responsive-style specs passed: 4 files / 34 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 611-file Vitest run (5,055 passing; one file and nine tests skipped), and the UI production
  build all passed.

Manual-control teaching follow-up (2026-08-29):

- Browser-measured the cross-floor Prediction and AutoQuant click routes before changing their feel. The 96ms tile pace,
  remaining-step trail, target pointer, collision-aware turns, and mid-route retarget all stayed readable; changing speed
  or adding arrival delay would have created friction without solving an observed problem.
- The real teaching error was state ownership: requesting any auto-walk immediately marked the persistent
  `MOVE · WASD / ARROWS` strip as learned, even when the player had never touched a direction control. After the first
  click-and-return excursion, Office therefore removed the only manual-movement lesson on false evidence.
- Compared treating all Alice motion as learning, keeping the lesson forever, and distinguishing navigation modes.
  Chose mode-aware learning: route steps move and animate Alice without completing manual teaching; keyboard arrows,
  WASD, the touch D-pad, and a real map drag retain their existing ownership of the learned state. Manual input during a
  route still cancels it immediately and then records learning.
- Browser-played Prediction auto-walk at 1280x900, 390x844, and 844x390. All three kept `learned=false`, displayed the
  movement lesson beside the route without covering Alice, the path, or the target, and preserved the existing
  contextual-action priority near arrival. A desktop ArrowRight takeover cleared the route/trail and changed the state
  to `learned=true` in the same input.
- Focused OfficeBuilding, interaction-path, and responsive-style specs passed: 3 files / 23 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 611-file Vitest run (5,055 passing; one file and nine tests skipped), and the UI production
  build all passed.

Overlay control-ownership follow-up (2026-08-29):

- Audited the remaining Office visual seams in source and in the rendered pause menu, Agent file, filing cabinet, and
  occupancy surfaces. Their visible icons are already native pixel assets; no SVG, Unicode-arrow, emoji, or generic icon
  replacement remained to justify another asset-generation pass.
- Real browser play exposed the stronger discontinuity: opening an Agent file or filing cabinet correctly dimmed and
  suspended the map, but the bright `MOVE · WASD / ARROWS` strip and camera-reset button remained on top of the paused
  scene. The same field controls remained visible behind the pause menu, implying actions that the interaction model had
  already disabled.
- Compared leaving the controls dimmed, replacing them with a `PAUSED` label, and giving the active game menu/window
  exclusive ownership. Chose exclusive ownership: when an Office overlay, pause menu, or departure transition suspends
  the floor, desktop map controls, the coarse-pointer D-pad, and the touch action button become hidden, pointer-inert,
  and absent from the accessibility tree. The world remains visible as spatial context; closing the overlay restores the
  correct field-control state at the same Alice position.
- Browser-played cabinet open/close and the pause menu at 1280x900, 390x844, and 844x390. Controls left the scene without
  layout movement or empty chrome, the modal/menu remained dominant, and cabinet close restored the nearby `FILES`
  prompt plus the camera control rather than stale movement teaching.
- Focused OfficeBuilding and responsive-style specs passed: 2 files / 20 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 611-file Vitest run (5,055 passing; one file and nine tests skipped), and the UI production
  build all passed.

Occupancy-journal composition follow-up (2026-08-29):

- Played the floor, roster, Agent file, collapsed journal, and expanded Replay at desktop before choosing the next
  increment. The first three surfaces already formed deliberate game windows; the journal alone retained a fixed
  desktop bottom edge, leaving an empty grid shelf beneath its six-event index whenever Replay was closed.
- Compared decorating the unused space, enlarging the selected event card to consume it, and letting the journal
  shrink-wrap its actual records. Chose content-owned height: decoration would disguise a layout bug and an inflated
  event card would imply detail that does not exist. The desktop window now grows from its header, Replay state, and
  journal contents up to a floor-bounded maximum; overflow remains owned by the existing window body.
- Kept the established full-height contract below the 760px stage breakpoint. Browser-played collapsed and expanded
  Replay at 1280x900, 844x390, and 390x844: desktop ends directly after the event index, expanded Replay grows without
  crossing the floor, and both narrow layouts retain one contained scroll region with no clipped controls.
- Focused responsive-style specs passed: 1 file / 9 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 611-file
  Vitest run (5,056 passing; one file and nine tests skipped), and the UI production build all passed.

Responsive camera-safety follow-up (2026-08-29):

- Played the current day/night floor and then resized the live desktop route to 390x844 without reloading. The map
  bounds remained valid, but the resize observer only clamped the old camera offset; Alice disappeared outside the
  phone viewport even though a fresh phone entry correctly centered her.
- Compared resetting the complete composition after every resize, preserving the clamped camera even when Alice is
  lost, and applying the existing follow-camera safe area as a minimal resize correction. Chose safe-area correction:
  it retains the player's pan context whenever Alice is already visible and moves only the axis needed to recover her.
- The ResizeObserver and window-resize path now reconcile the current camera through `officeCameraFollowingAlice`
  using the live Alice ref. Browser-played 1280x900 -> 390x844 -> 844x390 without navigation or Reset: Alice remained
  visible after both transitions, the map stayed bounded, and the camera preserved the surrounding pod context.
- Focused OfficeBuilding and camera-helper specs passed: 2 files / 20 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`,
  the 611-file Vitest run (5,056 passing; one file and nine tests skipped), and the UI production build all passed.

Superseded scene-graph removal follow-up (2026-08-29):

- Proved the current runtime source has no room, group, nested map-zone, legacy cabinet, or amenity scene consumers;
  the only remaining hit was a neutral map wrapper still named `room-grid`. The stylesheet nevertheless retained five
  generations of card rooms, Harness scenes, group grids, CSS windows, and their later de-nesting overrides.
- Renamed the live wrapper to `oa-office-map-stage`, removed 776 lines of superseded scene CSS instead of preserving a
  compatibility layer, and added source/style contracts that reject the old room/group selector vocabulary. Current
  pod, desk, cabinet-window, roster, Agent-file, log, camera, and map-object classes remain independently owned.
- Browser-compared the night floor before and after deletion, then replayed Menu -> Occupancy Log, the six-member Team
  roster, and its 390x844 layout. The continuous floor, generated environment, modal pause ownership, responsive
  camera, roster navigation, and all visible geometry remained unchanged.
- Focused OfficeBuilding and responsive-style specs passed: 2 files / 22 tests. `npx tsc --noEmit`,
  `cd ui && npx tsc -b`, the 611-file Vitest run (5,057 passing; one file and nine tests skipped), and the UI
  production build passed; the built CSS fell from 372.87 kB to 357.96 kB.

Filing-cabinet inventory navigation follow-up (2026-08-29):

- Browser-played a filed Semis cabinet and the empty Auto Quant cabinet before choosing the interaction. Both windows
  initially focused Close, so the first game-menu action was unavailable until extra Tab presses; arrow keys did not
  move between filed records even though the responsive record list can form a physical grid.
- Compared changing only the initial focus, adding linear arrow navigation, and sharing the roster's geometry-aware
  roving-focus model. Chose the shared grid model: filed cabinets begin on the newest record, arrows follow the rendered
  columns, Home/End reach the bounds, and Tab loops record -> Workspace files -> Close -> the retained record. Empty
  cabinets begin on Workspace files and loop directly through Close.
- Generalized the roster helper into an Office grid-navigation primitive rather than duplicating cabinet-only key
  logic. Browser-played the populated focus loop at 1280x900 and the empty cabinet at 390x844; the selected record and
  primary empty-state exit were visually clear, and the phone dialog fit without internal scrolling.
- Focused cabinet, roster, and shared-navigation specs passed: 3 files / 5 tests, together with `cd ui && npx tsc -b`.
  `npx tsc --noEmit`, the 611-file Vitest run (5,057 passing; one file and nine tests skipped), and the UI production
  build all passed.

Auto-route legibility follow-up (2026-08-29):

- Browser-played long routes to the Floor terminal and Auto Prediction at 1280x900 and 390x844. The generated floor
  chevrons and target pointer communicate motion spatially, but the ordinary `MOVE` tutorial remains visible while
  Alice auto-walks; the destination name and the fact that manual movement cancels the route exist only indirectly.
- Compared labeling only the target pointer, attaching a moving speech bubble to Alice, and replacing the ordinary
  movement tutorial with a transient route-status strip. Chose the transient strip: it preserves the unobstructed map
  and path, names the current destination, teaches desktop Escape and touch movement cancellation, and disappears with
  the route instead of adding permanent HUD chrome.
- Interaction model: Escape cancels a route without moving Alice; WASD, arrows, and touch movement retain their existing
  cancel-and-take-control behavior. The visible status owns the existing polite announcement rather than duplicating a
  second screen-reader-only message. Narrow and coarse-pointer layouts place the transient strip above touch controls.
- Implemented the generated target-pointer status strip, route-aware suppression of the ordinary movement tutorial,
  Escape cancellation, and localized desktop/touch guidance. At <=520px the destination and cancellation guidance use
  separate lines; coarse-pointer layouts lift the strip above the D-pad and action-button band.
- Browser-played long routes, immediate Escape cancellation, and normal Floor-terminal arrival at 1280x900 and 390x844.
  The strip named Auto Prediction/Floor terminal without covering Alice or the route, disappeared atomically with a
  canceled route, and cleared before the destination menu received focus. Focused OfficeBuilding and responsive-style
  specs passed: 2 files / 23 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 611-file Vitest run (5,058 passing;
  one file and nine tests skipped), and the UI production build all passed.

Agent-file command-menu follow-up (2026-08-29):

- Browser-played a direct desk interaction at 1280x900. The Agent file presents a strong RPG dialogue composition, but
  focuses Close on entry; pressing the interaction/confirm key again immediately dismisses the window instead of
  executing its primary `Open session` command.
- Compared retaining universal Close focus, universally focusing Open session, and adapting the first command to the
  entry context. Chose context-aware command focus: direct map dialogue starts on Open session, roster drill-down keeps
  Back to roster, and an empty file keeps Close. This preserves both RPG confirmation flow and nested party-menu return.
- The command model will form one bounded keyboard loop across Open session, drawer records, and Close/Back. Drawer
  records use the shared geometry-aware Office grid navigation plus Home/End, so horizontal desktop inventory and any
  responsive wrapping follow their physical placement rather than source order assumptions.
- Implemented entry-aware autofocus, retained-drawer roving focus, spatial arrows, Home/End, and a bounded Tab loop.
  Direct dialogue now confirms Open session; roster drill-down still begins on Back, and Escape keeps its universal
  dismiss/return role. Focus follows a newly selected employee's first drawer instead of leaking another file's state.
- Browser-played the direct command loop and roster drill-down at 1280x900, then a direct file at 390x844. The primary
  green command and roster Back each received the expected visible focus, the phone file fit in 289px without internal
  scrolling, and the map remained paused behind it. Focused InspectRail/shared-grid specs passed: 2 files / 4 tests.
  `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 611-file Vitest run (5,058 passing; one file and nine tests skipped),
  and the UI production build all passed.

Partial-row service-bay follow-up (2026-08-29):

- Audited the 16-bit furniture pack and browser-played the three-Workspace floor. The repository already contains
  transparent, palette-matched mail/water and copier/archive landmarks, but layout restricts them to one-row maps; the
  current 2x2 composition therefore leaves its entire fourth cell as an accidental-looking empty field.
- Compared reducing map height, forcing three Workspaces into one long row, and turning the unused final grid cell into
  a service bay. Chose the service bay: it keeps the stable pod/camera geometry and future expansion space, avoids a
  worse horizontal phone corridor, and converts the structural gap into recognizable Office world-building.
- Layout contract: one-row floors retain their lower-edge services; a multi-row floor receives the same two generated
  props only when its final row is partial, centered inside the first unused cell. Each prop keeps a tight lower-body
  collision rect while the cell's upper aisle and pod gaps remain walkable. Complete rows receive no service props.
- Implemented partial-row placement from the actual pod grid geometry, retained the one-row lower-edge composition, and
  registered the service bodies in the existing collision system. Added direct geometry contracts for one-row, partial,
  and complete layouts; complete 2x2 floors remain undecorated instead of overlapping a real fourth Workspace.
- Browser-played the three-Workspace service bay at 1280x900 and 390x844, then walked Alice into the water/mail station.
  The pair fills the unused fourth cell without a fake Workspace rug or sign, stays legible in the phone camera, leaves
  an open upper aisle, and produces the normal collision impact at its physical base. Focused landmark/collision/building
  specs passed: 4 files / 25 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 612-file Vitest run (5,062 passing;
  one file and nine tests skipped), and the UI production build all passed.

Workspace-departure transition follow-up (2026-08-29):

- Browser-played Auto Prediction entry at 1280x900 and 390x844. The existing center-out pixel curtain has the right
  visual vocabulary, but its 260ms animation and navigation timer end together: desktop can switch before the
  destination plaque becomes perceptible, while the phone only exposes a fleeting half-closed frame.
- Compared recoloring the existing fast curtain, replacing it with a conventional full-screen fade, and splitting the
  pixel curtain into a stepped close plus a short fully-closed hold. Chose the two-phase pixel curtain because it keeps
  the Office game language, gives the destination a readable beat, and does not delay or visually cover app navigation.
- Interaction contract: the map remains busy and input-blocked during departure; the shutter closes in discrete steps,
  then holds the complete stage with the generated portal plaque before the existing Workspace navigation runs.
  Reduced-motion users retain the current immediate navigation path rather than receiving a newly prolonged effect.
- Implemented a 320ms six-step close, delayed two-step plaque reveal, a framed fully-closed stage, and a 200ms readable
  hold before navigation. The timer contract now proves that navigation cannot fire at 519ms and must fire at 520ms;
  the style contract pins the stepped shutter and delayed message instead of allowing a smooth fade regression.
- Browser-played Auto Prediction departure and arrival at 1280x900 and 390x844. Both viewports retain the surrounding
  application chrome, show the complete generated portal plaque during the hold, and land on the correct Workspace;
  a long-route Semis and supply-chain entry also reached its correct Workspace. Focused OfficeBuilding/responsive-style
  specs passed: 2 files / 24 tests. `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 612-file Vitest run (5,063 passing;
  one file and nine tests skipped), and the UI production build all passed.

Coworker variety and control-legibility follow-up (2026-08-29):

- Maintainer and community review identified four related game-completion gaps: the four runtime-locked coworkers make
  a male-heavy clone floor, simultaneous direction keys cannot move diagonally, long Agent-file titles scroll the
  primary command and close control out of view, and the ornate generated close chest hides its actual X affordance.
- Character options compared replacing the four incumbents, adding one feminine alternate per runtime, and growing a
  stable curated roster. Chose a ten-character roster: retain the four incumbents as veteran variants and add six
  clearly feminine coworkers, yielding roughly eight feminine and two masculine silhouettes. `agent + resumeId`
  deterministically owns identity so refreshes never reroll a Session. Every newcomer ships matched portrait, seated
  idle, and seated working poses; runtime palettes remain recognizable without making every runtime a clone.
- Movement options compared OS-repeat cardinal input, unnormalized two-key movement, and a held-key vector loop. Chose
  a 96ms held-key loop with 24px cardinal and normalized 17px diagonal steps, last-pressed-axis facing, keyup/blur
  cleanup, and axis sliding when a diagonal candidate meets furniture. This preserves speed and four-direction Alice
  art while making simultaneous keys feel native.
- Agent-file options compared hard truncation, an unconstrained expanding title, and a collapsed title disclosure inside
  a fixed-control window. Chose a three-line default with explicit expand/collapse, a single internal content scroller,
  and always-visible close and Open-session commands. Close becomes a deterministic high-contrast CSS pixel X; Back
  keeps its directional asset because it has different navigation semantics.
- Implemented the stable ten-character assignment, generated and packaged six transparent three-pose 16-bit coworkers,
  and retained the four veteran assets. Packaging now applies a shared idle/work scale per character so animation does
  not breathe between frames; the Pi sheet also received a dedicated transparency-extraction pass before packaging.
- Implemented held-key diagonal movement with normalized steps, last-key facing, blur/keyup cleanup, and corner sliding.
  Added exact two-key timing coverage plus a diagonal furniture-collision contract.
- Implemented the three-line title disclosure, profile-only scrolling, fixed Open-session action, keyboard-loop ownership,
  and the CSS-owned high-contrast close mark. Removed the more ornate generated close asset while retaining Back.
- Browser-played the real `/office` route against the current 18-Workspace, roughly 87-agent Project at desktop size and
  390x844. The live floor visibly distributes multiple newcomer silhouettes; long Agent files retain close and primary
  action in collapsed and expanded states; the compact close mark remains easy to locate on phone. The final browser
  state was restored to desktop size with no dialog left open.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 612-file Vitest run (5,068 passing; one file and nine tests skipped),
  and the UI production build all passed. The build retains the existing large-chunk advisory only.

Low-noise auto-route follow-up (2026-08-29):

- Maintainer review found the generated 24px chevrons too luminous and visually busy, with the route appearing a few
  pixels off Alice's movement line. Measurement confirmed the bitmap itself was centered; the larger mismatch came
  from drawing markers at Alice's logical body center while her visible shadow/feet sit roughly 22px lower. Diagonal
  17px movement also allowed the subsequent 24px route lattice to inherit an off-grid origin.
- Compared small static footsteps, a continuous RPG navigation rail, and retaining only the destination marker. The
  maintainer chose the footsteps: preserve spatial preview while reducing contrast, density, and animation.
- Generated a muted paired-footprint source and hollow destination diamond with the built-in image generator, rejecting
  one footprint draft that collapsed into an exclamation mark at native size. Packaged the accepted art as transparent
  12x12 and 20x20 sprites; old luminous chevron and bouncing-pointer assets are removed from the runtime pack.
- Route breadcrumbs now sit on Alice's 22px visual foot line, render statically at low opacity, and remain thinned to
  every other 24px cell. Auto-routing from a diagonal/manual position samples a short collision-safe join to the nearest
  walkable 24px grid coordinate before the ordinary breadth-first route continues. Already-interactable targets retain
  their facing-only behavior without an unnecessary snap.
- Browser-played a multi-turn route to Auto Prediction against the real Project. The six visible footprints stayed
  readable without overpowering desks or floor tiles, the static diamond identified the destination, and measured CSS
  confirmed 12px/20px native canvases, no pointer animation, and the corrected foot-line transform.
- Focused route/path/furniture specs passed: 5 files / 23 tests, and the static foot-line style contract passed. The
  large end-to-end Office-building unit spec now owns a 15-second budget because a safe grid-entry step pushed its
  already multi-route interaction sequence beyond Vitest's five-second default under full-suite load.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, the 612-file Vitest run (5,070 passing; one file and nine tests skipped),
  and the UI production build all passed. The build retains the existing large-chunk advisory only.

Coworker map-scale normalization follow-up (2026-08-29):

- Maintainer review used Alice as the correct scale reference and identified the seated NPCs—not the player—as too
  small. Inspection found that every desk image had the same 176px canvas, but generated alpha fringe made some actual
  silhouettes occupy only 93–119px vertically before the runtime's common 0.23 scale was applied.
- Compared enlarging every coworker in CSS, changing the complete map scale, and normalizing the authored desk assets by
  their actual hard-alpha bounds. Chose asset normalization because it fixes the inconsistent source occupancy while
  leaving Alice, desks, pod spacing, hit targets, and collision geometry untouched.
- Packaging now hard-mattes generated panels before trimming. A deterministic pair normalizer repacks all ten idle/work
  sets with one shared scale and bottom-center anchor inside a 164px visual fit, preventing tiny newcomers and animation
  breathing without rerendering or changing character identity.
- Browser-rechecked the real 18-Workspace Project at 1280x720: the seated coworkers now read at the same character
  scale as Alice without covering desks or changing the three-pod composition. Root/UI TypeScript, the 612-file Vitest
  run (5,070 passing; one file and nine tests skipped), and the UI production build passed; the existing large-chunk
  advisory remains unchanged.

Alice right-gait repair follow-up (2026-08-30):

- Maintainer screenshots showed Alice's body apparently floating above her shoes while walking right. Native-cell
  measurement disproved a size mismatch: all three right-facing frames occupied the same 44px height, but each frame's
  main body stopped at row 41 while two detached shoe components resumed at rows 44–46. Left, down, and up frames each
  retained one connected silhouette.
- Compared CSS frame offsets, mirroring the approved left gait, and regenerating the right-facing source. The original
  1086x1448 generated master confirmed that the gap already existed before packaging, so re-cropping could not repair
  it. Alice has no handed prop or asymmetric side marking; chose a per-cell mirror of the connected left row because it
  preserves exact identity, palette, scale, shoe baseline, and frame order without generation drift.
- Added a deterministic repair script and rebuilt only the right-facing atlas row. All three right cells now exactly
  match the horizontal mirror of their left counterpart and contain one connected foreground component instead of
  three.
- Browser-played a real route to the Floor terminal and captured right-facing frames 0, 1, and 2 in motion. Alice kept
  one planted shoe baseline and a connected silhouette through the cycle; pathfinding, turning, and the route HUD were
  unchanged. Focused Alice/sprite-pack specs, root/UI TypeScript, the 612-file Vitest run (5,072 passing; one file and
  nine tests skipped), and the UI production build passed. The existing large-chunk advisory remains unchanged.

Product-activity landmarks follow-up (2026-08-30):

- With Inbox and News now writing the shared Product Activity Journal, compared a permanent map ticker, HUD-only
  counters, and physical service landmarks. Chose physical landmarks because they make background work discoverable
  inside the game world without adding another dashboard layer. The fixtures remain calm by default; approaching one
  reveals its latest summary, while only a newly appended event earns a short-lived signal lamp.
- Replaced the semantically unrelated water-cooler/archive decoration with generated 16-bit Inbox sorting and News
  communications terminals. Both are native transparent 136x116 map props with restrained cream, walnut, brass, and
  cyan palettes; they use the same collision, depth, focus, route pointer, and reduced-motion rules as other furniture.
- Added an Office-local journal projection that keeps the latest Inbox and News fact independently. Initial history
  hydrates the fixtures without pretending to be new; later events light the matching station for twelve seconds.
  Inbox navigation selects the exact journal entry when available, while News opens the first-class News surface.
- Browser-played both service routes on the real Project: Inbox auto-walked and opened `/inbox`; News auto-walked and
  opened `/market/news`. The current News fact produced one visible pixel signal without adding a persistent overlay.
  Focused Office specs passed (6 files / 37 tests), as did root/UI TypeScript and the full 613-file Vitest run (5,080
  passing; one file and nine tests skipped).

Persistent service-zone follow-up (2026-08-30):

- Dense-floor review found that the first activity-landmark increment reused only a partial final Workspace row. A
  complete multi-row grid therefore dropped Inbox and News entirely when the maintainer switched to All groups.
- Compared pinning the services to the HUD, appending a full-width bottom corridor, and making the service bay a real
  map-packer cell. Chose the real cell: HUD pinning would return Office to dashboard composition, while a corridor adds
  disproportionate travel and dead floor. One-row floors retain their established lower lobby, partial rows retain
  their natural spare cell, and only complete multi-row floors add one bounded service cell.
- `OfficeMapLayout` now owns the service-zone geometry. The zone participates in aspect scoring, bounds, collision,
  interaction targets, route search, and camera travel, and uses the existing muted Workspace rug as a low-contrast
  physical base. No extra floating title or permanent notification overlay was added.
- Browser-played the real 18-Workspace All groups floor at 1776x1152. The service cell landed at the final grid slot;
  clicking Inbox from the central spawn completed the long auto-route and opened `/inbox`. The ordinary three-group
  floor kept its previous composition and gained the service rug without crowding Chat or the central aisle.
- Added dense geometry, non-overlap, collision, and long-route contracts. Focused Office specs passed (6 files / 49
  tests), root/UI TypeScript passed, and the full 613-file Vitest run passed (5,083 tests; one file and nine tests
  skipped).

Service-terminal prompt follow-up (2026-08-30):

- Manual play found that the new Inbox and News facilities inherited the 176px cabinet prompt. Both the verb and the
  Product Activity detail collapsed to fragments (`CHECK… / Product…`), so the journal data was technically present
  but not useful to a player standing at the machine.
- Compared a modal reader, a permanent ticker attached to each prop, and a wider version of the existing contextual
  RPG prompt. Chose the contextual prompt: it preserves one interaction grammar and keeps information absent until
  Alice deliberately approaches a terminal. The placement solver now accepts terminal-specific width and height, so
  edge avoidance accounts for the real two-line card instead of the old 56px cabinet bounds.
- Inbox and News prompts use 280px desktop / 240px narrow cards, a larger device portrait, full action verb, emphasized
  source, and a two-line clamped summary. Ordinary coworker, cabinet, roster, sign, and Operations prompts keep their
  established compact measurements.
- Browser-walked Alice to both terminals. Inbox clearly rendered `CHECK MAIL`, source, and a two-line journal summary;
  News rendered `READ NEWS`, `TECHCRUNCH`, and the current headline. Facing-cone target switching worked between the
  adjacent props, and Enter on News opened `/market/news`. Focused prompt/responsive/OfficeBuilding specs passed (3
  files / 34 tests), root/UI TypeScript passed, and the full 613-file Vitest run passed (5,084 tests; one file and nine
  tests skipped).

Persistent terminal-attention follow-up (2026-08-30):

- The first journal integration only animated a new terminal signal for twelve seconds. That made live arrivals feel
  lively, but activity received while the player was elsewhere could disappear before the Office was revisited.
- Compared unread counters in the HUD, a permanent animated alarm, and a per-terminal acknowledgement watermark.
  Chose the watermark: the physical fixture remains the source of truth, the calm floor avoids dashboard chrome, and
  motion is reserved for the genuinely fresh moment rather than becoming ambient visual noise.
- A first Office visit baselines the latest Inbox and News entries instead of presenting the entire journal as unread.
  Later entries survive route changes as a static `!`; arrivals while Office is open animate briefly and then settle
  into the same pending state. Opening the corresponding terminal acknowledges only that activity family. The state is
  session-scoped so it does not create another backend persistence contract.
- Attention is exposed in each terminal's accessible name as well as its pixel signal. Hook coverage now owns initial
  baselining, leave-and-return persistence, live arrival, and acknowledgement; the Office integration spec distinguishes
  static pending attention from fresh animated attention.
- Browser-tested the complete loop against the real Project: acknowledged an existing News signal, triggered an Inbox
  fact from Dev Frontend while Office was unmounted, returned to find only Inbox persistently marked while the same fact
  appeared in Sonner, auto-walked to Inbox, and returned again with both terminals calm. Root/UI TypeScript passed, as
  did the full 613-file Vitest run (5,086 tests; one file and nine tests skipped).

Activity-log channel follow-up (2026-08-30):

- The first real journal window preserved every event in chronological order, but per-item News ingestion occupied 27
  of the latest 50 rows on the live Project and made Agent work or Inbox deliveries difficult to find.
- Compared batching News rows, prioritizing Agent events above chronology, and adding explicit journal channels. Chose
  channels because batching would discard the requested article-level grain and priority sorting would make replay
  order untrustworthy. `All` remains the exact journal; `Agent`, `Inbox`, and `News` are projections of the same page.
- Added a shared Base UI tab primitive styled as a four-slot 16-bit menu strip, with live per-channel counts, selected
  state, standard keyboard semantics, and a two-by-two phone layout below 480px. A channel switch selects its newest
  visible event; event-row arrow navigation stays within the active channel, and empty channels retain the switcher and
  explain that the current journal page has no matching activity.
- Browser-tested the live 50-row Project journal at 1052x734. The `All 50 / Agent 18 / Inbox 5 / News 27` strip fit
  without shrinking the detail pane; Agent removed every News row, Inbox retained its report detail, and News retained
  individual headlines plus the Open News action. Root/UI TypeScript passed, as did the full 613-file Vitest run (5,089
  tests; one file and nine tests skipped).

Completed-result legibility follow-up (2026-08-30):

- A completed real Grok Issue left six useful records in its Agent File, but the one-row flex strip compressed every
  record until its title disappeared. The completion path therefore exposed that work existed without telling the
  player what had been produced.
- Compared a horizontally scrolling reward strip, a three-item summary with a More action, and a responsive record
  grid. Chose the grid because it keeps every result visible in the existing keyboard loop and makes the artifact name
  the primary differentiator instead of six repeated icons and Open labels.
- Agent File now presents records in three columns on the full floor, two columns in the compact container, and one
  column on phone-sized viewports. Cards retain a stable height and min-width contract so long result names ellipsize
  inside their own record instead of collapsing neighboring results. The bounded Agent File height also grows from the
  old single-row 270px treatment to 320px, enough for two result rows without covering the whole floor on short screens.
- Browser-replayed the completed six-record Grok Issue: all titles and both rows were visible with no profile overflow,
  the close control stayed fixed, and Tab plus arrow-key navigation traversed the responsive result grid. Focused Office
  specs, root/UI TypeScript, the full 613-file Vitest run (5,096 passing; one file and nine tests skipped), and the full
  production build passed; the existing large-chunk and direct-eval advisories remain unchanged.

Spatial completion-cue follow-up (2026-08-30):

- A fresh one-line Grok run exposed the successful `review` state on the real floor: its desk powered down and the
  Operations Board gained attention, but the specific coworker who had finished showed no map-level feedback. Success
  was therefore less legible than working, waiting, or failure.
- Compared a gold workstation glow, a completed count on the room sign, and a coworker-anchored result emote. Chose the
  emote because it identifies the exact actor, follows the existing RPG status language, and disappears with the
  existing 30-second review hold instead of adding another persistent dashboard counter.
- Added a generated transparent 16-bit parchment bubble with a muted moss check. It uses the existing decorative emote
  slot, bobs only three restrained cycles, stays static under reduced motion, and leaves the desk's translated review
  state as the accessible description.
- Browser-ran and then resumed the same tiny Grok Session. The cue appeared above the exact finished coworker without
  overpowering the room sign or service-terminal attention, the Agent File remained directly reachable, and the cue
  disappeared with the review hold. Root/UI TypeScript, the full 613-file Vitest run (5,097 passing; one file and nine
  tests skipped), and the production build passed; existing large-chunk and direct-eval advisories are unchanged.

Player-facing activity-language follow-up (2026-08-30):

- A live Operations Board review found that the three physical `!` signals remained distinguishable by their terminal
  silhouettes, but the journal itself still exposed backend nouns such as `stopped`, `text`, and `started`. The exact
  runtime data was correct while the interaction read like a developer console instead of an in-world action record.
- Compared collapsing a Session into one task card, appending explanations to raw event names, and translating only the
  Office presentation layer. Chose presentation mapping so the requested event-by-event grain and replay sequence stay
  intact while labels become `Task complete`, `Agent report`, `Task started`, `Needs attention`, and equivalent copy in
  all four shipped locales. Raw completion statuses are likewise presented as player-facing states.
- The desktop journal index now owns a measured 300px / 48% reading column so the new labels remain visible; below the
  existing compact breakpoint the journal still stacks above the detail pane, preserving phone space and keyboard order.
- Browser measurement confirmed that the six visible English labels have matching `clientWidth` and `scrollWidth` with
  no overflow while the detail pane retains 310px. Arrow-key row navigation and the translated Inbox/News exits remained
  operable. Focused Office specs, root/UI TypeScript, the full 613-file Vitest run (5,098 passing; one file and nine tests
  skipped), and the production build passed; existing large-chunk and direct-eval advisories are unchanged.

Event-to-floor replay follow-up (2026-08-30):

- Real journal play showed a semantic break between the readable event cards and Replay: selecting an older event only
  changed the detail pane, while entering its historical floor required separately guessing the same raw sequence on a
  slider. The log explained the event and the Replay control moved through history, but the two systems did not meet.
- Compared adding slider tick hints, a hover-only preview, and a direct event action. Chose an explicit
  `View floor at this event` action because it preserves deliberate browsing, works with mouse, touch, and keyboard,
  and turns the journal detail into the game's natural doorway to the historical floor without background refreshes.
- The selected event now owns a Replay action beside its existing destination action. Desktop actions wrap in one
  compact row; phone-sized containers stack full-width controls. The action uses the existing Replay asset and closes
  the journal before loading the exact `asOfSeq` snapshot.
- Browser-played the real Grok journal from Agent Report `#1309` into `Replay floor · Seq 1309`; the dialog closed,
  every Workspace sign switched to `Snapshot`, and the HUD's Live action returned to the current floor. Focused Office
  specs, root/UI TypeScript, the full 613-file Vitest run (5,099 passing; one file and nine tests skipped), and the
  production build passed; existing large-chunk and direct-eval advisories are unchanged.

Unique-artifact cabinet follow-up (2026-08-30):

- Real play opened the Prediction filing cabinet after one Grok-backed Office exercise. Six cards represented only
  four artifacts: one Issue appeared three times for `updated / commented / updated`, while two Inbox deliveries used
  raw UUIDs as their visible titles. Repeated Open labels were also indistinguishable to assistive navigation.
- Compared presenting the provenance history as a stack, labeling every mutation, and making the cabinet a unique
  artifact collection. Chose unique artifacts because Activity Log already owns the event-by-event story; an RPG filing
  cabinet should behave like a key-item inventory. The newest provenance edge now represents each report path, Issue,
  Inbox delivery, or trade decision, and the six-item cap applies after deduplication.
- Added one Office-owned presentation helper shared by Agent File and the cabinet. Result cards now lead with a
  player-facing artifact title, followed by a compact type badge and relative acquisition time. Inbox UUIDs remain the
  navigation identity but are no longer exposed as copy; accessible action names include title, type, and time.
- Three stepped cabinet heights accommodate one, two, or three desktop result rows while retaining bounded scrolling
  on smaller stages. The Agent File gained enough desktop height for two metadata-bearing reward rows; its established
  two-column compact and one-column phone layouts remain unchanged.
- Browser-replayed the live Prediction cabinet: six provenance rows became four artifact cards, both Inbox entries read
  `Inbox delivery`, no UUID remained visible, and the two-by-two grid had identical client/scroll heights with no
  overflow. Arrow Right moved Issue → current Inbox and Arrow Down moved to the older Inbox. The originating Agent File
  likewise displayed all four cards across two rows with no profile overflow.
- Focused projection, cabinet, Agent File, and responsive-style specs passed (4 files / 22 tests), as did root/UI
  TypeScript, the full 613-file Vitest run (5,100 passing; one file and nine tests skipped), and the production build;
  existing large-chunk and direct-eval advisories are unchanged.

Collision-free coworker casting follow-up (2026-08-30):

- Two tiny real Grok sessions (`run-cMA4D_xp` and `run-AqjAvnXI`) expanded Prediction to a five-person test roster.
  The resulting party exposed three identical red-haired portraits among five members even though the current Grok
  family already contains five distinct characters. Individual resume-ID hashing was stable, but it did not produce a
  convincing ensemble.
- Compared expanding the asset pool again, randomly rerolling collisions, and assigning the existing family as a
  deterministic group cast. Chose group casting: each runtime family exhausts its available characters before a
  portrait repeats, assignment remains stable for the same member set, and no persisted identity or migration contract
  is introduced.
- The shared casting helper now drives workstation actors, Team roster portraits, and the Agent File portrait. It keeps
  the established individual hash as each member's first choice, then deterministically open-addresses unused family
  variants. Responsive layout, controls, and semantic member buttons remain unchanged.
- Browser-played the live five-person Prediction team. The four simultaneously visible desk actors used four distinct
  Grok characters and all five roster members used all five available characters. `Roster scout one` remained
  `grok-oracle` in the Agent File and after Back returned focus to the same roster member. Focused casting, roster,
  desk, Agent File, and OfficePage specs passed (5 files / 23 tests), together with root/UI TypeScript, the full
  613-file Vitest run (5,101 passing; one file and nine tests skipped), and the production build; existing large-chunk
  and direct-eval advisories are unchanged.

Player-facing coworker identity follow-up (2026-08-30):

- Real Activity Log play exposed raw internal identities in both panes: rows read `@resume-crisp-sla...` and the event
  detail printed the complete resume ID. Agent File repeated the same implementation identifier below its otherwise
  player-facing title, breaking the character continuity established by the map and Team roster.
- Compared hiding the identifier, shortening it into another opaque code, and resolving journal actors through the
  current Office cast. Chose cast resolution: a current teammate keeps the exact portrait, task-facing name, runtime,
  short Session name, and Office used elsewhere. Retained events for departed teammates derive a stable title-cased
  call sign from their Session slug instead of exposing the raw ID; no persisted identity is added.
- The event detail now combines the teammate portrait with a small event-kind marker, preserving both who acted and
  what happened. Journal rows keep their event badge and existing keyboard order. Agent File uses the same
  `runtime · short name` byline as the roster. Existing desktop two-column and narrow stacked log layouts are unchanged.
- Browser-played the live Grok journal: the newest event resolved to `grok-analyst`, Arrow Down selected sequence 1326
  and changed the detail portrait to `grok-oracle`, and the matching map-opened Agent File returned to
  `grok-analyst · grok · g5`. No `resume-*` text remained visible. Focused actor-directory, journal, Agent File, and
  OfficePage specs passed (4 files / 18 tests), together with root/UI TypeScript, the full 614-file Vitest run (5,103
  passing; one file and nine tests skipped), and the production build. One Office menu-focus test flickered during the
  first full run, then passed both in isolation and in the complete rerun; existing large-chunk and direct-eval
  advisories are unchanged.

Historical-event floor beacon follow-up (2026-08-30):

- Playing `View floor at this event` for Grok completion #1327 showed that the action only changed the HUD to Replay;
  camera, focus, selection, and prompts stayed where they were, so the player could not tell where the event happened.
- Compared centering only the Workspace, immediately reopening Agent File, and marking the exact historical world
  target. Chose a map beacon: it keeps the snapshot visible and explorable, does not move Alice or trigger a live
  interaction, and matches the map-target language already taught by Office auto-move.
- Agent events resolve to the exact desk, then the Team roster for off-desk members, then the Workspace sign. Inbox and
  News resolve to their physical service terminals; events without a spatial identity resolve to Operations. A hidden
  target Workspace automatically enters All groups. Direct Replay slider changes deliberately clear the event beacon.
- Loading the snapshot centers the camera and focuses the floor. A compact generated-arrow parchment marker names the
  sequence and actor/source, animates for only three stepped beats, remains static under reduced motion, and persists
  while the player pans for context. Returning Live removes it.
- Browser-played Grok #1327 (`employee`, `grok-analyst`), Inbox #1296 (`inbox-service`), and News #1311
  (`news-service`, `nikkei-asia`). Each changed the camera, focused `office-floor`, and marked the correct physical
  target without moving Alice. Focused replay mapping, beacon, journal, OfficeBuilding, and OfficePage specs passed (5
  files / 30 tests), together with root/UI TypeScript, the full 616-file Vitest run (5,106 passing; one file and nine
  tests skipped), and the production build; existing large-chunk and direct-eval advisories are unchanged.

Activity-beat journal follow-up (2026-08-30):

- Real play of the 50-row Operations journal found long uninterrupted runs of identical Grok reports: one completed
  task occupied fifteen rows before the next lifecycle or product event. The game presented backend effort, but its
  most important starts, finishes, Inbox deliveries, and News additions were buried like development telemetry.
- Compared pagination, hiding progress reports, and folding adjacent same-task progress into story beats. Chose beats:
  they preserve proof that work happened without letting repetitive updates dominate the player's event history.
- Adjacent text or tool progress from the same actor, task, and Workspace now forms one newest-first beat within a
  three-minute cadence. Lifecycle events, errors, Inbox, News, different actors, interleaving work, and longer pauses
  always remain separate. Each folded row exposes its update count and exact sequence range; selection, arrow-key
  navigation, detail, and floor replay target the newest concrete event in that beat.
- The real Project's All view fell from 50 raw rows to 21 readable beats while retaining both Grok completions, both
  task starts, both new-agent events, Inbox, and News. A five-report beat rendered as `×5 #1321–1325`, selected the
  latest report detail, and Arrow Down moved to the next beat. Focused aggregation and journal specs passed (2 files /
  11 tests), together with root/UI TypeScript, the full 617-file Vitest run (5,110 passing; one file and nine tests
  skipped), and the production build; existing large-chunk and direct-eval advisories are unchanged.

Coworker identity and Assignment follow-up (2026-08-30):

- Ran a real seven-second Grok headless Session (`run-k5Q9pPX_`) as an Office actor and watched birth, working, report,
  and completion states on the live floor. Its automatically derived Session title was the full test prompt, so opening
  Agent File presented a paragraph-long assignment as if it were the coworker's name. The earlier title clamp protected
  layout but could not make that identity model feel like a game character.
- Compared retaining the task title as the name, assigning one fixed name per runtime, and separating the coworker from
  her current Assignment. Chose separation: an explicit user display name still wins, otherwise the already-cast pixel
  archetype becomes a stable in-world callsign (`Grok Oracle`, `Codex Mechanic`, and so on), disambiguated by the short
  Session name. The auto-generated title remains useful as the current Assignment and no persistent identity is added.
- Agent File now leads with callsign and runtime/Session byline, gives Assignment its own clamped and expandable quest
  block, and keeps status, output dialogue, records, and Open Session at their established levels. Team roster uses the
  same callsign plus short Session name as its primary row and the Assignment as secondary copy. Activity Log rows,
  event detail portraits, and replay beacons resolve the same callsign; selected Agent details retain the Assignment.
- Long Assignments in Activity Log clamp to three lines because the journal owns action history, not full task reading.
  Shortened `Find on floor` wording plus equal-width compact action buttons keeps both floor replay and destination
  actions in the first detail screen; Agent File remains the place to expand the complete Assignment.
- Browser-played the resulting real six-person Grok roster, Grok Oracle Agent File, full-title expansion, and completion
  event. All five authored Grok archetypes remained visible before the sixth stable repeat; every row stayed distinct by
  `g1`–`g6`, the Agent File action bar remained fixed, and the log's two actions fit side by side within the 279px detail
  pane. Focused identity, roster, Agent File, journal, and OfficePage verification passed (9 files / 45 tests), together
  with root/UI TypeScript, the full 617-file Vitest run (5,111 passing; one file and nine tests skipped), and the
  production build; the existing large-chunk advisory is unchanged.

Eight-person Grok party follow-up (2026-08-30):

- Reopened the real six-person Prediction roster after introducing callsigns and found `Grok Engineer` visibly
  repeated inside one party. The identity model was now clear, but the five-person asset pool still made a normal
  six-Session Workspace feel procedurally duplicated instead of authored.
- Compared accepting repeats after five, deriving palette swaps, and expanding the authored Grok party. Chose the
  authored party: palette swaps would preserve the same face and silhouette, while three genuinely distinct women add
  durable character memory without changing responsive layout, keyboard semantics, or runtime data contracts.
- Generated a silver-blue Navigator, rose-gold Synthesist, and emerald-black Sentinel as identity-locked three-pose
  sheets using the built-in image generator and the existing Office palette/camera references. The standard packager
  hard-matted their alpha, normalized each portrait to 72x104, and shared the seated scale and bottom-center anchor
  across the 176x176 idle/work frames.
- The shared coworker registry now owns eight Grok identities. Workspace casting exhausts all eight before a portrait
  or callsign repeats. Browser-played the real six-person roster, Sentinel Agent File, Synthesist completion pose, and
  an eight-person party produced by two additional Grok runs (`run-bROQI9-K`, `run-lmsKn-on`); all eight callsigns and
  portraits remained unique. Focused coworker, label, roster, desk, and floor specs passed (5 files / 30 tests), together
  with root/UI TypeScript, the full 617-file Vitest run (5,111 passing; one file and nine tests skipped), and the
  production build; the existing large-chunk advisory is unchanged.

## Completion

计划只在 maintainer 接受真实浏览器中的 Live、All groups、employee dialog 和 pause/log
四个状态后删除。完成标准不是“CSS 编译通过”，而是：

- 看起来是一张连续的俯视游戏地图；
- Harness、Workspace、Session 层级无需解释即可辨认；
- 2D 构图、拖动镜头和 Alice 移动自然；
- 主画面没有 card nesting、横版卷轴构图或 Dashboard chrome；
- 数据密集状态仍然可读、可操作并通过完整验证。
