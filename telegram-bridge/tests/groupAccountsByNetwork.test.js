import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupAccountsByNetwork,
  uniqueResolvedAccountIds,
} from '../src/utils/groupAccountsByNetwork.js';

const ALL = [
  { id: 'KUnp9', network: 'instagram', username: 'tiaemng' },
  { id: 'T7ck1', network: 'instagram', username: 'fadzillacandrasari' },
  { id: 'abc12', network: 'threads', username: 'tiaemng' },
];

describe('groupAccountsByNetwork', () => {
  it('deduplicates duplicate IDs in one publish list', () => {
    const ids = ['KUnp9', 'KUnp9', 'T7ck1'];
    const byNet = groupAccountsByNetwork(ids, ALL);
    assert.equal(byNet.instagram.length, 2);
    assert.equal(byNet.instagram.filter((a) => a.id === 'KUnp9').length, 1);
  });

  it('splits platforms for one POST per network', () => {
    const byNet = groupAccountsByNetwork(['KUnp9', 'abc12'], ALL);
    assert.equal(byNet.instagram.length, 1);
    assert.equal(byNet.threads.length, 1);
  });

  it('ignores unknown account IDs', () => {
    const byNet = groupAccountsByNetwork(['KUnp9', 'UNKNOWN'], ALL);
    assert.equal(byNet.instagram.length, 1);
  });
});

describe('uniqueResolvedAccountIds', () => {
  it('returns each valid ID once', () => {
    const u = uniqueResolvedAccountIds(['KUnp9', 'KUnp9', 'T7ck1', 'bad'], ALL);
    assert.deepEqual(u, ['KUnp9', 'T7ck1']);
  });
});
