import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NdjsonDecoder } from '../src/herdr/framing.ts';
import { HerdrProtocolError } from '../src/herdr/errors.ts';

test('yields one message per newline-terminated frame', () => {
  const decoder = new NdjsonDecoder();

  assert.deepEqual(decoder.push(Buffer.from('{"id":"a"}\n')), [{ id: 'a' }]);
});

test('withholds a message until its terminating newline arrives', () => {
  const decoder = new NdjsonDecoder();

  assert.deepEqual(decoder.push(Buffer.from('{"id":"a"}')), []);
  assert.deepEqual(decoder.push(Buffer.from('\n')), [{ id: 'a' }]);
});

test('reassembles a message split across many reads', () => {
  const decoder = new NdjsonDecoder();
  const message = '{"id":"a","result":{"type":"pong","protocol":17}}\n';

  const collected: Record<string, unknown>[] = [];
  for (let index = 0; index < message.length; index += 1) {
    collected.push(...decoder.push(Buffer.from(message.slice(index, index + 1))));
  }

  assert.deepEqual(collected, [{ id: 'a', result: { type: 'pong', protocol: 17 } }]);
});

test('yields every message when several arrive in one read', () => {
  const decoder = new NdjsonDecoder();

  const messages = decoder.push(Buffer.from('{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n'));

  assert.deepEqual(messages, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('yields the complete messages in a read and holds back the partial tail', () => {
  const decoder = new NdjsonDecoder();

  assert.deepEqual(decoder.push(Buffer.from('{"id":"a"}\n{"id":"b"}\n{"id":')), [
    { id: 'a' },
    { id: 'b' },
  ]);
  assert.deepEqual(decoder.push(Buffer.from('"c"}\n')), [{ id: 'c' }]);
});

test('reassembles a multi-byte character split across reads', () => {
  const decoder = new NdjsonDecoder();
  const encoded = Buffer.from('{"label":"café ✅"}\n', 'utf8');

  const collected = [
    ...decoder.push(encoded.subarray(0, 15)),
    ...decoder.push(encoded.subarray(15)),
  ];

  assert.deepEqual(collected, [{ label: 'café ✅' }]);
});

test('skips blank frames and tolerates CRLF terminators', () => {
  const decoder = new NdjsonDecoder();

  assert.deepEqual(decoder.push(Buffer.from('\n{"id":"a"}\r\n\r\n{"id":"b"}\n')), [
    { id: 'a' },
    { id: 'b' },
  ]);
});

test('rejects a frame that is not valid JSON', () => {
  const decoder = new NdjsonDecoder();

  assert.throws(() => decoder.push(Buffer.from('not json\n')), HerdrProtocolError);
});

test('rejects a frame that is valid JSON but not an object', () => {
  const decoder = new NdjsonDecoder();

  assert.throws(() => decoder.push(Buffer.from('"a bare string"\n')), HerdrProtocolError);
});

test('rejects an unterminated frame that grows past the size limit', () => {
  const decoder = new NdjsonDecoder({ maxFrameBytes: 32 });

  assert.throws(() => decoder.push(Buffer.from(`{"pad":"${'x'.repeat(64)}"}`)), HerdrProtocolError);
});

test('accepts frames up to the size limit', () => {
  const decoder = new NdjsonDecoder({ maxFrameBytes: 32 });

  assert.deepEqual(decoder.push(Buffer.from('{"pad":"xxxxxxxx"}\n')), [{ pad: 'xxxxxxxx' }]);
});

test('end() reports a truncated trailing frame', () => {
  const decoder = new NdjsonDecoder();
  decoder.push(Buffer.from('{"id":"a"}\n{"id":'));

  assert.throws(() => {
    decoder.end();
  }, HerdrProtocolError);
});

test('end() is silent when the stream ended on a frame boundary', () => {
  const decoder = new NdjsonDecoder();
  decoder.push(Buffer.from('{"id":"a"}\n'));

  assert.doesNotThrow(() => {
    decoder.end();
  });
});
