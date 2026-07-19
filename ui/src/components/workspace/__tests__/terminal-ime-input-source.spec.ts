// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  BROWSER_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  getMacNativeTextInputSourceFeatures
} from '../terminal-ime-input-source'

describe('macOS native text input-source classification', () => {
  it('recognizes the WeType pinyin mode used by the current machine', () => {
    expect(getMacNativeTextInputSourceFeatures('com.tencent.inputmethod.wetype.pinyin'))
      .toEqual({ forwardAsciiPunctuation: true, forwardShortTextReplacements: false })
  })

  it('keeps ordinary US layouts disabled when Electron identifies them', () => {
    expect(getMacNativeTextInputSourceFeatures('com.apple.keylayout.US'))
      .toEqual({ forwardAsciiPunctuation: false, forwardShortTextReplacements: false })
  })

  it('allows only punctuation forwarding when a browser cannot identify the input source', () => {
    expect(getMacNativeTextInputSourceFeatures(
      null,
      BROWSER_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES
    )).toEqual({ forwardAsciiPunctuation: true, forwardShortTextReplacements: false })
  })
})
