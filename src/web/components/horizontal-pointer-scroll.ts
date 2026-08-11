export interface HorizontalPointerScrollOptions {
  targetSelector: string
  holdDelayMs?: number
  movementThreshold?: number
  onHoldStart?: (target: HTMLElement, event: PointerEvent) => (() => void) | void
  onTap?: (target: HTMLElement, event: PointerEvent) => void
}

/**
 * Adds click/hold plus drag-to-scroll behavior to a horizontally scrollable
 * element. A short stationary pointer becomes a tap; a held pointer starts the
 * target action; horizontal movement cancels the action and scrolls instead.
 */
export function enableHorizontalPointerScroll(
  element: HTMLElement,
  options: HorizontalPointerScrollOptions,
): () => void {
  const holdDelayMs = options.holdDelayMs ?? 90
  const movementThreshold = options.movementThreshold ?? 6
  let pointerId: number | null = null
  let startX = 0
  let startScrollLeft = 0
  let dragging = false
  let target: HTMLElement | null = null
  let releaseAction: (() => void) | undefined
  let holdTimer: number | undefined
  let startEvent: PointerEvent | null = null

  const cancelHoldTimer = () => {
    if (holdTimer !== undefined) window.clearTimeout(holdTimer)
    holdTimer = undefined
  }

  const releaseHeldAction = () => {
    releaseAction?.()
    releaseAction = undefined
  }

  const reset = () => {
    cancelHoldTimer()
    releaseHeldAction()
    element.classList.remove('is-dragging')
    pointerId = null
    target = null
    startEvent = null
    dragging = false
  }

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
    const closest = (event.target as Element | null)?.closest<HTMLElement>(options.targetSelector) ?? null
    target = closest && element.contains(closest) ? closest : null
    pointerId = event.pointerId
    startX = event.clientX
    startScrollLeft = element.scrollLeft
    dragging = false
    startEvent = event
    element.setPointerCapture(event.pointerId)

    if (target && options.onHoldStart) {
      holdTimer = window.setTimeout(() => {
        holdTimer = undefined
        if (!dragging && target && startEvent) {
          releaseAction = options.onHoldStart?.(target, startEvent) ?? undefined
        }
      }, holdDelayMs)
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const delta = event.clientX - startX
    if (!dragging && Math.abs(delta) >= movementThreshold) {
      dragging = true
      cancelHoldTimer()
      releaseHeldAction()
      element.classList.add('is-dragging')
    }
    if (!dragging) return
    event.preventDefault()
    element.scrollLeft = startScrollLeft - delta
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    cancelHoldTimer()
    if (!dragging && target) {
      if (releaseAction) releaseHeldAction()
      else options.onTap?.(target, event)
    }
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    reset()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    reset()
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerCancel)

  return () => {
    reset()
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointermove', onPointerMove)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerCancel)
  }
}
