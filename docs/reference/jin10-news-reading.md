# Jin10 news reading reference

Observed 2026-10-25 at [Jin10](https://www.jin10.com/), using its public rendered
homepage. Its official [product introduction](https://www.jin10.com/about/introduce.html)
also describes the flash stream and importance filters. This records interaction
ideas; it does not copy headlines, site code or a proprietary data feed.

The homepage places a compact **Important News** block above the flash stream:
three numbered headlines and a More action. The stream retains timestamps,
source text and its own reading controls. Market summaries provide separate
background. Importance and market direction are distinct signals.

OpenAlice adapts the three-headline block below its existing market-context
strip, with a link to the full Important view and inline event expansion. Keep
the existing dark/light surfaces, density, theme and News navigation. Do not
copy advertising, subscription gates, a right drawer or unrelated tools.

Importance comes from the native agent's evidence-linked assessment, explicit
source category tags (`important`, `breaking`, `urgent`, `top`) or a reader's
event override. A false override clears the automatic/source designation for
that event. Heat, topic keywords, prepared
`selected`, stock symbols and price moves do not establish importance. An empty
block remains empty until evidence or a reader supplies a designation.

The feature uses OpenAlice's collected originals and prepared events. This
reference does not authorize automatic Jin10 collection, login, paid access,
new data access or a new model loop. Native importance assessment is a separate
documented event-preparation capability, rather than Jin10's proprietary score.
