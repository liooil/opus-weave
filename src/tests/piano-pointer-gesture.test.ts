import { describe, expect, test } from 'bun:test'
import { PianoPointerGesture, type PianoPointerSample } from '../web/components/piano-pointer-gesture.ts'

function pointer(pointerId: number, pointerType: string, clientX: number): PianoPointerSample {
  return { pointerId, pointerType, clientX }
}

describe('piano pointer gestures', () => {
  test('glides through notes with one mouse, touch or pen pointer', () => {
    for (const pointerType of ['mouse', 'touch', 'pen']) {
      const gesture = new PianoPointerGesture()
      expect(gesture.pointerDown(pointer(1, pointerType, 100), 60)).toEqual([
        { type: 'note-on', pointerId: 1, note: 60 },
      ])
      expect(gesture.pointerMove(pointer(1, pointerType, 120), 62)).toEqual([
        { type: 'note-off', pointerId: 1, note: 60 },
        { type: 'note-on', pointerId: 1, note: 62 },
      ])
      expect(gesture.pointerMove(pointer(1, pointerType, 140), 64)).toEqual([
        { type: 'note-off', pointerId: 1, note: 62 },
        { type: 'note-on', pointerId: 1, note: 64 },
      ])
      expect(gesture.pointerUp(1)).toEqual([{ type: 'note-off', pointerId: 1, note: 64 }])
    }
  })

  test('releases a note outside the keys and starts another after re-entry', () => {
    const gesture = new PianoPointerGesture()
    gesture.pointerDown(pointer(1, 'mouse', 100), 60)
    expect(gesture.pointerMove(pointer(1, 'mouse', 120), null)).toEqual([
      { type: 'note-off', pointerId: 1, note: 60 },
    ])
    expect(gesture.pointerMove(pointer(1, 'mouse', 140), 65)).toEqual([
      { type: 'note-on', pointerId: 1, note: 65 },
    ])
  })

  test('switches two touches from notes to horizontal panning', () => {
    const gesture = new PianoPointerGesture()
    expect(gesture.pointerDown(pointer(1, 'touch', 100), 60)).toEqual([
      { type: 'note-on', pointerId: 1, note: 60 },
    ])
    expect(gesture.pointerDown(pointer(2, 'touch', 200), 67)).toEqual([
      { type: 'note-off', pointerId: 1, note: 60 },
    ])
    expect(gesture.isTouchPanning).toBe(true)
    expect(gesture.pointerMove(pointer(1, 'touch', 80), 59)).toEqual([
      { type: 'scroll-by', delta: 10 },
    ])
    expect(gesture.pointerMove(pointer(2, 'touch', 180), 65)).toEqual([
      { type: 'scroll-by', delta: 10 },
    ])
  })

  test('does not resume notes until every finger from a pan has lifted', () => {
    const gesture = new PianoPointerGesture()
    gesture.pointerDown(pointer(1, 'touch', 100), 60)
    gesture.pointerDown(pointer(2, 'touch', 200), 67)
    expect(gesture.pointerUp(2)).toEqual([])
    expect(gesture.isTouchPanning).toBe(false)
    expect(gesture.pointerMove(pointer(1, 'touch', 130), 62)).toEqual([])
    expect(gesture.pointerUp(1)).toEqual([])
    expect(gesture.pointerDown(pointer(3, 'touch', 160), 64)).toEqual([
      { type: 'note-on', pointerId: 3, note: 64 },
    ])
  })

  test('releases every sounding pointer when interaction is cancelled', () => {
    const gesture = new PianoPointerGesture()
    gesture.pointerDown(pointer(1, 'mouse', 100), 60)
    gesture.pointerDown(pointer(2, 'pen', 200), 67)
    expect(gesture.cancelAll()).toEqual([
      { type: 'note-off', pointerId: 1, note: 60 },
      { type: 'note-off', pointerId: 2, note: 67 },
    ])
  })
})
