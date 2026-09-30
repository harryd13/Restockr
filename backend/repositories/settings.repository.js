import { COLLECTIONS } from "../config.js";

export function createSettingsRepository(database) {
  return {
    settings: () => database.collection(COLLECTIONS.SETTINGS)
  };
}

