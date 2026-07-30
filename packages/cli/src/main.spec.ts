import { describe, expect, it, vi } from 'vitest'

import { main } from './main.ts'

describe('OpenAlice TypeScript application entry', () => {
  it('opens the Supervisor TUI for the bare command', async () => {
    const runTui = vi.fn(async () => 0)

    await expect(main([], { runTui })).resolves.toBe(0)

    expect(runTui).toHaveBeenCalledOnce()
  })

  it('keeps the explicit tui alias', async () => {
    const runTui = vi.fn(async () => 0)

    await expect(main(['tui'], { runTui })).resolves.toBe(0)

    expect(runTui).toHaveBeenCalledOnce()
  })

  it('rejects unknown tui options before terminal startup', async () => {
    await expect(main(['tui', '--wat'], {
      runTui: vi.fn(async () => 0),
    })).rejects.toMatchObject({
      code: 'EUSAGE',
      exitCode: 2,
    })
  })
})
