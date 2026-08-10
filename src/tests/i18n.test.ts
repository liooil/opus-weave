import { afterEach, describe, expect, test } from 'bun:test'
import { resolveLocale, setLocale, t } from '../web/i18n.ts'

describe('web interface localization', () => {
  afterEach(() => setLocale('en'))

  test('selects Chinese for any Chinese browser locale', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
    expect(resolveLocale('zh-TW')).toBe('zh-CN')
    expect(resolveLocale('en-US')).toBe('en')
    expect(resolveLocale(null)).toBe('en')
  })

  test('translates and interpolates dynamic interface copy', () => {
    setLocale('zh-CN')
    expect(t('playback.loading', { file: 'demo.mid' })).toBe('正在加载 demo.mid…')
    expect(t('record.stopped', { events: 12, duration: '3.50' })).toBe('录音已停止，共 12 个事件，时长 3.50 秒。')

    setLocale('en')
    expect(t('playback.loading', { file: 'demo.mid' })).toBe('Loading demo.mid…')
  })

  test('falls back to the English message or key', () => {
    setLocale('zh-CN')
    expect(t('app.title')).toBe('OpusWeave 音乐工作站')
    expect(t('missing.message')).toBe('missing.message')
  })
})
