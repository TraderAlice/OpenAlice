# OpenAlice 多代理優化確認報告

**日期**:2026-04-10
**分支**:`feat/strategy-council`
**作者**:Claude + Jason
**範圍**:OpenAlice 從單一 agent 升級成 **三代理協作決策系統**,含 dashboard 與連續測試驗證

---

## 1. 這次做了什麼(優化內容)

把原本「一個 agent 自己下決策」的流程,改成 **三代理協作 + 固定融合規則** 的架構,完全保留原本的 AgentSdkProvider、Agent SDK runtime、工具系統、event-log、web connector。所有改動都是**加法式的**,沒有破壞既有功能。

### 1.1 新增模組:`src/core/strategy-council/`

| 檔案 | 用途 |
|---|---|
| `types.ts` | `RoleName` / `RoleVerdict` / `StrategyDecision` / 事件型別定義 |
| `roles.ts` | 三個預設角色 (trend / signal / risk) 的 system prompt 與工具群組白名單,共用一份 `JSON_CONTRACT` 強制輸出格式 |
| `council.ts` | `StrategyCouncil` 類別、`askAsRole()`、`deliberate()`、`combineVerdicts()` 融合規則、`extractJsonBlock()` 容錯 JSON 解析 |
| `index.ts` | Barrel export |
| `council.spec.ts` | 28 個單元測試 |

### 1.2 核心設計決策(為什麼這樣寫)

1. **不改 AgentSdkProvider** — 三個角色共用同一個 `AgentCenter`,每次呼叫只是換一份 `systemPrompt` 和 `disabledTools`。這樣就能把 Claude Agent SDK 的 `query()` 當成多代理的底層 runtime,不需要新 provider。
2. **Stateless 子呼叫** — 每個 role 呼叫用一個 throwaway `MemorySessionStore`,deliberation 的中間對話永遠不會汙染主 session JSONL。這對 compaction 與可觀測性都很重要。
3. **工具隔離靠群組白名單** — 角色只定義允許的群組(e.g. `['analysis', 'twstock', 'fugle']`),council 會從 `ToolCenter.getInventory()` 推出要關掉的工具名單。Risk 角色額外明確黑名單 `trading_place_order` / `trading_cancel_order` / `trading_close_position`,確保它能「讀倉位但不能下單」。
4. **Fail-safe 預設** — Risk 角色解析失敗預設 `block`,Signal 預設 `hold`,Trend 預設 `neutral`。模型亂講話 → 系統默認不交易。
5. **固定融合規則,故意寫得很笨** — Risk block 是絕對否決;trend/signal 一致 → 順勢;neutral 時跟隨 signal;衝突 → hold;risk reduce 時套用 `positionFactor`。這裡故意**不**放花俏的 ensemble 或權重學習,因為 alpha 該來自 prompt 與資料,不是融合公式。
6. **事件化** — 每次 `deliberate()` 完成就寫一筆 `strategy.decision` 到 event-log,失敗寫 `strategy.error`。Dashboard、heartbeat、未來的回測引擎都從同一條 event 流消費,不用各自重建歷史。

### 1.3 整合到現有系統

| 檔案 | 改動 |
|---|---|
| `src/core/types.ts` | 在 `EngineContext` 加入 `strategyCouncil?: StrategyCouncil` |
| `src/main.ts` | 在 AgentCenter 之後 instantiate `StrategyCouncil` 並塞進 ctx |
| `src/connectors/web/routes/strategy-council.ts` | **新增** — REST + SSE:`POST /deliberate` / `GET /recent` / `GET /history` / `GET /stream` / `GET /roles` |
| `src/connectors/web/web-plugin.ts` | 掛上新路由 `/api/strategy-council` |

### 1.4 Dashboard 頁面

