export function createMiscRequestsService(repository) {
  return {
    database: {
      collection(name) {
        return repository.collection(name);
      }
    }
  };
}

