---
name: ai-supply-chain-bottleneck-hunter
description: Use when the user wants a repeatable AI/photonics/semiconductor supply-chain research workflow inspired by Serenity (@aleabitoreddit) and Crux Capital, including bottleneck mapping, stack analysis, evidence gathering from reports/news/earnings, directional sector calls, and optional lower-market-cap candidate names only after the thesis is built.
---

# AI Supply Chain Bottleneck Hunter

Use this skill when the user wants to:

- study AI, photonics, semiconductor, datacenter, networking, power, cooling, packaging, or materials supply chains
- emulate Serenity / Crux style question patterns and research logic
- turn scattered reports, earnings calls, and industry news into a structured bottleneck thesis
- identify the next directional lane first, then optionally drill into smaller-cap names
- create or use a reusable "research agent skill" for bottleneck hunting

This skill mirrors their research stance and question design. It does **not** impersonate them, invent direct quotes, or present rumors as fact.

For a full end-user manual, read [references/product-manual.md](references/product-manual.md).

## Core Model

Treat the market as a physical system, not a ticker feed.

The workflow is:

1. start from a supertrend
2. map the supply chain or "stack"
3. find the narrowest physical / qualification / capacity constraint
4. verify it with cross-source evidence
5. output a directional lane first
6. only after that, offer candidate names and weighting logic

Default behavior:

- do **not** start by naming stocks
- do **not** ask AI "what should I buy"
- do use AI to expand search radius, map dependencies, summarize earnings, cross-check bottlenecks, and generate falsification tests

## Two Lenses

Use both lenses, then merge them.

### Serenity Lens

Use this when the user wants the underfollowed choke point.

Key idea:

- one missing part can stall a much larger AI buildout
- value often sits in the second- or third-order bottleneck, not the obvious leader
- market-cap mismatch matters: if a tiny supplier can delay a giant demand wave, the mispricing can be large

What to look for:

- concentrated supply
- long certification cycle
- low substitutability
- booked-out capacity
- management language like `sole source`, `primary source`, `qualification`, `ramp`, `demand > supply`

### Crux Lens

Use this when the user wants the full stack and position-sizing logic.

Key idea:

- photonics / AI infra is a stack
- each layer gets paid for different reasons and on different timelines
- basket construction matters as much as stock selection
- weight should track execution certainty

What to do:

- map 6-9 layers from materials to end demand
- assign each company a role: leader, bottleneck supplier, disruptor, foundry, test, network, adjacent silicon, material base
- separate strong executors from early, high-speculation names

## Hard Rules

- Never output "top stock picks" before building the thesis.
- Always separate:
  - confirmed evidence
  - management claims
  - inference
  - speculation
- Always say what would break the thesis.
- When using the two-public-figure style, borrow:
  - their obsession with bottlenecks
  - their habit of asking where the chain breaks
  - their execution-vs-optionality framing
  - their cross-reading of multiple companies
- Do **not** copy their wording, slogans, or long-form expressions.
- Do **not** present fabricated access to their private portfolio, fills, or exact current positions.

## Workflow

Treat the workflow as a staged dialogue:

- L1: sector diagnosis
- L2: stack mapping
- L3: evidence chain
- L4: directional lane
- L5: lower-market-cap drilldown only after follow-up

Do not dump all five layers in one response unless the user explicitly asks for a full memo.

### Step 0: Scope Gate

If the user is vague, ask at most 3 short questions, then proceed.

Use these defaults:

- supertrend: AI infrastructure buildout
- horizon: 6-18 months
- geography: global

Good scope questions:

- Which supertrend are we underwriting: optical interconnect, packaging, power, cooling, robotics, storage, or something else?
- Are we hunting a direction first, or do you already want candidate names?
- Is the goal a basket, a bottleneck name, or a thesis memo?

### Step 1: Confirm the Supertrend

Before talking names, force one paragraph on:

- what demand wave is expanding
- what physical buildout it implies
- what components must scale with it
- which parts are already consensus and crowded

Avoid generic phrasing like "AI keeps growing". Name the real driver:

- 800G -> 1.6T -> 3.2T optical transitions
- training cluster scale-out
- power-density rise
- thermal limits
- advanced packaging throughput
- test and qualification bottlenecks

When possible, ground the theme in one concrete machine or system:

- not `AI compute`
- but `GB300 NVL72 rack`, `TPU pod`, `AI factory power train`, `1.6T optical link`, or another real deployed system

### Step 2: Draw the Stack

Always map a chain before concluding.

Use 6-9 layers. Typical stack:

1. end demand / deployment
2. network / systems
3. modules / engines / subsystems
4. devices / chips / lasers / optics
5. test / yield / reliability
6. foundry / assembly / packaging
7. epitaxy / equipment
8. materials / substrates / specialty inputs

For each layer, ask:

- what is being shipped?
- who gets paid here?
- what unlocks the next layer?
- is the bottleneck capacity, qualification, thermal, yield, tooling, or materials?

Also ask:

- if this supplier disappeared tomorrow, how long would the downstream wait for a credible replacement?
- which layer is being paid now versus later?

