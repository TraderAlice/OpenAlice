export type DesignVariantLayout =
  | 'safe-launch'
  | 'mode-ladder'
  | 'goal-picker'
  | 'quiet-checklist'
  | 'semantic-colors'

export interface DesignVariant {
  id: string
  name: string
  summary: string
  intent: string
  risk: string
  layout: DesignVariantLayout
}

export interface DesignProject {
  slug: string
  title: string
  eyebrow: string
  status: string
  updatedAt: string
  context: {
    why: string
    goals: string[]
    constraints: string[]
    openQuestions: string[]
  }
  variants: DesignVariant[]
}

export const designProjects: DesignProject[] = [
  {
    slug: 'semantic-colors',
    title: 'Semantic color system',
    eyebrow: 'Living color card',
    status: 'Current implementation',
    updatedAt: '2026-07-18',
    context: {
      why: 'OpenAlice used separate physical color names, Tailwind palette shades, chart literals, and Workspace aliases. This project renders the shared semantic contract that now drives the product UI without requiring a component library.',
      goals: [
        'Keep the core CSS vocabulary aligned with Orca and shadcn.',
        'Make light and dark palette changes visible on one real product route.',
        'Keep trading, status, AI, and chart extensions explicit and small.',
        'Give reviewers a fast contrast and hierarchy smoke test.',
      ],
      constraints: [
        'The route consumes the real CSS variables; it must not duplicate palette values.',
        'Product UI and xterm read one semantic CSS card; the renderer remains the only terminal color authority.',
        'Product components must not select Tailwind palette shades directly.',
      ],
      openQuestions: [
        'Which product extensions can reuse terminal-compatible roles before earning a separate semantic token?',
        'How should future imported terminal palettes map into the shared card without silently recoloring product-only roles?',
      ],
    },
    variants: [
      {
        id: 'A',
        name: 'Current semantic palette',
        summary: 'The live core, product extensions, and representative component states.',
        intent: 'Use this route while adjusting palette.css so both themes and common semantic pairings can be judged together.',
        risk: 'A color card cannot replace route-level visual review for dense trading and Workspace surfaces.',
        layout: 'semantic-colors',
      },
    ],
  },
  {
    slug: 'first-run-onboarding',
    title: 'First-run onboarding',
    eyebrow: 'OpenAlice setup',
    status: 'Exploration',
    updatedAt: '2026-07-06',
    context: {
      why: 'OpenAlice can run in Lite without UTA, but a fresh user currently meets too many silent prerequisites at once: agent runtimes, AI credentials, trading mode, UTA availability, and broker permissions. This project explores a first-launch guide that explains the product without turning setup into a wall of configuration.',
      goals: [
        'Make Lite feel intentional and usable, not broken or incomplete.',
        'Explain when Readonly and Pro become useful without pushing users there immediately.',
        'Separate the first-run guide from the later checklist so the opening screen can stay focused.',
        'Keep the surface responsive and calm on laptop and narrow widths.',
      ],
      constraints: [
        'The route is internal and hidden: direct URL only, no navigation entry.',
        'Do not require UTA, broker accounts, or local command-line tools before Alice can be opened.',
        'Avoid dense card walls, repeated explanatory blocks, and accidental setup pressure.',
        'The production guide must be testable with the onboarding sandbox and a fresh storage key.',
      ],
      openQuestions: [
        'Should the first screen ask what the user wants to do, or simply state the safe default?',
        'How much should the guide mention agent runtimes before an AI credential exists?',
        'Where should the handoff from guide to checklist happen?',
      ],
    },
    variants: [
      {
        id: 'A',
        name: 'Safe Launch',
        summary: 'One large statement: Alice is usable now, broker systems stay off.',
        intent: 'Best when trust is the first problem. It makes Lite mode feel like a deliberate safe start before any configuration.',
        risk: 'It may under-explain what the user should do next if they came in specifically for portfolio or trading workflows.',
        layout: 'safe-launch',
      },
      {
        id: 'B',
        name: 'Mode Ladder',
        summary: 'Shows Lite, Readonly, and Pro as a progression with the current rung selected.',
        intent: 'Best when users need a mental model of OpenAlice permissions before they configure brokers.',
        risk: 'Can feel like product taxonomy too early if the user just wants to start asking Alice things.',
        layout: 'mode-ladder',
      },
      {
        id: 'C',
        name: 'Goal Picker',
        summary: 'Starts with the user goal: research, analyze portfolio, or prepare trading workflows.',
        intent: 'Best when the product should route users by intent instead of explaining architecture first.',
        risk: 'Requires more branching copy and may over-promise if runtime and credential setup still block progress.',
        layout: 'goal-picker',
      },
      {
        id: 'D',
        name: 'Quiet Checklist',
        summary: 'Minimal welcome plus a short setup queue, closer to the current checklist idea.',
        intent: 'Best when the guide should disappear quickly and leave durable setup tasks behind.',
        risk: 'Can collapse back into the painful checklist problem if the first page carries too many tasks.',
        layout: 'quiet-checklist',
      },
    ],
  },
]

export function getDesignProject(slug: string): DesignProject | undefined {
  return designProjects.find((project) => project.slug === slug)
}
