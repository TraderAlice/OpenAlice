// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { StickerManager } from './StickerManager'
const mock = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }))
vi.mock('../../hooks/useStickerPacks', async original => ({ ...await original<typeof import('../../hooks/useStickerPacks')>(), useStickerPacks: () => ({ busy: false, error: null, ...mock, data: { defaultPackId: 'color', packs: [{ id: 'color', name: 'Color', version: '1', revision: '1+abc', source: 'builtin', stickers: [{ file: 'wave.png', description: 'Hello' }] }], workspaces: [{ id: 'ws', name: 'Chat', state: { enabled: true, packId: 'color', revision: '1+old' }, skillPresent: true, changed: [] }] } }) }))
beforeEach(async () => { await i18n.changeLanguage('en'); mock.request.mockReset(); mock.refresh.mockReset() })
afterEach(cleanup)
it('previews disable before applying and retains source pack preview', async () => {
  mock.request.mockResolvedValueOnce({ digest: 'abc', revision: '1+abc', conflicts: [], files: ['.agents/skills/alice-stickers/SKILL.md'] }).mockResolvedValueOnce({})
  render(<StickerManager wsId="ws" />)
  expect(screen.getByAltText('Hello')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(mock.request).toHaveBeenLastCalledWith('/workspaces/ws/apply', { enabled: false, packId: 'color', digest: 'abc', restore: false }))
})
