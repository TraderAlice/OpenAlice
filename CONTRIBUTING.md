# Contributing to OpenAlice

Thanks for your interest in OpenAlice!

## Issues — Yes, Please

We actively welcome issues of all kinds:

- Bug reports
- Feature requests
- Questions about architecture or usage
- Ideas for improvement

The more detail you provide, the faster we can understand and act on it.
Screenshots, logs, and steps to reproduce are always helpful. For a bug, please
show both why you believe the problem exists and what behavior you expected
instead.

## Pull Requests — Welcome

External pull requests are welcome. We read them carefully, and we are happy to
merge contributions that have a clear purpose, fit the product, and carry
enough evidence for us to review them responsibly.

OpenAlice is a trading agent that can connect to real broker accounts and API
keys. Changes involving credentials, dependencies, permissions, persistence,
trading, or other security-sensitive boundaries will receive additional review
and may require stronger validation before they can be merged. This is a review
requirement, not a reason to reject community ownership of good work.

In practice, please:

- Open a PR when you have a concrete fix, design, refactor, or implementation
  idea.
- Target the `dev` branch by default. `master` is the stable user-facing lane
  and is reserved for maintainer promotions or emergency hotfixes.
- Explain the problem, why it matters, the approach you chose, and the tradeoffs
  you considered.
- Keep each PR reviewable. If a change establishes a new foundation and then
  applies it across several product surfaces, split it into coherent increments
  that can be discussed, tested, and reverted independently.
- Include the commands you ran and the relevant results. If a required check
  could not be run, say so and describe the remaining risk.
- Stay involved in review. We prefer to ask the original contributor to revise
  an accepted direction instead of taking the work away and rewriting it.

### UI and UX contributions

UI and UX changes need an explicit design point of view. Include screenshots or
a short recording of the affected surface, describe the user problem, and
explain the interaction or visual principles behind your proposal. For a visual
change, show the before and after states whenever possible. A polished screenshot
without the reasoning behind it is difficult to evaluate because maintainers
need to judge whether the idea belongs in OpenAlice, not only whether it looks
finished.

For broad redesigns, start with an issue or discussion and separate shared
visual primitives from route-level changes. Please call out responsive behavior,
keyboard and focus behavior, reduced-motion implications, and any shared
component that the change introduces or replaces.

### Bug fixes

A bug-fix PR should contain enough evidence to establish both sides of the
claim:

- the problem exists, with reproduction steps, logs, screenshots, a failing
  test, or another concrete observation; and
- the proposed change fixes it, with a passing regression test and/or a verified
  walk through the real affected surface.

Please distinguish the root cause from the visible symptom. A green unrelated
test suite is not evidence that the reported behavior was fixed.

### AI-assisted contributions

AI-assisted contributions are welcome. OpenAlice itself is developed with
extensive use of coding agents, so we do not judge a contribution by whether AI
helped write it.

We do expect the reason for a contribution to come from a person who has thought
carefully about the product. The author should be able to explain the observed
problem, the desired outcome, the chosen tradeoffs, and the evidence that the
result works. Please do not submit issues or PRs produced by an automated sweep
that merely searches for possible changes and generates patches at scale. More
code is not automatically a better product.

We are especially glad to discuss and accept issues and PRs that show a complete
human point of view, use AI as a capable implementation tool, and remain owned
by the contributor through review and validation.

## Other Ways to Contribute

Documentation, testing, translations, and careful product feedback are also
valuable. If you've found a bug or have an idea but are not ready to implement
it, file an issue — we read every issue. Screenshots, logs, reproduction steps,
broker/account mode, operating system, and expected-vs-actual behavior all help.

## Security Issues

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly. Responsible disclosure is appreciated.
