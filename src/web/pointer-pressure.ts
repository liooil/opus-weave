/**
 * Helpers for reading pressure/force from Pointer Events and converting it to
 * MIDI velocity. Only real pressure-sensitive hardware is used; fixed
 * placeholder values from ordinary touch/mouse input fall back to the app's
 * configured velocity.
 */

/** Convert a normalized 0..1 pressure/force value to a MIDI velocity 1..127. */
export function pressureToVelocity(pressure: number): number {
  return Math.max(1, Math.min(127, Math.round(pressure * 127)))
}

/**
 * True when a PointerEvent carries real pressure information rather than the
 * fixed placeholder used by hardware without pressure support.
 */
export function isPressureSensitive(event: Pick<PointerEvent, 'pressure' | 'pointerType'>): boolean {
  if (event.pressure <= 0) return false
  if (event.pointerType === 'pen') return true
  // Pointer Events report a fixed 0.5 for devices without pressure support
  // (and Touch Events often report 1). Only treat values that can actually
  // vary as real pressure; otherwise the caller keeps its fixed velocity.
  return event.pointerType === 'touch' && event.pressure !== 0.5 && event.pressure !== 1
}
