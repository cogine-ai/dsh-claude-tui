/** Keyless legacy MCP fixture; exercises the real SDK without another SDK dependency. */
const objectSchema = { type: 'object', properties: {}, additionalProperties: false }
const tool = (name, inputSchema = objectSchema, extra = {}) => ({
  name, description: `Local compatibility fixture: ${name}`, inputSchema, ...extra,
})

export function createMcpFixture({ noProgress = false } = {}) {
  let toolLists = 0
  const requests = []
  return {
    requests,
    get toolLists() { return toolLists },
    handle(message) {
      requests.push(message)
      if (message.id === undefined) return undefined
      let result
      switch (message.method) {
        case 'initialize':
          result = {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'local-mcp-compat', version: '1.0.0' },
            instructions: 'Local MCP compatibility fixture.',
          }
          break
        case 'tools/list': {
          toolLists++
          const add = tool('add', {
            type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'], additionalProperties: false,
          })
          // Reused cursors with different items must continue; an identical page must stop.
          if (noProgress || toolLists === 1) result = { tools: [add], nextCursor: 'reused' }
          else if (toolLists === 2) result = { tools: [tool('admin.reset')], nextCursor: 'reused' }
          else result = {
            tools: [tool('fail'), tool('slow'), tool('structured', objectSchema, {
              outputSchema: {
                type: 'object', properties: { answer: { type: 'number' } },
                required: ['answer'], additionalProperties: false,
              },
            })],
          }
          break
        }
        case 'tools/call': {
          const args = message.params?.arguments ?? {}
          switch (message.params?.name) {
            case 'add': result = { content: [{ type: 'text', text: String(args.a + args.b) }] }; break
            case 'admin.reset': result = { content: [{ type: 'text', text: 'reset done' }] }; break
            case 'fail': result = { content: [{ type: 'text', text: 'fixture failure' }], isError: true }; break
            case 'structured': result = {
              content: [{ type: 'text', text: '42' }], structuredContent: { answer: 42 },
            }; break
            case 'slow': return undefined // Remains in flight until the client cancels/closes.
            default: return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'unknown tool' } }
          }
          break
        }
        case 'ping': result = {}; break
        default: return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported fixture method' } }
      }
      return { jsonrpc: '2.0', id: message.id, result }
    },
  }
}
