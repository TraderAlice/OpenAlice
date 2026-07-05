---
name: build-thesis
description: >
  Build a two-sided, falsifiable thesis on a specific name — the left side
  (does the number stand up, and where do you differ from consensus) and the
  right side (is the market itself favoring this — sector, capital, macro,
  trend). Use when the user has a ticker but no conviction yet: "is the NVDA
  thesis real", "build a thesis on X", "should I believe the X story", "bull
  and bear case for Y", "stress-test my view on Z", "is X already priced in",
  "left side or right side on X", "everyone's buying Y, should I". This is the
  have-a-name / no-conviction step — it picks up where a value-chain scan hands
  off ("the next question: is the thesis real?") and turns a name into a thesis
  you can act on and later monitor.
---

# Build a two-sided thesis on a name

Turn "everyone's talking about NVDA — should I believe it?" into a thesis with
a spine: what has to be true, where you differ from the crowd, and what would
prove you wrong.

Judge the name from BOTH sides. Most real money is medium- or short-term and
can't wait for value to revert — so the **right side** (is the market actually
favoring this?) is usually what drives realized P&L. Don't stop at "it's cheap."

## Procedure (don't answer from memory — run the tools)

The tools: `traderhub equity` for valuation / estimates / consensus,
`alice analysis quant` for relative strength, momentum, and z-score vs history,
`traderhub board` for the sector/macro frame, `alice rss grep` for the
narrative. (See the `traderhub`, `alice-analysis`, `alice` skills.)

0. **Anchor the comparison set.** The right side is *relative* — "strong" only
   means something against peers. If a value-chain map for this name's theme
   exists in the dossier (from `scan-value-chain`), use it as the peer/chain
   set. If not, sketch the chain first: without it you don't know what to
   compare against.

1. **State the claim** in one sentence — what has to happen for this to work.

2. **LEFT side — does the number stand up, and where do you differ from consensus?**
   - Your own quant: valuation against its own history and against chain peers;
     the 2–3 assumptions the value actually rests on.
   - Others' quant: where consensus / estimates sit — and the part that matters,
     your **variant view**: where you disagree with the street, and why. No
     variant view, no edge.
   - *What must be true (left):* the load-bearing valuation assumptions.
   - *Disconfirming signals (left):* what would break the fundamental case.

3. **RIGHT side — is the market itself favoring this?** (cross-sectional, on the
   chain from step 0)
   - Relative strength: this name vs its layer peers vs the chain vs the market —
     leader or laggard? (a laggard is either a left-side setup or a falling
     knife — say which.)
   - Where capital is rotating: into this node/name, or out of it. Flow data is
     thin — read it through price/volume momentum, market breadth (what's
     leading vs lagging), and the news narrative.
   - Sector + macro tailwind: is the whole chain on the right side of macro, or
     is this name swimming against it?
   - *What must be true (right):* the trend / flow / sector strength that must
     persist.
   - *Disconfirming signals (right):* momentum break, capital rotating out, the
     chain rolling over. (These are exactly the hooks a position monitor watches.)

4. **Consensus & priced-in.** Is this already the consensus trade? Has the easy
   money gone? A correct left+right thesis that everyone already holds is a
   crowded trade, not an edge — and the variant view is where any edge survives.

5. **Verdict.** Combine the sides → is the thesis real, and is the opportunity a
   **left-side entry** (early, cheap, market not yet confirming) or a
   **right-side entry** (market confirming, pay up for lower timing risk) — or
   neither. Often the chain map points you off the crowded leader toward a
   less-crowded name carrying the marginal strength.

## Output — write it into the dossier

Persist the thesis as `<theme>/notes/<TICKER>.md` in the dossier the value-chain
scan started (confirm the layout with the user if none exists — don't impose
one). The per-name note is the living thesis: the claim, both sides, what-must-
be-true, and the disconfirming-signal watchlist. Next session reads it and
updates it as the signals move — never re-derives from zero. The right-side
disconfirming signals are the baton to a position-monitor step. To act on the
verdict — size and place the trade through the approval flow — that's the
`alice-uta` skill.

## Worked example: NVDA (illustrative — run it fresh for any name)

**Claim:** NVDA keeps compounding data-center revenue because hyperscaler capex
hasn't peaked and it stays the market's chosen way to own AI silicon.

**Left:** rich vs its own history and vs the chain on most multiples — not a
value bargain. Consensus already models years of data-center growth; the only
variant views with edge are narrow ("does CoWoS/HBM supply cap the growth the
street is modeling?" / "does custom silicon — TPU, Trainium — quietly take
share?"). *Must be true:* capex doesn't peak, ~dominant accelerator share holds,
margins hold. *Breaks if:* a data-center guide-down, margin compression,
visible custom-silicon share loss.

**Right:** the leader of the AI-silicon chain, riding a whole-chain tailwind —
strong on relative-strength. But anchored on the chain map, the *marginal*
strength has migrated downstream of the headline name, to the HBM + advanced-
packaging bottleneck (MU / SK Hynix / Amkor). *Must be true:* the AI-capex
narrative persists and NVDA stays the chosen leader. *Breaks if:* momentum
rolls over, a "capex peak" narrative takes hold, money rotates from NVDA to the
laggards or out of the chain.

**Priced-in:** NVDA is *the* consensus AI trade — extremely crowded. Left+right
can both hold and the edge still be thin.

**Verdict:** left = fair-to-rich (no left-side bargain), right = leader but
crowded. The chain map's tell is that the cleaner right-side trade with less
crowding may be the bottleneck names, not NVDA itself — which is the kind of
call this two-sided + chain-anchored read surfaces and a single-name glance
misses.
