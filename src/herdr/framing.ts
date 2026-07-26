import { StringDecoder } from 'node:string_decoder';

import { HerdrProtocolError } from './errors.ts';

/** 16 MiB. A pane read of a long scrollback is the largest thing herdr sends. */
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export interface NdjsonDecoderOptions {
  /**
   * Cap on a single unterminated frame. A peer that never sends a newline would
   * otherwise grow the buffer without bound.
   */
  readonly maxFrameBytes?: number;
}

/**
 * Turns a byte stream into herdr messages.
 *
 * herdr frames both replies and events as newline-delimited JSON, and a socket
 * read boundary has nothing to do with a frame boundary: one reply can arrive
 * across several reads, and a burst of events can arrive in one. This decoder is
 * the single place that difference is reconciled, so neither the request path
 * nor the event path has to think about it.
 */
export class NdjsonDecoder {
  readonly #maxFrameBytes: number;
  readonly #utf8 = new StringDecoder('utf8');
  #pending = '';

  constructor(options: NdjsonDecoderOptions = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  /** Feeds a socket read in, and returns whatever messages it completed. */
  push(chunk: Buffer): Record<string, unknown>[] {
    // Decode before splitting: a multi-byte character can straddle a read, and
    // StringDecoder holds the incomplete tail back for us.
    this.#pending += this.#utf8.write(chunk);

    const messages: Record<string, unknown>[] = [];
    let newlineAt = this.#pending.indexOf('\n');
    while (newlineAt !== -1) {
      const frame = this.#pending.slice(0, newlineAt);
      this.#pending = this.#pending.slice(newlineAt + 1);
      const message = parseFrame(frame);
      if (message !== undefined) messages.push(message);
      newlineAt = this.#pending.indexOf('\n');
    }

    if (Buffer.byteLength(this.#pending, 'utf8') > this.#maxFrameBytes) {
      this.#pending = '';
      throw new HerdrProtocolError(
        `herdr sent more than ${String(this.#maxFrameBytes)} bytes without terminating a frame`,
      );
    }

    return messages;
  }

  /**
   * Declares the stream over. Throws if bytes were left mid-frame — a truncated
   * frame is a dropped message, and silently discarding it would let a caller
   * wait forever for a reply that will never be decoded.
   */
  end(): void {
    const trailing = this.#pending + this.#utf8.end();
    this.#pending = '';
    if (trailing.trim() !== '') {
      throw new HerdrProtocolError('herdr closed the connection mid-frame');
    }
  }
}

function parseFrame(frame: string): Record<string, unknown> | undefined {
  const text = frame.trimEnd();
  if (text === '') return undefined;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new HerdrProtocolError(`herdr sent a frame that is not JSON: ${truncate(text)}`, {
      cause,
    });
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HerdrProtocolError(`herdr sent a frame that is not a JSON object: ${truncate(text)}`);
  }

  return value as Record<string, unknown>;
}

function truncate(text: string): string {
  return text.length <= 120 ? text : `${text.slice(0, 120)}…`;
}
