// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BETA_FEATURES_STORAGE_KEY,
  DEFAULT_BETA_FEATURES,
  normalizeBetaFeatures,
  useBetaFeatures,
} from './beta-features'

describe('normalizeBetaFeatures', () => {
  it('defaults malformed or missing values to off', () => {
    expect(normalizeBetaFeatures(undefined)).toEqual(DEFAULT_BETA_FEATURES)
    expect(normalizeBetaFeatures({ office: 'yes' })).toEqual({ office: false })
    expect(normalizeBetaFeatures({ office: 1 })).toEqual({ office: false })
  })

  it('accepts an explicit on value', () => {
    expect(normalizeBetaFeatures({ office: true })).toEqual({ office: true })
  })
})

describe('useBetaFeatures', () => {
  beforeEach(() => {
    localStorage.removeItem(BETA_FEATURES_STORAGE_KEY)
    useBetaFeatures.setState(DEFAULT_BETA_FEATURES)
  })

  afterEach(() => {
    localStorage.removeItem(BETA_FEATURES_STORAGE_KEY)
    useBetaFeatures.setState(DEFAULT_BETA_FEATURES)
  })

  it('starts with Office hidden', () => {
    expect(useBetaFeatures.getState().office).toBe(false)
  })

  it('records the Office Activity Bar preference', () => {
    useBetaFeatures.getState().setOffice(true)
    expect(useBetaFeatures.getState().office).toBe(true)
    useBetaFeatures.getState().setOffice(false)
    expect(useBetaFeatures.getState().office).toBe(false)
  })
})
