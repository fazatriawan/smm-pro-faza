import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyTestEnv } from './helpers/testEnv.js';
import {
  createRecordingOutstandClient,
  getPublishPostCalls,
} from './helpers/mockOutstandClient.js';

applyTestEnv();

const FIXTURE_ACCOUNTS = [
  { id: 'KUnp9', network: 'instagram', username: 'tiaemng' },
  { id: 'T7ck1', network: 'instagram', username: 'fadzillacandrasari' },
  { id: 'SH98J', network: 'instagram', username: 'adelatuko' },
  { id: 'abc12', network: 'threads', username: 'tiaemng' },
];

let publishBulk;
let clearSocialAccountsCache;
let seedSocialAccountsCacheForTests;
let setOutstandClientForTests;
let resetOutstandClientForTests;
let filterSocialAccountIdsAlreadyLiveToday;

before(async () => {
  const outstand = await import('../src/services/outstand.js');
  publishBulk = outstand.publishBulk;
  clearSocialAccountsCache = outstand.clearSocialAccountsCache;
  seedSocialAccountsCacheForTests = outstand.seedSocialAccountsCacheForTests;
  setOutstandClientForTests = outstand.setOutstandClientForTests;
  resetOutstandClientForTests = outstand.resetOutstandClientForTests;

  const dayUsage = await import('../src/utils/accountDayUsage.js');
  filterSocialAccountIdsAlreadyLiveToday =
    dayUsage.filterSocialAccountIdsAlreadyLiveToday;
});

beforeEach(() => {
  clearSocialAccountsCache();
  resetOutstandClientForTests();
  seedSocialAccountsCacheForTests(FIXTURE_ACCOUNTS);
});

after(() => {
  resetOutstandClientForTests();
  clearSocialAccountsCache();
});

const MEDIA = {
  instagram: [{ id: 'media-ig-1', url: 'https://cdn.test/qurban.jpg', filename: 'qurban.jpg' }],
  threads: [{ id: 'media-th-1', url: 'https://cdn.test/qurban.jpg', filename: 'qurban.jpg' }],
};

describe('publishBulk integration (mock POST /v1/posts)', () => {
  it('sends one POST per platform with unique accounts[]', async () => {
    const mock = createRecordingOutstandClient({
      postIds: ['ErFTA', 'th001'],
    });
    setOutstandClientForTests(mock);

    const result = await publishBulk({
      baseCaption: 'QURBAN campaign',
      mediaByNetwork: MEDIA,
      socialAccountIds: [
        'KUnp9',
        'KUnp9',
        'T7ck1',
        'SH98J',
        'abc12',
      ],
    });

    const posts = getPublishPostCalls(mock.calls);
    assert.equal(posts.length, 2, 'instagram + threads');
    assert.equal(result.batchCount, 2);
    assert.equal(result.postIds.length, 2);

    const igCall = posts.find((p) =>
      p.data.accounts.includes('KUnp9')
    );
    const thCall = posts.find((p) => p.data.accounts.includes('abc12'));
    assert.ok(igCall, 'instagram batch');
    assert.ok(thCall, 'threads batch');

    const igAccounts = igCall.data.accounts;
    assert.equal(new Set(igAccounts).size, igAccounts.length, 'unique IG ids');
    assert.equal(igAccounts.filter((id) => id === 'KUnp9').length, 1);
    assert.deepEqual(
      [...igAccounts].sort(),
      ['KUnp9', 'SH98J', 'T7ck1'].sort()
    );
    assert.deepEqual(thCall.data.accounts, ['abc12']);
  });

  it('@tiaemng failed-but-live: exclude KUnp9 before publish → only other IG in payload', async () => {
    const todayFromErFTA = [
      {
        accountId: 'KUnp9',
        network: 'instagram',
        username: 'tiaemng',
        status: 'failed',
        platformPostId: '17952452178142844',
        postId: 'ErFTA',
      },
    ];

    const selected = ['KUnp9', 'T7ck1', 'SH98J'];
    const allowed = filterSocialAccountIdsAlreadyLiveToday(
      selected,
      todayFromErFTA
    );
    assert.deepEqual(allowed, ['T7ck1', 'SH98J']);

    const mock = createRecordingOutstandClient({ postIds: ['7it8W'] });
    setOutstandClientForTests(mock);

    await publishBulk({
      baseCaption: 'QURBAN',
      mediaByNetwork: { instagram: MEDIA.instagram },
      socialAccountIds: allowed,
    });

    const posts = getPublishPostCalls(mock.calls);
    assert.equal(posts.length, 1);
    const accounts = posts[0].data.accounts;
    assert.ok(!accounts.includes('KUnp9'), 'tiaemng must not be re-published');
    assert.deepEqual([...accounts].sort(), ['SH98J', 'T7ck1'].sort());
  });

  it('@tiaemng published today is also excluded from a new batch', async () => {
    const today = [
      {
        accountId: 'KUnp9',
        network: 'instagram',
        username: 'tiaemng',
        status: 'published',
        platformPostId: '17913714858395065',
        postId: 'ew0Tr',
      },
    ];
    const allowed = filterSocialAccountIdsAlreadyLiveToday(['KUnp9', 'T7ck1'], today);
    assert.deepEqual(allowed, ['T7ck1']);
  });
});
