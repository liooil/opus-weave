import { describe, expect, test } from 'bun:test'

const html = await Bun.file('src/web/index.html').text()
const app = await Bun.file('src/web/app.ts').text()
const css = await Bun.file('src/web/app.css').text()
const modalEditor = await Bun.file('src/web/editor/modal-editor.ts').text()

describe('web workspace structure', () => {
  test('integrates score controls into the top bar without a local-session badge', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header).toContain('id="score-view-toolbar"')
    expect(header).toContain('data-score-view-target="owt"')
    expect(header).toContain('class="control-icon')
    expect(header).toContain('class="control-label"')
    expect(html).not.toContain('class="session-state"')
    expect(html).not.toContain('data-i18n="session.local"')
    expect(app).toContain("$('score-view-toolbar').hidden = pageId !== 'studio'")
    expect(css).toContain('.topbar .control-label { display: none; }')
    expect(css).toContain('overflow-x: auto;')
    expect(css).not.toContain('grid-template-rows: auto auto auto')
  })

  test('keeps score editing above the live keyboard in the studio flow', () => {
    const studio = html.slice(html.indexOf('data-workspace-page="studio"'), html.indexOf('data-workspace-page="settings"'))
    expect(studio.indexOf('id="owt-panel"')).toBeGreaterThan(-1)
    expect(studio.indexOf('id="staff-panel"')).toBeGreaterThan(-1)
    expect(studio.indexOf('id="jianpu-panel"')).toBeGreaterThan(-1)
    expect(studio.indexOf('id="live-panel"')).toBeGreaterThan(studio.indexOf('id="jianpu-panel"'))
  })

  test('gives every visible button an executable keyboard shortcut', () => {
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0])
    expect(buttons.filter((button) => !button.includes('data-shortcut') && !button.includes('aria-keyshortcuts'))).toEqual([])
    expect(app).toContain("case 'workspace-studio': showWorkspacePage('studio')")
    expect(app).toContain("case 'toggle-locale': localeButton.click()")
    expect(app).toContain("case 'toggle-theme': themeButton.click()")
    expect(app).toContain("case 'midi-enable': showWorkspacePage('settings')")
  })

  test('places an icon-only three-state theme control after the language button', () => {
    const actions = html.slice(html.indexOf('<div class="topbar-actions">'), html.indexOf('</div>', html.indexOf('<div class="topbar-actions">')))
    expect(actions.indexOf('id="theme-toggle"')).toBeGreaterThan(actions.indexOf('id="language-toggle"'))
    expect(actions).toContain('data-theme-state="system"')
    expect(actions).toContain('data-theme-icon="light"')
    expect(actions).toContain('data-theme-icon="dark"')
    expect(actions).toContain('data-theme-icon="system"')
    expect(actions).not.toContain('control-label')
    expect(app).toContain("window.matchMedia('(prefers-color-scheme: dark)')")
    expect(app).toContain("window.localStorage.setItem('opusweave.theme', themePreference)")
    expect(css).toContain(":root[data-effective-theme='light']")
    expect(css).toContain('.topbar-actions button[data-shortcut]::after { display: none; }')
  })

  test('themes staff and Jianpu surfaces in both dark and light modes', () => {
    expect(css).toContain('--notation-bg: #0d100e;')
    expect(css).toContain("--notation-bg: #eeede5;")
    expect(css).toContain('background: var(--notation-bg)')
    expect(css).toContain('stroke: var(--notation-staff-line)')
    expect(css).toContain('color: var(--notation-ink)')
    expect(css).toContain('border-top: 1px solid var(--notation-rule)')
  })

  test('uses one settings page for devices, AI and advanced controls', () => {
    expect(html).toContain('data-page-target="settings"')
    expect(html).toContain('data-workspace-page="settings"')
    expect(html).not.toContain('data-page-target="studio"')
    expect(html).not.toContain('data-page-target="devices"')
    expect(html).not.toContain('data-workspace-page="devices"')
    expect(html).toContain('id="status-panel"')
    expect(html).toContain('id="midi-panel"')
    expect(html).toContain('id="ai-settings-panel"')
    expect(html).toContain('class="advanced-settings"')
    expect(html).not.toContain('id="record-panel"')
    expect(html).not.toContain('id="btn-record"')
    expect(html).not.toContain('data-page-target="tools"')
  })

  test('opens AI composition through one button and a modal prompt dialog', () => {
    expect(html.match(/id="btn-ai-compose"/g)).toHaveLength(1)
    expect(html).toContain('<dialog id="ai-compose-dialog"')
    expect(html).toContain('id="ai-prompt"')
    expect(html).toContain('id="btn-ai-submit"')
    expect(app).toContain('aiComposeDialog.showModal()')
    expect(app).toContain("setAiComposeState('working')")
    expect(app).toContain("setAiComposeState('success')")
    expect(app).toContain("setAiComposeState('error')")
  })

  test('keeps contextual motion help inside the focused OWT editor', () => {
    expect(html).toContain('class="owt-editor-overlay"')
    expect(html).toContain('class="owt-motion-hints"')
    expect(html).not.toContain('id="owt-event-input"')
    expect(html).not.toContain('data-i18n="ai.improvHint"')
    expect(css).toContain(".owt-editor-shell[data-edit-mode='score']:focus-within .owt-editor-overlay")
    expect(html).toContain('id="owt-status" class="status" hidden')
    expect(html).toContain('data-shortcut="d"')
    expect(html).not.toContain('data-shortcut="Space a d"')
    expect(modalEditor).toContain("case 'd': void this.callbacks.onCommand('delete-object')")
    expect(app).not.toContain("owtEditor.addEventListener('click'")
  })

  test('moves file and MIDI import options out of the editor chrome', () => {
    expect(html).toContain('class="file-menu"')
    expect(html).toContain('id="midi-import-dialog"')
    expect(html).toContain('id="owt-grid"')
    expect(html.indexOf('id="owt-grid"')).toBeGreaterThan(html.indexOf('id="midi-import-dialog"'))
    expect(html).not.toContain('class="owt-actions"')
    expect(html).not.toContain('class="owt-source-row"')
  })

  test('uses F5 as a global play and pause shortcut', () => {
    expect(html).toContain('data-shortcut="F5 · Ctrl+Space · Space p"')
    expect(html).toContain('aria-keyshortcuts="F5 Control+Space"')
    expect(app).toContain("ev.key === 'F5'")
    expect(app).toContain("handleModalCommand('play-pause')")
  })
})
