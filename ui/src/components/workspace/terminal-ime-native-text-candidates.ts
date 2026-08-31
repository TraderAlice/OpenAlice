import {
  DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  type MacNativeTextInputSourceFeatures
} from './terminal-ime-input-source'

export type ImeNativeTextKeyEvent = {
  type: string
  key: string
  code?: string
  keyCode?: number
  which?: number
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
}

const CJK_DIRECT_PUNCTUATION_KEYS = new Set<string>([
  '、', '。', '，', '．', '！', '？', '；', '：', '“', '”', '‘', '’',
  '（', '）', '【', '】', '《', '》', '〈', '〉', '「', '」', '『', '』',
  '￥', '～', '·', '…'
])

function isSingleAsciiKey(key: string): number | null {
  if (Array.from(key).length !== 1) return null
  return key.codePointAt(0) ?? null
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

function isUpperAsciiLetterCode(code: number): boolean {
  return code >= 0x41 && code <= 0x5a
}

function isLowerAsciiLetterCode(code: number): boolean {
  return code >= 0x61 && code <= 0x7a
}

function isAsciiPunctuationKey(key: string): boolean {
  const code = isSingleAsciiKey(key)
  if (code === null) return false
  return (
    code > 0x20 &&
    code <= 0x7e &&
    !isAsciiDigitCode(code) &&
    !isUpperAsciiLetterCode(code) &&
    !isLowerAsciiLetterCode(code)
  )
}

function isCjkDirectPunctuationKey(key: string): boolean {
  return Array.from(key).length === 1 && CJK_DIRECT_PUNCTUATION_KEYS.has(key)
}

function isAsciiShortTextReplacementKey(key: string): boolean {
  const code = isSingleAsciiKey(key)
  if (code === null) return false
  return isAsciiDigitCode(code) || isUpperAsciiLetterCode(code) || isLowerAsciiLetterCode(code)
}

export function isSinglePrintableTextKey(key: string): boolean {
  const chars = Array.from(key)
  if (chars.length !== 1) return false
  const codePoint = chars[0].codePointAt(0)
  return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f
}

function hasUnreliablePhysicalKeyIdentity(event: ImeNativeTextKeyEvent): boolean {
  const code = event.code?.trim()
  const legacyKeyCode = event.keyCode ?? event.which
  return !code || code === 'Unidentified' || legacyKeyCode === 0
}

function isSyntheticUnicodeTextKey(event: ImeNativeTextKeyEvent): boolean {
  if (!hasUnreliablePhysicalKeyIdentity(event)) return false
  if (event.key === 'Unidentified') return true
  return isSinglePrintableTextKey(event.key)
}

function isImeProcessedKeydown(event: ImeNativeTextKeyEvent): boolean {
  return (event.keyCode ?? event.which) === 229
}

export function isImeNativeTextKeydownCandidate(
  event: ImeNativeTextKeyEvent,
  compositionActive: boolean,
  inputSourceFeatures: MacNativeTextInputSourceFeatures =
    DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES
): boolean {
  if (event.type !== 'keydown') return false
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  if (event.isComposing === true || compositionActive) return false
  // keyCode 229 marks a keydown the IME owns (macOS Chromium keeps the real
  // character in `key` while an IME is active, even in its ASCII mode).
  // xterm routes every 229 keydown through CompositionHelper's textarea-diff
  // path, which batches pending inserts behind one 0ms timer over the shared
  // helper textarea. Claiming such keys here makes the forwarder clear that
  // textarea mid-window, so the pending diff loses fast-typed letters and can
  // even emit a spurious DEL that swallows the just-forwarded character.
  // The 229 path already forwards IME-produced text (including full-width
  // punctuation) byte-faithfully, so the claim is only for non-IME keydowns.
  if (isImeProcessedKeydown(event)) return false
  if (isSyntheticUnicodeTextKey(event)) return true
  if (isCjkDirectPunctuationKey(event.key)) return true
  if (inputSourceFeatures.forwardAsciiPunctuation && isAsciiPunctuationKey(event.key)) return true
  return (
    inputSourceFeatures.forwardShortTextReplacements &&
    isAsciiShortTextReplacementKey(event.key)
  )
}
