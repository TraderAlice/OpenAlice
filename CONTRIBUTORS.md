# Contributors

OpenAlice is shaped by the people who dig into it with us — and this page is the
record of who they are and what each one moved. The project stays open; if your
work left a mark on it, you belong here.

## How recognition works

- If your **report, idea, design, or review** shaped a change, you're credited
  here — with a link to the actual change you influenced. A real record, not
  just a name on a wall.
- **Credit types:**
  🤔 ideas · 🎨 design · 🐛 bug report · 👀 review · 💬 question answered ·
  📖 docs · 🛡️ security · 🌍 translation · 💻 code _(rare — reimplemented with
  your consent)_
- **How to earn one:** open an
  [issue](https://github.com/TraderAlice/OpenAlice/issues) or PR with an idea,
  report, design, or implementation proposal. If it lands in the project, we add
  you. Think we missed crediting you? Say so in an issue or on Discord — we'll
  fix it.
- **Standouts (⭐):** a few people go notably above and beyond — high-signal,
  consistent, often right. They sit at the top.

## The roll

<!--
  Maintainer note — adding someone:
    • Put standouts (⭐) first; everyone else below, newest-ish at the bottom.
    • The avatar comes free from  https://github.com/<handle>.png  — no token.
    • Link each "Shaped" item to the PR / commit / issue it influenced.
    • Pick credit emoji from the list above; honesty over generosity isn't the
      goal here — credit them for what they actually moved.

  Row template (copy this):

  | ⭐ | <a href="https://github.com/HANDLE"><img src="https://github.com/HANDLE.png" width="40" height="40" alt="@HANDLE" /></a><br>[@HANDLE](https://github.com/HANDLE) | 🤔 🎨 | [what they shaped](LINK) |
-->

| | Contributor | Credits | Shaped |
|:--:|---|:--:|---|
| ⭐ | <a href="https://github.com/bakabird"><img src="https://github.com/bakabird.png" width="40" height="40" alt="@bakabird" /></a><br>[@bakabird](https://github.com/bakabird) | 🐛 🤔 🎨 | UTA robustness and risk correctness — [typed CCXT custom toggles (#283)](https://github.com/TraderAlice/OpenAlice/issues/283), [partial-tolerant portfolio aggregation (#390)](https://github.com/TraderAlice/OpenAlice/issues/390), [proxy-aware CCXT connections (#384)](https://github.com/TraderAlice/OpenAlice/issues/384), and [position leverage / liquidation / margin visibility (#387)](https://github.com/TraderAlice/OpenAlice/issues/387)<br>Workspace and runtime usability — [configurable local ports (#282)](https://github.com/TraderAlice/OpenAlice/issues/282), [a current Codex model catalog (#284)](https://github.com/TraderAlice/OpenAlice/issues/284), [Workspace and Session renaming (#385)](https://github.com/TraderAlice/OpenAlice/issues/385), [subscription-login-aware onboarding (#465)](https://github.com/TraderAlice/OpenAlice/issues/465), [Issue model/effort overrides (#706)](https://github.com/TraderAlice/OpenAlice/issues/706), and [durable Workspace model defaults (#710)](https://github.com/TraderAlice/OpenAlice/issues/710)<br>Research and reading UX — [actionable yfinance failures (#375)](https://github.com/TraderAlice/OpenAlice/issues/375), [Inbox Markdown export (#411)](https://github.com/TraderAlice/OpenAlice/issues/411), [Tracked navigation recovery (#412)](https://github.com/TraderAlice/OpenAlice/issues/412), and [an auto-growing WebPi composer (#711)](https://github.com/TraderAlice/OpenAlice/issues/711) |
| | <a href="https://github.com/2233admin"><img src="https://github.com/2233admin.png" width="40" height="40" alt="@2233admin" /></a><br>[@2233admin](https://github.com/2233admin) | 🎨 🐛 | [Linear dark-shell design pass — palette & navigation density re-traced into the app](https://github.com/TraderAlice/OpenAlice/pull/302)<br>[Windows guardian launch fix — `tsx` not resolving to its `.CMD` shim for `cmd.exe`-spawned children, reimplemented in-house](https://github.com/TraderAlice/OpenAlice/pull/378) |
| | <a href="https://github.com/lvysssss"><img src="https://github.com/lvysssss.png" width="40" height="40" alt="@lvysssss" /></a><br>[@lvysssss](https://github.com/lvysssss) | 🐛 🤔 | [Windows workspace-launch blockers — diagnosed the bootstrap path/bash failures and the extensionless CLI-shim file-association dialog, with verified repros](https://github.com/TraderAlice/OpenAlice/issues/364) |
| | <a href="https://github.com/walkonbothsides"><img src="https://github.com/walkonbothsides.png" width="40" height="40" alt="@walkonbothsides" /></a><br>[@walkonbothsides](https://github.com/walkonbothsides) | 🐛 | [OKX showed no spot holdings — reported the broker reporting no spot, which traced to a partial CCXT market-load that silently dropped spot markets and understated netLiquidation](https://github.com/TraderAlice/OpenAlice/commit/d7711887a19629414698678827a79a405797f17d) |
| | <a href="https://github.com/bakabaka0613"><img src="https://github.com/bakabaka0613.png" width="40" height="40" alt="@bakabaka0613" /></a><br>[@bakabaka0613](https://github.com/bakabaka0613) | 🤔 🎨 | [Native TWSE/TPEx data provider — raised the Taiwan-equity need and the Yahoo-suffix-symbol approach (history served via yfinance), reimplemented in-house](https://github.com/TraderAlice/OpenAlice/pull/285) |
| | <a href="https://github.com/JasonWang1124"><img src="https://github.com/JasonWang1124.png" width="40" height="40" alt="@JasonWang1124" /></a><br>[@JasonWang1124](https://github.com/JasonWang1124) | 🤔 | [Earliest call for Taiwan-equity (TWSE/TPEx) market data — raised the need back in April 2026 (#109, #110), long before it shipped as a native vendor](https://github.com/TraderAlice/OpenAlice/issues/109) |
| | <a href="https://github.com/rudyll"><img src="https://github.com/rudyll.png" width="40" height="40" alt="@rudyll" /></a><br>[@rudyll](https://github.com/rudyll) | 🤔 🎨 | [Richer contract rows — surfacing the instrument long-name + primary listing exchange on position/order rows (follow-up to #335)](https://github.com/TraderAlice/OpenAlice/issues/340), reimplemented via a cached catalog join |
| | <a href="https://github.com/jalilsedna"><img src="https://github.com/jalilsedna.png" width="40" height="40" alt="@jalilsedna" /></a><br>[@jalilsedna](https://github.com/jalilsedna) | 🐛 🤔 | [IBKR forex contract resolution — traced the bare-conId order failure to the `SMART`/`USD` fallback diverging from quote resolution and proposed a shared canonical-contract lookup (#345)](https://github.com/TraderAlice/OpenAlice/pull/345), which led to the broader in-house fix across quote, place, modify, and close paths in [#655](https://github.com/TraderAlice/OpenAlice/pull/655) |
| | <a href="https://github.com/dbydd"><img src="https://github.com/dbydd.png" width="40" height="40" alt="@dbydd" /></a><br>[@dbydd](https://github.com/dbydd) | 🐛 🤔 🎨 | [Pi global + Workspace configuration layering and model reasoning capabilities (#662)](https://github.com/TraderAlice/OpenAlice/issues/662) — an unusually complete two-part reproduction that drove the native project-overlay architecture, safe migration of legacy `.pi-agent` state, and explicit reasoning-capability round trips in [#670](https://github.com/TraderAlice/OpenAlice/pull/670) |
| | <a href="https://github.com/enderzcx"><img src="https://github.com/enderzcx.png" width="40" height="40" alt="@enderzcx" /></a><br>[@enderzcx](https://github.com/enderzcx) | 🐛 🤔 | [Bitget Classic account-state blind spots (#951)](https://github.com/TraderAlice/OpenAlice/pull/951) — traced healthy-looking unscoped CCXT reads that omitted USDT-M funds and conditional-order namespaces, leading to the in-house Classic account model and routing fix |

---

_This is the credits list (`CONTRIBUTORS`), not the contribution guide. For the
rules — what we accept and why — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)._
