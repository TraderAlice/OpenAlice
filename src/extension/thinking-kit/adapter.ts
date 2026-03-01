import { tool } from 'ai';
import { z } from 'zod';
import { calculate } from './tools/calculate.tool';
import { readFile as fsReadFile } from 'fs/promises';
import { resolve } from 'path';

/**
 * Create thinking AI tools (cognition + utility, no data dependency)
 *
 * Tools:
 * - think: Record observations and analysis
 * - plan: Record action plans
 * - calculate: Safe mathematical expression evaluation
 * - readFile: Read the content of a local file
 * - reportWarning: Report anomalies or unexpected situations
 * - getConfirm: Request user confirmation before actions
 */
export function createThinkingTools() {
  return {
    think: tool({
      description: `
Use this to analyze current market situation and your observations.
Call this tool to:
- Summarize what you observe from market data, positions, and account
- Analyze what these observations mean
- Identify key factors influencing your decision

This is for analysis only. Use 'plan' tool separately to decide your next actions.
      `.trim(),
      inputSchema: z.object({
        observations: z
          .string()
          .describe(
            'What you currently observe from market data, positions, and account status',
          ),
        analysis: z
          .string()
          .describe(
            'Your analysis of the situation - what do these observations mean? What are the key factors?',
          ),
      }),
      execute: async () => {
        return {
          status: 'acknowledged',
          message:
            'Your analysis has been recorded. Now use the plan tool to decide your next actions.',
        };
      },
    }),

    plan: tool({
      description: `
Use this to plan your next trading actions based on your analysis.
Call this tool after using 'think' to:
- List possible actions you could take
- Decide which action to take and explain why
- Outline the specific steps you will execute

This commits you to a specific action plan before execution.
      `.trim(),
      inputSchema: z.object({
        options: z
          .array(z.string())
          .describe(
            'List of possible actions you could take (e.g., "Buy BTC", "Close ETH position", "Hold and wait")',
          ),
        decision: z
          .string()
          .describe(
            'Which option you choose and WHY - explain your reasoning for this specific choice',
          ),
        steps: z
          .array(z.string())
          .describe(
            'Specific steps you will execute (e.g., "1. placeOrder BTC buy $1000", "2. Set stop loss at $66000")',
          ),
      }),
      execute: async () => {
        return {
          status: 'acknowledged',
          message:
            'Your plan has been recorded. You may now execute the planned actions.',
        };
      },
    }),

    calculate: tool({
      description:
        'Perform mathematical calculations with precision. Use this for any arithmetic operations instead of calculating yourself. Supports basic operators: +, -, *, /, (), decimals.',
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            'Mathematical expression to evaluate, e.g. "100 / 50000", "(1000 * 0.1) / 2"',
          ),
      }),
      execute: ({ expression }) => {
        return calculate(expression);
      },
    }),

    readFile: tool({
      description: 'Reads the entire content of a file at the given local path and returns it as a string. Use this to inspect local files like configuration or scripts.',
      inputSchema: z.object({
        path: z.string().describe('The relative or absolute path to the file.'),
      }),
      execute: async ({ path }) => {
        try {
          // Resolve path to be relative to the project root for security
          const safePath = resolve(process.cwd(), path);
          // Basic jailbreak prevention
          if (!safePath.startsWith(process.cwd())) {
            return { error: 'Access denied. Path is outside the project directory.' };
          }
          const content = await fsReadFile(safePath, 'utf-8');
          return { content };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return { error: `File not found at ${path}` };
          }
          return { error: `Failed to read file: ${error.message}` };
        }
      },
    }),

    reportWarning: tool({
      description:
        'Report a warning when you detect anomalies or unexpected situations in the sandbox. Use this to alert about suspicious data, unexpected PnL, zero prices, or any other concerning conditions.',
      inputSchema: z.object({
        message: z.string().describe('Clear description of the warning'),
        details: z.string().describe('Additional details or context'),
      }),
      execute: async ({ message, details }) => {
        console.warn('\n⚠️  AI REPORTED WARNING:');
        console.warn(`   ${message}`);
        if (details) {
          console.warn('   Details:', details);
        }
        console.warn('');
        return { success: true, message: 'Warning logged' };
      },
    }),

    getConfirm: tool({
      description: `
Request user confirmation before executing an action.

Currently: Automatically approved.
In production environment: Will wait for user approval before proceeding.

Use this when you want to:
- Get approval for risky operations
- Ask for permission before major position changes
- Confirm strategy adjustments with the user

Example use cases:
- "I want to open a 10x leveraged position on BTC"
- "Should I close all positions due to negative market sentiment?"
- "Planning to switch from long to short strategy"
      `.trim(),
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            'Clear description of the action you want to perform and why',
          ),
      }),
      execute: async ({ action }) => {
        console.log('\n🤖 AI requesting confirmation:');
        console.log(`   Action: ${action}`);
        console.log('   ✅ Auto-approved');
        console.log('');
        return {
          approved: true,
          message: 'Approved automatically',
        };
      },
    }),
  };
}
