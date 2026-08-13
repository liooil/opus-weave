import type { BuiltinComputerLayoutId } from '../../domain/devices/mapping-engine.ts'

export interface ComputerKeyboardSectionSpec {
  id: string
  rows: readonly (readonly (string | null)[])[]
}

const STANDARD_QWERTY_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
] as const

const WORD_MELODY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
  [' '],
] as const

const FREEPIANO_KEYBOARD_SECTIONS: readonly ComputerKeyboardSectionSpec[] = [
  { id: 'main', rows: [
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'back'],
    ['tab', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    ['caps', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", 'enter'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', 'rshift'],
  ] },
  { id: 'navigation', rows: [
    ['insert', 'home', 'pgup'], ['delete', 'end', 'pgdn'], [null, 'up', null], ['left', 'down', 'right'],
  ] },
  { id: 'numpad', rows: [
    ['numlock', 'num/', 'num*', 'num-'], ['num7', 'num8', 'num9', 'num+'],
    ['num4', 'num5', 'num6', null], ['num1', 'num2', 'num3', 'numenter'], ['num0', 'num.', null],
  ] },
]

const LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space', back: '⌫', tab: 'Tab', caps: 'Caps', enter: 'Enter', shift: 'Shift', rshift: 'Shift',
  left: '←', right: '→', up: '↑', down: '↓', insert: 'Ins', delete: 'Del', home: 'Home', end: 'End', pgup: 'PgUp', pgdn: 'PgDn',
  numlock: 'Num', 'num/': '/', 'num*': '×', 'num-': '−', 'num+': '+', 'num.': '.', numenter: 'Enter',
}
const WIDTHS: Readonly<Record<string, number>> = { ' ': 6, back: 2, tab: 1.5, caps: 1.75, enter: 2.25, shift: 2.25, rshift: 2.75, num0: 2 }
const CODE_KEYS: Readonly<Record<string, string>> = {
  Backquote: '`', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0', Minus: '-', Equal: '=',
  KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't', KeyY: 'y', KeyU: 'u', KeyI: 'i', KeyO: 'o', KeyP: 'p', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';', Quote: "'",
  KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyB: 'b', KeyN: 'n', KeyM: 'm', Comma: ',', Period: '.', Slash: '/', Space: ' ',
  Backspace: 'back', Tab: 'tab', CapsLock: 'caps', Enter: 'enter', ShiftLeft: 'shift', ShiftRight: 'rshift',
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn',
  NumLock: 'numlock', NumpadDivide: 'num/', NumpadMultiply: 'num*', NumpadSubtract: 'num-', NumpadAdd: 'num+', NumpadDecimal: 'num.', NumpadEnter: 'numenter',
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3', Numpad4: 'num4', Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7', Numpad8: 'num8', Numpad9: 'num9',
}

export function keyboardSectionsForLayout(layout: BuiltinComputerLayoutId): readonly ComputerKeyboardSectionSpec[] {
  if (layout === 'freepiano') return FREEPIANO_KEYBOARD_SECTIONS
  if (layout === 'english' || layout === 'pinyin') return [{ id: 'main', rows: WORD_MELODY_ROWS }]
  return [{ id: 'main', rows: STANDARD_QWERTY_ROWS }]
}

export function computerKeyLabel(key: string): string {
  if (LABELS[key]) return LABELS[key]!
  if (/^num\d$/.test(key)) return key.slice(3)
  return key.toUpperCase()
}

export function computerKeyWidth(key: string): number {
  const units = WIDTHS[key] ?? 1
  return 44 * units + 5 * (units - 1)
}

export function computerInputKey(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  return CODE_KEYS[event.code] ?? event.key.toLowerCase()
}
