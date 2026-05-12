// Endlesss session credentials returned by /auth/login. `token` and `password`
// are NOT the user's login credentials — they're a CouchDB keypair the auth
// service mints for the session. Reused for both Basic (CouchDB) and Bearer
// (web API) auth headers until `expiresAt` passes.
export interface AuthSession {
  token: string;
  password: string;
  userId: string;
  expiresAt: number;
}
