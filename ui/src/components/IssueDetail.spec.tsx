// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  IssueDetail as IssueDetailData,
  IssueProvenanceRecord,
} from '../api/issues'
import { i18n } from '../i18n'
import { IssueActivity, IssueDetail } from './IssueDetail'

const mocks = vi.hoisted(() => ({
  detectWorkspaceCredential: vi.fn().mockResolvedValue({
    configured: true,
    slug: 'longcat-1',
    model: 'LongCat-2.0',
    contextWindow: null,
    wireShape: 'openai-chat',
    reasoningMode: 'optional',
    reasoningDefaultEnabled: true,
  }),
  mutate: vi.fn(),
  openAgentConfig: vi.fn(),
  openHeadlessRun: vi.fn(),
  getWorkspaceSessionDirectory: vi.fn(),
  listAgentCredentials: vi.fn(),
  getPresets: vi.fn(),
  updateIssue: vi.fn(),
  runNow: vi.fn(),
  retry: vi.fn(),
}))

const scheduledIssue: IssueDetailData = {
  issue: {
    id: 'morning-scan',
    title: 'Morning movers scan',
    what: 'Scan the market and publish a brief.',
    status: 'in_progress',
    priority: 'high',
    assignee: '@new-each-run',
    agent: 'codex',
    when: {
      kind: 'cron',
      cron: '30 8 * * 1-5',
      timezone: 'America/New_York',
    },
  },
  runs: [],
  comments: [],
  activity: [],
  inboxReports: [],
}

vi.mock('../hooks/useIssueDetail', () => ({
  useIssueDetail: () => ({
    data: scheduledIssue,
    error: null,
    loading: false,
    mutate: mocks.mutate,
  }),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    agents: [
      { id: 'codex', displayName: 'Codex', kind: 'agent', installed: true },
      { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
    ],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    workspaces: [{ id: 'demo-ws-auto-quant' }],
    openAgentConfig: mocks.openAgentConfig,
    openHeadlessRun: mocks.openHeadlessRun,
  }),
}))

vi.mock('./workspace/api', () => ({
  detectWorkspaceCredential: mocks.detectWorkspaceCredential,
  getAgentReadiness: vi.fn().mockResolvedValue({ agents: {} }),
  getWorkspaceSessionDirectory: mocks.getWorkspaceSessionDirectory,
  listAgentCredentials: mocks.listAgentCredentials,
}))

vi.mock('../api/config', () => ({
  configApi: { getPresets: mocks.getPresets },
}))

vi.mock('../api/issues', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../api/issues')
  return {
    ...actual,
    issuesApi: {
      ...actual.issuesApi,
      update: mocks.updateIssue,
      runNow: mocks.runNow,
      retry: mocks.retry,
    },
  }
})

