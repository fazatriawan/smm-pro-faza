// amplify.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { AmplifyJob, SocialAccount } = require('../models');
const { runAmplifyJob } = require('../services/amplifyService');

router.get('/', protect, async (req, res) => {
  try {
    const jobs = await AmplifyJob.find({ createdBy: req.user._id })
      .populate('accounts', 'label platform')
      .sort('-createdAt').limit(50);
    res.json(jobs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/', protect, async (req, res) => {
  try {
    const { targetUrl, targetUrls, platform, actions, accountIds } = req.body;
    const accounts = await SocialAccount.find({
      _id: { $in: accountIds }, owner: req.user._id, isActive: true
    });
    const job = await AmplifyJob.create({
      createdBy: req.user._id, targetUrl, platform, actions,
      accounts: accounts.map(a => a._id), status: 'pending'
    });
    runAmplifyJob(job._id).catch(console.error);
    res.status(201).json(job);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Stop job
router.patch('/:id/stop', protect, async (req, res) => {
  try {
    const job = await AmplifyJob.findOneAndUpdate(
      { _id: req.params.id, status: 'running' },
      { $set: { status: 'stopped' } },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: 'Job tidak ditemukan atau sudah selesai' });
    console.log('[Amplify] Job stopped:', req.params.id);
    res.json({ message: 'Job berhasil dihentikan', job });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
