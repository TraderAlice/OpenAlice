import { tool } from 'ai';
import { z } from 'zod';
import type { Brain } from '@/domain/brain/Brain';

/**
 * Frontal-lobe tools — read/write Alice's personal notes that persist across
 * rounds (surviving session compaction).
 *
 * The strict rule enforced in these descriptions: these notes must be about
 * HER (commitments, attention targets, self-constraints, operating stances),
 * never about the WORLD (facts, predictions, market state). World-referring
 * content goes stale and pollutes later reasoning; self-referring content
 * stays valid until she chooses to change it.
 */
export function createBrainTools(brain: Brain) {
  return {
    getFrontalLobe: tool({
      description: `
Read your previous personal notes — things YOU committed to in earlier rounds.

These are *your* rules, attention targets, self-constraints, and operating
stances, not facts about the market. They persist across rounds so you can
maintain continuity in what you've decided to do, what you're watching for,
and the frame you've been working under.

Use this at the start of a round to recover the context of your own prior
decisions — what rules are still armed, what events you were waiting for,
what constraints you put on yourself.

Returns: your notes as a string (empty if nothing is set yet).
      `.trim(),
      inputSchema: z.object({}),
      execute: () => {
        return brain.getFrontalLobe();
      },
    }),

    updateFrontalLobe: tool({
      description: `
Update your personal notes — things that belong to YOU, not to the world.

These notes persist across rounds, so the rule is strict: write only content
that the world cannot falsify. World-referring content goes stale between
rounds and will pollute your future reasoning.

✅ Write:
- Conditional rules you've committed to: "If ETH reclaims 3800, add 10%"
- Events you're waiting on: "FOMC Thursday 14:00 — check policy signal"
- Self-constraints: "No new entries until macro clarity"
- Operating stances: "Running under consolidation assumption for BTC range"

❌ Do NOT write:
- Market state: "Market is in strong uptrend" — will be false by next round
- Derivable facts: "Position is +15% PnL" — query the tool instead
- Predictions: "BTC should reach 100k" — pollutes next round's reasoning
- Emotion/confidence: "Feeling confident about this" — not decision-relevant

Your notes replace the previous ones entirely each time — drop rules that
fired or expired, carry forward ones still active, add new ones.

Example (all self-referring, no world claims):
"If ETH reclaims 3800, add 10% to the long. Waiting on FOMC Thursday 14:00.
Holding off new entries until macro clarity. Running under consolidation
assumption for BTC range — flip if we break 98k or lose 94k."
      `.trim(),
      inputSchema: z.object({
        content: z
          .string()
          .describe(
            'Your personal notes (rules, attention targets, self-constraints, stances — not facts or predictions)',
          ),
      }),
      execute: ({ content }) => {
        return brain.updateFrontalLobe(content);
      },
    }),

    getBrainLog: tool({
      description:
        'View the history of your frontal-lobe updates — a timeline of how your committed rules, attention, and stances have evolved.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Number of recent commits to return (default: 10)'),
      }),
      execute: ({ limit }) => {
        return brain.log(limit);
      },
    }),
  };
}
