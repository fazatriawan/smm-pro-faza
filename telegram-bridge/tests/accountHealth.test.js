import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAkunCommandArgs,
  mapListAccountFields,
  summarizeListConnection,
  summarizeHealthApi,
  summarizePublishFailure,
  buildTodayFailureMap,
  buildAccountIssueMap,
  formatHealthAttentionBlock,
  issueBadge,
} from '../src/utils/accountHealth.js';

test('parseAkunCommandArgs — check keyword', () => {
  const a = parseAkunCommandArgs('ig fb check');
  assert.equal(a.deepCheck, true);
  assert.equal(a.filterText, 'ig fb');

  const b = parseAkunCommandArgs('fb');
  assert.equal(b.deepCheck, false);
  assert.equal(b.filterText, 'fb');
});

test('mapListAccountFields — isActive', () => {
  assert.equal(mapListAccountFields({ isActive: 1 }).isActive, true);
  assert.equal(mapListAccountFields({ isActive: 0 }).isActive, false);
  assert.equal(mapListAccountFields({}).isActive, true);
});

test('summarizeListConnection — inactive', () => {
  const issue = summarizeListConnection({ isActive: false });
  assert.equal(issue?.code, 'inactive');
});

test('summarizeHealthApi — token', () => {
  const issue = summarizeHealthApi({
    healthy: false,
    errorCode: 'unauthorized',
  });
  assert.equal(issue?.code, 'token');
});

test('summarizePublishFailure — FB media URL', () => {
  const issue = summarizePublishFailure(
    'Unable to fetch video file from URL'
  );
  assert.equal(issue?.code, 'fb_media');
  assert.match(issue?.action || '', /Outstand/i);
});

test('summarizePublishFailure — FB photo 400', () => {
  const issue = summarizePublishFailure(
    'publishing post to Facebook: Failed to upload Facebook photo: 400 - Invalid parameter'
  );
  assert.equal(issue?.code, 'fb_photo');
});

test('formatHealthAttentionBlock — groups many accounts', () => {
  const accounts = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    network: 'facebook',
    username: `user${i}`,
  }));
  const failuresById = new Map(
    accounts.map((a) => [
      a.id,
      {
        error:
          'Failed to upload Facebook video: 400 - Unable to fetch video file from URL',
      },
    ])
  );
  const issueMap = buildAccountIssueMap(accounts, { failuresById });
  const text = formatHealthAttentionBlock(accounts, issueMap, {
    maxDetailRows: 5,
  });
  assert.match(text, /Ringkasan masalah/);
  assert.match(text, /10 akun/);
  assert.doesNotMatch(text, /user9.*user9/);
});

test('buildTodayFailureMap', () => {
  const map = buildTodayFailureMap([
    { accountId: 'a1', status: 'failed', error: 'token expired' },
    { accountId: 'a1', status: 'failed', error: 'token expired' },
    { accountId: 'a2', status: 'published' },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get('a1')?.failedCount, 2);
});

test('issueBadge', () => {
  assert.equal(issueBadge({ level: 'bad', code: 'x', label: 'y' }), ' 🔴');
  assert.equal(issueBadge({ level: 'warn', code: 'x', label: 'y' }), ' 🟡');
  assert.equal(issueBadge(null), '');
});
