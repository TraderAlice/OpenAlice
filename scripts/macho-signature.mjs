import { createHash } from 'node:crypto'

const digest = bytes => createHash('sha256').update(bytes).digest()
function requireCondition(condition, message) {
  if (!condition) throw new Error(`Mach-O signature: ${message}`)
}

// Restricted to the thin, little-endian, 64-bit executables shipped by this CLI.
// Layout: Apple's xnu/osfmk/kern/cs_blobs.h and mach-o/loader.h.
// This verifies embedded ad-hoc integrity, not certificate trust or TCC identity.
function readSignature(bytes, arch) {
  const check = requireCondition
  check(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf, 'expected thin 64-bit Mach-O')
  const cpu = bytes.readUInt32LE(4)
  check(cpu === (arch === 'arm64' ? 0x100000c : arch === 'x64' ? 0x1000007 : -1), 'architecture mismatch')
  check(bytes.readUInt32LE(12) === 2, 'expected executable')
  const count = bytes.readUInt32LE(16)
  const commandsEnd = 32 + bytes.readUInt32LE(20)
  check(commandsEnd <= bytes.length && count <= (commandsEnd - 32) / 8, 'invalid load commands')
  let cursor = 32
  let signature
  let linkedit
  for (let index = 0; index < count; index++) {
    check(cursor + 8 <= commandsEnd, 'truncated load command')
    const command = bytes.readUInt32LE(cursor)
    const size = bytes.readUInt32LE(cursor + 4)
    check(size >= 8 && cursor + size <= commandsEnd, 'invalid load command size')
    if (command === 0x1d) {
      check(size === 16 && !signature, 'invalid or duplicate code signature command')
      signature = { offset: bytes.readUInt32LE(cursor + 8), size: bytes.readUInt32LE(cursor + 12) }
    }
    if (command === 0x19) {
      check(size >= 72, 'truncated segment')
      if (bytes.subarray(cursor + 8, cursor + 24).toString().replace(/\0.*$/, '') === '__LINKEDIT') {
        check(!linkedit, 'duplicate LINKEDIT')
        linkedit = { offset: Number(bytes.readBigUInt64LE(cursor + 40)), size: Number(bytes.readBigUInt64LE(cursor + 48)) }
      }
    }
    cursor += size
  }
  check(cursor === commandsEnd && signature, 'missing signature or invalid load command coverage')
  check(signature.offset >= commandsEnd && signature.size >= 12 && signature.offset + signature.size === bytes.length, 'signature must end at EOF')
  check(linkedit && linkedit.offset <= signature.offset && linkedit.offset + linkedit.size === bytes.length, 'invalid LINKEDIT coverage')
  const superblob = bytes.subarray(signature.offset)
  const total = superblob.readUInt32BE(4)
  const blobCount = superblob.readUInt32BE(8)
  check(superblob.readUInt32BE(0) === 0xfade0cc0 && total <= signature.size && total >= 12, 'invalid SuperBlob')
  check(blobCount <= (total - 12) / 8, 'invalid blob index')
  const blobs = new Map()
  const ranges = []
  for (let index = 0; index < blobCount; index++) {
    const slot = superblob.readUInt32BE(12 + index * 8)
    const offset = superblob.readUInt32BE(16 + index * 8)
    check(!blobs.has(slot) && offset >= 12 + blobCount * 8 && offset + 8 <= total, 'invalid blob offset or duplicate slot')
    const length = superblob.readUInt32BE(offset + 4)
    check(length >= 8 && offset + length <= total && ranges.every(([a, z]) => offset + length <= a || offset >= z), 'overlapping or truncated blob')
    ranges.push([offset, offset + length])
    blobs.set(slot, superblob.subarray(offset, offset + length))
  }
  check([...blobs.keys()].every(slot => [0, 2, 5, 7, 0x10000].includes(slot)), 'unsupported signature slot')
  const directory = blobs.get(0)
  check(directory?.length >= 44 && directory.readUInt32BE(0) === 0xfade0c02, 'missing CodeDirectory')
  const version = directory.readUInt32BE(8)
  const headerSize = version >= 0x20600 ? 108 : version >= 0x20500 ? 96 : version >= 0x20400 ? 88 : version >= 0x20300 ? 64 : version >= 0x20200 ? 52 : 48
  check(version >= 0x20100 && version <= 0x20600 && directory.length >= headerSize, 'unsupported CodeDirectory version')
  const flags = directory.readUInt32BE(12)
  const hashOffset = directory.readUInt32BE(16)
  const identifierOffset = directory.readUInt32BE(20)
  const specialSlots = directory.readUInt32BE(24)
  const codeSlots = directory.readUInt32BE(28)
  const limit64 = version >= 0x20300 ? Number(directory.readBigUInt64BE(56)) : 0
  const codeLimit = limit64 || directory.readUInt32BE(32)
  return { flags, hashOffset, identifierOffset, specialSlots, codeSlots, codeLimit, headerSize, version, directory, blobs, signature }
}

