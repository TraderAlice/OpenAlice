import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

export function verifyNativeBootstrapFormat(executablePath, platform, arch) {
  if (!['x64', 'arm64'].includes(arch)) {
    throw new Error(`unsupported native bootstrap architecture: ${arch}`)
  }
  const descriptor = openSync(executablePath, 'r')
  try {
    const size = fstatSync(descriptor).size
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('native bootstrap file size is invalid')
    if (platform === 'win32') verifyPeExecutable(descriptor, size, arch)
    else if (platform === 'linux') verifyElfExecutable(descriptor, size, arch)
    else if (platform === 'darwin') verifyMachExecutable(descriptor, size, arch)
    else throw new Error(`unsupported native bootstrap platform: ${platform}`)
  } finally {
    closeSync(descriptor)
  }
  return 'passed'
}

function verifyPeExecutable(descriptor, size, arch) {
  const dos = readExactly(descriptor, size, 0, 64, 'DOS header')
  if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('native bootstrap is not a PE executable')
  const peOffset = dos.readUInt32LE(0x3c)
  const coff = readExactly(descriptor, size, peOffset, 24, 'PE header')
  if (coff.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error('native bootstrap has an invalid PE header')
  const expectedMachine = arch === 'x64' ? 0x8664 : 0xaa64
  if (coff.readUInt16LE(4) !== expectedMachine) throw architectureError('win32', arch)
  const sectionCount = coff.readUInt16LE(6)
  const optionalSize = coff.readUInt16LE(20)
  const characteristics = coff.readUInt16LE(22)
  if (
    sectionCount === 0
    || sectionCount > 96
    || optionalSize < 240
    || optionalSize > 4096
    || (characteristics & 0x0002) === 0
    || (characteristics & 0x2000) !== 0
  ) {
    throw new Error('native bootstrap PE image metadata is invalid')
  }
  const optional = readExactly(descriptor, size, peOffset + 24, optionalSize, 'PE optional header')
  const entryPoint = optional.readUInt32LE(16)
  const sizeOfImage = optional.readUInt32LE(56)
  if (optional.readUInt16LE(0) !== 0x20b || entryPoint === 0 || sizeOfImage === 0 || entryPoint >= sizeOfImage) {
    throw new Error('native bootstrap is not an executable PE32+ image')
  }
  const directoryCount = optional.readUInt32LE(108)
  if (directoryCount > 16 || optionalSize < 112 + directoryCount * 8) {
    throw new Error('native bootstrap PE data directory table is invalid')
  }
  for (let index = 0; index < directoryCount; index += 1) {
    const directoryOffset = 112 + index * 8
    const address = optional.readUInt32LE(directoryOffset)
    const bytes = optional.readUInt32LE(directoryOffset + 4)
    if (address === 0 && bytes === 0) continue
    if (address === 0 || bytes === 0) throw new Error('native bootstrap PE data directory entry is invalid')
    const end = checkedEnd(address, bytes, 'PE data directory')
    if (index === 4 ? end > size : end > sizeOfImage) {
      throw new Error('native bootstrap PE data directory exceeds the declared image')
    }
  }
  const sectionTable = peOffset + 24 + optionalSize
  readExactly(descriptor, size, sectionTable, sectionCount * 40, 'PE section table')
  let entryInExecutableSection = false
  for (let index = 0; index < sectionCount; index += 1) {
    const section = readExactly(descriptor, size, sectionTable + index * 40, 40, 'PE section')
    const virtualSize = section.readUInt32LE(8)
    const virtualAddress = section.readUInt32LE(12)
    const rawSize = section.readUInt32LE(16)
    const rawOffset = section.readUInt32LE(20)
    const flags = section.readUInt32LE(36)
    if (rawSize > 0 && checkedEnd(rawOffset, rawSize, 'PE section') > size) {
      throw new Error('native bootstrap PE section exceeds the file')
    }
    const mappedBytes = Math.max(virtualSize, rawSize)
    const mappedEnd = checkedEnd(virtualAddress, mappedBytes, 'PE mapped section')
    if (mappedEnd > sizeOfImage) throw new Error('native bootstrap PE section exceeds the declared image')
    if (
      mappedBytes > 0
      && (flags & 0x20000000) !== 0
      && entryPoint >= virtualAddress
      && entryPoint < mappedEnd
    ) {
      entryInExecutableSection = true
    }
  }
  if (!entryInExecutableSection) throw new Error('native bootstrap PE entry point is not in an executable section')
}

function verifyElfExecutable(descriptor, size, arch) {
  const header = readExactly(descriptor, size, 0, 64, 'ELF header')
  if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header[4] !== 2 || header[5] !== 1) {
    throw new Error('native bootstrap is not a 64-bit little-endian ELF executable')
  }
  const fileType = header.readUInt16LE(16)
  if (fileType !== 2 && fileType !== 3) throw new Error('native bootstrap ELF file is not executable')
  const expectedMachine = arch === 'x64' ? 0x3e : 0xb7
  if (header.readUInt16LE(18) !== expectedMachine) throw architectureError('linux', arch)
  const entryPoint = safeUInt64(header, 24, 'ELF entry point')
  if (entryPoint === 0 || header.readUInt16LE(52) < 64) {
    throw new Error('native bootstrap ELF entry point or header size is invalid')
  }
  const programOffset = safeUInt64(header, 32, 'ELF program table offset')
  const programEntrySize = header.readUInt16LE(54)
  const programCount = header.readUInt16LE(56)
  if (programEntrySize < 56 || programEntrySize > 4096 || programCount === 0 || programCount > 1024) {
    throw new Error('native bootstrap ELF program table is invalid')
  }
  readExactly(descriptor, size, programOffset, programEntrySize * programCount, 'ELF program table')
  let entryInExecutableSegment = false
  for (let index = 0; index < programCount; index += 1) {
    const entry = readExactly(descriptor, size, programOffset + index * programEntrySize, 56, 'ELF program header')
    const fileOffset = safeUInt64(entry, 8, 'ELF segment offset')
    const virtualAddress = safeUInt64(entry, 16, 'ELF segment virtual address')
    const fileBytes = safeUInt64(entry, 32, 'ELF segment file size')
    const memoryBytes = safeUInt64(entry, 40, 'ELF segment memory size')
    const alignment = safeUInt64(entry, 48, 'ELF segment alignment')
    if (fileBytes > memoryBytes) throw new Error('native bootstrap ELF segment file size exceeds memory size')
    if (checkedEnd(fileOffset, fileBytes, 'ELF segment') > size) throw new Error('native bootstrap ELF segment exceeds the file')
    if (
      alignment > 1
      && (!isPowerOfTwo(alignment) || fileOffset % alignment !== virtualAddress % alignment)
    ) {
      throw new Error('native bootstrap ELF segment alignment is invalid')
    }
    const fileBackedEnd = checkedEnd(virtualAddress, fileBytes, 'ELF file-backed segment')
    if (
      entry.readUInt32LE(0) === 1
      && fileBytes > 0
      && (entry.readUInt32LE(4) & 1) !== 0
      && entryPoint >= virtualAddress
      && entryPoint < fileBackedEnd
    ) {
      entryInExecutableSegment = true
    }
  }
  if (!entryInExecutableSegment) throw new Error('native bootstrap ELF entry point is not in an executable load segment')
}

