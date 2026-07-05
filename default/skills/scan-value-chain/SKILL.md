---
name: scan-value-chain
description: >
  Scan an investment theme by decomposing its value chain, then surface the
  handful of names actually worth researching — each with why and the next
  question. Use when the user has a theme/sector/thread but no specific
  ticker yet: "what's worth looking at in semis", "scan the AI-infra space",
  "I'm curious about uranium / obesity drugs / power grid",
  "who are the picks-and-shovels in X", "map the supply chain for Y",
  "find the names worth watching in the X value chain". This is the
  have-a-theme / no-target step —
  it turns "I don't know what to look at" into a short, reasoned shortlist.
---

# Scan a theme by its value chain

Turn a theme the user can't yet act on into a short list of names worth
digging into. The point is NOT a data dump — it's "where is the interesting
thing, and why."

## Procedure (don't answer from memory — go to the data)

The data is on your CLIs: `alice market search` to turn a name into a barId,
`traderhub equity` / `traderhub board` for valuation snapshots & macro,
`alice analysis quant` for where each trades vs its own trend, `alice rss grep`
for the news cluster. (See the `alice`, `alice-analysis`, `traderhub` skills.)

1. **Decompose the chain, not a flat list.** Break the theme into structural
   layers — upstream (inputs, equipment, IP) → midstream (manufacture, core
   product) → downstream (demand, end-market). Place the real names in each
   layer. The value is the structure itself: who supplies whom, where the
   margin/bottleneck sits, who's a picks-and-shovels play. This is the
   meta-method — apply it to ANY theme, don't hardcode one taxonomy.
2. **Quick read per node.** Across the candidates, pull a quick read from the
   data: a valuation snapshot, any near-term catalysts, and where each trades
   vs its own trend (stretched or basing). Wide and cheap — you're triaging,
   not deep-diving.
3. **Find the divergence.** Surface 3–6 names where there's something to pull
   on: cheap vs its layer, margin shifting along the chain, a catalyst close,
   a leader/laggard gap. Drop the rest — a scan that returns everything
   returns nothing.
4. **Frame the top-down driver.** Is the theme live right now? Tie it to macro
   — the rate/capex cycle, energy, any news cluster around the theme — the
   macro frame is what separates a live theme from noise.
5. **Hand off to research.** For each surfaced name: one-line WHY + the next
   question to answer (the "is the thesis real" question). That next question
   is the baton to the deeper research step — the `build-thesis` skill.

## Output — persist as a file group, don't leave it in chat

Workspace sessions can be destroyed at any time; anything not written to a
file is lost. And coding-ifying the workflow is core to this project —
research that produces no files is a contradiction. So the result of a scan
must land in files.

- **First time on a theme:** propose a small file/directory layout and confirm
  it with the user before writing — the shortlist, per-name notes, the chain
  map, whatever this theme needs. Don't hardcode a layout from this skill;
  settle the shape WITH the user, per theme.
- **After that:** the agreed file group IS the dossier. Every session just
  CRUDs it — read it, update it, add to it. File-based, git-trackable,
  survives session loss. That's the coding workflow.

The shortlist and the per-name "next question" from the procedure above are
what get written down — so the next session starts from them, not from zero.

## Worked example: semiconductors

One theme, worked end to end. Decompose freshly for any other theme — don't
pattern-match these layers (a drug theme, say, layers differently: discovery
/ developer → CDMO manufacturing → distribution / PBM → payer).

**Decompose the chain** (representative names, not exhaustive):

- **Upstream — tools & IP** (most concentrated moats):
  - EDA / IP: Cadence (CDNS), Synopsys (SNPS), Arm (ARM)
  - Equipment (WFE): ASML (ASML — sole EUV supplier), Applied Materials
    (AMAT), Lam (LRCX), KLA (KLAC), Tokyo Electron (8035.T)
  - Materials: wafers (Shin-Etsu, SUMCO), photoresist / specialty chemicals
- **Midstream — make & design:**
  - Foundry (pure-play make): TSMC (TSM), GlobalFoundries (GFS), SMIC
  - IDM (design + make): Intel (INTC), Samsung, Texas Instruments (TXN)
  - Fabless (design only): NVIDIA (NVDA), AMD (AMD), Broadcom (AVGO),
    Marvell (MRVL), Qualcomm (QCOM)
  - Memory: Micron (MU), SK Hynix, Samsung — DRAM / NAND / **HBM**
  - Packaging & test (OSAT): ASE (ASX), Amkor (AMKR) — **advanced packaging**
- **Downstream — demand:** hyperscalers (MSFT / GOOGL / META / AMZN — also
  rolling their own silicon: TPU, Trainium, MTIA, Maia), devices (AAPL),
  auto / industrial, servers (SMCI, DELL)

**Where the tension is right now** — this is what a scan surfaces, not the
full roster: the binding constraint for AI silicon has migrated from
leading-edge logic to **HBM + advanced packaging (CoWoS)**, so Micron /
SK Hynix and TSM's CoWoS capacity + Amkor deserve more attention than the
headline GPU names. ASML is the single most concentrated upstream choke point.

**Top-down frame:** semis run on three clocks — hyperscaler
**capex**, the **rate** cycle (long-duration growth multiples), and the
**memory inventory / pricing** cycle. Tie the scan to these via the macro and
news data.

**Proposed file structure** (confirm / adjust with the user — don't impose):

```
semis/
  map.md         # chain decomposition + where the tension sits + macro frame
  shortlist.md   # the 3–6 names to dig now: one-line why + next question each
  notes/         # per-name research, added as you climb scan → thesis (R3+)
    NVDA.md
    MU.md
    ...
```

`map.md` and `shortlist.md` are produced by this scan; `notes/<name>.md` grow
later as specific names get researched. The next session reads `shortlist.md`
and continues — never a cold start.
