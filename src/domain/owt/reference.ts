export type OwtReferenceLocale = 'en' | 'zh-CN'

const OWT_0_1_REFERENCE_EN = `OWT 0.1 — COMPLETE FORMAT REFERENCE

This is the authoritative description of the OWT 0.1 fields and their actual parser semantics.

1. DOCUMENT

    owt 0.1 score
    ...directives and tracks...
    end

- The first non-empty, non-comment line must contain owt, 0.1 and score in that order, separated by whitespace, with no other tokens.
- "owt" is the format name, "0.1" is the version, and "score" is the only document kind.
- "end" is required. Only blank lines and comments may follow it.
- Keywords are lowercase unless this reference explicitly says otherwise.

2. COMMENTS AND STRINGS

- A comment begins at # when # is at the start of a line or is preceded by whitespace.
- # inside a quoted string is text. # in F#4 is an accidental, not a comment.
- Names and titles are double-quoted JSON strings. JSON escaping represents quotation marks, backslashes and newlines.
- Blank lines and whitespace between tokens do not affect musical time.

3. GLOBAL DIRECTIVES

All global directives must appear before the first track.

    title "Title"

- Optional display title. If repeated, the last value is retained.

    ppq 480

- MIDI pulses per quarter note. Integer 1–32767; default 480.
- PPQ affects MIDI compilation/export, not the meaning of OWT durations.
- If repeated, the last value is retained.

    meter 1:1 4/4

- Syntax: meter <measure:beat> <numerator/denominator>.
- The measure and beat are one-based. A meter change must occur at beat 1.
- Numerator: integer 1–64. Denominator: a positive power of two.
- May occur multiple times. If absent, meter 1:1 4/4 is supplied.

    tempo 1:1 120

- Syntax: tempo <measure:beat> <BPM>.
- BPM is a finite number greater than 0 and at most 1000.
- May occur multiple times and may change within a measure.
- If absent, tempo 1:1 120 is supplied.

    key 1:1 C major

- Syntax: key <measure:beat> <tonic> <mode>.
- Tonic is uppercase A–G with an optional # or b, such as C, F# or Bb.
- Mode is exactly major or minor.
- May occur multiple times and may change within a measure.
- Optional; no key directive is supplied when it is absent.

4. POSITIONS

- Positions use <measure>:<beat>, for example 1:1, 3:2 or 4:3/2.
- Measure is an integer starting at 1. Beat is a positive integer or rational starting at 1.
- The beat unit is the denominator of the active meter. In 4/4, moving from beat 1 to beat 2 advances one quarter note. In 6/8, it advances one eighth note.
- Positions are used by meter, tempo and key directives. Track events themselves are sequential and do not carry position fields.

5. TRACKS

    track "Melody" channel=1 program=0 velocity=88

- A track begins with track and continues until the next track or document end.
- The quoted name is required and is for display/identification.
- channel is the human-facing MIDI channel, integer 1–16. It maps to MIDI channel 0–15. If omitted, it defaults to the one-based track number.
- program is the initial MIDI program, integer 0–127; default 0.
- velocity is the default note velocity, integer 1–127; default 80.
- channel, program and velocity are syntactically optional.
- Unknown or duplicate track attributes are errors.
- Each track has its own sequential time cursor starting at score time 0. Tracks therefore play in parallel. OWT 0.1 requires every non-empty track to end on a complete measure boundary; pickup and incomplete final measures are not supported.
- At least one track is required.

6. NOTES, RESTS, CHORDS AND DURATIONS

    C4:1
    F#4:1/2
    Bb3:2
    R:1
    [C4 E4 G4]:2
    C4:1{v=64}

- A note is <pitch>:<duration>. Pitch is A–G (case-insensitive), optional # or b, then an integer octave. The resulting MIDI pitch must be 0–127. C4 is MIDI note 60.
- R is an uppercase rest. It advances time without sounding.
- A chord is one or more whitespace-separated pitches inside [ ]. All pitches start together and share one duration and velocity.
- Duplicate pitches inside a chord are accepted by the current parser.
- Duration is required on every note, rest and chord. It is a positive integer or rational; decimal duration syntax is not accepted.
- OWT 0.1 duration values are measured in quarter-note units: 4 = whole note, 2 = half note, 1 = quarter note, 1/2 = eighth note, 1/4 = sixteenth note, 3/2 = dotted quarter note, and 1/3 is one quarter-note triplet subdivision.
- Durations use exact rational arithmetic.
- {v=N} overrides velocity for one note or chord. N is an integer 1–127. v is the only supported note/chord attribute. Rests do not support attributes.
- Notes, rests and chords advance the current track cursor by their duration.
- Internally pitches are stored as MIDI numbers. Re-serialization uses sharp pitch names, so an input such as Bb4 may be written back as A#4.

7. ZERO-DURATION MIDI CONTROL EVENTS

    <cc64=127>
    <bend=8192>
    <program=40>

- <ccC=V> sends MIDI continuous controller C with value V. Both are integers 0–127.
- <bend=V> sends pitch bend V, integer 0–16383; 8192 is the conventional center.
- <program=V> changes the MIDI program from that cursor position, integer 0–127.
- A track's program field is its initial program; a program event changes it during playback.
- Control events occur at the current track cursor and do not advance time.

8. BAR LINES

    | C4:1 D4:1 E4:1 F4:1 |

- A bar line is a validation assertion: whenever | appears, the accumulated duration of that track must be exactly a measure boundary calculated from the meter map.
- Put exactly one complete measure between a paired | ... |. In 4/4 its event durations must sum to exactly 4 quarter-note units; in 3/4 exactly 3; in 6/8 exactly 3.
- Count every measure independently. For example, "| G4:1/2 B4:1/2 D5:1 G5:1 |" is invalid in 4/4 because it totals 3, so it needs R:1 or another duration totaling 1 before the closing bar.
- Prefer paired bar lines with one complete measure between each pair. Do not place a bar line after an incomplete measure, and do not use a leading bar to hide an incomplete previous measure.
- A line may contain several complete measures; line breaks do not affect musical time. The canonical formatter starts a new line at a phrase boundary — a measure whose tail is a rest of at least a quarter of the measure, or whose final note lasts at least half the measure — and otherwise starts a new line after at most four measures per line.
- Although the parser permits omitted bar lines and events crossing an unchecked boundary, generated OWT must not rely on those permissive forms.

9. TIME AND DEFAULT SUMMARY

- Notes, rests and chords advance time. Bars, comments and control events do not.
- A new track resets its own cursor to score time 0.
- Required: document header, at least one track, document end.
- Optional defaults: title = absent; ppq = 480; meter = 1:1 4/4; tempo = 1:1 120; key = absent; track program = 0; track velocity = 80; track channel = its one-based track number.

10. COMPLETE EXAMPLE

    owt 0.1 score

    title "Example melody"
    ppq 480
    meter 1:1 4/4
    tempo 1:1 120
    key 1:1 C major

    track "Melody" channel=1 program=0 velocity=88
    | C4:1 D4:1 E4:1 G4:1 |
    | A4:2 G4:1 R:1 |

    end
`

