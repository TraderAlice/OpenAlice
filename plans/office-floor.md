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
   All groups 中出现。默认 `chat=1`、`auto-quant=1`、`other=0`。
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

## Completion

计划只在 maintainer 接受真实浏览器中的 Live、All groups、employee dialog 和 pause/log
四个状态后删除。完成标准不是“CSS 编译通过”，而是：

- 看起来是一张连续的俯视游戏地图；
- Harness、Workspace、Session 层级无需解释即可辨认；
- 2D 构图、拖动镜头和 Alice 移动自然；
- 主画面没有 card nesting、横版卷轴构图或 Dashboard chrome；
- 数据密集状态仍然可读、可操作并通过完整验证。
