// src/main/oauthHandlers.js
// Logika OAuth per platform: bangun URL + tukar code → token → simpan ke Supabase
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = 42813;
const REDIRECT = (platform) => `http://localhost:${PORT}/oauth/${platform}/callback`;

// ── Supabase & crypto (baca dari electron-store yg dikirim dari main) ─────────
let _supabase = null;
let _encKey   = null;

function init(supabaseUrl, supabaseKey, encryptionKeyHex) {
  _supabase = createClient(supabaseUrl, supabaseKey);
  _encKey   = Buffer.from(encryptionKeyHex, 'hex');
}

// Format: iv:authTag:ciphertext  (sama persis dengan worker/src/lib/crypto.js)
function encrypt(text) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _encKey, iv);
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

// ── Simpan / update akun di Supabase (manual upsert) ─────────────────────────
async function upsertAccount(fields) {
  // Cek apakah sudah ada
  const { data: existing } = await _supabase
    .from('social_accounts')
    .select('id')
    .eq('platform',     fields.platform)
    .eq('platform_uid', fields.platform_uid)
    .maybeSingle();

  if (existing) {
    // Update
    const { data, error } = await _supabase
      .from('social_accounts')
      .update(fields)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new Error(`Supabase update gagal: ${error.message}`);
    return data;
  } else {
    // Insert
    const { data, error } = await _supabase
      .from('social_accounts')
      .insert(fields)
      .select()
      .single();
    if (error) throw new Error(`Supabase insert gagal: ${error.message}`);
    return data;
  }
}

// ── Facebook / Instagram OAuth ────────────────────────────────────────────────
function buildFacebookUrl(appId) {
  const scope = [
    'pages_manage_posts',
    'pages_read_engagement',
    'pages_show_list',
    'instagram_basic',
    'instagram_content_publish',
  ].join(',');

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
  url.searchParams.set('client_id',     appId);
  url.searchParams.set('redirect_uri',  REDIRECT('facebook'));
  url.searchParams.set('scope',         scope);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function handleFacebookCallback(code, appId, appSecret) {
  // 1. Tukar code → short-lived token
  const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id',     appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri',  REDIRECT('facebook'));
  tokenUrl.searchParams.set('code',          code);

  const tokenRes  = await fetch(tokenUrl.toString());
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error?.message || 'Token exchange gagal');

  // 2. Tukar → long-lived token (60 hari)
  const llUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  llUrl.searchParams.set('grant_type',        'fb_exchange_token');
  llUrl.searchParams.set('client_id',         appId);
  llUrl.searchParams.set('client_secret',     appSecret);
  llUrl.searchParams.set('fb_exchange_token', tokenData.access_token);

  const llRes    = await fetch(llUrl.toString());
  const llData   = await llRes.json();
  const longToken = llData.access_token || tokenData.access_token;

  // 3. Info user
  const meRes  = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${longToken}`);
  const me     = await meRes.json();

  // 4. Daftar Pages
  const pagesRes  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${longToken}`);
  const pagesData = await pagesRes.json();
  const pages     = pagesData.data || [];

  const saved = [];

  for (const page of pages) {
    // Simpan Facebook Page
    const fbAcc = await upsertAccount({
      platform:     'facebook',
      username:     page.name,
      platform_uid: page.id,
      access_token: encrypt(page.access_token),
      is_active:    true,
    });
    saved.push({ ...fbAcc, _platform_label: `FB: ${page.name}` });

    // Cek Instagram Business Account linked ke page ini
    const igRes  = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    );
    const igData = await igRes.json();

    if (igData.instagram_business_account?.id) {
      const igId      = igData.instagram_business_account.id;
      const igInfoRes = await fetch(
        `https://graph.facebook.com/v19.0/${igId}?fields=id,name,username&access_token=${page.access_token}`
      );
      const igInfo = await igInfoRes.json();

      const igAcc = await upsertAccount({
        platform:     'instagram',
        username:     igInfo.username || igInfo.name || igId,
        platform_uid: igId,
        access_token: encrypt(page.access_token),
        is_active:    true,
      });
      saved.push({ ...igAcc, _platform_label: `IG: ${igInfo.username || igInfo.name}` });
    }
  }

  return { name: me.name, accounts: saved };
}

// ── Twitter OAuth 2.0 + PKCE ──────────────────────────────────────────────────
let _twCodeVerifier = null;

function buildTwitterUrl(clientId) {
  // PKCE
  _twCodeVerifier   = crypto.randomBytes(32).toString('base64url');
  const challenge   = crypto.createHash('sha256').update(_twCodeVerifier).digest('base64url');

  const url = new URL('https://twitter.com/i/oauth2/authorize');
  url.searchParams.set('response_type',          'code');
  url.searchParams.set('client_id',              clientId);
  url.searchParams.set('redirect_uri',           REDIRECT('twitter'));
  url.searchParams.set('scope',                  'tweet.read tweet.write users.read offline.access');
  url.searchParams.set('state',                  crypto.randomBytes(8).toString('hex'));
  url.searchParams.set('code_challenge',         challenge);
  url.searchParams.set('code_challenge_method',  'S256');
  return url.toString();
}

async function handleTwitterCallback(code, clientId, clientSecret) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  // Tukar code → token
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT('twitter'),
      code_verifier: _twCodeVerifier,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error_description || tokenData.error || 'Twitter token exchange gagal');

  // Info user
  const meRes  = await fetch('https://api.twitter.com/2/users/me', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });
  const meData = await meRes.json();
  const user   = meData.data;

  const acc = await upsertAccount({
    platform:      'twitter',
    username:      user.username || user.name,
    platform_uid:  user.id,
    access_token:  encrypt(tokenData.access_token),
    refresh_token: tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
    token_expires_at: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null,
    is_active: true,
  });

  return { name: user.name, accounts: [acc] };
}

