import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  DEFAULT_PROTOCOL_VERSION,
  handleJsonRpcMessage,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOL_DEFINITIONS,
  McpFrameDecoder,
  serializeJsonRpcMessage,
} from '../../src/mcp/server';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulse-mcp-proto-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('mcp/server — dual-framing protocol parser, serializer & JSON-RPC 2.0 router', () => {
  it('L-013: importing server module does not auto-bind stdin or hang test execution', () => {
    assert.equal(typeof handleJsonRpcMessage, 'function');
    assert.equal(MCP_TOOL_DEFINITIONS.length, 3);
  });

  it('decodes chunked Content-Length frames with multi-byte UTF-8 CJK/emoji accurately', () => {
    const payload = {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'pulse_status_card',
        arguments: { note: '中文多字节遥测 🚀🔥' },
      },
    };
    const serialized = serializeJsonRpcMessage(payload, 'content-length');
    assert.ok(serialized.startsWith('Content-Length: '));

    // Byte length differs strictly from UTF-16 string length due to CJK + emojis
    const bodyStr = JSON.stringify(payload);
    assert.notEqual(Buffer.byteLength(bodyStr, 'utf8'), bodyStr.length);

    const rawBytes = Buffer.from(serialized, 'utf8');
    const decoder = new McpFrameDecoder();
    const collected = [];

    // Feed 5 bytes at a time across headers, CRLFCRLF, and multi-byte UTF-8 boundaries
    for (let offset = 0; offset < rawBytes.length; offset += 5) {
      const slice = rawBytes.subarray(offset, Math.min(rawBytes.length, offset + 5));
      collected.push(...decoder.push(slice));
    }
    collected.push(...decoder.flushEnd());

    assert.equal(collected.length, 1);
    assert.equal(collected[0].framing, 'content-length');
    assert.equal(collected[0].parseError, undefined);
    assert.deepEqual(JSON.parse(collected[0].rawJson ?? ''), payload);

    // Also test LF-only header separator + Content-Type header preceding Content-Length
    const lfFrame = Buffer.from(
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\nContent-Length: ${Buffer.byteLength(bodyStr, 'utf8')}\n\n${bodyStr}`,
      'utf8'
    );
    const d2 = new McpFrameDecoder();
    const f2 = [...d2.push(lfFrame.subarray(0, 18)), ...d2.push(lfFrame.subarray(18)), ...d2.flushEnd()];
    assert.equal(f2.length, 1);
    assert.equal(f2[0].framing, 'content-length');
    assert.deepEqual(JSON.parse(f2[0].rawJson ?? ''), payload);
  });

  it('decodes NDJSON frames across split chunks and handles interleaved or CRLF lines', () => {
    const p1 = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const p2 = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const combined =
      serializeJsonRpcMessage(p1, 'ndjson').replace(/\n$/, '\r\n') +
      '\n' +
      serializeJsonRpcMessage(p2, 'ndjson');

    const decoder = new McpFrameDecoder();
    const buf = Buffer.from(combined, 'utf8');
    const frames = [
      ...decoder.push(buf.subarray(0, 12)),
      ...decoder.push(buf.subarray(12, 33)),
      ...decoder.push(buf.subarray(33)),
      ...decoder.flushEnd(),
    ];

    assert.equal(frames.length, 2);
    assert.equal(frames[0].framing, 'ndjson');
    assert.equal(frames[1].framing, 'ndjson');
    assert.deepEqual(JSON.parse(frames[0].rawJson ?? ''), p1);
    assert.deepEqual(JSON.parse(frames[1].rawJson ?? ''), p2);
  });

  it('flags malformed or truncated Content-Length and captures malformed NDJSON for -32700', () => {
    const d1 = new McpFrameDecoder();
    const badHeader = Buffer.from('Content-Length: not-a-num\r\n\r\n{}', 'utf8');
    const f1 = [...d1.push(badHeader), ...d1.flushEnd()];
    assert.ok(f1.some((f) => f.framing === 'content-length' && f.parseError === true));

    const d2 = new McpFrameDecoder();
    const truncated = Buffer.from('Content-Length: 500\r\n\r\n{"partial":true}', 'utf8');
    const f2 = [...d2.push(truncated), ...d2.flushEnd()];
    assert.equal(f2.length, 1);
    assert.equal(f2[0].framing, 'content-length');
    assert.equal(f2[0].parseError, true);

    const d3 = new McpFrameDecoder();
    const badJson = Buffer.from('{bad json\n', 'utf8');
    const f3 = [...d3.push(badJson), ...d3.flushEnd()];
    assert.equal(f3.length, 1);
    assert.equal(f3[0].framing, 'ndjson');
    assert.throws(() => JSON.parse(f3[0].rawJson ?? ''));
  });

  it('handles initialize, notifications, ping, tools/list, and JSON-RPC error codes without stdout noise', async () => {
    const stateDir = makeTempDir();
    const context = { stateDir };

    // Verify handleJsonRpcMessage itself writes zero debug noise to stdout
    let stdoutWrites = 0;
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: Uint8Array | string) => {
      stdoutWrites += 1;
      return origWrite(chunk);
    }) as typeof process.stdout.write;

    try {
      const initRes = await handleJsonRpcMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test-client' } },
        },
        context
      );
      assert.deepEqual(initRes, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        },
      });

      const initDefaultRes = await handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 'init-2', method: 'initialize', params: {} },
        context
      );
      assert.equal(
        (initDefaultRes?.result as { protocolVersion: string }).protocolVersion,
        DEFAULT_PROTOCOL_VERSION
      );

      assert.equal(
        await handleJsonRpcMessage(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          context
        ),
        null
      );
      assert.equal(
        await handleJsonRpcMessage(
          { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
          context
        ),
        null
      );

      const pingRes = await handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 2, method: 'ping' },
        context
      );
      assert.deepEqual(pingRes, { jsonrpc: '2.0', id: 2, result: {} });

      const listRes = await handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        context
      );
      const tools = (listRes?.result as { tools: Array<{ name: string }> }).tools;
      assert.deepEqual(
        tools.map((t) => t.name),
        ['pulse_status_card', 'pulse_get_compute_budget', 'pulse_set_preference']
      );

      // -32601 Method not found
      const unknownMethod = await handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 4, method: 'resources/list' },
        context
      );
      assert.equal(unknownMethod?.error?.code, -32601);

      // -32600 Invalid Request
      const invalidNonObj = await handleJsonRpcMessage(['not-an-object'], context);
      assert.equal(invalidNonObj?.error?.code, -32600);

      const invalidVersion = await handleJsonRpcMessage(
        { jsonrpc: '1.0', id: 5, method: 'ping' },
        context
      );
      assert.equal(invalidVersion?.error?.code, -32600);

      const invalidMissingMethod = await handleJsonRpcMessage({ jsonrpc: '2.0', id: 6 }, context);
      assert.equal(invalidMissingMethod?.error?.code, -32600);

      // tools/call missing name returns isError: true
      const missingName = await handleJsonRpcMessage(
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} },
        context
      );
      assert.equal((missingName?.result as { isError?: boolean }).isError, true);

      assert.equal(stdoutWrites, 0, 'JSON-RPC handler must never write debug output to stdout');
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
