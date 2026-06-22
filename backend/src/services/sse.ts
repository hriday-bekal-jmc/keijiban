import type { Response } from 'express'

interface SseEvent {
  type: string
  [key: string]: unknown
}

// In-process SSE manager — PM2 fork mode required (single process, no IPC needed)
class SSEManager {
  #clients = new Map<string, Set<Response>>() // userId -> Set<res>

  add(userId: string, res: Response): void {
    if (!this.#clients.has(userId)) this.#clients.set(userId, new Set())
    this.#clients.get(userId)!.add(res)
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

  ping(): void {
    const heartbeat = ': ping\n\n'
    for (const [, set] of this.#clients) {
      for (const res of set) {
        try { res.write(heartbeat) } catch { /* cleaned up on close */ }
      }
    }
  }
}

export const sseManager = new SSEManager()

setInterval(() => sseManager.ping(), 25_000)
