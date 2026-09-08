export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface StoredUser extends AuthenticatedUser {
  passwordHash: string;
  isActive: boolean;
}

export interface CreatedSession {
  user: AuthenticatedUser;
  token: string;
  tokenHash: string;
}
