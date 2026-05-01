const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { SocialAccount } = require('../models');

// GET all accounts (admin sees all active, operator sees own active)
router.get('/', protect, async (req, res) => {
  try {
    const { loginType } = req.query;
    const baseFilter = { isActive: true };
    let filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, owner: req.user._id };
    if (loginType) filter = { ...filter, loginType };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET OAuth accounts only
router.get('/oauth', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { isActive: true, loginType: 'oauth' }
      : { isActive: true, owner: req.user._id, loginType: 'oauth' };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET Automation accounts only
router.get('/automation', protect, async (req, res) => {
  try {
    const filter = req.user.role === 'admin'
      ? { isActive: true, loginType: 'automation' }
      : { isActive: true, owner: req.user._id, loginType: 'automation' };
    const accounts = await SocialAccount.find(filter)
      .populate('owner', 'name email')
      .sort('-connectedAt');
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET by user
router.get('/user/:userId', protect, async (req, res) => {
  try {
    const accounts = await SocialAccount.find({ owner: req.params.userId, isActive: true });
    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST manually add account (after OAuth, token is stored here)
router.post('/', protect, async (req, res) => {
  try {
    const { label, platform, platformUserId, platformUsername, accessToken, refreshToken, tokenExpiresAt, pageId } = req.body;
    const account = await SocialAccount.create({
      owner: req.user._id, label, platform,
      platformUserId, platformUsername,
      accessToken, refreshToken, tokenExpiresAt, pageId
    });
    res.status(201).json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH update warmup settings
router.patch('/:id/warmup', protect, async (req, res) => {
  try {
    const account = await SocialAccount.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { $set: { warmup: req.body } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE / deactivate
router.delete('/:id', protect, async (req, res) => {
  try {
    await SocialAccount.findOneAndUpdate(
      { _id: req.params.id, owner: req.user._id },
      { isActive: false }
    );
    res.json({ message: 'Account disconnected' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH update access token
router.patch('/:id', protect, async (req, res) => {
  try {
    const { accessToken } = req.body;
    const account = await SocialAccount.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { accessToken } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json(account);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST sync accounts from desktop app (automation accounts) - uses API key
router.post('/sync-desktop', async (req, res) => {
  try {
    // Simple API key auth for desktop sync
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const { userId, accounts } = req.body;
    if (!userId || !accounts) {
      return res.status(400).json({ message: 'userId and accounts required' });
    }

    const results = [];
    for (const acc of accounts) {
      const update = {
        owner: userId,
        label: acc.label || acc.username,
        platform: acc.platform,
        platformUserId: acc.platformUserId || acc.username,
        platformUsername: acc.platformUsername || acc.username,
        loginType: 'automation',
        isActive: true,
        automationData: {
          password: acc.password,
          cookies: acc.cookies,
          twoFactorSecret: acc.twoFactorSecret,
          userAgent: acc.userAgent,
          lastLoginAt: acc.lastLoginAt,
          lastWarmupAt: acc.lastWarmupAt
        }
      };

      const account = await SocialAccount.findOneAndUpdate(
        { owner: userId, platform: acc.platform, platformUserId: acc.username },
        { $set: update },
        { upsert: true, new: true }
      );
      results.push(account);
    }

    res.status(201).json({ message: 'Accounts synced', count: results.length, accounts: results });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET automation accounts for desktop sync
router.get('/sync-desktop/:userId', async (req, res) => {
  try {
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const accounts = await SocialAccount.find({
      owner: req.params.userId,
      isActive: true
    }).sort('-connectedAt');

    res.json(accounts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE automation account by desktop
router.delete('/sync-desktop/:userId/:platform/:username', async (req, res) => {
  try {
    const apiKey = req.headers['x-desktop-api-key'];
    if (apiKey !== process.env.DESKTOP_API_KEY) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    await SocialAccount.findOneAndUpdate(
      { owner: req.params.userId, platform: req.params.platform, platformUserId: req.params.username },
      { isActive: false }
    );
    res.json({ message: 'Account removed from sync' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST sync accounts from desktop app (automation accounts)
router.post('/sync', protect, async (req, res) => {
  try {
    const { accounts } = req.body;
    const results = [];

    for (const acc of accounts) {
      const update = {
        owner: req.user._id,
        label: acc.label || acc.username,
        platform: acc.platform,
        platformUserId: acc.platformUserId || acc.username,
        platformUsername: acc.platformUsername || acc.username,
        loginType: 'automation',
        isActive: true,
        automationData: {
          password: acc.password,
          cookies: acc.cookies,
          twoFactorSecret: acc.twoFactorSecret,
          userAgent: acc.userAgent,
          lastLoginAt: acc.lastLoginAt,
          lastWarmupAt: acc.lastWarmupAt
        }
      };

      const account = await SocialAccount.findOneAndUpdate(
        { owner: req.user._id, platform: acc.platform, platformUserId: acc.username },
        { $set: update },
        { upsert: true, new: true }
      );
      results.push(account);
    }

    res.status(201).json({ message: 'Accounts synced', count: results.length, accounts: results });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE automation account by platform + username (for desktop sync)
router.delete('/sync/:platform/:username', protect, async (req, res) => {
  try {
    await SocialAccount.findOneAndUpdate(
      { owner: req.user._id, platform: req.params.platform, platformUserId: req.params.username },
      { isActive: false }
    );
    res.json({ message: 'Account removed from sync' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
