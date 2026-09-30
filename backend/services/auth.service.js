export function createAuthService(repository) {
  return { get database() { return repository.database; } };
}

