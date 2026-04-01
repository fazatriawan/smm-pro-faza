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
    const { targetUrl, platform, actions, accountIds } = req.body;
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

module.exports = router;
