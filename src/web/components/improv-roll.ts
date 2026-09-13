import type { RealtimeImprovSession, ImprovNote } from '../../domain/ai/realtime-improv.ts'

/** A bounded, two-lane view of performed notes and the replaceable future. */
export function drawImprovRoll(canvas: HTMLCanvasElement, session: RealtimeImprovSession, now: number): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!width || !height) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const css = getComputedStyle(canvas)
  const color = (key: string) => css.getPropertyValue(key).trim()
  const beat = 60 / session.bpm
  const span = beat * 16
  const left = now - span * 0.65
  const x = (time: number) => (time - left) / span * width
  ctx.fillStyle = color('--subtle-fill')
  ctx.fillRect(x(now), 0, width - x(now), height)
  ctx.font = '10px monospace'
  for (let b = Math.ceil((left - session.origin) / beat); session.origin + b * beat < left + span; b++) {
    const at = x(session.origin + b * beat)
    ctx.strokeStyle = color(b % 4 === 0 ? '--line-strong' : '--line')
    ctx.beginPath(); ctx.moveTo(at, 0); ctx.lineTo(at, height); ctx.stroke()
    if (b >= 0 && b % 4 === 0) { ctx.fillStyle = color('--dim'); ctx.fillText(String(b / 4 + 1), at + 5, 15) }
  }
  ctx.strokeStyle = color('--line-strong')
  ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke()
  const draw = (notes: ImprovNote[], lane: number, fill: string, planned = false) => {
    for (const note of notes) {
      if (note.start + note.duration < left || note.start > left + span) continue
      const top = lane * height / 2 + 25 + (96 - Math.max(36, Math.min(96, note.pitch))) / 60 * (height / 2 - 43)
      const nx = x(note.start)
      const nw = Math.max(3, note.duration / span * width)
      ctx.globalAlpha = planned ? 0.3 : 0.85
      ctx.fillStyle = fill
      ctx.fillRect(nx, top, nw, 5)
      if (planned) { ctx.globalAlpha = 0.65; ctx.strokeStyle = fill; ctx.strokeRect(nx, top, nw, 5) }
    }
  }
  draw(session.human(now), 0, color('--cyan'))
  draw(session.played(now), 1, color('--accent'))
  draw(session.future(now), 1, color('--accent'), true)
  ctx.globalAlpha = 1
  ctx.strokeStyle = color('--text')
  ctx.beginPath(); ctx.moveTo(x(now), 0); ctx.lineTo(x(now), height); ctx.stroke()
}
