import type {
  GetAllCascadeTrajectoriesResponse,
  GetCascadeModelConfigDataResponse,
  GetCascadeTrajectoryGeneratorMetadataRequest,
  GetCascadeTrajectoryGeneratorMetadataResponse,
  GetCascadeTrajectoryStepsRequest,
  GetCascadeTrajectoryStepsResponse,
  RetrieveUserQuotaSummaryResponse,
} from '../types/rpc';

export type ReadonlyLsMethod =
  | 'GetCascadeModelConfigData'
  | 'RetrieveUserQuotaSummary'
  | 'GetAllCascadeTrajectories'
  | 'GetCascadeTrajectoryGeneratorMetadata'
  | 'GetCascadeTrajectorySteps';

export const READONLY_LS_METHODS: ReadonlySet<string> = new Set<string>([
  'GetCascadeModelConfigData',
  'RetrieveUserQuotaSummary',
  'GetAllCascadeTrajectories',
  'GetCascadeTrajectoryGeneratorMetadata',
  'GetCascadeTrajectorySteps',
]);

export const FORBIDDEN_LS_METHODS: ReadonlySet<string> = new Set<string>([
  'DeleteCascadeTrajectory',
  'UpdateConversationAnnotations',
  'JetboxWriteState',
  'DeletePlugin',
  'InstallCustomization',
  'GetCascadeTrajectory',
]);

export class ReadonlyRpcViolationError extends Error {
  readonly method: string;

  constructor(method: string, reason?: string) {
    super(
      reason ??
        `Blocked non-readonly or unapproved LanguageServerService RPC method: "${method}"`
    );
    this.name = 'ReadonlyRpcViolationError';
    this.method = method;
  }
}

export class LsConnectionError extends Error {
  readonly statusCode?: number;
  readonly code?: string;

  constructor(message: string, details?: { statusCode?: number; code?: string; cause?: unknown }) {
    super(message);
    this.name = 'LsConnectionError';
    this.statusCode = details?.statusCode;
    this.code = details?.code;
    if (details?.cause !== undefined) {
      this.cause = details.cause;
    }
  }
}

export interface LsClientOptions {
  address?: string;
  csrfToken?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

function normalizeLsBaseUrl(rawAddress: string | undefined): string {
  const trimmed = (rawAddress ?? '').trim();
  if (!trimmed) {
    return '';
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export class ReadOnlyLsClient {
  private readonly baseUrl: string;
  private readonly csrfToken: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: LsClientOptions = {}) {
    const rawAddress = options.address ?? process.env.ANTIGRAVITY_LS_ADDRESS;
    const rawCsrf = options.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN;
    this.baseUrl = normalizeLsBaseUrl(rawAddress);
    this.csrfToken = (rawCsrf ?? '').trim();
    this.timeoutMs =
      typeof options.timeoutMs === 'number' &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
        ? Math.trunc(options.timeoutMs)
        : 2500;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.csrfToken.length > 0;
  }

  /**
   * Synchronously enforces the read-only method allowlist before constructing any URL or invoking fetch.
   */
  callReadonlyMethod<TResponse>(method: string, body: object = {}): Promise<TResponse> {
    if (FORBIDDEN_LS_METHODS.has(method) || !READONLY_LS_METHODS.has(method)) {
      throw new ReadonlyRpcViolationError(method);
    }
    return this.dispatchReadonlyRpc<TResponse>(method, body);
  }

  private async dispatchReadonlyRpc<TResponse>(
    method: string,
    body: object
  ): Promise<TResponse> {
    if (!this.isConfigured()) {
      throw new LsConnectionError('LS_NOT_CONFIGURED', { code: 'LS_NOT_CONFIGURED' });
    }
    if (typeof this.fetchFn !== 'function') {
      throw new LsConnectionError('FETCH_UNAVAILABLE', { code: 'FETCH_UNAVAILABLE' });
    }

    const url = `${this.baseUrl}/exa.language_server_pb.LanguageServerService/${method}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': this.csrfToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new LsConnectionError(
        `LS RPC ${method} transport error: ${err instanceof Error ? err.message : String(err)}`,
        { code: 'LS_TRANSPORT_ERROR', cause: err }
      );
    }

    if (!response.ok) {
      let snippet = '';
      try {
        snippet = (await response.text()).slice(0, 200);
      } catch {
        // Ignore response body read error
      }
      throw new LsConnectionError(
        `LS RPC ${method} failed with HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
        { statusCode: response.status, code: 'LS_HTTP_ERROR' }
      );
    }

    try {
      return (await response.json()) as TResponse;
    } catch (err) {
      throw new LsConnectionError(`LS RPC ${method} returned invalid JSON`, {
        code: 'LS_INVALID_JSON',
        cause: err,
      });
    }
  }

  getCascadeModelConfigData(): Promise<GetCascadeModelConfigDataResponse> {
    return this.callReadonlyMethod<GetCascadeModelConfigDataResponse>(
      'GetCascadeModelConfigData',
      {}
    );
  }

  retrieveUserQuotaSummary(): Promise<RetrieveUserQuotaSummaryResponse> {
    return this.callReadonlyMethod<RetrieveUserQuotaSummaryResponse>(
      'RetrieveUserQuotaSummary',
      {}
    );
  }

  getAllCascadeTrajectories(): Promise<GetAllCascadeTrajectoriesResponse> {
    return this.callReadonlyMethod<GetAllCascadeTrajectoriesResponse>(
      'GetAllCascadeTrajectories',
      {}
    );
  }

  getCascadeTrajectoryGeneratorMetadata(
    cascadeId: string
  ): Promise<GetCascadeTrajectoryGeneratorMetadataResponse> {
    const req: GetCascadeTrajectoryGeneratorMetadataRequest = { cascadeId };
    return this.callReadonlyMethod<GetCascadeTrajectoryGeneratorMetadataResponse>(
      'GetCascadeTrajectoryGeneratorMetadata',
      req
    );
  }

  /**
   * L-004: Always requests tail steps via stepOffset + disableRehydration: true (never startIndex/endIndex).
   */
  getCascadeTrajectorySteps(
    cascadeId: string,
    stepCount: number
  ): Promise<GetCascadeTrajectoryStepsResponse> {
    const safeStepCount =
      typeof stepCount === 'number' && Number.isFinite(stepCount) && stepCount > 0
        ? Math.trunc(stepCount)
        : 0;
    const req: GetCascadeTrajectoryStepsRequest = {
      cascadeId,
      stepOffset: Math.max(0, safeStepCount - 4),
      disableRehydration: true,
    };
    return this.callReadonlyMethod<GetCascadeTrajectoryStepsResponse>(
      'GetCascadeTrajectorySteps',
      req
    );
  }
}
