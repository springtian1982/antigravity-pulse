/**
 * Ambient TypeScript declarations matching Google Antigravity's runtime
 * `/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/index.mjs` and `preload.js`.
 */

declare module 'sidecar_sdk' {
  import type { Server } from 'node:http';

  export interface SidecarResponseInit {
    contentType?: string;
    status?: number;
    headers?: Record<string, string>;
  }

  export class Response {
    body: string | Uint8Array;
    contentType: string;
    status: number;
    headers?: Record<string, string>;
    constructor(body: string | Uint8Array, init?: SidecarResponseInit);
  }

  export interface SidecarAppConfig {
    projectId: string | undefined;
    conversationId: string | undefined;
  }

  export type SidecarPageHandler = () =>
    | string
    | Response
    | Promise<string | Response>;

  export type SidecarApiHandler = (
    data: Record<string, unknown>
  ) => unknown | Response | Promise<unknown | Response>;

  export class SidecarApp {
    constructor();
    get config(): SidecarAppConfig;
    sendMessage(
      conversationId: string,
      message: string,
      options?: { title?: string; projectId?: string }
    ): Record<string, unknown>;
    startConversation(
      message: string,
      options?: { model?: string; projectId?: string }
    ): Record<string, unknown>;
    getConversationMetadata(conversationId: string): Record<string, unknown>;
    page(path: string, handler: SidecarPageHandler): void;
    api(path: string, handler: SidecarApiHandler, method?: string): void;
    run(): Promise<Server>;
    close(): Promise<void>;
  }
}

interface SidecarWindowBridge {
  conversationId: string | null;
  fetch(url: string, options?: RequestInit): Promise<globalThis.Response>;
  getWorkspaceUris(): Promise<string[]>;
  onWorkspaceChange(listener: (uris: string[]) => void): () => void;
  agent: {
    sendMessage(message: string, convId?: string): Promise<Record<string, unknown>>;
    startConversation(message: string, title?: string): Promise<Record<string, unknown>>;
    getConversationMetadata(conversationId: string): Promise<Record<string, unknown>>;
  };
  ui: {
    toggleAuxPane(request?: Record<string, unknown>): void;
    toggleConversation(conversationId: string, options?: Record<string, unknown>): void;
    addArtifactComment(params?: {
      uri?: string;
      comment?: string;
      selection?: unknown;
      pageTitle?: string;
    }): void;
  };
}

interface Window {
  sidecar?: SidecarWindowBridge;
}
