// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearOfficePlayerState,
  readOfficePlayerState,
  rememberOfficePlayerState,
} from './office-excursion'

beforeEach(() => {
  clearOfficePlayerState()
})

describe('Office excursion continuity', () => {
  it('copies the remembered player state instead of exposing mutable module data', () => {
    rememberOfficePlayerState({ position: { x: 456, y: 384 }, direction: 'left' })
    const remembered = readOfficePlayerState()!
    remembered.position.x = 0

    expect(readOfficePlayerState()).toEqual({
      position: { x: 456, y: 384 },
      direction: 'left',
    })
  })

  it('clears the tab-lifetime floor memory without retaining a stale return point', () => {
    rememberOfficePlayerState({ position: { x: 312, y: 240 }, direction: 'left' })
    clearOfficePlayerState()
    expect(readOfficePlayerState()).toBeNull()
  })
})
