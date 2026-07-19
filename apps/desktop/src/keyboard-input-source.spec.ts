import { describe, expect, it, vi } from 'vitest'
import {
  MAC_SELECTED_INPUT_SOURCES_JSON_COMMAND,
  readKeyboardInputSourceId,
  readSelectedInputSourceIdFromJson,
} from './keyboard-input-source.js'

describe('macOS keyboard input source reader', () => {
  it('uses the newest keyboard input mode and ignores non-keyboard records', () => {
    expect(readSelectedInputSourceIdFromJson(JSON.stringify([
      { 'Bundle ID': 'com.apple.keylayout.US', InputSourceKind: 'Keyboard Layout' },
      { 'Bundle ID': 'com.apple.PressAndHold', InputSourceKind: 'Non Keyboard Input Method' },
      {
        'Bundle ID': 'com.tencent.inputmethod.wetype',
        'Input Mode': 'com.tencent.inputmethod.wetype.pinyin',
        InputSourceKind: 'Input Mode'
      }
    ]))).toBe('com.tencent.inputmethod.wetype.pinyin')
  })

  it('runs Orca\'s macOS 15-safe selected-source pipeline before layout fallback', async () => {
    const runCommand = vi.fn(async () => JSON.stringify([{
      'Input Mode': 'com.apple.inputmethod.SCIM.ITABC',
      InputSourceKind: 'Input Mode'
    }]))
    await expect(readKeyboardInputSourceId({ platform: 'darwin', runCommand }))
      .resolves.toBe('com.apple.inputmethod.SCIM.ITABC')
    expect(runCommand).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', MAC_SELECTED_INPUT_SOURCES_JSON_COMMAND],
      'Selected keyboard input source probe timed out'
    )
  })

  it('falls back to the keyboard layout and returns null off macOS', async () => {
    const runCommand = vi.fn()
      .mockRejectedValueOnce(new Error('selected probe failed'))
      .mockResolvedValueOnce('com.apple.keylayout.ABC\n')
    await expect(readKeyboardInputSourceId({ platform: 'darwin', runCommand }))
      .resolves.toBe('com.apple.keylayout.ABC')
    await expect(readKeyboardInputSourceId({ platform: 'linux', runCommand }))
      .resolves.toBeNull()
  })
})
