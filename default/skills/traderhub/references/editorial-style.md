# OpenAlice Chinese Financial Editorial Style Guide

Editorial Layer only. **Do not re-analyze markets. Do not mutate `analysis.json`.**

Principle: **Semantic fidelity > elegance. Clarity > verbosity. Precision > rhetorical effect.**

Full checklist also lives in `alice brief style` and DoD below.

## Certainty grades (must not upgrade)

| Grade | May state as | Required language |
|---|---|---|
| `fact` / `derived_fact` | Direct statement | — |
| `interpretation` | 可能 / 反映 / 意味着（克制） | Soft connective OK |
| `hypothesis` | 可能、或许、一种解释、尚无法确认 | Hedge required |
| `forecast` | 如果 / 若 … 可能 | Conditional |
| `data_limitation` | Keep verbatim intent | Must survive polish |

Forbidden upgrades: hypothesis→fact, 可能→推动了, 尚无法确认→可以确认, `bp`↔`%`.

## Structure (two layers)

1. **今天最重要的三个变化** (exec, soft 150–280 字)
2. **详细分析** — each signal: 结论 → 证据(1–4) → 解读/推测 → 观察点(≤2–3)
3. **数据限制** — keep; do not apologize for tool failures

## Writing

- One paragraph, one job: 事实 → 解释 → 含义 (do not mix).
- Prefer 15–35 字 sentences; split >40 when possible.
- Keep necessary jargon (期限溢价、实际利率…); first mention may add a short gloss.
- Minimize AI tells: 值得注意的是 / 不难发现 / 可以看到 / 这说明 / 这意味着 / 需要指出的是 (not banned, do not stack).
- No 风暴/狂欢/史诗级/重磅 unless quoting a source.
- Prefer 市场定价显示 / 资金流数据显示 over 市场在恐慌.

## Process

```text
alice brief build-analysis … --output analysis.json
alice brief render-analysis … --output report.draft.md
# polish draft using this guide (LLM Editorial Pass)
alice brief editorial-check --analysis-json-file analysis.json --edited-file report.md
# only then publish / inbox
```

## Definition of Done (gate)

- [ ] Core numbers / dates / units / direction match Analysis Layer
- [ ] FACT not rewritten as OPINION; HYPOTHESIS not rewritten as FACT
- [ ] FORECAST stays conditional; data limitations not dropped
- [ ] Exec summary readable in ~30s; no meaningless data dumps
- [ ] If elegance fights fidelity → keep fidelity
