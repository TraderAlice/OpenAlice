# Contributing to OpenAlice

Thanks for your interest in OpenAlice!

## Issues — Yes, Please

We actively welcome issues of all kinds:

- Bug reports
- Feature requests
- Questions about architecture or usage
- Ideas for improvement

The more detail you provide, the faster we can act on it. Screenshots, logs, and steps to reproduce are always helpful.

## Pull Requests — Not Accepted

**We do not accept external pull requests.** This is not a reflection on the quality of contributions — it's a security decision.

OpenAlice is a trading agent that executes real financial operations. Every line of code that runs has direct access to exchange accounts and API keys. Accepting external code — even well-intentioned code — introduces supply chain risk that we cannot afford. A single malicious dependency update, a subtle logic change in order execution, or a backdoor in a utility function could result in real financial loss.

We review and implement all changes internally to maintain full control over the security surface.

## How to Contribute Without Code

The best way to help is to **open an issue**. If you've found a bug or have an idea, file it — we read every issue and often ship fixes the same day. Your feedback directly shapes the roadmap.

## Security Issues

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly. Responsible disclosure is appreciated.
