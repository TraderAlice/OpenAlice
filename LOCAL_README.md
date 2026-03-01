# OpenAlice 本地执行 README

> 目的：作为本地长期工作台账（做了什么、当前风险、下一步），每次改动后持续追加。  
> 规则：所有新增记录必须带日期，优先写“行为变化 + 验证结果 + 未决风险”。

| 字段 | 内容 |
| --- | --- |
| 项目 | OpenAlice 治理闭环集成 |
| 记录范围 | 本地分支集成、pull 后对齐、治理链路验收 |
| 首次创建 | 2026-03-01 |
| 最近更新 | 2026-03-01 |

---

## 1. 核心问题（按量化公司标准重审）

### 1.1 一句话结论

当前核心问题已经不是“代码没接上”，而是“**生产就绪纪律（readiness discipline）未完全达标**”：

1. 治理链路已可运行，但策略输入仍有模板态内容。  
2. pull 后一键对齐已具备，但在锁定文件未收敛前会稳定触发 `policy_fail`。  
3. 合并风险已集中在少数关键文件，需要持续按清单管理。

### 1.2 量化标准维度评估

| 维度 | 量化公司常见要求 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 发布门禁（Release Gating） | GO/NO_GO 可重复、可硬阻断 | 黄 | 运行时硬门禁已上线，但 lock/manifest 仍有模板值。 |
| 可复现性（Reproducibility） | 环境锁+工件溯源默认通过 | 黄 | 校验逻辑完整，但环境锁与实际运行版本有偏差。 |
| 风险控制（Risk Control） | 新开仓可被门禁拦截，平仓通道保留 | 绿 | `placeOrder` 被拦；`close/cancel/sync` 保留。 |
| 运维自动化（Ops Automation） | pull 后最小步骤恢复一致性 | 绿 | `sync:post-pull` + hooks 已就位。 |
| 变更治理（Change Governance） | 冲突面可识别、可控 | 绿 | 最小冲突清单已落盘。 |
| 诊断语义（Diagnostics） | reason code 语义准确、无误报 | 绿 | 已修复“缺指标误报阈值突破”。 |

### 1.3 仍阻塞“生产绿灯”的真实项

1. `environment_lock.v1.json` 与当前运行环境不一致（node/jsonschema）。  
2. `freeze_manifest.json` 仍含占位/非具体身份字段。  
3. 在 1/2 修复前，`pnpm sync:post-pull` 返回 `exit 2` 属于预期策略拦截，不是脚本故障。

---

## 2. 已完成工作（日期日志）

### 2026-03-01

#### A. 治理主流程闭环
- 新增本地治理端口：通过 `python_fallback` 驱动治理脚本。
- 主运行时接入 governance service 与 execution hard gate。
- 交易门禁策略：
  - `placeOrder`：强门禁校验。
  - `closePosition` / `cancelOrder` / `syncOrders`：透传，保证风险处置通道可用。

#### B. Web 与配置接入
- 新增治理 API：
  - `/api/governance/status`
  - `/api/governance/build`
  - `/api/governance/validate`
  - `/api/governance/replay`
  - `/api/governance/verify-freeze`
  - `/api/governance/reason-codes`
- Web 插件已完成路由挂载。
- Config 路由已支持治理 alias 归一化，且保留 canonical `governance` 路径行为。

#### C. pull 后快速对齐与自动化
- 一键对齐命令：
  - `pnpm sync:post-pull`
- 可选自动模式（git hooks）：
  - 安装：`pnpm sync:install-hooks`
  - 移除：`pnpm sync:remove-hooks`
- 已输出冲突治理文档：
  - `docs/research/minimal_conflict_manifest.md`

#### D. 审查问题修复（P2）
- 修复 `build_decision_packet.py`：
  - 兼容 legacy 模板（仅 `releaseGateStatus.path`）时，仍会正确落地产物与 provenance。
- 修复 `validate_decision_packet.py`：
  - “指标缺失”仅触发 `HARD_METRIC_MISSING`。
  - 不再错误触发 `HARD_THRESHOLD_BREACH`。

#### E. 验证证据
- Python 治理链路测试通过：
  - `scripts/tests/test_governance_pipeline.py`
  - `scripts/tests/test_exit_code_contract.py`
  - `scripts/tests/test_decision_packet_idempotency.py`
  - `scripts/tests/test_post_pull_sync.py`
- TS 测试通过：
  - governance route/config spec
  - governance trading-gate spec
  - upstream adapter contract spec
- 构建通过：
  - `pnpm build:backend`

#### F. V5.1.1 Gate 编排与回归补齐
- 新增/补齐：
  - Gate 编排器（G0->G4）与 checkpoint/history/verdict 三态裁决链路。
  - 迁移/对比/chaos 工具链：`migrate_v4_to_v5.py`、`migration_compare.py`、`chaos_gate_runner.py`。
  - 统计口径锁与哈希落盘：`thresholdsHash`、`statisticsLockHash`。
- 本轮修复要点：
  - Gate 超时控制覆盖到通用执行路径（不再仅 G1 生效）。
  - `migration_compare` 增加 verdict 结构校验，避免非 verdict 输入假阳性通过。
  - G0 开关配置（reason lint / command availability / secrets hygiene）按 profile 生效。
  - source-health 在 strict 模式下对缺字段执行硬失败。
- 验证命令：
  - `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`
  - `pnpm gate:run-all`
  - `pnpm gate:migrate-v4-v5`
  - `pnpm gate:migration-compare`
  - `pnpm gate:chaos`
- 验证结果：
  - Python 测试通过（40 tests）。
  - `gate:run-all` 可执行并在当前仓库状态给出 `NO_GO`（`exit 2`，符合门禁语义）。
  - 迁移/对比/chaos 命令可直接执行并产物落盘。

---

## 3. pull 后快速使用说明

### 3.1 手动模式（推荐）

```bash
pnpm sync:post-pull
```

### 3.2 自动模式（每次 pull/checkout 后触发）

```bash
pnpm sync:install-hooks
```

### 3.3 关闭自动模式

```bash
pnpm sync:remove-hooks
```

### 3.4 退出码解释

- `exit 0`：全部通过。  
- `exit 2`：策略失败（需要修配置/数据，不是工具崩溃）。  
- `exit 3`：工具或运行时错误。  

---

## 4. 后续更新模板（每次都按此追加）

```markdown
### YYYY-MM-DD
- 变更范围：
- 触达文件：
- 行为变化：
- 验证命令：
- 验证结果：
- 未决风险/下一步：
```

---

## 5. 下一步（达成生产绿灯）

1. 将 `freeze_manifest.json` 占位字段替换为真实人员与签署时间。  
2. 对齐 `environment_lock.v1.json` 与运行时，或统一运行时到锁定版本。  
3. 连续执行 `pnpm sync:post-pull`，直至稳定 `exit 0`。  
