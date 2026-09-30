export function createSettingsService(repository) {
  return {
    database: {
      collection(name) {
        return repository.collection(name);
      }
    }
  };
}

