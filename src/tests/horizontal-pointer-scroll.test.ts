import { describe, expect, test } from 'bun:test'
import { isPointerOnNativeScrollbar, type ScrollbarHitArea } from '../web/components/horizontal-pointer-scroll.ts'

function scrollArea(overrides: Partial<ScrollbarHitArea> = {}): ScrollbarHitArea {
  return {
    clientHeight: 138,
    clientWidth: 300,
    clientLeft: 1,
    clientTop: 1,
    offsetHeight: 147,
    offsetWidth: 302,
    scrollHeight: 138,
    scrollWidth: 1000,
    getBoundingClientRect: () => ({ top: 10, right: 322, bottom: 157, left: 20 }),
    ...overrides,
  }
}

describe('horizontal pointer scrolling', () => {
  test('leaves the native horizontal scrollbar gutter to the browser', () => {
    const area = scrollArea()
    expect(isPointerOnNativeScrollbar(area, { clientX: 160, clientY: 148 })).toBe(false)
    expect(isPointerOnNativeScrollbar(area, { clientX: 160, clientY: 150 })).toBe(true)
    expect(isPointerOnNativeScrollbar(area, { clientX: 160, clientY: 156 })).toBe(true)
  })

  test('does not invent a scrollbar hit when content does not overflow', () => {
    const area = scrollArea({ scrollWidth: 300 })
    expect(isPointerOnNativeScrollbar(area, { clientX: 160, clientY: 154 })).toBe(false)
  })

  test('also preserves native vertical scrollbar dragging', () => {
    const area = scrollArea({
      clientHeight: 140,
      clientWidth: 292,
      offsetHeight: 142,
      scrollHeight: 500,
      scrollWidth: 292,
    })
    expect(isPointerOnNativeScrollbar(area, { clientX: 311, clientY: 80 })).toBe(false)
    expect(isPointerOnNativeScrollbar(area, { clientX: 314, clientY: 80 })).toBe(true)
  })
})
