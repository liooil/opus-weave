import { describe, expect, test } from 'bun:test'

const html = await Bun.file('src/web/index.html').text()
const app = await Bun.file('src/web/app.ts').text()
const css = await Bun.file('src/web/app.css').text()
const modalEditor = await Bun.file('src/web/editor/modal-editor.ts').text()
const aiClient = await Bun.file('src/domain/ai/owt-ai.ts').text()
const owtDocs = await Bun.file('docs/owt.md').text()

describe('web workspace structure', () => {
  test('integrates score controls into the top bar without a local-session badge', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header).toContain('id="score-view-toolbar"')
    expect(header).toContain('data-score-view-target="owt"')
    expect(header).toContain('class="control-icon')
    expect(header).toContain('class="control-label"')
    expect(html).not.toContain('class="session-state"')
    expect(html).not.toContain('data-i18n="session.local"')
    expect(app).toContain("control.hidden = pageId !== 'studio'")
    expect(css).toContain('.topbar .control-label { display: none; }')
    expect(css).toContain('overflow-x: auto;')
    expect(css).not.toContain('grid-template-rows: auto auto auto')
  })

  test('orders perform before AI controls and keeps settings after them', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    const toolbar = header.slice(header.indexOf('id="score-view-toolbar"'), header.indexOf('</nav>'))
    expect(header.indexOf('class="file-menu topbar-file-menu"')).toBeLessThan(header.indexOf('id="score-view-toolbar"'))
    expect(toolbar.indexOf('id="btn-owt-practice"')).toBeLessThan(toolbar.indexOf('id="btn-ai-compose"'))
    expect(toolbar.indexOf('id="btn-ai-compose"')).toBeLessThan(toolbar.indexOf('id="btn-ai-improvise"'))
    expect(header.indexOf('id="btn-ai-improvise"')).toBeLessThan(header.indexOf('data-page-target="settings"'))
    const actionsStart = header.indexOf('<div class="topbar-actions">')
    expect(header.indexOf('data-page-target="settings"')).toBeGreaterThan(actionsStart)
    expect(header.indexOf('id="language-toggle"')).toBeGreaterThan(header.indexOf('data-page-target="settings"'))
  })

  test('places a loop toggle beside the global play control', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header.indexOf('id="btn-score-view-play"')).toBeLessThan(header.indexOf('id="btn-loop-playback"'))
    expect(header.indexOf('id="btn-loop-playback"')).toBeLessThan(header.indexOf('id="btn-owt-practice"'))
    expect(html).toContain('id="btn-loop-playback" class="loop-playback-button topbar-control"')
    expect(html).toContain('data-shortcut="Space t l"')
    expect(app).toContain('engine?.setLooping(loopPlayback)')
    expect(app).toContain('player.setLooping(loopPlayback && allowLoop)')
    expect(app).toContain('playOwtRange(undefined, false)')
    expect(modalEditor).toContain("l: 'loop'")
  })

  test('keeps audition transport in settings and shows one current playback action', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    const play = header.match(/<button id="btn-score-view-play"[^>]*>/)?.[0] ?? ''
    const loop = header.match(/<button id="btn-loop-playback"[^>]*>/)?.[0] ?? ''
    expect(play).not.toContain('data-studio-only')
    expect(loop).not.toContain('data-studio-only')
    for (const id of ['btn-owt-practice', 'btn-ai-compose', 'btn-ai-improvise']) {
      expect(header.match(new RegExp(`<button id="${id}"[^>]*>`))?.[0]).toContain('data-studio-only')
    }
    expect(header).toContain('<div class="score-view-tabs" role="tablist" data-studio-only>')
    expect(play).toContain('data-i18n-aria-label="playback.play"')
    expect(html).toContain('<span class="control-label" data-i18n="playback.play">Play</span>')
    expect(html).not.toContain('>Play / pause</span>')
    expect(app).toContain("const actionKey = playing ? 'playback.pause' : 'playback.play'")
    expect(app).toContain('label.dataset.i18n = actionKey')
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
    expect(buttons.filter((button) => !button.includes('data-shortcut') && !button.includes('aria-keyshortcuts') && !button.includes('data-shortcut-exempt'))).toEqual([])
    expect(buttons.filter((button) => button.includes('data-shortcut-exempt'))).toEqual([
      expect.stringContaining('id="owt-mode"'),
      expect.stringContaining('id="toggle-computer-map"'),
      expect.stringContaining('id="btn-ai-refresh-models"'),
    ])
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
    const themeButton = actions.slice(actions.indexOf('id="theme-toggle"'), actions.indexOf('</button>', actions.indexOf('id="theme-toggle"')))
    expect(themeButton).not.toContain('control-label')
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

  test('submits composition on Enter and exposes persistent per-feature prompt templates', () => {
    expect(app).toContain("if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return")
    expect(app).toContain('aiComposeForm.requestSubmit()')
    for (const id of ['ai-template-system', 'ai-template-prompt', 'ai-template-media', 'ai-template-improvise']) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toContain('id="btn-ai-reset-templates"')
    expect(app).toContain('promptTemplates: currentAiPromptTemplates()')
  })

  test('randomizes composition suggestions and submits the visible suggestion when empty', () => {
    const prompt = html.match(/<textarea id="ai-prompt"[^>]*>/)?.[0] ?? ''
    expect(prompt).not.toContain('required')
    expect(app).toContain("ai.promptExample.rain")
    expect(app).toContain("ai.promptExample.typhoon")
    expect(app).toContain('aiPrompt.placeholder = chooseAiPromptExample()')
    expect(app).toContain('aiPrompt.value.trim() || aiPrompt.placeholder.trim()')
  })

  test('persists the current OWT in a shareable URL hash', () => {
    expect(app).toContain("import { decodeOwtHash, encodeOwtHash } from './owt-url-state.ts'")
    expect(app).toContain('syncOwtUrlHash(owtEditor.value)')
    expect(app).toContain('window.history.replaceState')
    expect(app).toContain('const initialOwtFromHash = decodeOwtHash(window.location.hash)')
    expect(app).toContain('setOwtEditorText(initialOwtFromHash ?? DEFAULT_OWT_SCORE)')
    expect(app).toContain("window.addEventListener('hashchange'")
    expect(app).toContain('if (initialOwtFromHash === null)')
  })

  test('uses manual AI collaboration when no optional API is configured', () => {
    const checkedSources = `${html}\n${app}\n${aiClient}\n${owtDocs}`
    expect(checkedSources).not.toMatch(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2}\b/)
    expect(html).not.toMatch(/id="ai-endpoint"[^>]*\svalue=/)
    expect(html).not.toMatch(/id="ai-model"[^>]*\svalue=/)
    expect(html).toContain('id=\"ai-protocol\"')
    expect(html).toContain('id=\"ai-model-options\"')
    expect(html).toContain('id=\"btn-ai-refresh-models\"')
    expect(app).toContain('discoverAiModels(config')
    expect(html).toContain('<dialog id="ai-manual-dialog"')
    expect(html).toContain('id="ai-manual-prompt"')
    expect(html).toContain('id="btn-ai-manual-copy"')
    expect(app).toContain('if (!hasConfiguredAiApi(currentAiConfig()))')
    expect(app).toContain('buildManualOwtPrompt(owtEditor.value, getLocale())')
    expect(app).toContain('navigator.clipboard.writeText(aiManualPrompt.value)')
    expect(modalEditor).toContain("textarea.addEventListener('paste'")
  })

  test('keeps contextual motion help inside the focused OWT editor', () => {
    expect(html).toContain('id="owt-motion-destinations"')
    expect(html).not.toContain('class="owt-motion-hints"')
    expect(html).not.toContain('id="owt-event-input"')
    expect(html).not.toContain('data-i18n="ai.improvHint"')
    expect(css).toContain('.owt-motion-destination')
    expect(css).toContain('.owt-motion-target')
    expect(html).toContain('id="owt-status" class="status" hidden')
    expect(html).toContain('data-shortcut="d"')
    expect(html).not.toContain('data-shortcut="Space a d"')
    expect(modalEditor).toContain("case 'd': void this.callbacks.onCommand('delete-object')")
    expect(app).not.toContain("owtEditor.addEventListener('click'")
  })

  test('switches NORMAL and RAW from the lower-left mode indicator', () => {
    expect(html.match(/id="btn-ai-improvise"/g)).toHaveLength(1)
    expect(html.indexOf('id="btn-ai-improvise"')).toBeLessThan(html.indexOf('</header>'))
    expect(html).not.toContain('id="btn-owt-mode-score"')
    expect(html).not.toContain('id="btn-owt-mode-raw"')
    expect(html).not.toContain('class="owt-edit-mode-tabs"')
    expect(html).toContain('<button id="owt-mode" class="owt-mode normal"')
    expect(app).toContain("$('owt-mode').addEventListener('click'")
    expect(modalEditor).toContain("{ s: 'mode-score', r: 'mode-raw' }")
    expect(css).not.toContain('.owt-editor-shell.raw .owt-highlight')
    expect(css).not.toContain('.owt-editor-shell.raw .owt-editor')
  })

  test('moves file and MIDI import options out of the editor chrome', () => {
    expect(html).toContain('class="file-menu topbar-file-menu"')
    expect(html.match(/id="owt-file"/g)).toHaveLength(1)
    expect(html).toContain('id="owt-example-menu"')
    expect(html).not.toContain('id="owt-example"')
    expect(html).not.toContain('id="btn-load-example"')
    expect(html).not.toContain('class="score-open-actions"')
    expect(html).not.toContain('class="example-picker"')
    expect(app).toContain("button.dataset.exampleId = example.id")
    expect(html).toContain('class="file-submenu-popover example-menu-list"')
    expect(css).toContain('.file-submenu-popover { width: 290px;')
    expect(css).toContain('left: calc(100% + 8px); z-index: 31;')
    expect(css).toContain('.file-submenu:not([open]) > .file-submenu-popover { display: none; }')
    expect(css).toContain('.file-menu-popover button { width: 100%; border: 0;')
    expect(css).toContain('.file-menu-item, .topbar .file-menu-popover > button')
    expect(css).toContain('.file-menu-popover button:hover:not(:disabled)')
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

  test('keeps guided performance visible in the top toolbar', () => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(header).toContain('id="btn-owt-practice"')
    expect(header).toContain('data-shortcut="Space q"')
    expect(header).toContain('aria-pressed="false"')
    expect(html.match(/id="btn-owt-practice"/g)).toHaveLength(1)
    expect(html).not.toContain('id="btn-owt-practice" class="sr-only"')
    expect(app).toContain('function updatePracticeButton()')
  })

  test('merges octave and velocity controls into the keyboard-map header', () => {
    const livePanel = html.slice(html.indexOf('id="live-panel"'), html.indexOf('</section>', html.indexOf('id="live-panel"')))
    const mapHeader = livePanel.slice(livePanel.indexOf('class="computer-map-head"'), livePanel.indexOf('class="computer-map-content"'))
    expect(mapHeader).toContain('id="oct-down"')
    expect(mapHeader).toContain('id="oct-label"')
    expect(mapHeader).toContain('id="velocity-down"')
    expect(mapHeader).toContain('id="key-velocity"')
    expect(mapHeader).toContain('class="map-shortcut-hint"')
    expect(mapHeader).toContain('id="toggle-computer-map"')
    expect(mapHeader).not.toContain('data-shortcut="Space k m"')
    expect(modalEditor).not.toContain("m: 'toggle-key-map'")
    expect(app).not.toContain("case 'toggle-key-map'")
    expect(css).toContain(".map-toggle[aria-expanded='false'] .map-toggle-icon")
    expect(mapHeader).toContain('id="live-notes"')
    expect(livePanel).not.toContain('data-i18n="section.instrument"')
    expect(livePanel).not.toContain('data-i18n="section.livePerformance"')
    expect(livePanel).not.toContain('class="hint keyboard-hint"')
    expect(app).not.toContain('updateComputerLayoutGuidance')
  })

  test('renders layout-specific key maps including the complete FreePiano keyboard', () => {
    expect(html).not.toContain('class="bridge-label"')
    expect(html).not.toContain('data-i18n="live.mappingBridge"')
    expect(app).toContain("id: 'navigation'")
    expect(app).toContain("id: 'numpad'")
    expect(app).toContain("['numlock', 'num/', 'num*', 'num-']")
    expect(app).toContain("NumpadEnter: 'numenter'")
    expect(app).toContain("root.dataset.layout = layout")
    expect(app).not.toContain('traceActiveOnly')
    expect(css).toContain('.keyboard-map-section + .keyboard-map-section')
  })

  test('confirms AI-bound file imports before reading or sending the file', () => {
    expect(html).toContain('<dialog id="ai-media-import-dialog"')
    expect(html).toContain('id="ai-media-file-name"')
    expect(html).toContain('id="ai-media-mode"')
    expect(html).toContain('id="ai-media-frames"')
    expect(html).toContain('id="ai-media-prompt"')
    expect(html).toContain('id="btn-ai-media-confirm"')
    expect(app).toContain('else requestAiMediaImport(file)')
    expect(app).toContain('aiMediaImportDialog.showModal()')
    expect(app).toContain('mediaFileToAiAttachments(file, options.maxVideoFrames)')
    expect(app).toContain("includeCurrentScore: aiMediaMode.value === 'edit'")
    const requestStart = app.indexOf('function requestAiMediaImport(file: File)')
    const requestEnd = app.indexOf('function cancelAiMediaImport()', requestStart)
    expect(app.slice(requestStart, requestEnd)).not.toContain('mediaFileToAiAttachments')
  })
})