| 檔案 | 改動 |
|---|---|
| `ui/src/api/strategyCouncil.ts` | **新增** — 前端 API client,支援 REST + SSE |
| `ui/src/api/index.ts` | 註冊 `api.strategyCouncil` |
| `ui/src/pages/StrategyCouncilPage.tsx` | **新增** — 整頁 dashboard:輸入框、最終決策 banner、三張代理卡片、歷史時間軸,點擊歷史可切換檢視 |
| `ui/src/App.tsx` | 加 `/strategy-council` 路由 |
| `ui/src/components/Sidebar.tsx` | 在「Agent」區段加 Strategy Council 入口 |

---

## 2. 測試結果

### 2.1 單元測試

| 測試類型 | 結果 |
|---|---|
| Council 專屬測試 (`council.spec.ts`) | **28 passed** |
| Backtest 專屬測試 (`runner.spec.ts` + `council-strategy.spec.ts`) | **24 passed** (17 + 7) |
| 全專案測試 (`vitest run`) | **1011 passed** / 52 test files — 無回歸 |
| Backend typecheck (`tsc --noEmit`) | **clean** |
| Frontend typecheck (`cd ui && tsc --noEmit`) | **clean** |

28 個 council 測試涵蓋:

- `extractJsonBlock`:fenced / 無語言標記 / 多段取最後 / trailing 花括號 fallback / 格式錯誤 → null
- `parseRoleReply`:合法 verdict / 信心值 clamp / 角色 enum 驗證 / 位置因子 / 預設 fail-safe
- `combineVerdicts`:7 種融合路徑 + 缺角色 fail-safe
- `StrategyCouncil.askAsRole`:system prompt 注入、工具白名單差集計算、risk 只能讀不能寫、per-role profile override、解析失敗不 throw
- `StrategyCouncil.deliberate`:三 role 並行、event-log 寫入、risk 否決、子呼叫失敗寫 `strategy.error` 並 re-throw

### 2.2 連續問答驗證(`scripts/council-demo.ts`)

這個 harness 用一個 `FakeAgentCenter`(會根據 system prompt 分辨 trend/signal/risk,回傳 scripted JSON)把 10 個不同情境一次跑完,目的是驗證 coordinator + 解析器 + 事件發射在各種輸入下都正確。所以子呼叫**完全不吃 LLM quota**,是純結構測試。

執行結果:

```
StrategyCouncil continuous Q&A demo
===================================
Running 10 scenarios…

  S1  Bull regime + clean breakout + low portfolio stress           long     [OK]
  S2  Bullish setup overridden by risk block (max drawdown today)   blocked  [OK]
  S3  Bear regime + clean breakdown + normal risk                   short    [OK]
  S4  Neutral regime + signal-led long (coordinator fallback)       long     [OK]
  S5  Bull regime but signal wants to rest (hold)                   hold     [OK]
  S6  Trend/signal conflict → hold                                  hold     [OK]
  S7  Risk reduce: take the trade but scale position to 0.3         long     [OK]
  S8  Signal agent returns broken JSON (parse-error fallback)       hold     [OK]
  S9  Risk agent malformed → fail-safe block                        blocked  [OK]
  S10 High-volatility crypto + conservative sizing                  long     [OK]

Done. 10/10 passed in 124ms.
```

**10/10 passed**,總耗時 124ms(遠遠在「十分鐘內」預算內)。完整逐情境 verdict 表格與融合 rationale 已寫到 `reports/council-demo.md`,每個情境都標示 expected action 與實際結果。

### 2.3 Backtest 端對端驗證(`scripts/backtest-demo.ts`)

用一個簡單的 10/30 SMA crossover 策略跑 600 根合成分鐘 K(sine 波 + 漂移 + 有界雜訊,seed=42 確定性),跑兩次對照:

| 指標 | Frictionless (0/0 bps) | Realistic (5/10 bps) | Δ |
|---|---:|---:|---:|
| Trades | 4 | 4 | 0 |
| Total return | 4161.25 | 4083.14 | **-78.11** |
| Total return % | 4.16% | 4.08% | -0.08pp |
| Max drawdown % | 0.13% | 0.15% | +0.02pp |
| Final equity | 104,161.25 | 104,083.14 | -78.11 |

