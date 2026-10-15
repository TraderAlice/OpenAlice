// Small inert Mach-O buffers for static verification tests. Never executable.
import { createHash } from 'node:crypto'
export function fixtureMachO(arch, payload = '', { entitlements = false } = {}) {
  const limit = 4352
  const special = entitlements ? 5 : 0
  const hashOffset = 112 + special * 32
  const cd = Buffer.alloc(hashOffset + 64)
  for (const [offset, value] of [[0,0xfade0c02],[4,cd.length],[8,0x20400],[12,2],[16,hashOffset],[20,88],[24,special],[28,2],[32,limit]]) cd.writeUInt32BE(value, offset)
  cd[36] = 32; cd[37] = 2; cd[39] = 12
  cd.write('ai.openalice.cli\0', 88)
  const xml = Buffer.from('<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>')
  const entitlement = Buffer.alloc(8 + xml.length)
  entitlement.writeUInt32BE(0xfade7171,0); entitlement.writeUInt32BE(entitlement.length,4); xml.copy(entitlement,8)
  const count = entitlements ? 2 : 1
  const offset = 12 + count * 8
  const signature = Buffer.alloc(offset + cd.length + (entitlements ? entitlement.length : 0))
  signature.writeUInt32BE(0xfade0cc0,0); signature.writeUInt32BE(signature.length,4); signature.writeUInt32BE(count,8)
  signature.writeUInt32BE(0,12); signature.writeUInt32BE(offset,16)
  if (entitlements) { signature.writeUInt32BE(5,20); signature.writeUInt32BE(offset + cd.length,24); entitlement.copy(signature,offset+cd.length); createHash('sha256').update(entitlement).digest().copy(cd,hashOffset-5*32) }
  cd.copy(signature,offset)
  const bytes = Buffer.alloc(limit + signature.length)
  bytes.writeUInt32LE(0xfeedfacf,0); bytes.writeUInt32LE(arch === 'arm64' ? 0x100000c : 0x1000007,4); bytes.writeUInt32LE(2,12); bytes.writeUInt32LE(3,16); bytes.writeUInt32LE(160,20)
  for (const [at,name,off,size] of [[32,'__TEXT',0,4096],[104,'__LINKEDIT',4096,bytes.length-4096]]) { bytes.writeUInt32LE(0x19,at); bytes.writeUInt32LE(72,at+4); bytes.write(name,at+8); bytes.writeBigUInt64LE(BigInt(off),at+40); bytes.writeBigUInt64LE(BigInt(size),at+48) }
  bytes.writeUInt32LE(0x1d,176); bytes.writeUInt32LE(16,180); bytes.writeUInt32LE(limit,184); bytes.writeUInt32LE(signature.length,188)
  bytes.write(payload,4096); signature.copy(bytes,limit)
  return rehashFixtureMachO(bytes)
}
export function rehashFixtureMachO(bytes) {
  const signature = bytes.readUInt32LE(184)
  const cd = signature + bytes.readUInt32BE(signature+16)
  const hashOffset = bytes.readUInt32BE(cd+16)
  for (let i=0;i<2;i++) createHash('sha256').update(bytes.subarray(i*4096,Math.min((i+1)*4096,signature))).digest().copy(bytes,cd+hashOffset+i*32)
  return bytes
}
