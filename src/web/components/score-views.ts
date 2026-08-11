import { durationMarks, jianpuPitch, staffPosition, type ScoreViewEvent, type ScoreViewMeasure, type ScoreViewModel } from '../../domain/owt/score-views.ts'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function staffLedgerLines(y: number, x: number): string {
  const lines: number[] = []
  if (y > 80) for (let line = 90; line <= y + 1; line += 10) lines.push(line)
  if (y < 40) for (let line = 30; line >= y - 1; line -= 10) lines.push(line)
  return lines.map((line) => `<line class="staff-ledger" x1="${x - 8}" y1="${line}" x2="${x + 8}" y2="${line}" />`).join('')
}

function staffEvent(event: ScoreViewEvent, measure: ScoreViewMeasure): string {
  const x = 28 + (event.beat / Math.max(0.001, measure.quarterLength)) * 164
  if (event.kind === 'rest') return `<g class="staff-rest" transform="translate(${x} 60)"><path d="M-5 -4h10l-7 8h8"/><text x="0" y="18">${event.duration}</text></g>`
  return event.pitches.map((pitch, index) => {
    const position = staffPosition(pitch)
    const noteX = x + index * 4
    const stemUp = position.y >= 60
    const stemX = noteX + (stemUp ? 5 : -5)
    const stemEnd = position.y + (stemUp ? -27 : 27)
    const flags = event.duration <= 0.25 ? 2 : event.duration <= 0.5 ? 1 : 0
    const flagPath = Array.from({ length: flags }, (_, flag) => {
      const offset = flag * (stemUp ? 6 : -6)
      return `<path class="staff-flag" d="M${stemX} ${stemEnd + offset} q${stemUp ? 12 : -12} ${stemUp ? 7 : -7} ${stemUp ? 5 : -5} ${stemUp ? 15 : -15}"/>`
    }).join('')
    return `<g class="staff-note">${staffLedgerLines(position.y, noteX)}${position.accidental ? `<text class="staff-accidental" x="${noteX - 10}" y="${position.y + 4}">♯</text>` : ''}<ellipse cx="${noteX}" cy="${position.y}" rx="6" ry="4" transform="rotate(-18 ${noteX} ${position.y})"/><line class="staff-stem" x1="${stemX}" y1="${position.y}" x2="${stemX}" y2="${stemEnd}"/>${flagPath}</g>`
  }).join('')
}

function staffMeasure(measure: ScoreViewMeasure, first: boolean): string {
  const lines = [40, 50, 60, 70, 80].map((y) => `<line class="staff-line" x1="18" y1="${y}" x2="202" y2="${y}"/>`).join('')
  const events = measure.events.map((event) => staffEvent(event, measure)).join('')
  return `<div class="staff-measure"><svg viewBox="0 0 220 112" role="img" aria-label="Measure ${measure.number}">${lines}<line class="staff-barline" x1="202" y1="40" x2="202" y2="80"/>${first ? `<text class="staff-clef" x="1" y="78">𝄞</text><text class="staff-meter" x="25" y="54">${measure.numerator}</text><text class="staff-meter" x="25" y="72">${measure.denominator}</text>` : ''}${events}<text class="staff-measure-number" x="18" y="18">${measure.number}</text></svg></div>`
}

export function renderStaffScore(model: ScoreViewModel): string {
  const tracks = model.tracks.map((track) => `<section class="notation-track"><h3>${escapeHtml(track.name)}</h3><div class="staff-systems">${track.measures.map((measure, index) => staffMeasure(measure, index === 0)).join('')}</div></section>`).join('')
  return `<div class="score-view-heading"><div><h2>${escapeHtml(model.title)}</h2><p>${escapeHtml(model.key.tonic)} ${model.key.mode} · ${model.meter.numerator}/${model.meter.denominator} · ♩=${model.tempo}</p></div></div>${tracks}`
}

function octaveDots(octave: number): { above: string; below: string } {
  const dots = '•'.repeat(Math.min(3, Math.abs(octave)))
  return octave > 0 ? { above: dots, below: '' } : { above: '', below: dots }
}

function jianpuNumber(pitch: number, model: ScoreViewModel): string {
  const value = jianpuPitch(pitch, model.key.tonic, model.key.mode)
  const dots = octaveDots(value.octave)
  return `<span class="jianpu-pitch"><span class="jianpu-octave above">${dots.above}</span><span>${value.accidental}${value.degree}</span><span class="jianpu-octave below">${dots.below}</span></span>`
}

function jianpuEvent(event: ScoreViewEvent, model: ScoreViewModel): string {
  const marks = durationMarks(event.duration)
  const content = event.kind === 'rest'
    ? '<span class="jianpu-pitch"><span class="jianpu-octave above"></span><span>0</span><span class="jianpu-octave below"></span></span>'
    : event.pitches.length === 1
      ? jianpuNumber(event.pitches[0]!, model)
      : `<span class="jianpu-chord">${event.pitches.slice().reverse().map((pitch) => jianpuNumber(pitch, model)).join('')}</span>`
  const underlines = marks.underlines > 0 ? `<span class="jianpu-underlines">${'―'.repeat(marks.underlines)}</span>` : ''
  const dashes = marks.dashes > 0 ? `<span class="jianpu-dashes">${'—'.repeat(marks.dashes)}</span>` : ''
  const label = marks.label ? `<small>${marks.label}</small>` : ''
  return `<span class="jianpu-event">${content}${underlines}${dashes}${label}</span>`
}

export function renderJianpuScore(model: ScoreViewModel): string {
  const tracks = model.tracks.map((track) => `<section class="notation-track"><h3>${escapeHtml(track.name)}</h3><div class="jianpu-measures">${track.measures.map((measure) => `<div class="jianpu-measure"><span class="jianpu-measure-number">${measure.number}</span>${measure.events.map((event) => jianpuEvent(event, model)).join('')}<span class="jianpu-barline">|</span></div>`).join('')}</div></section>`).join('')
  return `<div class="score-view-heading"><div><h2>${escapeHtml(model.title)}</h2><p>1=${escapeHtml(model.key.tonic)} · ${model.key.mode} · ${model.meter.numerator}/${model.meter.denominator} · ♩=${model.tempo}</p></div></div>${tracks}`
}
