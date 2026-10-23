export interface AuthenticatedUser {
  isAdmin: boolean;
  id: string;
  email: string;
  displayName: string;
}
