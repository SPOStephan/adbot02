/** Session user shape (JWT-backed; no MySQL dependency). */
export type User = {
  id: number;
  openId: string;
  email: string;
  name: string;
  loginMethod: "password" | "adbot-sso";
  role: "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};
