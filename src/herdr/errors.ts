/**
 * Every failure the herdr client surfaces is one of these. The Orchestrator has
 * no model and cannot interpret prose, so a failure has to be branchable: the
 * class says what kind of thing went wrong, and `code` carries herdr's own
 * error code where there is one.
 */
export class HerdrError extends Error {
  override readonly name: string = 'HerdrError';
}

/** The peer said something that is not the herdr protocol. */
export class HerdrProtocolError extends HerdrError {
  override readonly name = 'HerdrProtocolError';
}

/** The socket could not be reached, or the connection dropped mid-exchange. */
export class HerdrConnectionError extends HerdrError {
  override readonly name = 'HerdrConnectionError';
}

/** herdr answered with an `error` envelope. `code` is herdr's own error code. */
export class HerdrRequestError extends HerdrError {
  override readonly name = 'HerdrRequestError';
  readonly code: string;
  readonly method: string;

  constructor(code: string, message: string, method: string) {
    super(`${method} failed: ${code}: ${message}`);
    this.code = code;
    this.method = method;
  }
}

/** A request outlived its deadline. Never a silent hang. */
export class HerdrTimeoutError extends HerdrError {
  override readonly name = 'HerdrTimeoutError';
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.timeoutMs = timeoutMs;
  }
}
