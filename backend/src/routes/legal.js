const express = require('express');
const router  = express.Router();

const APP_NAME    = 'SMM Pro Desktop';
const CONTACT     = 'fazatriawan@gmail.com';
const LAST_UPDATE = 'April 17, 2026';

const html = (title, bodyContent) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — ${APP_NAME}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
         background:#f5f5f7;color:#1d1d1f;font-size:16px;line-height:1.65}
    header{background:linear-gradient(135deg,#312e81,#5b21b6);padding:40px 24px;text-align:center;color:#fff}
    header .logo{display:inline-flex;align-items:center;gap:12px;margin-bottom:12px}
    header .mark{width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:12px;
                 display:flex;align-items:center;justify-content:center;font-size:22px}
    header h1{font-size:28px;font-weight:700;letter-spacing:-0.02em}
    header p{font-size:14px;color:rgba(255,255,255,0.7);margin-top:6px}
    main{max-width:760px;margin:40px auto;padding:0 24px 80px}
    h2{font-size:20px;font-weight:700;color:#312e81;margin:36px 0 12px;padding-bottom:8px;
       border-bottom:2px solid #e5e3f5}
    h3{font-size:16px;font-weight:600;margin:20px 0 8px;color:#1d1d1f}
    p{margin-bottom:14px;color:#3d3d3f}
    ul,ol{padding-left:22px;margin-bottom:14px}
    li{margin-bottom:6px;color:#3d3d3f}
    a{color:#5b21b6;text-decoration:none}
    a:hover{text-decoration:underline}
    .chip{display:inline-block;background:#ede9fe;color:#5b21b6;font-size:12px;
          font-weight:600;padding:3px 10px;border-radius:20px;margin:2px 3px}
    footer{text-align:center;font-size:13px;color:#888;margin-top:60px;padding:20px}
    .card{background:#fff;border-radius:14px;padding:24px;margin-bottom:20px;
          box-shadow:0 1px 4px rgba(0,0,0,0.07)}
    .last-update{text-align:right;font-size:13px;color:#888;margin-bottom:32px}
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="mark">📡</div>
      <div>
        <div style="font-size:22px;font-weight:800">${APP_NAME}</div>
        <div style="font-size:13px;opacity:0.7">Social Media Management</div>
      </div>
    </div>
    <h1>${title}</h1>
    <p>Last updated: ${LAST_UPDATE}</p>
  </header>

  <main>
    <p class="last-update">Effective date: ${LAST_UPDATE}</p>
    ${bodyContent}
  </main>

  <footer>
    &copy; 2026 ${APP_NAME}. For questions, contact
    <a href="mailto:${CONTACT}">${CONTACT}</a>
  </footer>
</body>
</html>`;

// ── Terms of Service ───────────────────────────────────────────────────────────
router.get('/tos', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html('Terms of Service', `
    <div class="card">
      <p>Welcome to <strong>${APP_NAME}</strong>, a desktop application that allows users to manage
      and publish content across multiple social media platforms. By using this application,
      you agree to the following terms.</p>
    </div>

    <h2>1. Acceptance of Terms</h2>
    <p>By downloading, installing, or using ${APP_NAME}, you agree to be bound by these Terms of
    Service. If you do not agree, please do not use the application.</p>

    <h2>2. Description of Service</h2>
    <p>${APP_NAME} is a desktop application that enables users to:</p>
    <ul>
      <li>Connect their social media accounts (TikTok, Facebook, Instagram, Twitter/X) via OAuth</li>
      <li>Schedule and publish posts, including text and media content</li>
      <li>Manage multiple accounts from a single interface</li>
      <li>Upload media to cloud storage for use in posts</li>
    </ul>

    <h2>3. TikTok Integration</h2>
    <p>When you connect your TikTok account, ${APP_NAME} uses the TikTok Developer API to:</p>
    <ul>
      <li>Retrieve your basic profile information (display name, user ID) for account identification</li>
      <li>Upload and publish video content to your TikTok profile on your behalf</li>
    </ul>
    <p>The application only acts on your explicit instructions. We do not post, upload, or modify
    your TikTok content without your direct action within the app.</p>

    <h2>4. User Responsibilities</h2>
    <p>You agree to:</p>
    <ul>
      <li>Use the application only for lawful purposes</li>
      <li>Not post content that violates TikTok's Community Guidelines or Terms of Service</li>
      <li>Keep your account credentials and API keys secure</li>
      <li>Not use the application to spam, harass, or engage in automated abuse</li>
      <li>Comply with the terms of service of all connected social media platforms</li>
    </ul>

    <h2>5. Prohibited Uses</h2>
    <p>You may not use ${APP_NAME} to:</p>
    <ul>
      <li>Post illegal, harmful, or misleading content</li>
      <li>Violate any third-party platform's terms of service</li>
      <li>Attempt to reverse-engineer or exploit the application</li>
      <li>Circumvent any rate limits or abuse API quotas</li>
    </ul>

    <h2>6. Intellectual Property</h2>
    <p>The application and its original content, features, and functionality are owned by
    ${APP_NAME} and are protected by applicable intellectual property laws.
    User-generated content remains the property of the respective user.</p>

    <h2>7. Disclaimer of Warranties</h2>
    <p>${APP_NAME} is provided "as is" without warranties of any kind. We do not guarantee
    uninterrupted or error-free operation. We are not liable for any content published through
    the application.</p>

    <h2>8. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, ${APP_NAME} shall not be liable for any indirect,
    incidental, special, or consequential damages arising from your use of the application.</p>

    <h2>9. Changes to Terms</h2>
    <p>We reserve the right to modify these terms at any time. Continued use of the application
    after changes constitutes acceptance of the new terms. We will update the "Last updated" date
    at the top of this page accordingly.</p>

    <h2>10. Contact</h2>
    <p>For questions regarding these Terms of Service, please contact us at
    <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
  `));
});

// ── Privacy Policy ─────────────────────────────────────────────────────────────
router.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html('Privacy Policy', `
    <div class="card">
      <p>${APP_NAME} is committed to protecting your privacy. This Privacy Policy explains what data
      we collect, how we use it, and your rights regarding your personal information.</p>
    </div>

    <h2>1. Information We Collect</h2>

    <h3>a. Information You Provide</h3>
    <ul>
      <li><strong>OAuth tokens</strong> — access tokens and refresh tokens from connected social
          media platforms (TikTok, Facebook, Instagram, Twitter/X). These are stored in encrypted
          form using AES-256-GCM encryption.</li>
      <li><strong>Account credentials</strong> — API keys for third-party services you configure
          (Supabase, Upstash Redis). These are stored locally on your device using encrypted
          storage.</li>
      <li><strong>Post content</strong> — text captions and media files you upload for publishing.
          Media files are stored in your own Supabase Storage bucket.</li>
    </ul>

    <h3>b. Information Collected Automatically</h3>
    <ul>
      <li><strong>Social profile data</strong> — when you connect a TikTok account, we retrieve
          your TikTok user ID (<code>open_id</code>) and display name solely to identify your
          account within the app.</li>
      <li><strong>Activity logs</strong> — post submission records (status, timestamps) stored
          in your own Supabase database.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>

    <div class="card">
      <p><strong>We use your TikTok data exclusively to:</strong></p>
      <span class="chip">Display your connected account</span>
      <span class="chip">Upload videos on your behalf</span>
      <span class="chip">Publish posts you explicitly create</span>
    </div>

    <p>We do <strong>not</strong>:</p>
    <ul>
      <li>Sell or share your data with third parties</li>
      <li>Use your data for advertising purposes</li>
      <li>Access your social media accounts beyond what you explicitly authorize</li>
      <li>Store your data on our servers — all data is stored in your own Supabase instance</li>
    </ul>

    <h2>3. Data Storage and Security</h2>
    <ul>
      <li>OAuth access tokens are encrypted with AES-256-GCM before storage</li>
      <li>Local settings (API keys) are stored using Electron's encrypted store on your device</li>
      <li>Post data and tokens are stored in your personal Supabase database, which you control</li>
      <li>We do not operate centralized servers that store your personal data</li>
    </ul>

    <h2>4. TikTok Data Usage</h2>
    <p>In connection with TikTok's Content Posting API, ${APP_NAME} accesses the following
    TikTok user data:</p>
    <ul>
      <li><strong>user.info.basic</strong> — Your TikTok user ID and display name, used only
          to identify your connected account within the app</li>
      <li><strong>video.upload</strong> — Used to upload video files you select to TikTok's
          servers in preparation for publishing</li>
      <li><strong>video.publish</strong> — Used to publish videos to your TikTok profile
          when you initiate a post</li>
    </ul>
    <p>TikTok data is used solely for the above purposes and is not shared with any third party.
    You can revoke access at any time from TikTok's App Permissions settings.</p>

    <h2>5. Data Retention</h2>
    <p>Your data is retained in your Supabase database for as long as you choose to keep it.
    You can delete your connected accounts and associated data at any time through the
    application's Account Management panel or directly from your Supabase dashboard.</p>

    <h2>6. Third-Party Services</h2>
    <p>The application integrates with the following third-party services, each governed by
    their own privacy policies:</p>
    <ul>
      <li><a href="https://www.tiktok.com/legal/page/global/privacy-policy/en" target="_blank">TikTok Privacy Policy</a></li>
      <li><a href="https://supabase.com/privacy" target="_blank">Supabase Privacy Policy</a></li>
      <li><a href="https://upstash.com/privacy" target="_blank">Upstash Privacy Policy</a></li>
    </ul>

    <h2>7. Children's Privacy</h2>
    <p>${APP_NAME} is not directed to children under the age of 13. We do not knowingly collect
    personal information from children under 13.</p>

    <h2>8. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access the personal data we hold about you</li>
      <li>Delete your connected accounts and associated data</li>
      <li>Revoke OAuth access from any connected social media platform at any time</li>
    </ul>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will update the "Last updated"
    date at the top of this page. Continued use of the application constitutes acceptance
    of the updated policy.</p>

    <h2>10. Contact Us</h2>
    <p>For privacy-related questions or requests, please contact us at
    <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
  `));
});

module.exports = router;
