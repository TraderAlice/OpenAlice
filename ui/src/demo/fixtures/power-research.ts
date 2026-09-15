import type { WebConversationMessage } from '../../components/workspace/api'

export const POWER_SESSION_ID = 'demo-power-session'
export const POWER_RESUME_ID = 'demo-power-resume'
export const POWER_REPORT_PATH = 'research/data-center-power.md'
export const POWER_RISK_PATH = 'research/power-risk-checklist.md'

export const powerReport = `# From AI demand to power delivery

> Illustrative demo scenario. Prices, changes and evidence below are synthetic snapshots, not live market research.

## The morning signal

VST led the watchlist at **+7.4% on 3.1× relative volume**. VRT rose **4.2% on 2.0×**. Both fit the AI infrastructure theme, but they sell different parts of the stack.

| Company | Exposure | What would confirm the thesis | What could break it |
| --- | --- | --- | --- |
| VST | Power generation and contracted supply | Signed long-duration contracts with credible delivery dates | Interconnection delays; economics already in the price |
| VRT | Power distribution and cooling equipment | Orders converting into revenue without margin pressure | Customer concentration; stretched lead times |
| CEG | Nuclear generation | Contract pricing and regulatory clarity | Approval delays; restart cost overruns |

## Follow the bottleneck

Compute demand → energized capacity → power distribution → cooling → usable racks.

A headline about planned megawatts is not the same as delivered electricity. Our highest-value follow-up is the bridge between **announced demand, contracted supply and actual commissioning**.

## Evidence ledger

| Demo source | Observation | Confidence |
| --- | --- | --- |
| Morning price/volume snapshot | VST and VRT outperform the watchlist | High for the snapshot; low for causality |
| Contract announcement excerpt | Multi-year supply discussed; commissioning date conditional | Medium |
| Equipment order summary | Cooling demand firm; backlog conversion needs another quarter | Medium |

These are scenario fixtures. A live run would attach dated primary filings and source links before treating the thesis as verified.

## Decision

Keep VST and VRT on the research watchlist. **No trade proposed.** A price gap alone does not establish risk/reward. Separate the generation and equipment theses before sizing anything.

## Next review

The recurring **Morning movers scan** checks fresh announcements and volume each weekday at 08:30 New York time. Publish only material changes. Use the risk checklist before escalating a candidate.
`

export const powerRiskChecklist = `# Power thesis — risk checklist

> Synthetic demo research; no broker action or live analysis.

- [ ] Confirm whether announced capacity is contracted, permitted and connected.
- [ ] Compare contract duration and pricing with the existing valuation assumption.
- [ ] Check customer concentration and backlog conversion for equipment suppliers.
- [ ] Separate share-price momentum from new fundamental evidence.
- [ ] Review portfolio overlap before proposing any position.

**Invalidation:** repeated commissioning delays or weaker order conversion while valuation keeps expanding.

**Notification threshold:** a signed contract, a material delivery delay, or a change in the risk assumptions. Quiet scans remain in the run history.
`

export const powerMessages: readonly WebConversationMessage[] = [
  { role: 'user', content: 'VST and VRT are both moving. Is this one AI power trade, or two different theses?' },
  { role: 'assistant', content: [
    { type: 'text', text: 'I’ll separate generation from equipment, then compare the morning snapshot with the research notes.' },
    { type: 'toolCall', id: 'power-read', name: 'read', arguments: { path: 'reports/movers-2026-06-27.md' } },
  ] },
  { role: 'toolResult', toolCallId: 'power-read', toolName: 'read', isError: false,
    content: 'Demo snapshot: VST +7.4%, RVOL 3.1x; VRT +4.2%, RVOL 2.0x. Catalyst classification: data-center power demand. No trade submitted.' },
  { role: 'assistant', content: [
    { type: 'toolCall', id: 'power-report', name: 'write', arguments: { path: POWER_REPORT_PATH, content: powerReport } },
  ] },
  { role: 'toolResult', toolCallId: 'power-report', toolName: 'write', isError: false, content: `Saved ${POWER_REPORT_PATH}` },
  { role: 'assistant', content: [{ type: 'text', text: 'They share a demand driver, but the risks differ. **VST needs credible power delivery and contract economics. VRT needs equipment orders to convert into revenue.**\n\nThe common bottleneck is getting capacity energized, not merely announcing more compute. I’ve captured the comparison and evidence gaps in the report.\n\nThis is an illustrative demo snapshot; there is no live recommendation or order.' }] },
  { role: 'user', content: 'What would make you change your mind? Keep watching it, but only tell me when something material changes.' },
  { role: 'assistant', content: [
    { type: 'toolCall', id: 'power-risk', name: 'write', arguments: { path: POWER_RISK_PATH, content: powerRiskChecklist } },
  ] },
  { role: 'toolResult', toolCallId: 'power-risk', toolName: 'write', isError: false, content: `Saved ${POWER_RISK_PATH}. Existing recurring Morning movers scan includes this watchlist.` },
  { role: 'assistant', content: [{ type: 'text', text: '**Three things would weaken the thesis:** commissioning slips, poor backlog conversion, or a valuation that outruns the contract economics.\n\nThe existing weekday morning scan covers VST and VRT. Its review brief calls for material updates only; quiet runs stay in history. The report and risk checklist are ready in Inbox and Files.\n\n**No trade was placed.**' }] },
]
