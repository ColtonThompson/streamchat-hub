/**
 * tests/stubs/ws.ts
 *
 * A stand-in for the `ws` (WebSocket) package so no test ever opens a real connection (vitest.config.ts
 * points the name "ws" here). Tests look at `WebSocket.instances` to see what the code opened and at
 * `.sent` for what it wrote, and call `.emit('open' | 'message' | 'close', ...)` on an instance to play
 * the part of the server.
 */
import { EventEmitter } from 'node:events'

export default class WebSocket extends EventEmitter {
  static instances: WebSocket[] = []
  closed = false
  sent: string[] = []
  constructor(public url?: string) {
    super()
    WebSocket.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(String(data))
  }
  close(): void {
    this.closed = true
  }
  terminate(): void {
    this.closed = true
    this.emit('close', 1006)
  }
}
