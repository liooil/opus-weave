export interface BuiltinOwtExample {
  id: string
  title: string
  composer: string
  text: string
}

export const BUILTIN_OWT_EXAMPLES: readonly BuiltinOwtExample[] = [
  {
    id: 'twinkle',
    title: 'Twinkle Twinkle Little Star / 小星星',
    composer: 'Traditional',
    text: `owt 0.1 score

title "Twinkle Twinkle Little Star / 小星星"
ppq 480
meter 1:1 4/4
tempo 1:1 100
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88
| C4:1 C4:1 G4:1 G4:1 | A4:1 A4:1 G4:2 |
| F4:1 F4:1 E4:1 E4:1 | D4:1 D4:1 C4:2 |
end
`,
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy / 欢乐颂',
    composer: 'Ludwig van Beethoven',
    text: `owt 0.1 score

title "Ode to Joy / 欢乐颂"
ppq 480
meter 1:1 4/4
tempo 1:1 108
key 1:1 C major

track "Melody" channel=1 program=0 velocity=92
| E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | E4:3/2 D4:1/2 D4:2 |
| E4:1 E4:1 F4:1 G4:1 | G4:1 F4:1 E4:1 D4:1 | C4:1 C4:1 D4:1 E4:1 | D4:3/2 C4:1/2 C4:2 |
end
`,
  },
  {
    id: 'fur-elise',
    title: 'Für Elise — Opening / 致爱丽丝',
    composer: 'Ludwig van Beethoven',
    text: `owt 0.1 score

title "Für Elise — Opening / 致爱丽丝"
ppq 480
meter 1:1 3/8
tempo 1:1 72
key 1:1 A minor

track "Melody" channel=1 program=0 velocity=86
| E5:1/2 D#5:1/2 E5:1/2 | D#5:1/2 E5:1/2 B4:1/2 | D5:1/2 C5:1/2 A4:1/2 | R:1/2 C4:1/2 E4:1/2 |
| A4:1/2 B4:1/2 E4:1/2 | G#4:1/2 B4:1/2 C5:1/2 | R:1/2 E4:1/2 E5:1/2 | D#5:1/2 E5:1/2 D#5:1/2 |
end
`,
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D — Arpeggio / D大调卡农',
    composer: 'Johann Pachelbel',
    text: `owt 0.1 score

title "Canon in D — Arpeggio / D大调卡农"
ppq 480
meter 1:1 4/4
tempo 1:1 76
key 1:1 D major

track "Arpeggio" channel=1 program=0 velocity=82
| D4:1/2 F#4:1/2 A4:1/2 F#4:1/2 D4:1/2 F#4:1/2 A4:1/2 F#4:1/2 | A3:1/2 C#4:1/2 E4:1/2 C#4:1/2 A3:1/2 C#4:1/2 E4:1/2 C#4:1/2 | B3:1/2 D4:1/2 F#4:1/2 D4:1/2 B3:1/2 D4:1/2 F#4:1/2 D4:1/2 | F#3:1/2 A3:1/2 C#4:1/2 A3:1/2 F#3:1/2 A3:1/2 C#4:1/2 A3:1/2 |
| G3:1/2 B3:1/2 D4:1/2 B3:1/2 G3:1/2 B3:1/2 D4:1/2 B3:1/2 | D3:1/2 F#3:1/2 A3:1/2 F#3:1/2 D3:1/2 F#3:1/2 A3:1/2 F#3:1/2 | G3:1/2 B3:1/2 D4:1/2 B3:1/2 G3:1/2 B3:1/2 D4:1/2 B3:1/2 | A3:1/2 C#4:1/2 E4:1/2 C#4:1/2 A3:1/2 C#4:1/2 E4:1/2 C#4:1/2 |
end
`,
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G — Opening / G大调小步舞曲',
    composer: 'Christian Petzold',
    text: `owt 0.1 score

title "Minuet in G — Opening / G大调小步舞曲"
ppq 480
meter 1:1 3/4
tempo 1:1 112
key 1:1 G major

track "Melody" channel=1 program=0 velocity=84
| D5:1 G4:1 A4:1 | B4:1 C5:1 D5:1 | G4:1 G4:1 E5:1 | C5:1 D5:1 E5:1 |
| F#5:1 G5:1 F#5:1 | E5:1 D5:1 C#5:1 | D5:1 E5:1 D5:1 | C5:1 B4:1 A4:1 |
end
`,
  },
  {
    id: 'moonlight-sonata',
    title: 'Moonlight Sonata — Opening Texture / 月光奏鸣曲',
    composer: 'Ludwig van Beethoven',
    text: `owt 0.1 score

title "Moonlight Sonata — Opening Texture / 月光奏鸣曲"
ppq 480
meter 1:1 4/4
tempo 1:1 54
key 1:1 C# minor

track "Triplets" channel=1 program=0 velocity=70
| G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 | G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 | A3:1/3 C#4:1/3 E4:1/3 A3:1/3 C#4:1/3 E4:1/3 A3:1/3 D4:1/3 F#4:1/3 A3:1/3 D4:1/3 F#4:1/3 | G#3:1/3 B#3:1/3 F#4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 D#4:1/3 G#3:1/3 B#3:1/3 D#4:1/3 |
end
`,
  },
]

export function builtinOwtExample(id: string): BuiltinOwtExample | undefined {
  return BUILTIN_OWT_EXAMPLES.find((example) => example.id === id)
}
