function Pulse({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className ?? ''}`}
      style={{ background: '#E4D4B8', ...style }}
    />
  )
}

export function PostCardSkeleton() {
  return (
    <div className="mb-3.5 overflow-hidden" style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', borderRadius: 12 }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Pulse className="w-9 h-9 !rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-2">
          <Pulse className="h-3 w-28 !rounded-full" />
          <Pulse className="h-2.5 w-44 !rounded-full" />
        </div>
        <Pulse className="h-5 w-14 !rounded-full" />
      </div>

      {/* Image / content area */}
      <Pulse style={{ height: 240, borderRadius: 0, borderTop: '1px solid #E4D4B8', borderBottom: '1px solid #E4D4B8' }} />

      {/* Action bar */}
      <div className="flex gap-4 items-center px-3.5 pt-3 pb-1.5">
        <Pulse className="w-6 h-6 !rounded-full" />
        <Pulse className="w-6 h-6 !rounded-full" />
        <Pulse className="w-6 h-6 !rounded-full" />
      </div>

      {/* Text */}
      <div className="px-3.5 pb-4 flex flex-col gap-2 mt-1">
        <Pulse className="h-3 w-16 !rounded-full" />
        <Pulse className="h-3 w-full !rounded-full" />
        <Pulse className="h-3 w-5/6 !rounded-full" />
      </div>
    </div>
  )
}

export function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 rounded-2xl" style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}>
      <Pulse className="w-11 h-11 !rounded-full flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <Pulse className="h-3 w-3/4 !rounded-full" />
        <Pulse className="h-3 w-1/2 !rounded-full" />
        <Pulse className="h-2.5 w-24 !rounded-full" />
      </div>
    </div>
  )
}
