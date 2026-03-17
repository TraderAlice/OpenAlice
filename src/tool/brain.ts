import { tool } from 'ai';
import { z } from 'zod';
import type { Brain } from '@/domain/brain/Brain';

/**
 * Create brain AI tools (cognition + emotion)
 *
 * Tools:
 * - getFrontalLobe: Read working memory
 * - updateFrontalLobe: Update working memory (creates brain commit)
 * - getEmotion: Read emotional state + recent changes
 * - updateEmotion: Change emotional state with reason (creates brain commit)
 * - getBrainLog: View brain commit history
 */
export function createBrainTools(brain: Brain) {
  return {
    getFrontalLobe: tool({
      description: `
Read your own "memory space" from the last round - your self-assessment and notes that YOU wrote.

This is YOUR frontal lobe, where you previously saved:
- Your market trend assessment (bullish/bearish/uncertain)
- Current portfolio health evaluation
- Key predictions or expectations for upcoming rounds
- Important reminders to yourself (e.g., "Watch BTC support at $95k")

Use this FIRST in every round to maintain continuity in your thinking.
This helps you remember:
- What was your market view last round?
- What were you planning or expecting?
- Any important levels or conditions you were watching?

Returns: Your previous self-assessment as a string (empty if this is the first round).
      `.trim(),
      inputSchema: z.object({}),
      execute: () => {
        return brain.getFrontalLobe();
      },
    }),

    updateFrontalLobe: tool({
      description: `
Update your "frontal lobe" memory space with your current self-assessment.

Use this at the END of each round (after executing actions and writing summary) to save:
- Your current view on market trend (bullish/bearish/uncertain)
- Your assessment of portfolio health
- Key predictions or expectations for next rounds
- Important reminders to yourself (e.g., "Watch BTC support at $95k", "Plan to take profit at $100k")

This is YOUR personal memory that persists across rounds. Write it clearly and concisely (2-5 sentences) so your future self can quickly understand the current situation.

Example:
"Market is in strong uptrend, BTC holding above $97k support. Current long position is healthy with +15% PnL. Expecting continuation to $100k, will take partial profit there. Watch for reversal if we break below $95k."
      `.trim(),
      inputSchema: z.object({
        content: z
          .string()
          .describe(
            'Your self-assessment and notes (2-5 sentences, concise but informative)',
          ),
      }),
      execute: ({ content }) => {
        return brain.updateFrontalLobe(content);
      },
    }),

    getEmotion: tool({
      description:
        'Get your current emotional state and recent emotion changes. Use this to understand your own sentiment trajectory.',
      inputSchema: z.object({}),
      execute: () => {
        return brain.getEmotion();
      },
    }),

    updateEmotion: tool({
      description: `
Update your emotional state when you sense a shift in market sentiment or confidence level.
Record WHY the emotion changed — this creates a permanent commit in your brain log.

Common states: fearful, cautious, neutral, confident, euphoric

Example: updateEmotion("cautious", "BTC rejected at $100k resistance with declining volume")
      `.trim(),
      inputSchema: z.object({
        emotion: z
          .string()
          .describe(
            'New emotional state (e.g., "fearful", "cautious", "neutral", "confident", "euphoric")',
          ),
        reason: z
          .string()
          .describe('Why this emotional shift occurred'),
      }),
      execute: ({ emotion, reason }) => {
        return brain.updateEmotion(emotion, reason);
      },
    }),

    getBrainLog: tool({
      description:
        'View your brain commit history — a timeline of all cognitive state changes (frontal lobe updates and emotion shifts).',
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
