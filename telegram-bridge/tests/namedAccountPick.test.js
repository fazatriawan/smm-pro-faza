import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNamedPickCommand,
  looksLikeNamedPick,
  resolveNamedPick,
  formatAccountListReport,
} from '../src/utils/namedAccountPick.js';

const ACCOUNTS = [
  { id: '1', network: 'instagram', username: 'tiaemng' },
  { id: '2', network: 'instagram', username: 'akun2' },
  { id: '3', network: 'facebook', username: 'page1' },
  { id: '4', network: 'threads', username: 'tiaemng' },
];

test('parseNamedPickCommand — scoped by platform', () => {
  const p = parseNamedPickCommand('ig tiaemng akun2');
  assert.deepEqual(p?.scoped?.instagram, ['tiaemng', 'akun2']);
  assert.deepEqual(p?.global, []);
});

test('parseNamedPickCommand — colon format', () => {
  const p = parseNamedPickCommand('ig: tiaemng, akun2');
  assert.deepEqual(p?.scoped?.instagram, ['tiaemng', 'akun2']);
});

test('parseNamedPickCommand — FB names with spaces via @', () => {
  const p = parseNamedPickCommand(
    'fb: @Celestine Mita @husna nandita\nig: aldiiwaklohan, b77446977'
  );
  assert.deepEqual(p?.scoped?.facebook, ['Celestine Mita', 'husna nandita']);
  assert.deepEqual(p?.scoped?.instagram, ['aldiiwaklohan', 'b77446977']);
});

test('parseNamedPickCommand — fb without colon, names with spaces', () => {
  const p = parseNamedPickCommand(
    'fb @Celestine Mita @husna nandita @Desy Isabelle\n' +
      'ig @korotulayunn @ratnatenna46\n' +
      'threads @b77446977'
  );
  assert.deepEqual(p?.scoped?.facebook, [
    'Celestine Mita',
    'husna nandita',
    'Desy Isabelle',
  ]);
  assert.deepEqual(p?.scoped?.instagram, ['korotulayunn', 'ratnatenna46']);
  assert.deepEqual(p?.scoped?.threads, ['b77446977']);
});

test('parseNamedPickCommand — single line fb @ names without colon', () => {
  const p = parseNamedPickCommand(
    'fb @Celestine Mita @husna nandita ig @korotulayunn threads @b77446977'
  );
  assert.deepEqual(p?.scoped?.facebook, ['Celestine Mita', 'husna nandita']);
  assert.deepEqual(p?.scoped?.instagram, ['korotulayunn']);
  assert.deepEqual(p?.scoped?.threads, ['b77446977']);
});

test('parseNamedPickCommand — force keyword not treated as username', () => {
  const p = parseNamedPickCommand(
    'threads: @mejorusak292 @rizqiboyyah003 force'
  );
  assert.equal(p?.force, true);
  assert.deepEqual(p?.scoped?.threads, ['mejorusak292', 'rizqiboyyah003']);
});

test('parseNamedPickCommand — platform header then names on next line', () => {
  const p = parseNamedPickCommand(
    'fb: @Celestine Mita\nthreads:\n@aldiiwaklohan @b77446977 force'
  );
  assert.deepEqual(p?.scoped?.facebook, ['Celestine Mita']);
  assert.deepEqual(p?.scoped?.threads, ['aldiiwaklohan', 'b77446977']);
  assert.equal(p?.force, true);
});

test('parseNamedPickCommand — force on multiline pick', () => {
  const p = parseNamedPickCommand(
    'ig: aldiiwaklohan\nthreads: rizqiboyyah003 force'
  );
  assert.equal(p?.force, true);
  assert.deepEqual(p?.scoped?.instagram, ['aldiiwaklohan']);
  assert.deepEqual(p?.scoped?.threads, ['rizqiboyyah003']);
});

test('parseNamedPickCommand — FB names with spaces via comma', () => {
  const p = parseNamedPickCommand('fb: Celestine Mita, husna nandita');
  assert.deepEqual(p?.scoped?.facebook, ['Celestine Mita', 'husna nandita']);
});

test('parseNamedPickCommand — does not parse random counts', () => {
  assert.equal(parseNamedPickCommand('ig 22 fb 22'), null);
});

test('looksLikeNamedPick vs random', () => {
  assert.equal(looksLikeNamedPick('ig tiaemng akun2'), true);
  assert.equal(looksLikeNamedPick('ig 22 fb 22'), false);
  assert.equal(looksLikeNamedPick('/pick ig user1'), true);
});

test('resolveNamedPick — scoped and global', () => {
  const scoped = resolveNamedPick(ACCOUNTS, {
    scoped: { instagram: ['tiaemng', 'akun2'] },
    global: [],
  });
  assert.deepEqual(scoped.accountIds, ['1', '2']);
  assert.equal(scoped.notFound.length, 0);

  const global = resolveNamedPick(ACCOUNTS, {
    scoped: {},
    global: ['page1'],
  });
  assert.deepEqual(global.accountIds, ['3']);
});

test('resolveNamedPick — FB double space in Outstand username', () => {
  const accounts = [
    { id: '1', network: 'facebook', username: 'Intania  Aisyah' },
    { id: '2', network: 'facebook', username: 'Kezia Zafira' },
  ];
  const r = resolveNamedPick(accounts, {
    scoped: { facebook: ['Intania Aisyah', 'Kezia Zafira'] },
    global: [],
  });
  assert.deepEqual(r.accountIds, ['1', '2']);
});

test('resolveNamedPick — ambiguous username across platforms', () => {
  const r = resolveNamedPick(ACCOUNTS, { scoped: {}, global: ['tiaemng'] });
  assert.equal(r.picked.length, 0);
  assert.equal(r.ambiguous.length, 1);
});

test('formatAccountListReport — grouped output', () => {
  const text = formatAccountListReport(ACCOUNTS);
  assert.match(text, /\*IG\*/);
  assert.match(text, /@tiaemng/);
  assert.match(text, /Copy \/pick:/);
});
