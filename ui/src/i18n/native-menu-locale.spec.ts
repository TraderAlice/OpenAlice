import { describe, expect, it, vi } from 'vitest'

describe('native locale publication', () => {
  it('publishes the saved language on boot and each later language change', async () => {
    vi.resetModules()
    localStorage.setItem('openalice.locale.v1', JSON.stringify({ state: { locale: 'zh' }, version: 1 }))
    const setNativeMenuLocale = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'openAlice', { configurable: true, value: { setNativeMenuLocale } })
    try {
      await import('./index')
      expect(setNativeMenuLocale).toHaveBeenCalledWith('zh')
      const { useLocaleStore } = await import('./store')
      useLocaleStore.getState().setLocale('ja')
      expect(setNativeMenuLocale).toHaveBeenLastCalledWith('ja')
      expect(document.documentElement.lang).toBe('ja')
      useLocaleStore.getState().setLocale('ja')
      expect(setNativeMenuLocale).toHaveBeenCalledTimes(2)
      // Ordinary browsers still use the same locale owner without native IPC.
      Object.defineProperty(window, 'openAlice', { configurable: true, value: undefined })
      expect(() => useLocaleStore.getState().setLocale('en')).not.toThrow()
      expect(document.documentElement.lang).toBe('en')
    } finally {
      localStorage.removeItem('openalice.locale.v1')
      Object.defineProperty(window, 'openAlice', { configurable: true, value: undefined })
    }
  })
})
