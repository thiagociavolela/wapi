import type { AuthUser } from "../modules/auth/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
      rawBody?: Buffer;
    }
  }
}

export {};
