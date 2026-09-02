export class PiiRedactionFailedError extends Error {
  override readonly name = "PiiRedactionFailedError";

  constructor(
    message = "PII redaction failed; refusing to continue with unredacted data",
  ) {
    super(message);
  }
}
