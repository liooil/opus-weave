const OWT_HASH_PREFIX = '#owt='

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function encodeOwtHash(text: string): string {
  const base64 = bytesToBase64(new TextEncoder().encode(text))
  return `${OWT_HASH_PREFIX}${base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
}

export function decodeOwtHash(hash: string): string | null {
  if (!hash.startsWith(OWT_HASH_PREFIX)) return null
  const encoded = hash.slice(OWT_HASH_PREFIX.length)
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) return null
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4)
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
