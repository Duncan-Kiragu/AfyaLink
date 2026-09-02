export class AiConfigurationError extends Error {
  override readonly name = "AiConfigurationError";
}

export class AiPiiBlockedError extends Error {
  override readonly name = "AiPiiBlockedError";

  constructor(message = "PII redaction failed; refusing to send unredacted text to Claude") {
    super(message);
  }
}

export class AiOutputInvalidError extends Error {
  override readonly name = "AiOutputInvalidError";
}

export class AiSessionContextMissingError extends Error {
  override readonly name = "AiSessionContextMissingError";

  constructor(method: string) {
    super(`${method} requires a SessionContextReader`);
  }
}
