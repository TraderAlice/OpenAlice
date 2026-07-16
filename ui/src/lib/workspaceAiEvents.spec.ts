// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
  notifyWorkspaceDefaultsChanged,
  WORKSPACE_DEFAULTS_CHANGED_EVENT,
} from './workspaceAiEvents'

describe('workspace AI settings events', () => {
  it('notifies long-lived launch surfaces when creation defaults change', () => {
    const listener = vi.fn()
    window.addEventListener(WORKSPACE_DEFAULTS_CHANGED_EVENT, listener, { once: true })

    notifyWorkspaceDefaultsChanged()

    expect(listener).toHaveBeenCalledOnce()
  })
})
