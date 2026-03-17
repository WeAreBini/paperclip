// Type declarations for ws module
// This provides TypeScript types for the ws WebSocket library
// Since @types/ws is not being hoisted correctly by pnpm in production builds

declare module "ws" {
  import { EventEmitter } from "events";

  export interface WebSocket extends EventEmitter {
    readyState: number;
    OPEN: number;
    CLOSED: number;
    CONNECTING: number;
    CLOSING: number;
    
    on(event: "message", listener: (data: Buffer | Buffer[] | ArrayBuffer) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "open", listener: () => void): this;
    
    once(event: "message", listener: (data: Buffer | Buffer[] | ArrayBuffer) => void): this;
    once(event: "close", listener: (code: number, reason: Buffer) => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "open", listener: () => void): this;
    
    off(event: "message", listener: (data: Buffer | Buffer[] | ArrayBuffer) => void): this;
    off(event: "close", listener: (code: number, reason: Buffer) => void): this;
    off(event: "error", listener: (err: Error) => void): this;
    off(event: "open", listener: () => void): this;
    
    send(data: string | Buffer | ArrayBuffer, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string | Buffer): void;
  }

  export type RawData = Buffer | Buffer[] | ArrayBuffer;
  
  export const WebSocket: {
    new (url: string | URL, options?: { headers?: Record<string, string>; maxPayload?: number }): WebSocket;
    OPEN: number;
    CLOSED: number;
    CONNECTING: number;
    CLOSING: number;
  };
}
