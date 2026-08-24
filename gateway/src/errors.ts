export class AgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export function normalizeError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error;
  }
  return new AgentError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
}
