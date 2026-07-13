# Contributing to OpenAlice

Thanks for your interest in OpenAlice!

## Issues — Yes, Please

We actively welcome issues of all kinds:

- Bug reports
- Feature requests
- Questions about architecture or usage
- Ideas for improvement

The more detail you provide, the faster we can act on it. Screenshots, logs, and steps to reproduce are always helpful.

## Pull Requests — Welcome as Proposals

External pull requests are welcome. We read them carefully and treat good PRs as
high-signal contributions to the project.

That said, we still do **not directly merge external PR branches**. OpenAlice is
a trading agent that can connect to real broker accounts and API keys, so every
line of code that runs has a security and financial-risk surface. The project is
also still early: large architectural changes happen often, and maintainers need
to keep authorship and integration responsibility tight while those boundaries
are moving.

In practice:

- Open a PR when you have a concrete fix, design, refactor, or implementation
  idea.
- Target the `dev` branch by default. `master` is the stable user-facing lane
  and is reserved for maintainer promotions or emergency hotfixes.
- Explain the problem, the tradeoffs, and why the approach fits OpenAlice.
- Maintainers may use the PR as a reference, adapt it, or reimplement the idea
  internally before it lands.
- If your PR meaningfully shapes the project, we credit you in
  [`CONTRIBUTORS.md`](./CONTRIBUTORS.md). That public credit is the contribution
  record for externally proposed work, even when the final code is integrated by
  maintainers.

This policy is not about contribution quality. It is about keeping the trading
security surface controlled while still recognizing the people whose ideas,
reports, and PRs move the project forward.

## Other Ways to Contribute

Issues are still very welcome. If you've found a bug or have an idea, file it —
we read every issue and often ship fixes quickly. Screenshots, logs, repro steps,
broker/account mode, operating system, and expected-vs-actual behavior all help.

## Security Issues

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly. Responsible disclosure is appreciated.
