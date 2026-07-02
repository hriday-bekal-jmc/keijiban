// Thin fetch wrapper. Rejects with the server's error string (callers rely on
// `typeof err === 'string'`). Serializes concurrent 401s behind one silent
// refresh, then retries the original request once.

let refreshing: Promise<void> | null = null

async function tryRefresh(): Promise<void> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error('refresh_failed')
}

async function request<T>(method: string, url: string, data?: unknown, retried = false): Promise<T> {
  const isForm = data instanceof FormData
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'include',
      headers: data !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: data === undefined ? undefined : isForm ? data : JSON.stringify(data),
    })
  } catch (e) {
    throw e instanceof Error ? e.message : String(e)
  }

  if (res.ok) return res.status === 204 ? (undefined as T) : res.json()

  const errMsg: string = (await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`

  // Silently refresh on any 401 from non-auth endpoints — covers both
  // 'Token expired' (JWT still present but stale) and 'Not authenticated'
  // (access cookie already deleted by browser after its 15-min maxAge).
  // Only attempt once per request; never retry the refresh endpoint itself.
  if (res.status === 401 && !retried && !url.includes('/auth/refresh')) {
    try {
      if (!refreshing) {
        refreshing = tryRefresh().finally(() => { refreshing = null })
      }
      await refreshing
      // New access cookie is now set; retry original request.
      return request(method, url, data, true)
    } catch {
      // Refresh failed — session truly over.
      window.dispatchEvent(new Event('auth:expired'))
      throw errMsg
    }
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:expired'))
  }

  throw errMsg
}

export const api = {
  get:    <T = unknown>(url: string): Promise<T> => request('GET', url),
  post:   <T = unknown>(url: string, data?: unknown): Promise<T> => request('POST', url, data),
  put:    <T = unknown>(url: string, data?: unknown): Promise<T> => request('PUT', url, data),
  delete: <T = unknown>(url: string): Promise<T> => request('DELETE', url),
}
