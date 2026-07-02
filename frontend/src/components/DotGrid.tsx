import { useRef, useEffect, useCallback, useMemo } from 'react'
import './DotGrid.css'

interface Dot {
  cx: number
  cy: number
  xOffset: number
  yOffset: number
  vx: number
  vy: number
  _active: boolean
}

interface Pointer {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  lastTime: number
  lastX: number
  lastY: number
}

interface DotGridProps {
  dotSize?: number
  gap?: number
  baseColor?: string
  activeColor?: string
  proximity?: number
  speedTrigger?: number
  shockRadius?: number
  shockStrength?: number
  maxSpeed?: number
  resistance?: number
  returnDuration?: number
  className?: string
  style?: React.CSSProperties
}

function hexToRgb(hex: string) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return { r: 0, g: 0, b: 0 }
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function throttle<T extends (...args: unknown[]) => void>(fn: T, limit: number): T {
  let lastCall = 0
  return function (this: unknown, ...args: unknown[]) {
    const now = performance.now()
    if (now - lastCall >= limit) { lastCall = now; fn.apply(this, args) }
  } as T
}

export default function DotGrid({
  dotSize = 16,
  gap = 32,
  baseColor = '#5227FF',
  activeColor = '#5227FF',
  proximity = 150,
  speedTrigger = 100,
  shockRadius = 250,
  shockStrength = 5,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.5,
  className = '',
  style,
}: DotGridProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const dotsRef    = useRef<Dot[]>([])
  const pointerRef = useRef<Pointer>({ x: 0, y: 0, vx: 0, vy: 0, speed: 0, lastTime: 0, lastX: 0, lastY: 0 })

  const baseRgb   = useMemo(() => hexToRgb(baseColor),   [baseColor])
  const activeRgb = useMemo(() => hexToRgb(activeColor), [activeColor])

  // Underdamped spring — dots fly out on impulse, overshoot, and settle back
  // (visually equivalent to the previous gsap inertia + elastic return).
  // returnDuration scales the period; resistance scales the damping.
  const omega = 2 * Math.PI / Math.max(returnDuration, 0.1)
  const damping = 2 * 0.3 * omega * (resistance / 750)

  const circlePath = useMemo(() => {
    if (typeof window === 'undefined') return null
    const p = new Path2D()
    p.arc(0, 0, dotSize / 2, 0, Math.PI * 2)
    return p
  }, [dotSize])

  const buildGrid = useCallback(() => {
    const wrap   = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const { width, height } = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width  = width  * dpr
    canvas.height = height * dpr
    canvas.style.width  = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)

    const cols  = Math.floor((width  + gap) / (dotSize + gap))
    const rows  = Math.floor((height + gap) / (dotSize + gap))
    const cell  = dotSize + gap
    const startX = (width  - (cell * cols - gap)) / 2 + dotSize / 2
    const startY = (height - (cell * rows - gap)) / 2 + dotSize / 2

    const dots: Dot[] = []
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        dots.push({ cx: startX + x * cell, cy: startY + y * cell, xOffset: 0, yOffset: 0, vx: 0, vy: 0, _active: false })
      }
    }
    dotsRef.current = dots
  }, [dotSize, gap])

  // Draw loop — integrates the spring physics, then paints.
  useEffect(() => {
    if (!circlePath) return
    let rafId: number
    let lastT = 0
    const proxSq = proximity * proximity

    const draw = (t: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dt = Math.min(lastT ? (t - lastT) / 1000 : 0.016, 0.032)
      lastT = t
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const { x: px, y: py } = pointerRef.current

      for (const dot of dotsRef.current) {
        if (dot._active) {
          dot.vx += (-omega * omega * dot.xOffset - damping * dot.vx) * dt
          dot.vy += (-omega * omega * dot.yOffset - damping * dot.vy) * dt
          dot.xOffset += dot.vx * dt
          dot.yOffset += dot.vy * dt
          if (Math.abs(dot.xOffset) < 0.1 && Math.abs(dot.yOffset) < 0.1 &&
              Math.abs(dot.vx) < 1 && Math.abs(dot.vy) < 1) {
            dot.xOffset = 0; dot.yOffset = 0; dot.vx = 0; dot.vy = 0; dot._active = false
          }
        }

        const dx  = dot.cx - px
        const dy  = dot.cy - py
        const dsq = dx * dx + dy * dy

        let fill = baseColor
        if (dsq <= proxSq) {
          const t2 = 1 - Math.sqrt(dsq) / proximity
          fill = `rgb(${Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t2)},${Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t2)},${Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t2)})`
        }

        ctx.save()
        ctx.translate(dot.cx + dot.xOffset, dot.cy + dot.yOffset)
        ctx.fillStyle = fill
        ctx.fill(circlePath)
        ctx.restore()
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [proximity, baseColor, activeRgb, baseRgb, circlePath, omega, damping])

  // Grid build + resize.
  useEffect(() => {
    buildGrid()
    const ro = new ResizeObserver(buildGrid)
    if (wrapperRef.current) ro.observe(wrapperRef.current)
    return () => ro.disconnect()
  }, [buildGrid])

  // Pointer tracking + impulse on fast move + click shockwave.
  // Listens on window so dots react even though canvas has pointer-events: none.
  useEffect(() => {
    // Velocity that makes an underdamped spring peak roughly at `offset`.
    const kick = (dot: Dot, offsetX: number, offsetY: number) => {
      dot._active = true
      dot.vx += offsetX * omega
      dot.vy += offsetY * omega
    }

    const onMove = (e: MouseEvent) => {
      const now = performance.now()
      const pr  = pointerRef.current
      const dt  = pr.lastTime ? now - pr.lastTime : 16
      let vx    = ((e.clientX - pr.lastX) / dt) * 1000
      let vy    = ((e.clientY - pr.lastY) / dt) * 1000
      let speed = Math.hypot(vx, vy)
      if (speed > maxSpeed) { const s = maxSpeed / speed; vx *= s; vy *= s; speed = maxSpeed }

      pr.lastTime = now; pr.lastX = e.clientX; pr.lastY = e.clientY
      pr.vx = vx; pr.vy = vy; pr.speed = speed

      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      pr.x = e.clientX - rect.left
      pr.y = e.clientY - rect.top

      if (speed <= speedTrigger) return
      for (const dot of dotsRef.current) {
        if (Math.hypot(dot.cx - pr.x, dot.cy - pr.y) < proximity && !dot._active) {
          kick(dot, dot.cx - pr.x + vx * 0.005, dot.cy - pr.y + vy * 0.005)
        }
      }
    }

    const onClick = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx   = e.clientX - rect.left
      const cy   = e.clientY - rect.top
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy)
        if (dist < shockRadius && !dot._active) {
          const falloff = Math.max(0, 1 - dist / shockRadius)
          kick(dot, (dot.cx - cx) * shockStrength * falloff, (dot.cy - cy) * shockStrength * falloff)
        }
      }
    }

    const throttledMove = throttle(onMove as (...args: unknown[]) => void, 50) as unknown as (e: MouseEvent) => void
    window.addEventListener('mousemove', throttledMove, { passive: true })
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('mousemove', throttledMove)
      window.removeEventListener('click', onClick)
    }
  }, [maxSpeed, speedTrigger, proximity, shockRadius, shockStrength, omega])

  return (
    <section className={`dot-grid ${className}`} style={style}>
      <div ref={wrapperRef} className="dot-grid__wrap">
        <canvas ref={canvasRef} className="dot-grid__canvas" />
      </div>
    </section>
  )
}
