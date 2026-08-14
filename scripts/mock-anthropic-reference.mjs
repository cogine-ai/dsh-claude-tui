/** Deterministic loopback-only Anthropic Messages API used for visual capture. */
import { createServer } from 'node:http'

function sse(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

function messageEvents(id, blocks, stopReason) {
  const events = [sse('message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-1-20250805',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 64,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
    },
  })]
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      }))
      for (const text of block.chunks) {
        events.push(sse('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text },
        }))
      }
    } else {
      events.push(sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      }))
      events.push(sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      }))
    }
    events.push(sse('content_block_stop', { type: 'content_block_stop', index }))
  })
  events.push(
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 18 },
    }),
    sse('message_stop', { type: 'message_stop' }),
  )
  return events
}

function firstReply(mode) {
  if (mode === 'approval') {
    return {
      blocks: [{
        type: 'tool',
        id: 'toolu_reference_approval',
        name: 'Bash',
        input: {
          command: 'touch /tmp/claude-tui-approval-reference',
          description: 'Create a temporary approval reference marker',
        },
      }],
      stopReason: 'tool_use',
    }
  }
  if (mode === 'question') {
    return {
      blocks: [{
        type: 'tool',
        id: 'toolu_reference_question',
        name: 'AskUserQuestion',
        input: {
          questions: [{
            question: 'Which reference option should be used?',
            header: 'Reference',
            options: [
              { label: 'Alpha', description: 'Use the first deterministic option.' },
              { label: 'Beta', description: 'Use the second deterministic option.' },
            ],
            multiSelect: false,
          }],
        },
      }],
      stopReason: 'tool_use',
    }
  }
  if (mode === 'tool') {
    return {
      blocks: [{
        type: 'tool',
        id: 'toolu_reference_bash',
        name: 'Bash',
        input: {
          command: "printf 'claude-tui-reference\\n'",
          description: 'Print a local reference marker',
        },
      }],
      stopReason: 'tool_use',
    }
  }
  if (mode === 'subagent-foreground' || mode === 'subagent-background') {
    return {
      blocks: [{
        type: 'tool',
        id: `toolu_reference_${mode}`,
        name: 'Agent',
        input: {
          description: 'Inspect reference',
          prompt: 'Return exactly CHILD_REFERENCE.',
          subagent_type: 'general-purpose',
          run_in_background: mode === 'subagent-background',
        },
      }],
      stopReason: 'tool_use',
    }
  }
  return {
    blocks: [{ type: 'text', chunks: ['Streaming', ' reference', ' response.'] }],
    stopReason: 'end_turn',
  }
}

function hasToolResult(body) {
  return Array.isArray(body.messages) && body.messages.some(message => (
    Array.isArray(message.content) && message.content.some(block => block?.type === 'tool_result')
  ))
}

function requestShape(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages.map(message => ({
    role: message?.role,
    content: Array.isArray(message?.content)
      ? message.content.map(block => ({ type: block?.type, name: block?.name }))
      : typeof message?.content,
  }))
}

/** Start one ephemeral server and expose a bounded asynchronous closer. */
export async function startReferenceAnthropicServer(mode) {
  let requestSequence = 0
  const eventDelayMs = mode === 'streaming-slow' ? 600 : 65
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ input_tokens: 64 }))
        return
      }
      if (!request.url?.startsWith('/v1/messages')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
        return
      }
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
      const messages = Array.isArray(body.messages) ? body.messages : []
      const offeredTools = Array.isArray(body.tools) ? body.tools : []
      const preflight = offeredTools.length === 0
        && !hasToolResult(body)
        && !messages.some(message => message?.role === 'system')
      if (process.env.DSH_CLAUDE_CAPTURE_DEBUG === '1') {
        process.stderr.write(`${JSON.stringify({
          requestSequence,
          url: request.url,
          preflight,
          toolResult: hasToolResult(body),
          tools: offeredTools.map(tool => tool?.name),
          model: body.model,
          messages: requestShape(body),
        })}\n`)
      }
      const isSubagent = mode === 'subagent-foreground' || mode === 'subagent-background'
      const reply = preflight
        ? { blocks: [{ type: 'text', chunks: ['REFERENCE_PREFLIGHT'] }], stopReason: 'end_turn' }
        : requestSequence === 0
        ? firstReply(mode)
        : hasToolResult(body)
          ? {
              blocks: [{ type: 'text', chunks: [
                isSubagent ? 'The subagent reference completed.' : 'The local reference action completed.',
              ] }],
              stopReason: 'end_turn',
            }
          : isSubagent
            ? { blocks: [{ type: 'text', chunks: ['CHILD_REFERENCE'] }], stopReason: 'end_turn' }
            : firstReply(mode)
      if (!preflight) requestSequence += 1
      const events = messageEvents(`msg_reference_${requestSequence}`, reply.blocks, reply.stopReason)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      let index = 0
      const write = () => {
        const event = events[index]
        if (event === undefined) {
          response.end()
          return
        }
        response.write(event)
        index += 1
        setTimeout(write, eventDelayMs)
      }
      write()
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('reference API has no TCP address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}
