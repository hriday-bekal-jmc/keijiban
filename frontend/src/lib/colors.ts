const AVATAR_COLORS = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090']

export function colorFor(id: string): string {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[n]
}
