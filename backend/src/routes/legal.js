// src/routes/legal.js — exports HTML generator functions (no Express router)
const APP_NAME    = 'SMM Pro Desktop';
const CONTACT     = 'fazatriawan@gmail.com';
const LAST_UPDATE = 'April 17, 2026';

function wrap(title, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${APP_NAME}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
     background:#f5f5f7;color:#1d1d1f;font-size:16px;line-height:1.65}
header{background:linear-gradient(135deg,#312e81,#5b21b6);padding:40px 24px;text-align:center;color:#fff}
header h1{font-size:26px;font-weight:700}
header p{font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px}
main{max-width:740px;margin:40px auto;padding:0 24px 80px}
h2{font-size:19px;font-weight:700;color:#312e81;margin:32px 0 10px;
   padding-bottom:7px;border-bottom:2px solid #e5e3f5}
p{margin-bottom:12px;color:#3d3d3f}
ul{padding-left:20px;margin-bottom:12px}
li{margin-bottom:5px;color:#3d3d3f}
a{color:#5b21b6}
footer{text-align:center;font-size:13px;color:#888;padding:20px}
</style></head><body>
<header>
  <div style="font-size:22px;font-weight:800;margin-bottom:8px">📡 ${APP_NAME}</div>
  <h1>${title}</h1>
  <p>Last updated: ${LAST_UPDATE}</p>
</header>
<main>${body}</main>
<footer>&copy; 2026 ${APP_NAME} — <a href="mailto:${CONTACT}">${CONTACT}</a></footer>
</body></html>`;
}

function tosHtml() {
  return wrap('Terms of Service', `
<p style="margin:20px 0 28px;color:#555">By using ${APP_NAME} you agree to the following terms.</p>

<h2>1. Acceptance of Terms</h2>
<p>By downloading, installing, or using ${APP_NAME}, you agree to be bound by these Terms of Service.</p>

<h2>2. Description of Service</h2>
<p>${APP_NAME} is a desktop application that enables users to:</p>
<ul>
  <li>Connect social media accounts (TikTok, Facebook, Instagram, Twitter/X) via OAuth</li>
  <li>Schedule and publish posts including text and media content</li>
  <li>Manage multiple accounts from a single interface</li>
</ul>

<h2>3. TikTok Integration</h2>
<p>When you connect your TikTok account, ${APP_NAME} uses the TikTok Developer API to retrieve your basic profile (display name, user ID) for account identification, and to upload and publish video content to your TikTok profile on your behalf. The application only acts on your explicit instructions.</p>

<h2>4. User Responsibilities</h2>
<ul>
  <li>Use the application only for lawful purposes</li>
  <li>Not post content that violates TikTok's Community Guidelines or Terms of Service</li>
  <li>Keep your account credentials and API keys secure</li>
  <li>Comply with the terms of all connected social media platforms</li>
</ul>

<h2>5. Prohibited Uses</h2>
<ul>
  <li>Posting illegal, harmful, or misleading content</li>
  <li>Violating any third-party platform's terms of service</li>
  <li>Circumventing rate limits or abusing API quotas</li>
</ul>

<h2>6. Disclaimer of Warranties</h2>
<p>${APP_NAME} is provided "as is" without warranties of any kind. We are not liable for any content published through the application.</p>

<h2>7. Changes to Terms</h2>
<p>We reserve the right to modify these terms at any time. Continued use constitutes acceptance of updated terms.</p>

<h2>8. Contact</h2>
<p>Questions? Email <a href="mailto:${CONTACT}">${CONTACT}</a></p>
  `);
}

function privacyHtml() {
  return wrap('Privacy Policy', `
<p style="margin:20px 0 28px;color:#555">${APP_NAME} is committed to protecting your privacy.</p>

<h2>1. Information We Collect</h2>
<ul>
  <li><strong>OAuth tokens</strong> — access/refresh tokens from connected platforms, stored encrypted (AES-256-GCM)</li>
  <li><strong>TikTok profile data</strong> — open_id and display_name to identify your connected account</li>
  <li><strong>Post content</strong> — captions and media you upload, stored in your own Supabase bucket</li>
</ul>

<h2>2. TikTok Data Usage</h2>
<p>${APP_NAME} accesses the following TikTok data:</p>
<ul>
  <li><strong>user.info.basic</strong> — Your TikTok user ID and display name, used only to identify your account in the app</li>
  <li><strong>video.upload</strong> — Used to upload video files you select to TikTok's servers</li>
  <li><strong>video.publish</strong> — Used to publish videos to your TikTok profile when you initiate a post</li>
</ul>
<p>TikTok data is used solely for these purposes and is never shared with third parties.</p>

<h2>3. How We Use Your Data</h2>
<p>We do <strong>not</strong> sell, share, or use your data for advertising. All data is stored in your own Supabase instance — we do not operate centralized servers that store your personal data.</p>

<h2>4. Data Security</h2>
<ul>
  <li>OAuth tokens are encrypted with AES-256-GCM before storage</li>
  <li>Local settings are stored in Electron's encrypted store on your device</li>
</ul>

<h2>5. Data Retention & Deletion</h2>
<p>Your data is retained in your Supabase database for as long as you keep it. You can delete connected accounts at any time through the app or from your Supabase dashboard. You can also revoke TikTok access from TikTok's App Permissions settings.</p>

<h2>6. Third-Party Services</h2>
<ul>
  <li><a href="https://www.tiktok.com/legal/page/global/privacy-policy/en">TikTok Privacy Policy</a></li>
  <li><a href="https://supabase.com/privacy">Supabase Privacy Policy</a></li>
</ul>

<h2>7. Contact</h2>
<p>Privacy questions? Email <a href="mailto:${CONTACT}">${CONTACT}</a></p>
  `);
}

module.exports = { tosHtml, privacyHtml };
