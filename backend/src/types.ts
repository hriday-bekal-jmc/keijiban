import type { Request } from 'express'

export interface AuthUser {
  id: string
  email: string
  role: 'member' | 'admin'
  departmentId: string
  canPost: boolean
}

export interface RequestWithUser extends Request {
  user: AuthUser
}