vi.mock('./MarkdownWhatEditor', () => ({
  MarkdownWhatEditor: ({ value }: { value: string }) => <div>{value}</div>,
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  delete scheduledIssue.issue.automationHealth
  delete scheduledIssue.issue.credential
  delete scheduledIssue.issue.model
  delete scheduledIssue.issue.effort
  delete scheduledIssue.issue.timeout
  scheduledIssue.runs = []
  mocks.updateIssue.mockResolvedValue(scheduledIssue)
  mocks.getWorkspaceSessionDirectory.mockResolvedValue({ sessions: [] })
  mocks.listAgentCredentials.mockResolvedValue([{
    slug: 'longcat-1',
    vendor: 'longcat',
    label: 'LongCat primary',
    authType: 'api-key',
    wires: { 'openai-chat': 'https://example.test' },
    resolvedModel: 'LongCat-2.0',
  }, {
    slug: 'deepseek-1',
    vendor: 'deepseek',
    label: 'DeepSeek primary',
    authType: 'api-key',
    wires: { 'openai-chat': 'https://example.test' },
    resolvedModel: 'deepseek-v4-flash',
  }])
  mocks.getPresets.mockResolvedValue({ presets: [{
    id: 'longcat',
    label: 'LongCat',
    description: '',
    category: 'third-party',
    defaultName: 'LongCat',
    schema: {},
    models: [{
      id: 'LongCat-2.0',
      label: 'LongCat 2.0',
      semantics: { reasoning: { mode: 'optional', defaultEnabled: true } },
    }],
  }, {
    id: 'deepseek',
    label: 'DeepSeek',
    description: '',
    category: 'third-party',
    defaultName: 'DeepSeek',
    schema: {},
    models: [{
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      semantics: { reasoning: { mode: 'optional', efforts: ['low', 'high', 'max'], defaultEffort: 'high' } },
    }],
  }] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('IssueDetail manual run', () => {
  it('confirms before dispatching a scheduled Issue without waiting for failure', async () => {
    mocks.runNow.mockResolvedValue({
      ...scheduledIssue,
      runs: [{
        taskId: 'run-now-1',
        resumeId: 'resume-run-now',
        resumable: false,
        wsId: 'demo-ws-auto-quant',
        issueId: 'morning-scan',
        agent: 'codex',
        prompt: scheduledIssue.issue.what,
        status: 'running',
        startedAt: Date.now(),
      }],
    })
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Run this Issue now?' })
    expect(dialog.textContent).toContain('The next scheduled time stays unchanged.')
    expect(mocks.runNow).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(mocks.runNow).toHaveBeenCalledWith('demo-ws-auto-quant', 'morning-scan'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mocks.mutate).toHaveBeenCalled()
  })

  it('does not dispatch when the confirmation is cancelled', async () => {
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Run this Issue now?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(mocks.runNow).not.toHaveBeenCalled()
  })

  it('confirms before retrying a failed run', async () => {
    scheduledIssue.runs = [{
      taskId: 'failed-run',
      resumeId: 'resume-failed-run',
      resumable: true,
      wsId: 'demo-ws-auto-quant',
      issueId: 'morning-scan',
      agent: 'codex',
      prompt: scheduledIssue.issue.what,
      status: 'failed',
      startedAt: Date.now() - 30_000,
      finishedAt: Date.now() - 20_000,
      failure: {
        kind: 'runtime_error',
        title: 'Runtime failed',
        message: 'The runtime exited early.',
        retryable: true,
      },
    }]
    mocks.retry.mockResolvedValue({ ...scheduledIssue, runs: [] })
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Retry this Issue now?' })
    expect(dialog.textContent).toContain('The next scheduled time stays unchanged.')
    expect(mocks.retry).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry now' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('demo-ws-auto-quant', 'morning-scan'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('closes the confirmation and exposes a dispatch failure in the inspector', async () => {
    mocks.runNow.mockRejectedValue(new Error('The Issue is already running.'))
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Run now' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('alert').textContent).toContain('The Issue is already running.')
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})

describe('IssueActivity provenance identity', () => {
  it('shows Session details before an explicit Open conversation action', async () => {
    const record: IssueProvenanceRecord = {
      id: 'provenance-reconstructed',
      action: 'reconstructed',
      at: Date.now(),
      origin: {
        kind: 'session',
        workspaceId: 'ws-home',
        resumeId: 'resume-open-coral-harbor-j76vuu',
        agent: 'opencode',
      },
    }
    const onOpenSession = vi.fn(async () => {})

    render(
      <IssueActivity
        activity={[{ ...record, kind: 'change' }]}
        onOpenSession={onOpenSession}
        wsId="ws-home"
        issueId="audit"
        ownerResumeId={null}
        assignee="@new-each-run"
        onPosted={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    fireEvent.click(screen.getByRole('button', {
      name: 'Show Session details for opencode · resume-open-coral-harbor-j76vuu',
    }))
    expect(onOpenSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', {
      name: 'Session resume-open-coral-harbor-j76vuu',
    })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', {
      name: 'Session resume-open-coral-harbor-j76vuu',
    })).toBeNull()

    fireEvent.click(screen.getByRole('button', {
      name: 'Show Session details for opencode · resume-open-coral-harbor-j76vuu',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining(record)))
  })
})

describe('IssueDetail property controls', () => {
  it('names every editable property and resolves inherited runtime defaults', async () => {
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    const title = screen.getByRole('heading', { level: 1, name: 'Morning movers scan' })
    const header = title.closest('header')
    const identityRow = header?.querySelector('div')
    expect(header).toBeTruthy()
    expect(identityRow?.className).toContain('flex-col')
    expect(identityRow?.className).toContain('sm:flex-row')

    const status = screen.getByRole('combobox', { name: 'Status' })
    expect(status).toBeTruthy()
    expect(status.className).toContain('h-10')
    expect(status.className).toContain('w-full')
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Assignee' }).className).toContain('w-full')
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Run timeout' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Configure codex' }).className).toContain('size-10')
    expect(screen.getByRole('heading', { level: 3, name: 'Schedule' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Agent' })).toBeTruthy()
    expect(screen.getByText('America/New_York').className).toContain('break-all')
    expect(screen.getByRole('button', { name: 'AI configuration' }).textContent)
      .toContain('Runtime managed')
    fireEvent.click(screen.getByRole('button', { name: 'AI configuration' }))
    const credential = screen.getByRole('combobox', { name: 'AI access' }) as HTMLSelectElement
    const model = screen.getByRole('combobox', { name: 'Run model' }) as HTMLSelectElement
    const effort = screen.getByRole('combobox', { name: 'Effort' }) as HTMLSelectElement
    await waitFor(() => {
      expect(credential.value).toBe('inherit')
      expect(model.selectedOptions[0]?.textContent).toBe('Default · runtime managed')
      expect(effort.selectedOptions[0]?.textContent).toBe('Runtime managed')
    })

    fireEvent.change(model, { target: { value: 'custom' } })
    expect(screen.getByRole('textbox', { name: 'Custom run model' })).toBeTruthy()
  })

  it('patches the optional run timeout from the execution inspector', async () => {
    mocks.updateIssue.mockResolvedValue({
      ...scheduledIssue,
      issue: { ...scheduledIssue.issue, timeout: '30m' },
    })
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    const timeout = await screen.findByRole('combobox', { name: 'Run timeout' }) as HTMLSelectElement
    expect(timeout.value).toBe('')
    fireEvent.change(timeout, { target: { value: '30m' } })
    await waitFor(() => {
      expect(mocks.updateIssue).toHaveBeenCalledWith(
        'demo-ws-auto-quant',
        'morning-scan',
        { timeout: '30m' },
      )
    })
  })

  it('patches cron catch-up from the schedule inspector', async () => {
    mocks.updateIssue.mockResolvedValue({
      ...scheduledIssue,
      issue: {
        ...scheduledIssue.issue,
        when: { ...scheduledIssue.issue.when!, catchUp: false },
      },
    })
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    const toggle = await screen.findByRole('checkbox', { name: /Retry a missed fire/ }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(mocks.updateIssue).toHaveBeenCalledWith(
        'demo-ws-auto-quant',
        'morning-scan',
        { catchUp: false },
      )
    })
  })

  it('chooses a credential before narrowing model and effort options', async () => {
    scheduledIssue.issue.credential = 'deepseek-1'
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)
    fireEvent.click(await screen.findByRole('button', { name: 'AI configuration' }))
    const credential = screen.getByRole('combobox', { name: 'AI access' }) as HTMLSelectElement
    const model = screen.getByRole('combobox', { name: 'Run model' }) as HTMLSelectElement
    const effort = screen.getByRole('combobox', { name: 'Effort' }) as HTMLSelectElement
    await waitFor(() => {
      expect(credential.value).toBe('vault:deepseek-1')
      expect(Array.from(model.options).map((option) => option.value)).toContain('deepseek-v4-flash')
      expect(Array.from(model.options).map((option) => option.value)).not.toContain('LongCat-2.0')
      expect(Array.from(effort.options).map((option) => option.value))
        .toEqual(['', 'low', 'high', 'max'])
    })
  })

  it('places mobile work-item controls before long-form Issue content', async () => {
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    const workItem = screen.getByRole('heading', { level: 3, name: 'Work item' })
    const what = screen.getByRole('heading', { level: 2, name: 'What' })
    const activity = screen.getByRole('heading', { level: 2, name: 'Activity' })
    const sectionNavigation = screen.getByRole('navigation', { name: 'Issue sections' })

    expect(workItem.compareDocumentPosition(what) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(workItem.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sectionNavigation.className).toContain('sticky')
    expect(sectionNavigation.className).toContain('overflow-x-auto')
    expect(sectionNavigation.className).toContain('flex-nowrap')
    const workItemLink = sectionNavigation.querySelector('a[href="#issue-work-item"]')
    expect(workItemLink).toBeTruthy()
    expect(workItemLink?.className).toContain('min-h-10')
    expect(workItemLink?.getAttribute('aria-current')).toBe('location')
    expect(workItemLink?.className).toContain('bg-primary-muted')
    const whatLink = sectionNavigation.querySelector('a[href="#issue-what"]') as HTMLAnchorElement
    expect(whatLink).toBeTruthy()
    expect(sectionNavigation.querySelector('a[href="#issue-activity"]')).toBeTruthy()
    expect(sectionNavigation.querySelector('a[href="#issue-reply"]')?.textContent).toBe('Reply')
    expect(document.querySelector('#issue-reply textarea')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comment & ask' }).className).toContain('min-h-10')
    expect(sectionNavigation.querySelector('a[href="#issue-runs"]')).toBeNull()
    expect(sectionNavigation.querySelector('a[href="#issue-inbox-reports"]')).toBeNull()

    const rect = (top: number, height = 100): DOMRect => ({
      x: 0,
      y: top,
      top,
      right: 320,
      bottom: top + height,
      left: 0,
      width: 320,
      height,
      toJSON: () => ({}),
    })
    Object.defineProperty(sectionNavigation, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(53, 54),
    })
    Object.defineProperty(document.getElementById('issue-work-item')!, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(-900),
    })
    Object.defineProperty(document.getElementById('issue-what')!, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(-300),
    })
    Object.defineProperty(document.getElementById('issue-activity')!, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(132),
    })
    Object.defineProperty(document.getElementById('issue-reply')!, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(600),
    })
    fireEvent.scroll(window)

    await waitFor(() => {
      expect(sectionNavigation.querySelector('a[href="#issue-activity"]')?.getAttribute('aria-current')).toBe('location')
      expect(workItemLink?.getAttribute('aria-current')).toBeNull()
    })

    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1_000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    fireEvent.scroll(window)

    await waitFor(() => {
      expect(sectionNavigation.querySelector('a[href="#issue-reply"]')?.getAttribute('aria-current')).toBe('location')
    })

    const whatSection = document.getElementById('issue-what')!
    const scrollIntoView = vi.fn()
    Object.defineProperty(whatSection, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const replaceState = vi.spyOn(window.history, 'replaceState')
    fireEvent.click(whatLink)

    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '#issue-what')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(whatLink.getAttribute('aria-current')).toBe('location')
  })

  it.each([
    ['en', 'Work item', 'Status', 'What', 'Activity', 'Issue sections', 'Tap or click the text to edit · changes save automatically.', 'Schedule is valid and has not run yet.'],
    ['zh', '工作项', '状态', '任务内容', '动态', '议题分区', '点按文字即可编辑 · 更改会自动保存。', '运行计划有效，但尚未执行。'],
    ['zh-Hant', '工作項目', '狀態', '任務內容', '動態', '議題區段', '點按文字即可編輯 · 變更會自動儲存。', '執行排程有效，但尚未執行。'],
    ['ja', '作業項目', 'ステータス', '作業内容', 'アクティビティ', '課題セクション', 'テキストをタップまたはクリックして編集 · 変更は自動保存されます。', 'スケジュールは有効ですが、まだ実行されていません。'],
  ] as const)(
    'localizes Issue chrome in %s while preserving authored content',
    async (locale, workItem, status, what, activity, sectionNavigation, editHint, healthMessage) => {
      await i18n.changeLanguage(locale)
      scheduledIssue.issue.automationHealth = {
        state: 'not_started',
        message: 'Schedule is valid and has not run yet.',
      }

      render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

      expect(screen.getByRole('heading', { level: 3, name: workItem })).toBeTruthy()
      expect(screen.getByRole('combobox', { name: status })).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: what })).toBeTruthy()
      expect(screen.getByRole('heading', { level: 2, name: activity })).toBeTruthy()
      expect(screen.getByRole('navigation', { name: sectionNavigation })).toBeTruthy()
      expect(screen.getByText(editHint)).toBeTruthy()
      expect(screen.getByText(healthMessage)).toBeTruthy()
      expect(screen.getByText('Morning movers scan')).toBeTruthy()
      expect(screen.getByText('Scan the market and publish a brief.')).toBeTruthy()
    },
  )

  it('keeps authoritative runtime diagnostics verbatim in localized chrome', async () => {
    await i18n.changeLanguage('zh')
    scheduledIssue.issue.automationHealth = {
      state: 'failed',
      message: 'Provider rejected model MODEL_NOT_FOUND.',
    }

    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByText('Provider rejected model MODEL_NOT_FOUND.')).toBeTruthy()
  })

  it('keeps stable Session identities first in a large assignee picker', async () => {
    const longPreview = `Updated a very long financial and industrial rotation report. ${'Cross-market context and execution notes. '.repeat(5)}END-OF-PREVIEW`
    mocks.getWorkspaceSessionDirectory.mockResolvedValue({
      sessions: [
        {
          resumeId: 'resume-recent-worker',
          agent: 'codex',
          createdAt: Date.now() - 120_000,
          updatedAt: Date.now() - 60_000,
          resumable: true,
          active: false,
          latestExecution: {
            taskId: 'task-1',
            status: 'done',
            startedAt: Date.now() - 90_000,
            assistantPreview: longPreview,
          },
        },
        {
          resumeId: 'resume-active-owner',
          agent: 'pi',
          createdAt: Date.now() - 86_400_000,
          updatedAt: Date.now() - 3_600_000,
          resumable: true,
          active: true,
          interactive: {
            name: 'p1',
            title: 'Current thesis room',
            state: 'running',
            lastActiveAt: new Date().toISOString(),
          },
        },
      ],
    })

    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose responsibility' })
    expect(dialog.className).toContain('grid-cols-[minmax(0,1fr)]')
    expect(dialog.className).toContain('grid-rows-[auto_auto_minmax(0,1fr)_auto]')
    const choices = within(dialog).getAllByRole('button')
    const activeIndex = choices.findIndex((choice) => choice.textContent?.includes('Current thesis room'))
    const recentIndex = choices.findIndex((choice) => choice.textContent?.includes('Updated a very long financial'))

    expect(activeIndex).toBeGreaterThanOrEqual(0)
    expect(recentIndex).toBeGreaterThan(activeIndex)
    expect(choices[activeIndex]?.textContent).toContain('resume-active-owner · pi · active')
    expect(choices[recentIndex]?.textContent).toContain('resume-recent-worker · codex')

    fireEvent.click(choices[activeIndex]!)
    expect(mocks.updateIssue).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Pending assignment')).toBeTruthy()
    expect(within(dialog).getByText('resume-active-owner · pi · active now')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm assignment' }))
    await waitFor(() => expect(mocks.updateIssue).toHaveBeenCalledWith(
      'demo-ws-auto-quant',
      'morning-scan',
      { assignee: '@resume-active-owner' },
    ))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose responsibility' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }))
    const reopenedDialog = await screen.findByRole('dialog', { name: 'Choose responsibility' })

    const search = within(reopenedDialog).getByPlaceholderText(/Search Sessions/)
    fireEvent.change(search, { target: { value: 'financial' } })
    expect(within(reopenedDialog).queryByText('Current thesis room')).toBeNull()
    expect(within(reopenedDialog).getByText(/^Updated a very long financial.*…$/)).toBeTruthy()
    expect(within(reopenedDialog).queryByText(/END-OF-PREVIEW/)).toBeNull()
  })
})