// ── TikTok OAuth 2.0 (PKCE required) ─────────────────────────────────────────
let _tiktokCodeVerifier = null;

function buildTikTokUrl(clientKey) {
  // PKCE
  _tiktokCodeVerifier       = crypto.randomBytes(32).toString('base64url');
  const challenge           = crypto.createHash('sha256').update(_tiktokCodeVerifier).digest('base64url');

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key',            clientKey);
  url.searchParams.set('response_type',         'code');
  url.searchParams.set('scope',                 'user.info.basic');
  url.searchParams.set('redirect_uri',          REDIRECT('tiktok'));
  url.searchParams.set('state',                 crypto.randomBytes(8).toString('hex'));
  url.searchParams.set('code_challenge',        challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function handleTikTokCallback(code, clientKey, clientSecret) {
  // Tukar code → token (sertakan code_verifier untuk PKCE)
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key:    clientKey,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT('tiktok'),
      code_verifier: _tiktokCodeVerifier,
    }),
  });
  const tokenData = await tokenRes.json();

  // Handle both {error:{code,message}} and {error:"string", error_description:"..."}
  const errCode = tokenData.error?.code ?? tokenData.error;
  const errMsg  = tokenData.error?.message ?? tokenData.error_description;
  if (errCode && errCode !== 'ok') {
    throw new Error(errMsg || `TikTok token exchange gagal (${errCode})`);
  }

  const data = tokenData.data || tokenData;
  const { access_token, refresh_token, expires_in, open_id } = data;

  if (!access_token) {
    throw new Error(`TikTok: access_token tidak ditemukan. Response: ${JSON.stringify(tokenData)}`);
  }

  // Info user
  const infoRes = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
    { headers: { 'Authorization': `Bearer ${access_token}` } }
  );
  const infoData = await infoRes.json();
  const user     = infoData.data?.user || {};

  const acc = await upsertAccount({
    platform:        'tiktok',
    username:        user.display_name || user.username || open_id,
    platform_uid:    user.open_id || open_id,
    access_token:    encrypt(access_token),
    refresh_token:   refresh_token ? encrypt(refresh_token) : null,
    token_expires_at: expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null,
    is_active: true,
  });

  return { name: user.display_name || open_id, accounts: [acc] };
}

// ── YouTube OAuth 2.0 ─────────────────────────────────────────────────────────
function buildYoutubeUrl(clientId) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('redirect_uri',  REDIRECT('youtube'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope',         'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  url.searchParams.set('access_type',   'offline');
  url.searchParams.set('prompt',        'consent');
  return url.toString();
}

async function handleYoutubeCallback(code, clientId, clientSecret) {
  // Exchange code → tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  REDIRECT('youtube'),
      grant_type:    'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error_description || tokenData.error || 'YouTube token exchange gagal');

  // Get user info
  const meRes  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });
  const me = await meRes.json();

  const acc = await upsertAccount({
    platform:        'youtube',
    username:        me.name || me.email || me.sub,
    platform_uid:    me.sub,
    access_token:    encrypt(tokenData.access_token),
    refresh_token:   tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
    token_expires_at: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null,
    is_active: true,
  });

  return { name: me.name || me.email, accounts: [acc] };
}

// ── Threads OAuth ─────────────────────────────────────────────────────────────
function buildThreadsUrl(appId) {
  const url = new URL('https://threads.net/oauth/authorize');
  url.searchParams.set('client_id',     appId);
  url.searchParams.set('redirect_uri',  REDIRECT('threads'));
  url.searchParams.set('scope',         'threads_basic,threads_content_publish');
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function handleThreadsCallback(code, appId, appSecret) {
  // Exchange code → short-lived token
  const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      redirect_uri:  REDIRECT('threads'),
      code,
      grant_type:    'authorization_code',
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error || 'Threads token exchange gagal');

  // Exchange → long-lived token (60 days)
  const llRes = await fetch(
    `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`
  );
  const llData = await llRes.json();
  const longToken = llData.access_token || tokenData.access_token;

  // Get user info
  const meRes  = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${longToken}`);
  const me     = await meRes.json();

  const acc = await upsertAccount({
    platform:        'threads',
    username:        me.username || me.id,
    platform_uid:    me.id,
    access_token:    encrypt(longToken),
    refresh_token:   null,
    token_expires_at: llData.expires_in
      ? new Date(Date.now() + llData.expires_in * 1000).toISOString()
      : null,
    is_active: true,
  });

  return { name: me.username || me.id, accounts: [acc] };
}

// ── Ambil semua akun dari Supabase ────────────────────────────────────────────
async function getOAuthAccounts() {
  const { data, error } = await _supabase
    .from('social_accounts')
    .select('id, platform, username, platform_uid, is_active, created_at')
    .order('platform')
    .order('username');
  if (error) throw new Error(error.message);
  return data || [];
}

async function deleteOAuthAccount(id) {
  const { error } = await _supabase.from('social_accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

module.exports = {
  init,
  buildFacebookUrl,   handleFacebookCallback,
  buildTwitterUrl,    handleTwitterCallback,
  buildTikTokUrl,     handleTikTokCallback,
  buildYoutubeUrl,    handleYoutubeCallback,
  buildThreadsUrl,    handleThreadsCallback,
  getOAuthAccounts,
  deleteOAuthAccount,
};
