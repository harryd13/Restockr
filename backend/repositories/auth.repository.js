import { COLLECTIONS } from "../config.js";

export function createAuthRepository(getDb) {
  return { users: () => getDb().collection(COLLECTIONS.USERS) };
}
