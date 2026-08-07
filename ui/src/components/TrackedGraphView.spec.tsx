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
  it('uses native node controls and opens source material with Tracked context', () => {
    const onSelectEntity = vi.fn()
    const onOpenArtifact = vi.fn()
    render(
      <TrackedGraphView
        graph={graph}
        selectedName="asset-a"
        onSelectEntity={onSelectEntity}
        onOpenEntity={vi.fn()}
        onOpenArtifact={onOpenArtifact}
      />,
    )

    const entityNode = screen.getByRole('button', { name: /topic-b, linked/ })
    expect(entityNode.tagName).toBe('BUTTON')
    fireEvent.click(entityNode)
    expect(onSelectEntity).toHaveBeenCalledWith('topic-b')

    fireEvent.click(screen.getByRole('button', { name: /shared-note, source material/ }))
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
        onSelectEntity={vi.fn()}
        onOpenEntity={vi.fn()}
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
        onSelectEntity={vi.fn()}
        onOpenEntity={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    )

    const assetButton = screen.getByRole('button', { name: /asset-a, linked/ })
    fireEvent.pointerEnter(assetButton)

    expect(assetButton.closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('active')
    expect(screen.getByRole('button', { name: /shared-note, source material/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('related')
    expect(screen.getByRole('button', { name: /topic-b, linked/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('dimmed')
    expect(screen.getByRole('button', { name: /other-note, source material/ })
      .closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('dimmed')

    fireEvent.pointerLeave(assetButton)
    expect(assetButton.closest('[data-graph-node]')?.getAttribute('data-focus-state')).toBe('idle')
  })
})