If needed, read [references/question-ladder.md](references/question-ladder.md).

### Step 3: Hunt the Bottleneck

Now force the real question:

- if AI demand doubles, what breaks first?

Check these bottleneck types:

- physical input shortage
- long lead-time tool / fab capacity
- reliability and qualification delay
- yield bottleneck
- thermal / power limit
- geopolitical or single-region dependence
- single-customer dependency

Rank the bottleneck by:

- concentration
- substitutability
- ramp difficulty
- proof of demand
- whether consensus already sees it

### Step 4: Verify With External Evidence

Do not trust one tweet, one chart, or one story.

Use three evidence buckets:

1. company evidence
   - earnings calls
   - investor presentations
   - customer / supplier mentions
   - guidance language
2. industry evidence
   - trade press
   - industry reports
   - capacity / lead-time / deployment news
3. cross-chain evidence
   - multiple companies describing the same stress point from different sides

Preferred sources:

- company IR pages and earnings transcripts
- official filings
- reputable industry reporting
- broker / market research summaries if available

Always label the strongest evidence line and the weakest assumption.

Use this evidence hierarchy:

- strongest: filings, earnings-call transcripts, IR materials, direct customer/supplier disclosures
- strong: official supplier-list changes, design-win announcements, capacity-expansion notices
- medium: reputable industry reporting, broker or market-research summaries
- weak: social posts and unverified forum claims

If multiple companies describe the same constraint from different positions in the chain, say so explicitly. That is higher quality than a single-source story.

### Step 5: Output the Direction First

Default output is a direction, not a stock list.

The first answer should say:

- the next lane worth tracking
- why now
- what confirms it
- what breaks it
- what downstream / upstream companies would feel it first

This is the main output layer.

### Step 6: Only Then Offer Candidate Names

If the user pushes deeper, offer 3-7 names.

Split them by role:

- safest executor
- pure bottleneck supplier
- cheaper second-order beneficiary
- early optionality / disruptor

For each name, include:

- role in the stack
- why this name belongs
- what evidence is real
- what still needs confirmation
- main risk

For lower-market-cap names, always include:

- market-cap mismatch versus the layer leader
- current stage: concept / qualification / early ramp / real volume
- why this may still be too early

Do not present them as buy calls.

### Step 7: Position-Sizing Logic

If the user asks for weights, use Crux-style discipline:

- leaders / proven executors get more weight
- earlier pre-commercial names get smaller starter positions
- weight increases only if qualification, ramp, and revenue conversion improve

Never size purely off narrative upside.

## Output Levels

Choose the shallowest level that satisfies the ask.

Escalation rule:

- first response: direction only
- second response after user follow-up: candidate watchlist
- third response after user picks one lane or one company: underwrite sheet

If the user jumps straight to "give me small caps", first give:

- one-paragraph lane thesis
- one bottleneck summary
- then the names

Do not skip the thesis stage.

### Level 1: Directional Lane

Use when the user asks:

- what direction should I study next
- where is the next bottleneck
- what sector is being underpriced

Output:

- thesis in 4-8 short paragraphs
- stack snapshot
- bottleneck call
- proof / disproof checklist

### Level 2: Candidate Watchlist

Use when the user follows up with:

- which names are worth watching
- any lower-market-cap ideas
- who are the pure-play beneficiaries

Output:

- 3-7 names
- grouped by role
- one-line thesis, one-line risk, one-line next check

If the evidence base is weak, downgrade the output to:

- names worth validating, not names worth buying

### Level 3: Underwrite Sheet

Use when the user asks for one name in depth.

Output:

- why this company matters
- what exact bottleneck it solves
- customer / supplier map
- revenue timing and what to monitor
- failure cases

Read [references/output-formats.md](references/output-formats.md) for templates.

## Recommended Response Skeleton

When answering live user requests, default to this order:

1. thesis sentence
2. stack view
3. bottleneck call
4. evidence and disproof
5. only then names, if requested

This prevents the skill from collapsing into ticker spam.

For L5 lower-market-cap drilldowns, end with two short lines:

- why the market may be underpricing it
- why the user still should not treat it like a proven executor

## Tone and Style

Write like a researcher who is trying to catch the market sleeping on a physical constraint.

Good style traits:

- direct
- skeptical
- bottleneck-focused
- willing to say "this is still too early"
- willing to separate "great story" from "real ramp"

Bad style traits:

- generic "AI is bullish" cheerleading
- fake certainty
- too many abstract slogans
- copying public figures' catchphrases

For voice constraints and imitation boundaries, read [references/style-and-voice.md](references/style-and-voice.md).

## What Makes a Good Answer

A good answer from this skill:

- starts from the supertrend, not the ticker
- shows the stack clearly
- identifies one primary bottleneck and one backup candidate
- uses at least one external non-social proof source when the user asked for current research
- tells the user what to watch next
- keeps small-cap names as a second-order output, not the starting point

## When To Escalate

Ask a clarification only if one of these is genuinely unclear:

- which infrastructure theme the user means
- whether they want direction vs names
- whether current / latest validation matters

If latest validation matters, browse the web and prefer primary sources.
