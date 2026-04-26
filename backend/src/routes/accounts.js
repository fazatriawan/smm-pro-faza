const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { SocialAccount } = require('../models');

// GET all accounts (admin sees all active, operator sees own active)
router.get('/', protect, async (req, res) => {
  try {
    const baseFilter = { isActive: true };
    const filter = req.user.role === 'admin' ? baseFilter : { ...baseFilter, owner: req.user._id };
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

module.exports = router;
