/**
 * mcp/server — stdio MCP server entry.
 *
 * Protocol rules:
 * - stdout carries ONLY MCP protocol messages;
 * - every log line goes to stderr;
 * - no GUI, no browser, no welcome text;
 * - fatal errors are logged to stderr and exit non-zero.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'
import { OpusWeaveError } from '../shared/errors.ts'

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'opus-weave',
    version: '0.1.0',
  })
  registerTools(server, new OpusWeaveService())

  // Surface tool errors to the client without crashing the server.
  server.server.onerror = (err) => {
    console.error(`[opus-weave mcp] ${err instanceof Error ? err.message : String(err)}`)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

/** Entry used by main.ts before any GUI code runs. */
export async function mainMcp(): Promise<void> {
  try {
    await runMcpServer()
    // StdioServerTransport keeps the process alive until stdin closes;
    // never call process.exit here or the handshake is killed.
  } catch (err) {
    if (err instanceof OpusWeaveError) {
      console.error(`[opus-weave mcp] error: ${err.message}`)
    } else {
      console.error(`[opus-weave mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
    }
    process.exit(1)
  }
}
