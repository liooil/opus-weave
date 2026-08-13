import { t, type TranslationValues } from '../i18n.ts'

export type StatusKind = 'ok' | 'warn' | 'err' | ''

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Element #${id} not found`)
  return element as T
}

export function setStatus(id: string, message: string, kind: StatusKind = ''): void {
  const element = byId(id)
  element.hidden = false
  delete element.dataset.statusKey
  delete element.dataset.statusValues
  element.textContent = message
  element.className = `status${kind ? ` ${kind}` : ''}`
}

export function setTranslatedStatus(id: string, key: string, values: TranslationValues = {}, kind: StatusKind = ''): void {
  const element = byId(id)
  element.hidden = false
  element.dataset.statusKey = key
  element.dataset.statusValues = JSON.stringify(values)
  element.textContent = t(key, values)
  element.className = `status${kind ? ` ${kind}` : ''}`
}

export function clearStatus(id: string): void {
  const element = byId(id)
  element.hidden = true
  element.textContent = ''
  delete element.dataset.statusKey
  delete element.dataset.statusValues
}

export function setTranslatedText(id: string, key: string, values: TranslationValues = {}): void {
  const element = byId(id)
  element.dataset.textKey = key
  element.dataset.textValues = JSON.stringify(values)
  element.textContent = t(key, values)
}

export function retranslateTrackedCopy(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-status-key]')) {
    const values = JSON.parse(element.dataset.statusValues ?? '{}') as TranslationValues
    element.textContent = t(element.dataset.statusKey!, values)
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-text-key]')) {
    const values = JSON.parse(element.dataset.textValues ?? '{}') as TranslationValues
    element.textContent = t(element.dataset.textKey!, values)
  }
}

export function showError(message: string): void {
  const element = byId<HTMLDivElement>('st-error')
  element.textContent = message
  element.hidden = false
}
