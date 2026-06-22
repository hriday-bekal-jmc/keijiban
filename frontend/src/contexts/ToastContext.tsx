import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
}

const STYLES: Record<ToastType, { bg: string; border: string; color: string; iconBg: string }> = {
  success: { bg: '#F0FAF4', border: '#86EFAC', color: '#166534', iconBg: '#22c55e' },
  error:   { bg: '#FEF2F2', border: '#FCA5A5', color: '#991B1B', iconBg: '#ef4444' },
  info:    { bg: '#FDE8D0', border: '#F0C898', color: '#7A3A0A', iconBg: '#E8732A' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  const ctx: ToastContextValue = {
    success: (msg) => add('success', msg),
    error:   (msg) => add('error', msg),
    info:    (msg) => add('info', msg),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center gap-2 pointer-events-none"
        style={{ bottom: '5.5rem' }}
      >
        <AnimatePresence>
          {toasts.map(t => {
            const s = STYLES[t.type]
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.94 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-[13px] font-semibold pointer-events-auto whitespace-nowrap"
                style={{
                  background: s.bg,
                  border: `1.5px solid ${s.border}`,
                  color: s.color,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                }}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0"
                  style={{ background: s.iconBg }}
                >
                  {ICONS[t.type]}
                </span>
                {t.message}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