重點**不是**這個數字好不好看,而是:
- 加上 5 bps 滑價 + 10 bps 手續費之後,報酬**往下掉**(-78)、最大回撤**變大**(+0.02pp)。這代表 execution model 確實有作用,不是掛飾。
- 兩次跑的 trades 完全一致(4 筆),元金流差異**只來自成本**,證明 runner 是 deterministic。
- 逐 bar 耗時小於 1μs(整個 600-bar backtest 只要 1~2 ms),這讓未來串入 council 的 per-bar deliberation 變可行。
- 完整 trade list、equity curve 抽樣已寫到 `reports/backtest-demo.md`。

### 2.4 這次測試**證明了**什麼

✅ 三個 role 會用不同的 system prompt 被呼叫(tool 白名單差異正確計算,風險角色明確被禁止下單工具)
✅ JSON 解析能忍受模型輸出各種格式問題(無語言標記 fence、多段 fence、裸 object、無效 JSON)
✅ 融合規則 7 條路徑全部正確執行(including conflict handling 與 risk reduce 的 positionFactor 套用)
✅ Fail-safe 預設能兜住模型失控的情況(Risk 亂回 → blocked,Signal 亂回 → hold)
✅ 每次 deliberation 會寫一筆結構化事件到 event-log,可被 dashboard 即時接收
✅ 整個 pipeline 在 ms 級完成,不會阻塞主 UI
✅ Backtest engine 的 cursor 在測試裡被拒絕窺視未來(negative offset throws),runner 會阻止在已有倉位時再度開倉(stacking prevention),執行成本會如預期吃掉收益

### 2.5 這次測試**沒有證明**什麼(要直白講)

❌ **三個 agent 實際在真 LLM 下會回甚麼** — FakeAgentCenter 是 scripted,不是真 Claude。角色 prompt 是不是寫得夠好,要另外跑一輪 `ANTHROPIC_API_KEY` 實盤驗證。這一步刻意沒做,原因是:一來需要 API 配額,二來要討論 reproducibility(同樣的輸入,不同時間問 LLM 會回不同),三來要加 rate limit 處理。
❌ **真實市場上有沒有 edge** — Backtest 用的是**合成**資料(sine 波 + 漂移),不是 twstock 或 fugle 的歷史分鐘 K。把引擎接上真資料是直接的(資料來源現成),但那要讓這次的架構先穩定下來再做。
❌ **Council 在 backtest 裡跑 per-bar** — `createCouncilStrategy` 的 adapter 已經寫好並有測試覆蓋,但實際用真 LLM 跑一次 600-bar backtest 會是 1800 次 API call,要先做 sparse sampling、cache、和成本分析。這是 Step 4→Step 5 的接續工作。
❌ **實盤下單路徑** — Council 目前只寫 event-log,沒有自動下單。這是刻意保留的,要等 Step 5 才讓它串回 UTA guard pipeline。

---

## 3. 現在的完整狀態

### 3.1 已完成(MVP 的 Step 1–4)

- [x] **Step 1** — 三代理 profile + `askAsRole`
- [x] **Step 2** — StrategyCouncil coordinator + `strategy.decision` 事件
- [x] **Step 3** — Dashboard 頁面 + SSE 串流
- [x] **Step 4** — 分鐘級回測引擎(`src/domain/backtest/`)

### 3.2 還沒做(MVP 的 Step 5)

- [ ] **Step 5** — 回測實盤對照 + 串入 guard pipeline
  - 把 coordinator 決策路徑串到 UTA 下單(先過 guard + backtest verifier)
  - Dashboard 顯示實盤 vs 回測績效差距

### 3.3 Git 狀態

本次分支 `feat/strategy-council`(從 `master` 開),共 3 個 commit:

| Commit | 內容 | 檔案變動 |
|---|---|---|
| `78052d5` | feat: add StrategyCouncil multi-agent deliberation with dashboard | 14 files, 1615 insertions(+) |
| `13cfc23` | test: add continuous Q&A demo harness and optimization report | 3 files, 716 insertions(+) |
| `e32caa9` | feat: add minute-level backtest engine with cursor-based replay | 11 files, 1396 insertions(+) |

