import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashWebhookBody,
  markIfNew,
  _resetForTests,
} from '../src/utils/webhookDedup.js';

describe('webhookDedup', () => {
  beforeEach(() => _resetForTests());

  it('same body hash is duplicate within TTL', () => {
    const body = '{"event":"post.published","data":{"id":"ErFTA"}}';
    const key = hashWebhookBody(body);
    assert.equal(markIfNew(key), true);
    assert.equal(markIfNew(key), false);
  });

  it('different bodies are not duplicates', () => {
    const a = hashWebhookBody('{"id":1}');
    const b = hashWebhookBody('{"id":2}');
    assert.equal(markIfNew(a), true);
    assert.equal(markIfNew(b), true);
  });
});
