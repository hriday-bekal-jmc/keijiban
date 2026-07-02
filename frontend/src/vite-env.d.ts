/// <reference types="vite/client" />

interface Window {
  google?: {
    accounts?: {
      id?: {
        initialize: (config: {
          client_id: string
          callback: (response: { credential: string }) => void
          auto_select?: boolean
          cancel_on_tap_outside?: boolean
          [key: string]: unknown
        }) => void
        renderButton: (element: HTMLElement, config: object) => void
        prompt: () => void
        cancel: () => void
        disableAutoSelect: () => void
      }
    }
  }
}