使用者的其他 WIP(`feat/twstock-tools` 的 UI 改動)已經 **git stash** 保留,完全沒動到。

---

## 4. 下一步建議

按照優先順序:

1. **先驗證真 Claude 的 role prompt 品質** — 寫一個 `scripts/council-real.ts`,用 `ANTHROPIC_API_KEY` 實際跑 3~5 個情境,看三個角色會不會真的分工,還是模型會把三個角色都寫成同樣的通用回答。這是最便宜也最有資訊量的驗證。如果這步發現 prompt 不夠逼迫分工,就先調 prompt 再做下一步。
2. **把 backtest engine 接到真 twstock / fugle 資料** — 引擎和資料來源都在專案裡,只是還沒接上。建議先做一個 `loadTwstockMinuteBars(symbol, dateRange)` 的 adapter,再把 Step 4 的 MA crossover demo 換成真資料跑一次。
3. **Council-in-the-loop sparse backtest** — 等 role prompt 品質與 backtest 真資料都確認之後,用 `deliberateEvery: 15` 之類的 sparse sampling 讓 council 每 15 分鐘出手一次,跑一個 2~4 週的回測,看成本和結果是否可接受。
4. **Step 5: 把 coordinator 決策串到 UTA guard pipeline** — 等 backtest 驗證有 edge 再做,不要提前做這步。
5. **把 persona.md 跟三個 role prompt 關聯起來** — 現在三個 role 的 prompt 是硬編碼在 `roles.ts`。長期應該搬到 `data/brain/roles/*.md`,這樣使用者能像改 persona 一樣熱改。
6. **Dashboard 加回測對照區** — 在有真實回測數字之後加。

---

## 4.5 真 Claude 驗證結果(2026-04-10 新增)

原本報告的第 2.4/2.5 節說「沒驗證過真 LLM 下三個 role 會不會真的分工」。在交還這份報告之後,我自己用 Chrome DevTools MCP 實際啟動 dashboard 跑了一次真 Claude deliberation,結果如下。

### 測試輸入

```
TWSE 2330 台積電:現價 1102,盤中 5 分鐘 K 剛突破 1105 壓力,
成交量是前 20 根 K 平均的 1.8 倍,週線仍在多頭排列。
目前無持倉,當日風險額度未用。請評估接下來 15 分鐘的多空與風險。
```

這是故意設計的**矛盾輸入** — 現價 1102 **低於**聲稱的突破位 1105,是一個會誘發三個 role 意見分歧的場景。

### 三個 role 的實際回答

| Role | Verdict | Confidence | Position Factor | 耗時 | 實際行為 |
|---|---|---:|---:|---:|---|
| **Trend** | `bearish` | 55% | 0.40 | 76.3s | 真的呼叫 `analysis` 群組工具查 SMA20 / RSI / MACD,發現日線 SMA20 = 1854 與現價 1102 差 40%,判定為「熊市中的技術反彈」,並**誠實指出數據與使用者描述矛盾,相應降低信心度** |
| **Signal** | `long` | 65% | 0.60 | 147.4s | 給出完整 5m entry setup(entry 1103-1105、target 1115/1131、stop 1087、風報比 1:1.6),列出三個可能情境(真突破 / 假突破 / 筆誤)並明確標出決策分支點 |
| **Risk** | `reduce` | 62% | 0.50 | 60.9s | 真的嘗試呼叫 `trading_get_positions`(回 "No accounts available"),指出「燈芯假突破」風險,裁定**先以 50% 倉位試探**,等 5m 收盤站上 1105 再擴倉 |

### Coordinator 融合

```
trend=bearish + signal=long → CONFLICT → hold
positionFactor: 0 (hold forces to zero)
elapsedMs: 147,447 (bottlenecked by the slowest role — signal)
```

### 這次驗證**證明了**什麼