export function machoSigningMetadata(bytes, arch) {
  const { flags, blobs } = readSignature(bytes, arch)
  const xml = blobs.get(5)
  requireCondition(!xml || xml.readUInt32BE(0) === 0xfade7171, 'invalid entitlement blob')
  requireCondition(!blobs.has(7) || xml, 'DER entitlements without XML are unsupported')
  return { flags: flags & 0x1ff00, entitlements: xml?.subarray(8) }
}

export function inspectMachOSignature(bytes, arch) {
  const check = requireCondition
  const { flags, hashOffset, identifierOffset, specialSlots, codeSlots, codeLimit, headerSize, version, directory, blobs, signature } = readSignature(bytes, arch)
  check((flags & 2) !== 0 && (flags & 0x20000) === 0, 'expected finalized ad-hoc signature')
  check(directory[36] === 32 && directory[37] === 2 && directory[39] === 12, 'expected SHA-256 / 4096-byte pages')
  check(directory.readUInt32BE(44) === 0 && (version < 0x20200 || directory.readUInt32BE(48) === 0), 'scatter or team signature unsupported')
  check(codeLimit === signature.offset && codeSlots === Math.ceil(codeLimit / 4096), 'incomplete code coverage')
  check(specialSlots <= 7 && hashOffset - specialSlots * 32 >= headerSize && hashOffset + codeSlots * 32 <= directory.length, 'invalid hash table')
  const stringsEnd = hashOffset - specialSlots * 32
  const identifierEnd = directory.indexOf(0, identifierOffset)
  check(identifierOffset >= headerSize && identifierEnd >= identifierOffset && identifierEnd < stringsEnd, 'invalid identifier')
  for (let index = 0; index < codeSlots; index++) {
    const actual = digest(bytes.subarray(index * 4096, Math.min((index + 1) * 4096, codeLimit)))
    check(actual.equals(directory.subarray(hashOffset + index * 32, hashOffset + (index + 1) * 32)), `code page ${index} hash mismatch`)
  }
  for (let slot = 1; slot <= specialSlots; slot++) {
    const blob = blobs.get(slot)
    const expected = directory.subarray(hashOffset - slot * 32, hashOffset - (slot - 1) * 32)
    check(expected.equals(blob ? digest(blob) : Buffer.alloc(32)), `special slot ${slot} hash mismatch`)
  }
  for (const slot of [2, 5, 7]) check(!blobs.has(slot) || slot <= specialSlots, `unhashed special slot ${slot}`)
  for (const [slot, magic] of [[2, 0xfade0c01], [5, 0xfade7171], [7, 0xfade7172]]) check(!blobs.has(slot) || blobs.get(slot).readUInt32BE(0) === magic, `invalid special slot ${slot}`)
  if (blobs.has(0x10000)) {
    const cms = blobs.get(0x10000)
    check(cms.length === 8 && cms.readUInt32BE(0) === 0xfade0b01, 'expected empty ad-hoc CMS')
  }
  return { flags, codeSlots, codeLimit, identifier: directory.subarray(identifierOffset, identifierEnd).toString() }
}
