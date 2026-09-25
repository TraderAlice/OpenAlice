import { describe, expect, it } from 'vitest'
import {
  AbortController,
  AbortSignal,
  default as DefaultExport,
} from './abort-controller.js'

describe('abort-controller shim', () => {
  it('re-exports the native global AbortController', () => {
    expect(AbortController).toBe(globalThis.AbortController)
    expect(DefaultExport).toBe(globalThis.AbortController)
  })

  it('re-exports the native global AbortSignal', () => {
    expect(AbortSignal).toBe(globalThis.AbortSignal)
  })

  it('produces a signal whose prototype name is AbortSignal', () => {
    const signal = new AbortController().signal
    const proto = Object.getPrototypeOf(signal)
    expect(proto?.constructor?.name).toBe('AbortSignal')
  })
})
