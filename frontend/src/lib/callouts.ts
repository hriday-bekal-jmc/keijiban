interface CalloutStyle {
  bg: string
  border: string
  text: string
  icon: string
}

export const CALLOUT_STYLES: Record<string, CalloutStyle> = {
  info:    { bg: '#D8EAF8', border: '#1E5FA8', text: '#0F3060', icon: 'ℹ️' },
  warning: { bg: '#FDE8D0', border: '#E8732A', text: '#7A2A00', icon: '⚠️' },
  success: { bg: '#D6F0E4', border: '#1A7A48', text: '#0A3A20', icon: '✅' },
  danger:  { bg: '#F8D8D8', border: '#A83030', text: '#5A0000', icon: '🚫' },
}
