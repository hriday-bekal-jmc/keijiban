import axios, { AxiosResponse } from 'axios'

const _axios = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

_axios.interceptors.response.use(
  (res: AxiosResponse) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      // Clear any cached auth state; App will render Login
      window.dispatchEvent(new Event('auth:expired'))
    }
    return Promise.reject(err.response?.data?.error ?? err.message)
  }
)

export const api = {
  get<T = unknown>(url: string, config?: Parameters<typeof _axios.get>[1]): Promise<T> {
    return _axios.get(url, config)
  },
  post<T = unknown>(url: string, data?: unknown, config?: Parameters<typeof _axios.post>[2]): Promise<T> {
    return _axios.post(url, data, config)
  },
  put<T = unknown>(url: string, data?: unknown, config?: Parameters<typeof _axios.put>[2]): Promise<T> {
    return _axios.put(url, data, config)
  },
  delete<T = unknown>(url: string, config?: Parameters<typeof _axios.delete>[1]): Promise<T> {
    return _axios.delete(url, config)
  },
}
