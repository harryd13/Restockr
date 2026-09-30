export function createDailyRequestsService(repository) {
  return {
    database: {
      collection(name) {
        return repository.collection(name);
      }
    }
  };
}

