// Proxy redirect: TikTok callback → forward ke localhost desktop app
const router = require('express').Router();

const LOCAL_PORT = 42813;

// GET /oauth/tiktok/callback
// TikTok redirect ke sini (HTTPS), kita forward ke app desktop di localhost
router.get('/oauth/tiktok/callback', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  const localUrl = `http://localhost:${LOCAL_PORT}/oauth/tiktok/callback${params ? '?' + params : ''}`;
  res.redirect(localUrl);
});

module.exports = router;
