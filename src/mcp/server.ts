import { createInterface } from 'node:readline';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function writeJsonRpc(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function handleRequest(req: JsonRpcRequest): void {
  const hasId = req.id !== undefined && req.id !== null;
  const method = req.method;

  if (method === 'notifications/initialized') {
    return;
  }

  if (!hasId) {
    return;
  }

  switch (method) {
    case 'initialize': {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'antigravity-pulse',
            version: '0.1.0',
          },
        },
      });
      return;
    }
    case 'ping': {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: req.id,
        result: {},
      });
      return;
    }
    case 'tools/list': {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: [],
        },
      });
      return;
    }
    default: {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32601,
          message: `Method not found: ${String(method ?? '')}`,
        },
      });
    }
  }
}

export function startMcpServer(): void {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as JsonRpcRequest;
      handleRequest(parsed);
    } catch {
      writeJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
    }
  });
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  startMcpServer();
}
