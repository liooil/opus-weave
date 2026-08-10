/**
 * midi-port-selection — pure port-picking logic for WebMIDI.
 *
 * Decides which port to use after a page reload or device reconnect:
 * exact id first, then manufacturer/name fallback, never a stale index.
 * Pure and DOM-free so it is unit-testable with mock port lists.
 */

export interface PortDescriptor {
  id: string
  name: string
  manufacturer: string
  state: string
  connection: string
  type: string
}

/** What we persist for a chosen port: id plus identity for fallback matching. */
export interface StoredPort {
  id: string
  name: string
  manufacturer: string
}

/** Ports that are really a computer's internal routing, not a physical device. */
export function isVirtualThroughPort(p: PortDescriptor): boolean {
  return /midi through|microsoft gs|synth|virtual|loopback/i.test(`${p.name} ${p.manufacturer}`)
}

export interface PortSelection {
  /** Chosen port, or null when nothing matches. */
  port: PortDescriptor | null
  /** Human reason for the choice, for the status area. */
  reason: string
}

/**
 * Choose a port given a previously stored port (id + identity) and the
 * current port list. Prefers an exact id match, then a name/manufacturer
 * match, then falls back to the first physical port. 'Midi Through'-style
 * virtual ports are only chosen when they are the sole option (explicit
 * user override is separate).
 */
export function selectPort(stored: StoredPort | null, ports: PortDescriptor[], preferPhysical = true): PortSelection {
  if (stored) {
    const exact = ports.find((p) => p.id === stored.id)
    if (exact) return { port: exact, reason: `restored by id: ${exact.name}` }

    const physical = ports.filter((p) => !isVirtualThroughPort(p))
    const byName = physical.find((p) => p.name === stored.name && p.manufacturer === stored.manufacturer)
    if (byName) return { port: byName, reason: `id changed, matched by name: ${byName.name}` }
    const byNameOnly = physical.find((p) => p.name === stored.name)
    if (byNameOnly) return { port: byNameOnly, reason: `id changed, matched by name only: ${byNameOnly.name}` }
    return { port: null, reason: `stored device '${stored.name}' is not connected` }
  }

  const physical = ports.filter((p) => !isVirtualThroughPort(p))
  if (preferPhysical && physical.length > 0) {
    return { port: physical[0]!, reason: `auto-selected first physical port: ${physical[0]!.name}` }
  }
  if (ports.length > 0) {
    return { port: ports[0]!, reason: `auto-selected only port: ${ports[0]!.name}` }
  }
  return { port: null, reason: 'no MIDI ports available' }
}
