import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLooksLiveOnPlatform,
  shouldExcludeAccountFromNewPublishToday,
  annotateAccountsWithDayAttempts,
  buildDuplicateAccountSummary,
  filterSocialAccountIdsAlreadyLiveToday,
} from '../src/utils/accountDayUsage.js';

describe('accountDayUsage — duplicate detection', () => {
  it('failed + platformPostId counts as live (Outstand failed-but-live)', () => {
    const acc = {
      status: 'failed',
      platformPostId: '17952452178142844',
      network: 'instagram',
      username: 'tiaemng',
    };
    assert.equal(accountLooksLiveOnPlatform(acc), true);
    assert.equal(shouldExcludeAccountFromNewPublishToday(acc), true);
  });

  it('filterSocialAccountIdsAlreadyLiveToday blocks @tiaemng (ErFTA failed-but-live)', () => {
    const ids = filterSocialAccountIdsAlreadyLiveToday(
      ['KUnp9', 'T7ck1'],
      [
        {
          accountId: 'KUnp9',
          network: 'instagram',
          username: 'tiaemng',
          status: 'failed',
          platformPostId: '17952452178142844',
        },
      ]
    );
    assert.deepEqual(ids, ['T7ck1']);
  });

  it('marks second post same day as duplicate', () => {
    const rows = [
      {
        network: 'instagram',
        username: 'tiaemng',
        postId: 'ErFTA',
        status: 'published',
        rowTimestamp: '2026-05-30T08:00:00Z',
      },
      {
        network: 'instagram',
        username: 'tiaemng',
        postId: '7it8W',
        status: 'published',
        rowTimestamp: '2026-05-30T10:00:00Z',
      },
    ];
    const annotated = annotateAccountsWithDayAttempts(rows);
    assert.equal(annotated[0].isDuplicate, false);
    assert.equal(annotated[1].isDuplicate, true);
    assert.equal(annotated[1].isRiskyDuplicate, true);
    const summary = buildDuplicateAccountSummary(annotated);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].username, 'tiaemng');
    assert.ok(summary[0].count >= 2);
  });

  it('failed-only retries do not inflate REKAP duplicate count', () => {
    const rows = [
      {
        network: 'instagram',
        username: 'tiaemng',
        postId: 'A1',
        status: 'failed',
        rowTimestamp: '2026-05-30T08:00:00Z',
      },
      {
        network: 'instagram',
        username: 'tiaemng',
        postId: 'A2',
        status: 'failed',
        rowTimestamp: '2026-05-30T10:00:00Z',
      },
    ];
    const annotated = annotateAccountsWithDayAttempts(rows);
    assert.equal(annotated[1].isDuplicate, true);
    assert.equal(annotated[1].isRiskyDuplicate, false);
    assert.equal(buildDuplicateAccountSummary(annotated).length, 0);
  });
});
