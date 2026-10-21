// Thrown by a provider when a model can't serve the request. cooldownMs = how long to skip it.
export class ProviderError extends Error {
  constructor(message: string, public status: number, public cooldownMs: number) {
    super(message);
  }
}