1. ✅ **三個 role 真的分工了** — Trend 看宏觀長週期背景,Signal 看 5m setup,Risk 看安全網。三個 reasoning 段落的視角、術語、結論**完全不同**,不是同一段 prompt 複製三次
2. ✅ **每個 role 都實際呼叫工具** — 不是憑空回答。Trend 用 analysis 指標、Signal 讀日線資料、Risk 探測 trading 群組(並且因為沒有 account 而**誠實回報無法驗證**,這比亂湊數字好得多)
3. ✅ **工具隔離生效** — Risk 能看到 `trading_get_positions` 這個唯讀工具,Trend 和 Signal 看不到。而且 Risk **沒有嘗試下單**(寫操作被 `extraDisabledTools` 明確擋掉)
4. ✅ **結構化 JSON 解析 100% 成功** — 三個 role 都在冗長的分析段落**最後**放了 ```json fenced block,`extractJsonBlock` 的「取最後一個 fence」策略完全有效
5. ✅ **融合規則的衝突處理正確觸發** — 這是最重要的。如果 coordinator 寫錯,這種矛盾輸入會產生長/空錯誤訊號,但它乖乖地走 hold path 並把 rationale 寫進 event-log
6. ✅ **Dashboard 端到端工作** — SSE 即時推送、三卡片即時更新、歷史時間軸可點選切換檢視、final action banner 顏色編碼正確(hold=灰、bearish=紅、long=綠、reduce=琥珀)

### 驗證過程中發現的 bug(已修)

**Commit `3a21a59`:`fix: strip all CLAUDE_CODE_* env vars before spawning Agent SDK subprocess`**

第一次驗證失敗,三個 role 全部秒噴 `Claude Code process exited with code 1`。原因是 `query.ts` 只刪 `CLAUDECODE` 一條環境變數,但當 OpenAlice 是從**父層 Claude Code session** 裡啟動的時候,`CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 都會洩漏到子進程,Agent SDK 的子 claude-code 進程偵測到這些變數就會判定自己是 nested session 並自殺退出。

修法:把 env 過一遍,凡是 `CLAUDECODE` 或 `CLAUDE_CODE_*` 開頭的全部刪掉。修完之後 deliberation 正常跑完。

這是**原本就存在的 bug**(先前的 `44b6018 fix CLAUDECODE env leak` 修到一半),不是這次 council 引進的。但因為我是從 Claude Code session 裡驅動 dashboard,所以先踩到。

### Dashboard 截圖

`reports/council-dashboard.png` — 點選第一筆 deliberation 後的完整畫面,可以看到 Final Action banner、三張 role 卡片並列、Recent Deliberations 時間軸。

### 這次驗證**沒有**證明的

- ❌ **結果在真實市場有 edge** — 矛盾輸入是我故意設計的 stress test,不是真實交易場景。真實市場的 alpha 驗證要接真歷史資料跑回測
- ❌ **成本可接受** — 單次 deliberation 耗時 147 秒、消耗 ~30k tokens(三個 role 加起來)。如果要 per-bar 在分鐘回測裡跑,需要 sparse sampling + cache
- ❌ **穩定性** — 只跑了一次成功的 deliberation。要多跑幾輪不同情境,確認 prompt 在 edge case(新聞衝擊、快速跳動、極端波動)下還能維持這個分工品質

---

## 5. 一句話總結

> **做到了**:多代理架構、工具隔離、角色分工、融合規則、fail-safe、事件化、Dashboard、cursor-based 分鐘回測引擎(含顯式成本模型)、10/10 連續問答測試、1011/1011 全專案測試、**1 次真 Claude 端到端 deliberation(3 個 role 實際分工且呼叫工具)**、**env leak bug 修復**。
> **還沒做到**:多輪真 Claude 穩定性驗證、真歷史資料回測、council-in-loop backtest、實盤串接。
> **誠實評估**:這是個乾淨、可驗證、可擴充的骨架,而且**在真 Claude 下已經證明三個 role 會依 prompt 設計分工運作**,不是 mock 出來的理論值。它不會自己變聰明,但它提供的每一層(代理分工 → 融合 → 回測 → 成本模型)都可以獨立被量化優化,而不是靠直覺調參。真正決定會不會賺錢的是下一階段的真資料驗證與多輪 prompt 調優,不是這次的架構工程。
