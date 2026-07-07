import type { Response } from 'express'

interface SseEvent {
  type: string
  [key: string]: unknown
}

const MAX_CONNECTIONS_PER_USER = 5

// In-process SSE manager — PM2 fork mode required (single process, no IPC needed)
class SSEManager {
  #clients = new Map<string, Set<Response>>() // userId -> Set<res>

  add(userId: string, res: Response): boolean {
    if (!this.#clients.has(userId)) this.#clients.set(userId, new Set())
    const set = this.#clients.get(userId)!
    if (set.size >= MAX_CONNECTIONS_PER_USER) {
      // Evict the oldest connection before adding the new one
      const oldest = set.values().next().value as Response
      try { oldest.end() } catch { /* already closed */ }
      set.delete(oldest)
    }
    set.add(res)
    return true
  }

  remove(userId: string, res: Response): void {
    const set = this.#clients.get(userId)
    if (!set) return
    set.delete(res)
    if (set.size === 0) this.#clients.delete(userId)
  }

  send(userId: string, event: SseEvent): void {
    const set = this.#clients.get(userId)
    if (!set) return
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of set) {
      try { res.write(data) } catch { set.delete(res) }
    }
  }

  broadcast(userIds: string[], event: SseEvent): void {
    for (const id of userIds) this.send(id, event)
  }

  // Convenience: send to all connected users (used until notification targeting is built)
  broadcastAll(event: SseEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const [, set] of this.#clients) {
      for (const res of set) {
        try { res.write(data) } catch { /* cleaned up on close */ }
      }
    }
  }

  // A real `data:` event, not a raw `:comment` — comments keep the TCP socket
  // alive but never reach EventSource.onmessage, so the client has no way to
  // tell a truly-dead (but not yet errored) connection from an idle one.
  ping(): void {
    const heartbeat = `data: ${JSON.stringify({ type: 'PING' })}\n\n`
    for (const [, set] of this.#clients) {
      for (const res of set) {
        try { res.write(heartbeat) } catch { /* cleaned up on close */ }
      }
    }
  }
}

export const sseManager = new SSEManager()

setInterval(() => sseManager.ping(), 25_000)
