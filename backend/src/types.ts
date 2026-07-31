import type { Request } from 'express'

export interface AuthUser {
  id: string
  email: string
  role: 'member' | 'admin'
  departmentId: string
  /** Optional: sessions issued before branches existed have no branch claim,
   *  and a user may legitimately be unassigned. Null means "sees 全社 posts
   *  only", never "sees everything". */
  branchId: string | null
  canPost: boolean
}

export interface RequestWithUser extends Request {
  user: AuthUser
}
