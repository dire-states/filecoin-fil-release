// Just enough DAG-CBOR to read the miner's vesting table: unsigned ints, byte strings and arrays.
export type Cbor = number | Uint8Array | Cbor[]

export function decodeCbor(bytes: Uint8Array): Cbor {
  let pos = 0

  function arg(info: number): number {
    if (info < 24) return info
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1
    if (len < 0) throw new Error(`cbor: unsupported length encoding ${info} at ${pos - 1}`)
    let v = 0
    for (let i = 0; i < len; i++) v = v * 256 + bytes[pos++]
    if (!Number.isSafeInteger(v)) throw new Error(`cbor: integer too large at ${pos - len - 1}`)
    return v
  }

  function item(): Cbor {
    if (pos >= bytes.length) throw new Error('cbor: unexpected end of data')
    const b = bytes[pos++]
    const major = b >> 5
    const n = arg(b & 31)
    switch (major) {
      case 0:
        return n
      case 2:
        pos += n
        return bytes.subarray(pos - n, pos)
      case 4:
        return Array.from({ length: n }, item)
      default:
        throw new Error(`cbor: unsupported major type ${major} at ${pos - 1}`)
    }
  }

  const out = item()
  if (pos !== bytes.length) throw new Error(`cbor: ${bytes.length - pos} trailing bytes`)
  return out
}

// Filecoin big ints: a sign byte (0 positive, 1 negative) followed by the big-endian magnitude;
// empty means zero.
export function decodeBigInt(b: Uint8Array): bigint {
  let v = 0n
  for (let i = 1; i < b.length; i++) v = (v << 8n) | BigInt(b[i])
  return b.length > 0 && b[0] === 1 ? -v : v
}
