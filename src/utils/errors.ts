import type { SwiggyService } from "../types/mcp.types.js";

export class SwiggyMcpError extends Error {
  constructor(
    message: string,
    public readonly service: SwiggyService,
    public readonly toolName?: string,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "SwiggyMcpError";
  }
}

export class AuthenticationRequiredError extends Error {
  constructor(
    public readonly userId: number,
    public readonly service: SwiggyService,
  ) {
    super(`User ${userId} not authenticated for ${service}`);
    this.name = "AuthenticationRequiredError";
  }
}

export class IntentParsingError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = "IntentParsingError";
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly userId: number,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limit exceeded for user ${userId}`);
    this.name = "RateLimitError";
  }
}
