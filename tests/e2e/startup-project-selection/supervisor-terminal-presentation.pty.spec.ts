import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as pty from 'node-pty'
import { describe, expect, it, vi } from 'vitest'

import { cliEntry, confirmationFixtureEntry, launchpadFixtureEntry, releaseFixtureEntry, eventLensFixtureEntry, temporaryPaths, stripSgr } from '../../../packages/cli/src/__fixtures__/supervisor-pty-support.js'

describe.skipIf(process.platform === 'win32')('Supervisor TUI PTY', () => {
  it('keeps the session alive after Kitty Esc release and accepts bracketed command-search paste', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-key-release-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 110, rows: 30, cwd: dirname(cliEntry),
      env: {
        ...process.env, HOME: isolatedHome, OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_START_VIEW: 'home', OPENALICE_TUI_BOOT: '0', OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })
    let output = ''
    let negotiated = false
    let exitCode: number | undefined
    child.onData((data) => {
      output += data
      if (!negotiated && output.includes('\x1b[?u')) {
        negotiated = true
        child.write('\x1b[?7u')
      }
    })
    child.onExit(event => { exitCode = event.exitCode })
    const waitForText = async (text: string) => {
      await vi.waitFor(() => expect(stripSgr(output)).toContain(text), { timeout: 4_000 })
    }
    try {
      await waitForText('[ / ] Commands')
      expect(negotiated).toBe(true)
      child.write('/')
      await waitForText('Command Dock')
      child.write('\x1b[200~pastecheck\x1b[201~')
      await waitForText('pastecheck')
      // Close with press/release, reopen, and prove input still reaches the TUI.
      child.write('\x1b[27;1:1u\x1b[27;1:3u/\x1b[200~aliveafterescape\x1b[201~')
      await waitForText('aliveafterescape')
      expect(exitCode).toBeUndefined()
      child.write('q')
      await vi.waitFor(() => expect(exitCode).toBe(0), { timeout: 4_000 })
      expect(output).toContain('FIXTURE_RESULT starts=0 opens=0')
    } finally {
      if (exitCode === undefined) child.kill()
    }
  }, 15_000)

  it.each([
    ['wide', 110, 30, 90, 70, 10, 'OpenAlice is current on dev.'],
    ['compact', 80, 24, null, 15, 16, 'OpenAlice is current on d…'],
  ] as const)('selects a release lane and clicks the %s Channel Brief action', async (
    _layout,
    cols,
    rows,
    releaseControlColumn,
    briefActionColumn,
    briefActionRow,
    expectedFeedback,
  ) => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-release-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [releaseFixtureEntry], {
      cols,
      rows,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let laneHovered = false
      let laneSelected = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Release Observatory pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [Home]')) {
          opened = true
          if (releaseControlColumn === null) {
            child.write('u')
          } else {
            child.write(`\u001b[<35;${releaseControlColumn};1M`)
            child.write(`\u001b[<0;${releaseControlColumn};1M`)
          }
        } else if (!laneHovered && output.includes('Release Observatory · 3 LANES')) {
          laneHovered = true
          setTimeout(() => child.write('\u001b[<35;20;7M'), 100)
        } else if (!laneSelected && output.includes('│ › Dev')) {
          laneSelected = true
          child.write('\u001b[<0;20;7M')
          setTimeout(() => {
            child.write(`\u001b[<35;${briefActionColumn};${briefActionRow}M`)
            setTimeout(() => {
              child.write(`\u001b[<0;${briefActionColumn};${briefActionRow}M`)
              setTimeout(() => child.write('q'), 300)
            }, 100)
          }, 100)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Release Observatory pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ › Dev')
    expect(transcript).toContain('Channel Brief · 3/3 · INSTALLED BETA')
    expect(transcript).toContain('› [ Enter ] Check')
    expect(transcript).toContain(expectedFeedback)
    expect(transcript).toContain('FIXTURE_RESULT checked=dev')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens Setup from the single-spine Command Dock', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-action-shelf-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    let overlayIdleOutput = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let dockOpened = false
      let queried = false
      let clicked = false
      let closed = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Dock pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!dockOpened && output.includes('Alice Session · OpenAlice')) {
          dockOpened = true
          child.write('/')
        } else if (!queried && output.includes('Command Dock')) {
          queried = true
          child.write('setup')
        } else if (!clicked && output.includes('›   Setup')) {
          clicked = true
          child.write('\r')
        } else if (!closed && clicked && output.includes('╭ Setup Studio · Default AliceProject')) {
          closed = true
          const pausedAt = output.length
          setTimeout(() => {
            overlayIdleOutput = output.slice(pausedAt)
            child.write('\u001b')
          }, 650)
        } else if (!detached && closed && output.includes('Setup closed.')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Command Dock pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(stripSgr(transcript)).not.toContain('Runtime Signal Deck')
    expect(stripSgr(overlayIdleOutput)).not.toContain('OpenAlice Supervisor')
    expect(transcript).not.toContain('CONTROL CONSOLE')
    expect(transcript).toContain('MATCH “setup”')
    expect(transcript).toContain('›   Setup')
    expect(transcript).toContain('╭ Setup Studio · Default AliceProject')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('hovers and clicks the quiet compact Runtime Lens reload segment', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-signal-scope-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Signal Scope pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [ Enter ]  Start OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('Runtime Lens · QUIET · 0 EVENTS')) {
          hovered = true
          child.write('\u001b[<35;30;7M')
        } else if (!clicked && output.includes('› [ l ] Reload Runtime snapshot')) {
          clicked = true
          child.write('\u001b[<0;30;7M')
        } else if (!detached && clicked) {
          detached = true
          setTimeout(() => child.write('q'), 250)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Signal Scope pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Runtime Lens · QUIET · 0 EVENTS')
    expect(transcript).toContain('○ QUIET · No Runtime events · all events · bounded/redacted')
    expect(stripSgr(transcript)).toContain(
      '◇  Tip: No Runtime events in this lens; l reloads the bounded snapshot.',
    )
    expect(stripSgr(transcript)).toContain('◆ [ l ] Reload Runtime snapshot')
    expect(stripSgr(transcript)).not.toContain('[ ↑↓ ] Scroll')
    expect(stripSgr(transcript)).not.toContain('[ End ] Latest')
    expect(transcript).toContain('› [ l ] Reload Runtime snapshot')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=2')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('hovers and clicks the no-check Diagnostic Radar rerun segment', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-diagnostic-radar-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Diagnostic Radar pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('◆ [ Enter ]  Start OpenAlice')) {
          opened = true
          child.write('d')
        } else if (!hovered && output.includes('Diagnostic Radar · NO CHECKS · 0F/0W/0P')) {
          hovered = true
          child.write('\u001b[<35;24;10M')
        } else if (!clicked && output.includes('› [ d ] Rerun Runtime Doctor')) {
          clicked = true
          child.write('\u001b[<0;24;10M')
        } else if (!detached && clicked) {
          detached = true
          setTimeout(() => child.write('q'), 250)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Diagnostic Radar pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Diagnostic Radar · NO CHECKS · 0F/0W/0P')
    expect(transcript).toContain('○  NO CHECKS')
    expect(transcript).toContain('› [ d ] Rerun Runtime Doctor')
    expect(stripSgr(transcript)).toContain('◆ [ d ] Rerun Runtime Doctor')
    expect(stripSgr(transcript)).not.toContain('[ ↑↓ ] Inspect')
    expect(stripSgr(transcript)).not.toContain('[ Home ] First')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=2')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('hovers and selects an Event Lens row with raw pointer input', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-lens-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let copyClicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event Lens pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('Event Lens · LINE 10 · INFO · TEXT')) {
          hovered = true
          child.write('\u001b[<35;20;11M')
        } else if (!clicked && output.includes('│ » !  9  03:04:09Z Fixture event 9')) {
          clicked = true
          child.write('\u001b[<0;20;11M')
        } else if (!copyClicked && clicked && output.includes('Event Lens · LINE 9 · WARNING · JSON')) {
          copyClicked = true
          child.write('y')
        } else if (copyClicked && output.includes('Sent Runtime event 9')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor Event Lens pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('│ » !  9  03:04:09Z Fixture event 9')
    expect(transcript).toContain('Event Lens · LINE 9 · WARNING · JSON')
    expect(transcript).toContain('Sent Runtime event 9')
    expect(transcript).toContain(
      `\u001b]52;c;${Buffer.from('{"ts":"2026-09-02T03:04:09Z","level":"warn","msg":"Fixture event 9","scope":"pty"}').toString('base64')}\u0007`,
    )
    expect(transcript).toContain('█')
    expect(transcript).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps a browsable Emergency Event Lens at 46x16', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-emergency-event-lens-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 46,
      rows: 16,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let moved = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Emergency Event Lens timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!moved && plain.includes('Event Lens · 10/10 · ALL · INFO')) {
          moved = true
          child.write('\u001b[A')
        } else if (moved && plain.includes('Event Lens · 9/10 · ALL · WARNING')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && moved) resolve(output)
        else reject(new Error(`Emergency Event Lens exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('Event Lens · 10/10 · ALL · INFO')
    expect(plain).toContain('Event Lens · 9/10 · ALL · WARNING')
    expect(plain).toContain('DETAIL  03:04:09Z Fixture event 9')
    expect(plain).toContain('KEYS    ↑↓ browse · f lens · y copy')
    expect(plain).toContain('╰─ [ / ] Commands  ›  [ q ] Detach')
    expect(plain).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('scrubs the Event Lens rail with raw hover, press, drag, and release reports', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-rail-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let pressed = false
      let dragged = false
      let released = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event rail timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('4–10/10 · ALL · LATEST')) {
          hovered = true
          child.write('\u001b[<35;78;6M')
        } else if (hovered && !pressed && output.includes('Runtime event 1/10')) {
          pressed = true
          child.write('\u001b[<0;78;6M')
        } else if (pressed && !dragged && output.includes('Event Lens · LINE 1 · INFO · TEXT')) {
          dragged = true
          child.write('\u001b[<32;78;12M')
        } else if (dragged && !released && output.includes('Event Lens · LINE 10 · INFO · TEXT')) {
          released = true
          child.write('\u001b[<0;78;12m')
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && released) resolve(output)
        else reject(new Error(`Supervisor Event rail exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Runtime event 1/10')
    expect(transcript).toContain('Event Lens · LINE 1 · INFO · TEXT')
    expect(transcript).toContain('Event Lens · LINE 10 · INFO · TEXT')
    expect(transcript).toContain('FIXTURE_RESULT event-lens')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('uses a 120x32 Operational Canvas for twenty clickable Runtime events', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-event-canvas-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [eventLensFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_EVENT_ROWS: '20',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    let expandedFrame = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Event Canvas timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered && output.includes('1–20/20 · ALL · LATEST')) {
          hovered = true
          expandedFrame = output.slice(output.lastIndexOf('Event stream · 1–20/20'))
          child.write('\u001b[<35;20;24M')
        } else if (!clicked && output.includes('» · 19  fixture event 19')) {
          clicked = true
          child.write('\u001b[<0;20;24M')
        } else if (clicked && output.includes('Event Lens · LINE 19 · INFO · TEXT')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Supervisor Event Canvas exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(expandedFrame)).toContain('1–20/20 · ALL · LATEST')
    expect(stripSgr(expandedFrame)).not.toContain('█')
    expect(transcript).toContain('» · 19  fixture event 19')
    expect(transcript).toContain('› · 19  fixture event 19')
    expect(transcript).toContain('Event Lens · LINE 19 · INFO · TEXT')
    expect(transcript).toContain('╰─ [ / ] Commands')
    expect(transcript).not.toContain('CONTROL CONSOLE')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('routes the Home Inbox signal to unread work before opening the Workspace', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-home-inbox-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_FIXTURE_INBOX_UNREAD: '2',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hoveredInbox = false
      let openedInbox = false
      let toggledRead = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Home Inbox route timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!hoveredInbox && plain.includes('◆ Inbox  2 unread reports')) {
          hoveredInbox = true
          child.write('\u001b[<35;20;15M')
        } else if (!openedInbox && plain.includes('› Inbox  2 unread reports')) {
          openedInbox = true
          child.write('\u001b[<0;20;15M')
        } else if (!toggledRead && openedInbox && output.includes('Inbox Desk') && output.includes('2 UNREAD')) {
          toggledRead = true
          child.write('\r')
        } else if (!detached && toggledRead && output.includes('Inbox Desk · 1 UNREAD') && output.includes('Mark unread')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && openedInbox && toggledRead) resolve(output)
        else reject(new Error(`Supervisor Home Inbox route exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('◆ Inbox  2 unread reports')
    expect(stripSgr(transcript)).toContain('› Inbox  2 unread reports')
    expect(transcript).toContain('[ Enter ]  Review 2 unread reports')
    expect(transcript).toContain('Inbox Desk')
    expect(transcript).toContain('[ o ] Open Workspace')
    expect(transcript).toContain('2 UNREAD')
    expect(transcript).toContain('1 UNREAD')
    expect(transcript).toContain('Mark unread')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0')
    expect(transcript).toContain('\u001b[?25h')
  }, 12_000)

  it('integrates the wide Alice mark without breaking Session Stage pointer geometry', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-integrated-launchpad-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.NO_COLOR
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor integrated Launchpad pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plainOutput = output.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/gu, '')
        if (
          !hovered
          && plainOutput.includes('Alice Session · OpenAlice')
          && plainOutput.includes('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
        ) {
          hovered = true
          child.write('\u001b[<35;70;11M')
        } else if (!clicked && plainOutput.includes('› [ Enter ]')) {
          clicked = true
          child.write('\u001b[<0;70;11M')
        } else if (clicked && plainOutput.includes('OpenAlice started')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor integrated Launchpad pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(stripSgr(transcript)).toContain('▄▀▄ █   ▀█▀ ▄▀▀ █▀▀')
    expect(stripSgr(transcript)).toContain('Your workspace is one step away')
    expect(stripSgr(transcript)).toContain('⌂ Default AliceProject')
    expect(stripSgr(transcript)).toContain('STATUS')
    expect(stripSgr(transcript)).toContain('ACTIVITY')
    expect(stripSgr(transcript)).not.toContain('COMPONENT TELEMETRY')
    expect(transcript).toContain('\u001b[1;38;2;')
    expect(transcript).not.toMatch(
      /\u001b\[1;38;2;183;255;248;48;2;18;54;59m[^\u001b\r\n]*Uptime/u,
    )
    expect(transcript.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/gu, '')).toContain('› [ Enter ]')
    expect(transcript).toContain('FIXTURE_RESULT starts=1 opens=1')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens contextual Help and explores it with raw pointer input', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-navigation-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let clicked = false
      let inspected = false
      let closing = false
      let closed = false
      let closeOffset = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor navigation pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!clicked && output.includes('◆ [Home]')) {
          clicked = true
          child.write('?')
        } else if (!inspected && clicked && output.includes('Help · START · SEARCH · SWITCH · 1/3')) {
          inspected = true
          child.write('\u001b[<35;10;8M')
          child.write('\u001b[<0;10;8M')
        } else if (!closing && inspected && output.includes('Help · START · SEARCH · SWITCH · 2/3')) {
          closing = true
          closeOffset = output.length
          child.write('\u001b[<35;10;22M')
          child.write('\u001b[<0;10;22M')
        } else if (closing && !closed && output.slice(closeOffset).includes('Alice Session · OpenAlice')) {
          closed = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Supervisor navigation pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Help · START · SEARCH · SWITCH · 1/3')
    expect(transcript).toContain('Help · START · SEARCH · SWITCH · 2/3')
    expect(transcript).toContain('NOW · [ Enter ] Start/connect/open')
    expect(transcript).toContain('[ ? ] Close Help')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('switches the wide Help inspector from its fixed system routes', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-help-board-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let selected = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Help Board pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('[ / ] Commands') && plain.includes('◆ HOME')) {
          opened = true
          child.write('?')
        } else if (!hovered && plain.includes('Help · START · SEARCH · SWITCH')) {
          hovered = true
          child.write('\u001b[<35;10;13M')
        } else if (!selected && plain.includes('» ● Runtime  Read state, then act')) {
          selected = true
          child.write('\u001b[<0;10;13M')
        } else if (selected && plain.includes('› ● Runtime  Read state, then act')
          && plain.includes('● SELECTED · RUNTIME')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && selected) resolve(output)
        else reject(new Error(`Supervisor Help Board pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(transcript)).toContain('» ● Runtime  Read state, then act')
    expect(stripSgr(transcript)).toContain('› ● Runtime  Read state, then act')
    expect(stripSgr(transcript)).toContain('● SELECTED · RUNTIME')
    expect(stripSgr(transcript)).toContain('[ x ] Stop local / disconnect remote target')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('uses raw pointer input inside the compact Setup Focus Workspace', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-overlay-pointer-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let setupOpened = false
      let clickedScope = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor overlay pointer timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!setupOpened && output.includes('[ / ] Commands') && output.includes('[ q ] Detach')) {
          setupOpened = true
          child.write('p')
        } else if (!clickedScope && output.includes('Setup Studio · Default AliceProject') && output.includes('Editing')) {
          clickedScope = true
          child.write('\u001b[<32;10;5M')
          child.write('\u001b[<0;10;5M')
        } else if (!closed && output.includes('› Editing') && output.includes('Current · Machine defaults')) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Supervisor overlay pointer exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Current · Machine defaults')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('clicks the wide Setup Studio Inspector action outside its keycap', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-setup-studio-action-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 110,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Setup Studio action timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('p')
        } else if (!hovered && output.includes('Setup Studio · Default AliceProject') && output.includes('Cycle value')) {
          hovered = true
          child.write('\u001b[<35;75;9M')
        } else if (!clicked && output.includes('› [ Enter ] Cycle value')) {
          clicked = true
          child.write('\u001b[<0;75;9M')
        } else if (!closed && clicked && output.includes('Current · Machine defaults')) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Supervisor Setup Studio action exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('› [ Enter ] Cycle value')
    expect(transcript).toContain('Current · Machine defaults')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('gives a focused confirmation modal an isolated Decision Gate', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-confirmation-modal-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [confirmationFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let requested = false
      let hoveredCancel = false
      let clickedCancel = false
      let cancelled = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor confirmation modal timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requested && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          requested = true
          child.write('m')
        } else if (!hoveredCancel && output.includes('Confirm Managed Source') && output.includes('◆ [ Enter ] Prepare source')) {
          hoveredCancel = true
          child.write('\u001b[<35;40;23M')
        } else if (!clickedCancel && output.includes('│ › [ Esc ] Not now')) {
          clickedCancel = true
          child.write('\u001b[<0;40;23M')
        } else if (!cancelled && output.includes('STATUS   Action cancelled.')) {
          cancelled = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && cancelled) resolve(output)
        else reject(new Error(`Supervisor confirmation modal exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Confirm Managed Source')
    expect(transcript).toContain('◆  CONFIRMATION REQUIRED')
    expect(transcript).toContain('IMPACT')
    expect(transcript).toContain('[ Enter ] Prepare source')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('│ › [ Esc ] Not now')
    expect(transcript).toContain('◆ FOCUS · PREPARE SOURCE')
    expect(transcript).toContain('DECISION GATE')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('◇ BUILD')
    expect(transcript).toContain('◆ [ Enter ] Prepare source')
    expect(transcript).toContain('[ Esc ] Not now')
    expect(transcript).toContain('STATUS   Action cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('cancels a Decision Gate from its action-specific Mission Header', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-confirmation-header-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [confirmationFixtureEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let requested = false
      let hovered = false
      let clicked = false
      let cancelled = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor confirmation Header timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!requested && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          requested = true
          child.write('m')
        } else if (!hovered && output.includes('◆ FOCUS · PREPARE SOURCE') && output.includes('[ Esc ] Not now')) {
          hovered = true
          child.write('\u001b[<35;70;2M')
        } else if (!clicked && output.includes('› [ Esc ] Not now')) {
          clicked = true
          child.write('\u001b[<0;70;2M')
        } else if (!cancelled && output.includes('STATUS   Action cancelled.')) {
          cancelled = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && cancelled) resolve(output)
        else reject(new Error(`Supervisor confirmation Header exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('◆ FOCUS · PREPARE SOURCE')
    expect(transcript).toContain('DECISION GATE')
    expect(transcript).toContain('› [ Esc ] Not now')
    expect(transcript).toContain('STATUS   Action cancelled.')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('opens Setup by clicking a bottom Command Dock result', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-command-dock-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    delete childEnv.OPENALICE_PROJECT
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let typedUnicode = false
      let typedSearch = false
      let clickedSetup = false
      let setupOpened = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Dock timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ / ] Commands') && output.includes('○ COLD')) {
          opened = true
          child.write('/')
        } else if (!typedSearch && output.includes('Command Dock') && output.includes('› ◆ Start OpenAlice')) {
          if (!typedUnicode) {
            typedUnicode = true
            child.write('日志')
            return
          }
          if (!output.includes('MATCH “日志”') || !output.includes('⌕  日志')) return
          typedSearch = true
          child.write('\x15')
          setTimeout(() => child.write('setup'), 50)
        } else if (
          !clickedSetup
          && output.includes('MATCH “setup”')
          && output.includes('⌕  setup▌')
          && output.includes('›   Setup')
        ) {
          clickedSetup = true
          child.write('\u001b[<32;32;19M')
          child.write('\u001b[<0;32;19M')
        } else if (!setupOpened && output.includes('Setup Studio · Default AliceProject')) {
          setupOpened = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 50)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && setupOpened) resolve(output)
        else reject(new Error(`Supervisor Command Dock exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Command Dock')
    expect(transcript).toContain('MATCH “日志”')
    expect(transcript).toContain('⌕  日志')
    expect(transcript).toContain('MATCH “setup”')
    expect(transcript).toContain('⌕  setup▌')
    expect(transcript).toContain('Alice Session · OpenAlice')
    expect(transcript).toContain('Setup Studio · Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps every visible Command Spine control segment clickable', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-context-ribbon-'))
    temporaryPaths.push(isolatedHome)
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: isolatedHome,
      OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
      TERM: 'xterm-256color',
    }
    delete childEnv.NO_COLOR
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    delete childEnv.OPENALICE_PROJECT
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: childEnv,
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let clickedProject = false
      let closedOverlay = false
      let clickedAfterNotice = false
      let openedPalette = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor Command Spine timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (
          !clickedProject
          && output.includes('[ i ] Default AliceProject')
          && output.includes('○ COLD')
        ) {
          clickedProject = true
          child.write('\u001b[<32;56;23M')
          child.write('\u001b[<0;56;23M')
        } else if (!closedOverlay && output.includes('AliceProject Switchboard · 1 PROJECT')) {
          closedOverlay = true
          child.write('\u001b')
        } else if (
          closedOverlay
          && !clickedAfterNotice
          && output.includes('STATUS   AliceProject selection')
        ) {
          clickedAfterNotice = true
          child.write('\u001b[<0;6;23M')
        } else if (!openedPalette && output.includes('Command Dock')) {
          openedPalette = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && openedPalette) resolve(output)
        else reject(new Error(`Supervisor Command Spine exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('STATUS   AliceProject selection')
    expect(transcript).toContain('Command Dock')
    expect(transcript).toContain('╰─ ')
    expect(transcript).toContain('  ›  ')
    expect(transcript).toContain(' ─╯')
    expect(transcript).toContain('\u001b[38;2;199;235;239;48;2;10;34;39m')
    expect(transcript).toContain('\u001b[1;38;2;240;249;255;48;2;10;34;39m[ i ] Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the 46-column Command Spine continuously closed around the Command Dock', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-narrow-command-spine-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 46,
      rows: 30,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_MOTION: '0',
      },
    })

    const closedSpine = '╰─ [ / ] Commands  ›  [ q ] Detach ──────────╯'
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let detaching = false
      let opened = false
      let closingAt = -1
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Narrow Supervisor Command Spine timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes(closedSpine)) {
          opened = true
          child.write('\u001b[<0;6;23M')
        } else if (opened && closingAt < 0 && output.includes('Command Dock · 1/10 · ABSENT')) {
          closingAt = output.length
          child.write('\u001b[<35;6;30M')
          child.write('\u001b[<0;6;30M')
          child.write('\u001b[<35;1;4M')
        } else if (!detaching && closingAt >= 0 && output.slice(closingAt).includes(closedSpine)) {
          detaching = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closingAt >= 0) resolve(output)
        else reject(new Error(`Narrow Supervisor Command Spine exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain(closedSpine)
    expect(transcript).not.toContain('[ q ] Detach ───────  ─╯')
    expect(transcript).toContain('Command Dock · 1/10 · ABSENT')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('keeps the complete Launcher target and action visible at 46x16', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-emergency-launcher-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 46,
      rows: 16,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '1',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let hovered = false
      let clicked = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Emergency Supervisor Launcher timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!hovered && plain.includes('◆ [ Enter ] Start OpenAlice')) {
          hovered = true
          child.write('\u001b[<35;22;9M')
        } else if (!clicked && plain.includes('› [ Enter ] Start OpenAlice')) {
          clicked = true
          child.write('\u001b[<0;22;9M')
        } else if (!detached && clicked && plain.includes('Alice Session · OpenAlice') && plain.includes('● RUNNING')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Emergency Supervisor Launcher exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('OPENALICE LAUNCH · ALICEPROJECT')
    expect(plain).toContain('1 MACHINE ✓ This computer')
    expect(plain).toContain('2 ALICEPROJECT ✓ Default AliceProject')
    expect(plain).toContain('3 RUNTIME ○ READY TO START')
    expect(plain).toContain('› [ Enter ] Start OpenAlice')
    expect(plain).toContain('╰─ [Home] │ Inbox │ Link·1 │ Run')
    expect(plain).toContain('NEXT  Workspace is ready')
    expect(plain).toContain('◆ [ Enter ]  Open Workspace')
    expect(plain).toContain('STATUS  ● Connection  healthy')
    expect(transcript).toContain('FIXTURE_RESULT starts=1 opens=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps and activates tiny Runtime status controls at 46x16', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-emergency-runtime-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 46,
      rows: 16,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        TERM: 'xterm-256color',
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let hovered = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Emergency Supervisor Runtime timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write('l')
        } else if (!hovered
          && plain.includes('Runtime · LIVE · LOCAL · QUIET')
          && plain.includes('◇  Tip:')) {
          hovered = true
          child.write('\u001b[<35;20;10M')
        } else if (!clicked && plain.includes('› [ l ] Reload Runtime snapshot')) {
          clicked = true
          child.write('\u001b[<0;20;10M')
          setTimeout(() => child.write('q'), 250)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Emergency Supervisor Runtime exited ${exitCode}:\n${output}`))
      })
    })

    const plain = stripSgr(transcript)
    expect(plain).toContain('╰─ Home │ Inbox │ Link·1 │ [Run]')
    expect(plain).toContain('Runtime · LIVE · LOCAL · QUIET')
    expect(plain).toContain('● OPENALICE READY · source')
    expect(plain).toContain('⌁ This computer → Default AliceProject')
    expect(plain).toContain('● Alice ready · ○ UTA off · ○ Conn off')
    expect(plain).toContain('◆ [ o ] Open verified Web UI')
    expect(plain).toContain('› [ l ] Reload Runtime snapshot')
    expect(plain).toContain('◇  Tip: No Runtime events in this lens')
    expect(plain).toContain('╰─ [ / ] Commands  ›  [ q ] Detach')
    expect(plain).toContain('FIXTURE_RESULT starts=0 opens=0 loads=2')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
    expect(transcript).toContain('\u001b[?1006l')
  }, 12_000)

  it('renders an offline registered Machine and preserves drill-down across resize', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-offline-'))
    temporaryPaths.push(isolatedHome)
    const supervisorHome = join(isolatedHome, 'supervisor')
    await mkdir(supervisorHome, { recursive: true })
    await writeFile(join(supervisorHome, 'machines.json'), `${JSON.stringify({
      schemaVersion: 1,
      machines: {
        cloud: {
          displayName: 'Cloud fixture',
          sshTarget: '127.0.0.1',
          sshPort: 1,
        },
      },
    })}\n`)
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 100,
      rows: 28,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_SUPERVISOR_HOME: supervisorHome,
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let openedFleet = false
      let selectedRemote = false
      let drilledDown = false
      let returned = false
      let returnOffset = 0
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor offline fleet timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedFleet && output.includes('[Home]') && output.includes('Connections')) {
          openedFleet = true
          child.write('\t\t')
        } else if (!selectedRemote && output.includes('Cloud fixture') && output.includes('offline')) {
          selectedRemote = true
          child.resize(48, 24)
          setTimeout(() => child.write('\u001b[B\u001b[C'), 120)
        } else if (!drilledDown && output.includes('AliceProjects · Cloud fixture')) {
          drilledDown = true
          returnOffset = output.length
          setTimeout(() => child.write('\u001b[D'), 120)
        } else if (
          drilledDown
          && !returned
          && output.slice(returnOffset).includes('Machines · ')
          && output.slice(returnOffset).includes('▶ Cloud fixture')
        ) {
          returned = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor offline fleet exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Cloud fixture')
    expect(transcript).toContain('offline')
    expect(transcript).toContain('AliceProjects · Cloud fixture')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('reveals and clicks a sixth Fleet row before showing a scroll rail', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-viewport-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_FIXTURE_FLEET_ROWS: '6',
        OPENALICE_TUI_MOTION: '0',
        TERM: 'xterm-256color',
      },
    })

    let expandedFleet = ''
    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let detaching = false
      let openedFleet = false
      let hoveredSixth = false
      let clickedSixth = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor expanded Fleet timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!openedFleet && output.includes('[Home]')) {
          openedFleet = true
          child.write(']]')
        } else if (!hoveredSixth && output.includes('Local Project 6')) {
          hoveredSixth = true
          expandedFleet = output.slice(output.lastIndexOf('Machines · 1/1'))
          child.write('\u001b[<35;70;11M')
        } else if (!clickedSixth && output.includes('» Local Project 6')) {
          clickedSixth = true
          child.write('\u001b[<0;70;11M')
        } else if (!detaching && clickedSixth && output.includes('AliceProjects · This computer · 6/6')) {
          detaching = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clickedSixth) resolve(output)
        else reject(new Error(`Supervisor expanded Fleet exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(expandedFleet)).toContain('Local Project 6')
    expect(stripSgr(expandedFleet)).not.toContain('█')
    expect(transcript).toContain('» Local Project 6')
    expect(transcript).toContain('▶ Local Project 6')
    expect(transcript).toContain('AliceProjects · This computer · 6/6')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the wide direct Connection board bounded and its quiet field pointer-passive', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-fleet-constellation-'))
    temporaryPaths.push(isolatedHome)
    const child = pty.spawn(process.execPath, [launchpadFixtureEntry], {
      cols: 120,
      rows: 32,
      cwd: dirname(cliEntry),
      env: {
        ...process.env,
        HOME: isolatedHome,
        OPENALICE_HOME: join(isolatedHome, 'state'),
        OPENALICE_TUI_BOOT: '0',
        OPENALICE_TUI_MOTION: '0',
        OPENALICE_TUI_START_VIEW: 'connect',
        OPENALICE_TUI_FIXTURE_RUNTIME: 'running',
        OPENALICE_TUI_FIXTURE_HOME_AVAILABLE: '0',
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let clicked = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor active Connection timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        const plain = stripSgr(output)
        if (!opened && plain.includes('Alice Session · OpenAlice')) {
          opened = true
          child.write(']]')
        } else if (!clicked && plain.includes('Active Route · LIVE · LOCAL')) {
          clicked = true
          child.write('\u001b[<35;70;20M')
          child.write('\u001b[<0;70;20M')
          setTimeout(() => child.write('q'), 150)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && clicked) resolve(output)
        else reject(new Error(`Supervisor active Connection exited ${exitCode}:\n${output}`))
      })
    })

    expect(stripSgr(transcript)).toContain('Active Route · LIVE · LOCAL')
    expect(stripSgr(transcript)).toContain('ACTIVE ROUTE')
    expect(stripSgr(transcript)).toContain('Runtime is live; AliceProject home is missing')
    expect(stripSgr(transcript)).toContain('Web route.')
    expect(stripSgr(transcript)).toContain('◆ running · home missing')
    expect(stripSgr(transcript)).toContain('◆ LIVE · HOME MISSING')
    expect(stripSgr(transcript)).not.toContain('◇ missing')
    expect(stripSgr(transcript)).toContain('↗ WEB  http://127.0.0.1:47331')
    expect(stripSgr(transcript)).toContain('◆ [ Enter ] Return Home')
    expect(stripSgr(transcript)).toContain('· Transfer unavailable')
    expect(stripSgr(transcript)).not.toContain('Machines · 1/1')
    expect(transcript).toContain('FIXTURE_RESULT starts=0 opens=0 loads=0 diagnoses=0')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the complete Source Launch Bay route at the 80-column baseline', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-source-narrow-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let closed = false
      let detached = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor narrow Source Launch Bay timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Start OpenAlice & open Workspace')) {
          opened = true
          child.write('c')
        } else if (!closed && output.includes('Source Launch Bay · SELECT CHECKOUT')) {
          closed = true
          child.write('\u001b')
        } else if (!detached && output.includes('Source configuration')) {
          detached = true
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor narrow Source Launch Bay exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('Source Launch Bay · SELECT CHECKOUT')
    expect(transcript).toContain('◆ Select  → Validate  → Save  → Launch')
    expect(transcript).toContain('Runtime Source · AliceProject setting')
    expect(transcript).toContain('◆ CONTRACT')
    expect(transcript).toContain('Source configuration')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  })

  it('keeps the Foundry identity step complete at the 80-column baseline', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-foundry-narrow-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 24,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let requestedCreate = false
      let foundry = false
      let returned = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Supervisor narrow Foundry timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('Start OpenAlice & open Workspace')) {
          opened = true
          child.write('i')
        } else if (!requestedCreate && output.includes('+ Create AliceProject')) {
          requestedCreate = true
          child.write('\u001b[B\r')
        } else if (!foundry && output.includes('AliceProject Foundry · 1/3 · IDENTITY')) {
          foundry = true
          child.write('\u001b')
        } else if (foundry && !returned && data.includes('AliceProject Switchboard')) {
          returned = true
          child.write('\u001b')
        } else if (returned && output.includes('AliceProject selection')) {
          child.write('q')
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0) resolve(output)
        else reject(new Error(`Supervisor narrow Foundry exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Foundry · 1/3 · IDENTITY')
    expect(transcript).toContain('◆ Identity  → Home  → Workspaces')
    expect(transcript).toContain('Create AliceProject · Project key')
    expect(transcript).toContain('◆ CONTRACT')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)

  it('keeps the Switchboard Inspector and status complete in an 80x20 terminal', async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), 'openalice-cli-switchboard-short-'))
    temporaryPaths.push(isolatedHome)
    const childEnv = { ...process.env }
    delete childEnv.OPENALICE_HOME
    delete childEnv.OPENALICE_INSTANCE
    const child = pty.spawn(process.execPath, [cliEntry], {
      cols: 80,
      rows: 20,
      cwd: dirname(cliEntry),
      env: {
        ...childEnv,
        HOME: isolatedHome,
        OPENALICE_SUPERVISOR_HOME: join(isolatedHome, 'supervisor'),
        TERM: 'xterm-256color',
      },
    })

    const transcript = await new Promise<string>((resolve, reject) => {
      let output = ''
      let opened = false
      let closed = false
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Short Supervisor Switchboard timed out:\n${output}`))
      }, 8_000)
      child.onData((data) => {
        output += data
        if (!opened && output.includes('[ i ] Default AliceProject')) {
          opened = true
          child.write('i')
        } else if (
          !closed
          && output.includes('Inspector · 1/2 · SELECT & CREATE')
          && output.includes('Switchboard status · Default AliceProject')
          && output.includes('Copy AI credentials with openalice project copy-ai-creds.')
        ) {
          closed = true
          child.write('\u001b')
          setTimeout(() => child.write('q'), 40)
        }
      })
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout)
        if (exitCode === 0 && closed) resolve(output)
        else reject(new Error(`Short Supervisor Switchboard exited ${exitCode}:\n${output}`))
      })
    })

    expect(transcript).toContain('AliceProject Switchboard · 1 PROJECT')
    expect(transcript).toContain('Inspector · 1/2 · SELECT & CREATE')
    expect(transcript).toContain('Switchboard status · Default AliceProject')
    expect(transcript).toContain('\u001b[?25h')
    expect(transcript).toContain('\u001b[?2004l')
  }, 12_000)


})
