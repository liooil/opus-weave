import { describe, it, expect, afterAll } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'opus-weave-mcp-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function startServer(): { child: ChildProcess; send: (id: number, method: string, params?: unknown) => void; waitFor: (id: number, timeoutMs?: number) => Promise<unknown>; getStdout: () => string } {
  const child = spawn('bun', ['src/main.ts', 'mcp'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
  const stdout: string[] = []
  const stderr: string[] = []
  child.stdout.on('data', (d) => stdout.push(d.toString()))
  child.stderr.on('data', (d) => stderr.push(d.toString()))

  const send = (id: number, method: string, params?: unknown) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  }

  const getStdout = (): string => stdout.join('')

  const waitFor = (id: number, timeoutMs = 8000) =>
    new Promise<unknown>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const timer = setInterval(() => {
        const lines = stdout.join('').split('\n').filter((l) => l.trim())
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as { id?: number }
            if (msg.id === id) {
              clearInterval(timer)
              resolve(JSON.parse(line))
              return
            }
          } catch {
            // partial line
          }
        }
        if (Date.now() > deadline) {
          clearInterval(timer)
          reject(new Error(`timeout waiting for id ${id}; stdout=${stdout.join('')} stderr=${stderr.join('')}`))
        }
      }, 20)
    })

  return { child, send, waitFor, getStdout }
}

const children: ChildProcess[] = []

describe('MCP server (stdio)', () => {
  it('initializes and lists all five tools', async () => {
    const { child, send, waitFor } = startServer()
    children.push(child)
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    const init = (await waitFor(1)) as { result?: { serverInfo?: { name?: string }; protocolVersion?: string } }
    expect(init.result?.serverInfo?.name).toBe('opus-weave')
    expect(init.result?.protocolVersion).toBe('2024-11-05')

    send(2, 'tools/list', {})
    const tools = (await waitFor(2)) as { result?: { tools?: Array<{ name: string }> } }
    const names = tools.result?.tools?.map((t) => t.name).sort()
    expect(names).toEqual(['create_example_composition', 'create_midi', 'inspect_midi', 'render_midi', 'validate_composition'])
  })

  it('validate_composition returns errors/warnings/stats', async () => {
    const { child, send, waitFor } = startServer()
    children.push(child)
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    await waitFor(1)
    send(2, 'tools/call', {
      name: 'validate_composition',
      arguments: { spec: { tracks: [{ name: 'X', notes: [{ startBeat: 0, durationBeats: 1, pitch: 300, velocity: 90 }] }] } },
    })
    const res = (await waitFor(2)) as { result?: { content?: Array<{ text?: string }> } }
    const parsed = JSON.parse(res.result?.content?.[0]?.text ?? '{}') as { errors?: Array<{ field: string }>; stats?: { noteCount: number } }
    expect(parsed.errors?.[0]?.field).toBe('tracks[0].notes[0].pitch')
    expect(parsed.stats?.noteCount).toBe(0)
  })

  it('create_example_composition returns a valid spec', async () => {
    const { child, send, waitFor } = startServer()
    children.push(child)
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    await waitFor(1)
    send(2, 'tools/call', { name: 'create_example_composition', arguments: {} })
    const res = (await waitFor(2)) as { result?: { content?: Array<{ text?: string }> } }
    const spec = JSON.parse(res.result?.content?.[0]?.text ?? '{}') as { tracks?: unknown[]; tempos?: unknown[] }
    expect(spec.tracks?.length).toBe(2)
    expect(spec.tempos?.length).toBeGreaterThanOrEqual(2)
  })

  it('create_midi writes a file whose inspect_midi reads back', async () => {
    const { child, send, waitFor } = startServer()
    children.push(child)
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    await waitFor(1)
    const out = join(dir, 'mcp.mid')
    send(2, 'tools/call', {
      name: 'create_midi',
      arguments: {
        output: out,
        spec: { title: 'MCP', tracks: [{ name: 'Piano', program: 0, notes: [{ startBeat: 0, durationBeats: 1, pitch: 72, velocity: 100 }] }] },
      },
    })
    const create = (await waitFor(2)) as { result?: { content?: Array<{ text?: string }> } }
    const created = JSON.parse(create.result?.content?.[0]?.text ?? '{}') as { noteCount?: number; bytes?: number; path?: string }
    expect(created).toMatchObject({ noteCount: 1, bytes: 83 })
    expect(created.path).toBe(out)

    send(3, 'tools/call', { name: 'inspect_midi', arguments: { file: out } })
    const insp = (await waitFor(3)) as { result?: { content?: Array<{ text?: string }> } }
    const info = JSON.parse(insp.result?.content?.[0]?.text ?? '{}') as { format?: number; hangingNotes?: number }
    expect(info.format).toBe(1)
    expect(info.hangingNotes).toBe(0)
  })

  it('keeps stdout pure: every stdout line is valid JSON-RPC', async () => {
    const { child, send, waitFor, getStdout } = startServer()
    children.push(child)
    send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    await waitFor(1)
    send(2, 'tools/call', { name: 'validate_composition', arguments: { spec: { tracks: [] } } })
    await waitFor(2)
    // Let any trailing output settle, then inspect everything emitted.
    await new Promise((r) => setTimeout(r, 300))
    const allLines = getStdout().split('\n').filter((l) => l.trim())
    expect(allLines.length).toBeGreaterThan(0)
    for (const line of allLines) {
      expect(() => JSON.parse(line), `stdout line must be JSON-RPC: ${line}`).not.toThrow()
    }
  })
})

afterAll(() => {
  for (const c of children) c.kill()
})