const OWT_0_1_REFERENCE_ZH_CN = `OWT 0.1——完整格式参考

这是 OWT 0.1 全部字段及当前解析器实际语义的权威说明。

1. 文档

    owt 0.1 score
    ……全局指令和轨道……
    end

- 第一条非空、非注释内容必须依次包含 owt、0.1、score，三者以空白分隔，不能包含其他词元。
- “owt”是格式名称，“0.1”是版本，“score”是当前唯一的文档类型。
- 必须有“end”。它之后只能出现空行和注释。
- 除非本文另有说明，关键字都使用小写。

2. 注释与字符串

- # 位于行首或前一个字符为空白时，开始一段注释。
- 双引号字符串中的 # 是文本；F#4 中的 # 是升号，不是注释。
- 名称和标题是双引号包围的 JSON 字符串；引号、反斜杠和换行使用 JSON 转义规则表示。
- 空行和词元之间的空白不影响音乐时间。

3. 全局指令

所有全局指令必须位于第一条 track 之前。

    title "标题"

- 可选的显示标题。重复出现时保留最后一个值。

    ppq 480

- 每个四分音符对应的 MIDI tick 数。必须是 1–32767 的整数；默认值为 480。
- PPQ 影响 MIDI 编译和导出，不改变 OWT 时值的含义。
- 重复出现时保留最后一个值。

    meter 1:1 4/4

- 语法：meter <小节:拍> <分子/分母>。
- 小节和拍都从 1 开始。拍号变化必须发生在某一小节的第 1 拍。
- 分子是 1–64 的整数；分母是正的 2 的幂。
- 可以出现多次。完全省略时，解析器补充 meter 1:1 4/4。

    tempo 1:1 120

- 语法：tempo <小节:拍> <BPM>。
- BPM 必须是大于 0 且不超过 1000 的有限数值。
- 可以出现多次，也可以在小节内部改变。
- 完全省略时，解析器补充 tempo 1:1 120。

    key 1:1 C major

- 语法：key <小节:拍> <主音> <调式>。
- 主音是大写 A–G，可带一个 # 或 b，例如 C、F#、Bb。
- 调式只能是 major 或 minor。
- 可以出现多次，也可以在小节内部改变。
- 可以省略；省略时解析器不会补充调号。

4. 位置

- 位置写作 <小节>:<拍>，例如 1:1、3:2、4:3/2。
- 小节是从 1 开始的整数；拍是从 1 开始的正整数或正分数。
- 拍的单位由当前拍号的分母决定。在 4/4 中，从第 1 拍到第 2 拍经过一个四分音符；在 6/8 中则经过一个八分音符。
- meter、tempo、key 使用位置。轨道事件按顺序排列，自身没有位置字段。

5. 轨道

    track "Melody" channel=1 program=0 velocity=88

- 一条轨道从 track 开始，到下一条 track 或文档 end 为止。
- 双引号名称是必填的，用于显示和识别。
- channel 是面向人的 MIDI 通道号，必须是 1–16 的整数；它映射到 MIDI 的 0–15。省略时默认为从 1 开始的轨道序号。
- program 是初始 MIDI 音色编号，必须是 0–127 的整数；默认值为 0。
- velocity 是音符的默认 MIDI 力度，必须是 1–127 的整数；默认值为 80。
- channel、program、velocity 在语法上都可以省略。
- 未知或重复的轨道属性是错误。
- 每条轨道都有从乐谱时间 0 开始的独立顺序游标，因此各轨道并行播放。OWT 0.1 要求每条非空轨道结束于完整小节边界；不支持弱起或不完整末小节。
- 文档至少需要一条轨道。

6. 音符、休止符、和弦与时值

    C4:1
    F#4:1/2
    Bb3:2
    R:1
    [C4 E4 G4]:2
    C4:1{v=64}

- 音符写作 <音高>:<时值>。音高由不区分大小写的 A–G、可选的 # 或 b、整数八度号组成。换算后的 MIDI 音高必须在 0–127 之间。C4 是 MIDI 音高 60。
- 大写 R 是休止符；它推进时间但不发声。
- 和弦是在 [ ] 中写一个或多个以空白分隔的音高。所有音同时开始，共用一个时值和力度。
- 当前解析器允许和弦内出现重复音高。
- 每个音符、休止符和和弦都必须显式写出时值。时值只能是正整数或正分数，不接受小数写法。
- OWT 0.1 的时值单位是四分音符：4 = 全音符，2 = 二分音符，1 = 四分音符，1/2 = 八分音符，1/4 = 十六分音符，3/2 = 附点四分音符，1/3 = 四分音符三连音中的一个细分。
- 时值使用精确有理数运算。
- {v=N} 覆盖一个音符或和弦的力度；N 是 1–127 的整数。v 是当前唯一支持的音符/和弦属性。休止符不支持属性。
- 音符、休止符和和弦都会按照自身时值推进当前轨道游标。
- 内部只保存 MIDI 音高数字。重新序列化时统一使用升号音名，因此输入 Bb4 后可能被写回 A#4。

7. 不占时值的 MIDI 控制事件

    <cc64=127>
    <bend=8192>
    <program=40>

- <ccC=V> 发送 MIDI 连续控制器 C 和数值 V；二者都是 0–127 的整数。
- <bend=V> 发送弯音值 V，范围为 0–16383；8192 通常是中央位置。
- <program=V> 从当前游标位置开始改变 MIDI 音色；V 是 0–127 的整数。
- 轨道上的 program 字段是初始音色；program 事件是在播放途中改变音色。
- 控制事件发生在当前轨道游标处，但不推进时间。

8. 小节线

    | C4:1 D4:1 E4:1 F4:1 |

- 小节线是校验断言：每当出现 |，该轨道累计时值必须恰好位于根据拍号表计算的小节边界。
- 每一对 | ... | 之间必须恰好写一个完整小节。4/4 中事件时值之和必须严格等于 4 个四分音符单位；3/4 必须等于 3；6/8 必须等于 3。
- 每个小节必须独立计数。例如“| G4:1/2 B4:1/2 D5:1 G5:1 |”在 4/4 中只有 3 拍，因此无效；右侧小节线前还需要 R:1 或其他总时值为 1 的事件。
- 默认使用成对小节线，每对小节线之间恰好写一个完整小节。不得在不完整小节后写小节线，也不得用下一行开头的小节线掩盖上一小节不完整。
- 一行可以包含多个完整小节，换行不影响音乐时间。规范格式化会在乐句边界处换行——小节尾部有至少四分之一小节时值的休止符，或末音至少持续半小节——否则每行最多放四个小节。
- 虽然解析器允许省略小节线以及事件跨过未检查的边界，但生成的 OWT 不得依赖这些宽松形式。

9. 时间与默认值汇总

- 音符、休止符、和弦推进时间；小节线、注释、控制事件不推进时间。
- 新轨道会把该轨道自己的游标重置为乐谱时间 0。
- 必填：文档头、至少一条轨道、文档 end。
- 可选字段默认值：title = 无；ppq = 480；meter = 1:1 4/4；tempo = 1:1 120；key = 无；轨道 program = 0；轨道 velocity = 80；轨道 channel = 从 1 开始的轨道序号。

10. 完整示例

    owt 0.1 score

    title "Example melody"
    ppq 480
    meter 1:1 4/4
    tempo 1:1 120
    key 1:1 C major

    track "Melody" channel=1 program=0 velocity=88
    | C4:1 D4:1 E4:1 G4:1 |
    | A4:2 G4:1 R:1 |

    end
`

export function buildOwt01Reference(locale: OwtReferenceLocale = 'en'): string {
  return (locale === 'zh-CN' ? OWT_0_1_REFERENCE_ZH_CN : OWT_0_1_REFERENCE_EN).trim()
}
