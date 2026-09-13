// Frozen prompt before musical-context tuning, for paired evaluation.
import type { ImprovPlan, ImprovRole } from '../../src/domain/ai/realtime-improv.ts'
export function baselinePrompt(plan: ImprovPlan, role: ImprovRole) {
  const unit = 60 / plan.bpm / 4
  const encode = (notes: ImprovPlan['human']) => notes.map((n) => [Math.round((n.start - plan.start) / unit), Math.max(1, Math.round(n.duration / unit)), n.pitch, n.velocity].join(' ')).join('\n')
  const system = `You are a live musical partner. The human keeps playing while you play ONE monophonic voice.
Output ONLY lines: N offset duration pitch velocity, then END. No prose, JSON, markdown, reasoning or full score.
Offset and duration are integer sixteenth-note units relative to the target start. Output in ascending offset order.
Stay within the target window; durations 1..16; MIDI pitch 36..96; velocity 35..100.
No overlapping notes. Use musical rests. Write the earliest notes first.
Develop the human's recent harmony and motif; do not copy their whole melody. Continue smoothly from the committed AI notes.
Follow the role and bounds in the user message.`
  const roleInstruction = `${role === 'bass' ? 'Sparse bass line, mostly pitches 36..55.' : role === 'counterpoint' ? 'Independent, complementary counter-melody, mostly pitches 55..84.' : 'Gentle, sparse accompaniment, leaving room for the human.'}`
  const prompt = `BPM ${plan.bpm}, meter 4/4, window ${plan.beats} beats, target version ${plan.version}.
Role: ${roleInstruction}
Offsets 0..${plan.beats * 4 - 1}; offset+duration <= ${plan.beats * 4}. Use ${plan.beats <= 4 ? '3-6' : '6-12'} notes across the window.
Recent human notes (offset duration pitch velocity; negative offsets are history):
${encode(plan.human)}
Currently held human pitches: ${plan.held.join(' ') || 'none'}
AI notes before target (do not repeat or modify):
${encode(plan.ai)}
Generate the next window now.`
  return { system, prompt }
}
