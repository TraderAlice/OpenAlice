// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityGraph } from '../api/entities'
import { i18n } from '../i18n'
import { TrackedGraphView } from './TrackedGraphView'

const graph: EntityGraph = {
  nodes: [
    { id: 'entity:a', kind: 'entity', label: 'asset-a', entityType: 'asset', description: 'Asset A', createdAt: 1 },
    { id: 'entity:b', kind: 'entity', label: 'topic-b', entityType: 'topic', description: 'Topic B', createdAt: 1 },
    { id: 'entity:c', kind: 'entity', label: 'second-hop-c', entityType: 'topic', description: 'Second hop', createdAt: 1 },
    {
      id: 'artifact:note', kind: 'artifact', label: 'shared-note', artifactType: 'note',
      workspaceId: 'ws-1', workspaceTag: 'research', path: 'shared-note.md',
    },
    {
      id: 'artifact:other', kind: 'artifact', label: 'other-note', artifactType: 'note',
      workspaceId: 'ws-1', workspaceTag: 'research', path: 'other-note.md',
    },
    {
      id: 'artifact:issue', kind: 'artifact', label: 'Power watch', artifactType: 'issue',
      workspaceId: 'ws-1', workspaceTag: 'research', path: '.alice/issues/power-watch.md',
    },
  ],
  edges: [
    { id: 'note-a', source: 'artifact:note', target: 'entity:a' },
    { id: 'note-b', source: 'artifact:note', target: 'entity:b' },
    { id: 'other-b', source: 'artifact:other', target: 'entity:b' },
    { id: 'other-c', source: 'artifact:other', target: 'entity:c' },
  ],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('TrackedGraphView', () => {
  it('uses native node controls and previews source material before opening it', () => {
    const onSelectEntity = vi.fn()
    const onOpenArtifact = vi.fn()
    render(
      <TrackedGraphView
        graph={graph}
        selectedName="asset-a"
        selectedIssue={null}
        onSelectEntity={onSelectEntity}
        onSelectIssue={vi.fn()}
        onOpenEntity={vi.fn()}
        onOpenIssue={vi.fn()}
        onOpenArtifact={onOpenArtifact}
      />,
    )

    const entityNode = screen.getByRole('button', { name: /topic-b, linked/ })
    expect(entityNode.tagName).toBe('BUTTON')
    fireEvent.click(entityNode)
    expect(onSelectEntity).toHaveBeenCalledWith('topic-b')

    fireEvent.click(screen.getByRole('button', { name: /shared-note, source material/ }))
    expect(onOpenArtifact).not.toHaveBeenCalled()
    expect(screen.getByText('Note · research')).toBeTruthy()
    expect(screen.getByText('shared-note.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'shared-note.md' }),
      'asset-a',
    )
  })

  it('turns the selected entity into a local relationship neighborhood', () => {
    render(
      <TrackedGraphView
        graph={graph}
        selectedName="asset-a"
        selectedIssue={null}
        onSelectEntity={vi.fn()}
        onSelectIssue={vi.fn()}
        onOpenEntity={vi.fn()}
        onOpenIssue={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Related$/ }))
    expect(screen.getByRole('button', { name: /asset-a, linked/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /topic-b, linked/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /second-hop-c, linked/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /other-note, source material/ })).toBeNull()
  })

  it('focuses one-hop relationships when a node is hovered', () => {
    render(
      <TrackedGraphView
        graph={graph}
        selectedName={null}
        selectedIssue={null}
        onSelectEntity={vi.fn()}
        onSelectIssue={vi.fn()}
        onOpenEntity={vi.fn()}
        onOpenIssue={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    )

    const assetButton = screen.getByRole('button', { name: /asset-a, linked/ })
    const assetNode = assetButton.closest('[data-graph-node]')
    const visualMark = assetNode?.querySelector('.oa-tracked-graph-node-mark')
    expect(visualMark).toBeTruthy()
    expect(visualMark?.querySelector('button')).toBeNull()
    expect(visualMark?.querySelector('text')).toBeNull()
    expect(assetNode?.querySelector('.oa-tracked-graph-label')).toBeTruthy()

    fireEvent.pointerEnter(assetButton)

    expect(assetNode?.getAttribute('data-focus-state')).toBe('active')
    expect(screen.getByRole('button', { name: /shared-note, source material/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('related')
    expect(screen.getByRole('button', { name: /topic-b, linked/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('dimmed')
    expect(screen.getByRole('button', { name: /other-note, source material/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('dimmed')

    fireEvent.pointerLeave(assetButton)
    expect(assetNode?.getAttribute('data-focus-state')).toBe('idle')
  })

  it('focuses a sidebar Issue through the same graph selection and preview path', () => {
    const onSelectIssue = vi.fn()
    const onOpenIssue = vi.fn()
    render(
      <TrackedGraphView
        graph={graph}
        selectedName={null}
        selectedIssue={{ workspaceId: 'ws-1', issueId: 'power-watch' }}
        onSelectEntity={vi.fn()}
        onSelectIssue={onSelectIssue}
        onOpenEntity={vi.fn()}
        onOpenIssue={onOpenIssue}
        onOpenArtifact={vi.fn()}
      />,
    )

    const issueButton = screen.getByRole('button', { name: /Power watch, source material/ })
    expect(issueButton.closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('active')
    expect(screen.getByText('Issue · research')).toBeTruthy()

    fireEvent.click(issueButton)
    expect(onSelectIssue).toHaveBeenCalledWith({ workspaceId: 'ws-1', issueId: 'power-watch' })
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
    expect(onOpenIssue).toHaveBeenCalledWith({ workspaceId: 'ws-1', issueId: 'power-watch' })
  })
})
