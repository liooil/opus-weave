import type { OwtAiAttachment } from '../domain/ai/owt-ai.ts'

function fileDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read media file')))
    reader.readAsDataURL(file)
  })
}

function waitForEvent(target: EventTarget, event: string, errorEvent = 'error'): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      cleanup()
      resolve()
    }
    const failed = (): void => {
      cleanup()
      reject(new Error(`Could not decode media (${event})`))
    }
    const cleanup = (): void => {
      target.removeEventListener(event, done)
      target.removeEventListener(errorEvent, failed)
    }
    target.addEventListener(event, done, { once: true })
    target.addEventListener(errorEvent, failed, { once: true })
  })
}

export async function mediaFileToAiAttachments(file: File, maxVideoFrames = 8): Promise<OwtAiAttachment[]> {
  if (file.type.startsWith('image/')) {
    return [{ mimeType: file.type, dataUrl: await fileDataUrl(file), label: file.name }]
  }
  if (file.type !== 'video/mp4' && !file.name.toLowerCase().endsWith('.mp4')) {
    throw new Error('Only score images and MP4 video are supported')
  }

  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  const objectUrl = URL.createObjectURL(file)
  video.src = objectUrl
  try {
    await waitForEvent(video, 'loadedmetadata')
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('The MP4 has no readable duration')
    const frameCount = Math.max(1, Math.min(maxVideoFrames, Math.ceil(video.duration / 4)))
    const width = Math.min(1280, video.videoWidth || 1280)
    const height = Math.max(1, Math.round(width * (video.videoHeight || 720) / (video.videoWidth || 1280)))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable for MP4 frame extraction')

    const attachments: OwtAiAttachment[] = []
    for (let index = 0; index < frameCount; index++) {
      const fraction = frameCount === 1 ? 0.5 : 0.03 + (index / (frameCount - 1)) * 0.94
      video.currentTime = Math.min(Math.max(0, video.duration * fraction), Math.max(0, video.duration - 0.01))
      await waitForEvent(video, 'seeked')
      context.drawImage(video, 0, 0, width, height)
      attachments.push({
        mimeType: 'image/jpeg',
        dataUrl: canvas.toDataURL('image/jpeg', 0.82),
        label: `${file.name} frame ${index + 1}/${frameCount}`,
      })
    }
    return attachments
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}
