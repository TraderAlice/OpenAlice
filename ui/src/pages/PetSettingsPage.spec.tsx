// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { i18n } from '../i18n'
import { PetSettingsPage } from './PetSettingsPage'
beforeAll(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'openAlice') })
describe('Pet settings page', () => {
  it('explains the desktop boundary in a browser', () => {
    render(<PetSettingsPage />)
    expect(screen.getByText(/available in the desktop app/)).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
  })
  it('shows silent defaults and saves mute and volume via the desktop bridge', async () => {
    let settings: PetSoundSettings = { enabled: true, volume: .5, source: null }
    const updateSound = vi.fn(async (patch: Partial<PetSoundSettings>) => (settings = { ...settings, ...patch }))
    Object.defineProperty(window, 'openAlice', { configurable: true, value: { companion: {
      getSound: async () => settings, updateSound, resetSound: async () => settings, onSound: () => () => {},
    } } })
    render(<PetSettingsPage />)
    expect(await screen.findByText('No sound selected — clicks are silent.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'Play sound on click' }))
    await waitFor(() => expect(updateSound).toHaveBeenCalledWith({ enabled: false }))
    const slider = screen.getByRole('slider', { name: 'Volume' })
    await waitFor(() => expect((slider as HTMLInputElement).disabled).toBe(false))
    fireEvent.change(slider, { target: { value: '25' } }); fireEvent.keyUp(slider, { key: 'ArrowLeft' })
    await waitFor(() => expect(updateSound).toHaveBeenCalledWith({ volume: .25 }))
  })
})