function verifyMachExecutable(descriptor, size, arch) {
  const header = readExactly(descriptor, size, 0, 32, 'Mach-O header')
  if (header.readUInt32LE(0) !== 0xfeedfacf) throw new Error('native bootstrap is not a 64-bit Mach-O executable')
  const expectedMachine = arch === 'x64' ? 0x01000007 : 0x0100000c
  if (header.readUInt32LE(4) !== expectedMachine) throw architectureError('darwin', arch)
  if (header.readUInt32LE(12) !== 2) throw new Error('native bootstrap Mach-O file is not executable')
  const commandCount = header.readUInt32LE(16)
  const commandBytes = header.readUInt32LE(20)
  if (commandCount === 0 || commandCount > 4096 || commandBytes < 8 || commandBytes > 16 * 1024 * 1024) {
    throw new Error('native bootstrap Mach-O load commands are invalid')
  }
  const commandsEnd = 32 + commandBytes
  readExactly(descriptor, size, 32, commandBytes, 'Mach-O load commands')
  let offset = 32
  const executableSegments = []
  let entryOffset = null
  for (let index = 0; index < commandCount; index += 1) {
    const commandHeader = readExactly(descriptor, size, offset, 8, 'Mach-O load command')
    const command = commandHeader.readUInt32LE(0)
    const commandSize = commandHeader.readUInt32LE(4)
    if (commandSize < 8 || commandSize % 8 !== 0 || offset + commandSize > commandsEnd) {
      throw new Error('native bootstrap Mach-O load command is invalid')
    }
    if (command === 0x19) {
      if (commandSize < 72) throw new Error('native bootstrap Mach-O segment command is invalid')
      const segment = readExactly(descriptor, size, offset, 72, 'Mach-O segment command')
      const memoryBytes = safeUInt64(segment, 32, 'Mach-O segment memory size')
      const fileOffset = safeUInt64(segment, 40, 'Mach-O segment offset')
      const fileBytes = safeUInt64(segment, 48, 'Mach-O segment file size')
      const sectionCount = segment.readUInt32LE(64)
      if (commandSize !== checkedEnd(72, sectionCount * 80, 'Mach-O segment command')) {
        throw new Error('native bootstrap Mach-O segment section table is invalid')
      }
      if (fileBytes > memoryBytes) throw new Error('native bootstrap Mach-O segment file size exceeds memory size')
      const segmentEnd = checkedEnd(fileOffset, fileBytes, 'Mach-O segment')
      if (segmentEnd > size) throw new Error('native bootstrap Mach-O segment exceeds the file')
      if (fileBytes > 0 && (segment.readUInt32LE(60) & 4) !== 0) {
        executableSegments.push({ start: fileOffset, end: segmentEnd })
      }
    }
    if (command === 0x80000028) {
      if (commandSize !== 24 || entryOffset !== null) throw new Error('native bootstrap Mach-O entry command is invalid')
      const entry = readExactly(descriptor, size, offset, 24, 'Mach-O entry command')
      entryOffset = safeUInt64(entry, 8, 'Mach-O entry offset')
    }
    offset += commandSize
  }
  if (offset !== commandsEnd) throw new Error('native bootstrap Mach-O load command sizes do not match the header')
  if (
    entryOffset === null
    || !executableSegments.some(({ start, end }) => entryOffset >= start && entryOffset < end)
  ) {
    throw new Error('native bootstrap Mach-O image has no valid executable entry segment')
  }
}

function readExactly(descriptor, size, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
    throw new Error(`native bootstrap ${label} exceeds the file`)
  }
  const output = Buffer.allocUnsafe(length)
  let total = 0
  while (total < length) {
    const count = readSync(descriptor, output, total, length - total, offset + total)
    if (count === 0) throw new Error(`native bootstrap ${label} is truncated`)
    total += count
  }
  return output
}

function safeUInt64(buffer, offset, label) {
  const value = buffer.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`native bootstrap ${label} is too large`)
  return Number(value)
}

function checkedEnd(start, length, label) {
  const end = start + length
  if (!Number.isSafeInteger(end)) throw new Error(`native bootstrap ${label} range is too large`)
  return end
}

function isPowerOfTwo(value) {
  const big = BigInt(value)
  return (big & (big - 1n)) === 0n
}
function architectureError(platform, arch) {
  return new Error(`native bootstrap architecture mismatch: expected ${platform}-${arch}`)
}
