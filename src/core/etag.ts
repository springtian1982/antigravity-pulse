import { createHash } from 'node:crypto';
import type { CascadeNodeView, HudSnapshotResponse, UnchangedEtagResponse } from '../types/telemetry';

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  const t = typeof value;
  if (t === 'boolean' || t === 'string') {
    return value;
  }
  if (t === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (t === 'bigint') {
    return String(value);
  }
  if (t !== 'object') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => (item === undefined ? null : canonicalize(item, seen)));
    }

    const sorted: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      if (prop === undefined || typeof prop === 'function' || typeof prop === 'symbol') {
        continue;
      }
      sorted[key] = canonicalize(prop, seen);
    }
    return sorted;
  } finally {
    seen.delete(value);
  }
}

export function computeDeterministicEtag(payload: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(canonicalJson).digest('base64url').slice(0, 6);
}

export function makeUnchangedResponse(etag: string): UnchangedEtagResponse {
  return { unchanged: true, etag };
}

export function isEtagMatch(clientEtag: string | undefined | null, serverEtag: string): boolean {
  if (typeof clientEtag !== 'string') {
    return false;
  }
  const trimmed = clientEtag.trim();
  return trimmed.length > 0 && trimmed === serverEtag;
}

function stripNodeVolatileFields(node: CascadeNodeView): Omit<CascadeNodeView, 'phaseElapsedMs'> {
  const { phaseElapsedMs: _ignored, ...rest } = node;
  return rest;
}

export type HudSemanticInput = Omit<HudSnapshotResponse, 'etag' | 'generatedAt' | 'unchanged'>;

export function stripVolatileHudFields(snapshot: HudSemanticInput) {
  return {
    hostConnected: snapshot.hostConnected,
    activeConversationId: snapshot.activeConversationId,
    rootCascadeId: snapshot.rootCascadeId,
    breadcrumb: snapshot.breadcrumb,
    activeNode: snapshot.activeNode ? stripNodeVolatileFields(snapshot.activeNode) : null,
    treeNodes: snapshot.treeNodes.map(stripNodeVolatileFields),
    smartGovernanceBanner: snapshot.smartGovernanceBanner,
    quota: snapshot.quota,
    config: snapshot.config,
    warnings: snapshot.warnings,
  };
}

export function computeHudSemanticEtag(snapshot: HudSemanticInput): string {
  return computeDeterministicEtag(stripVolatileHudFields(snapshot));
}
