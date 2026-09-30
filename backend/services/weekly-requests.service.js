export function createWeeklyRequestsService(repository) {
  return {
    database: {
      collection(name) {
        return repository.collection(name);
      }
    }
  };
}

