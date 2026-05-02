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
    const { targetUrl, targetUrls, platform, actions, accountIds, aiConfig } = req.body;

    // Validasi input
    if (!accountIds || accountIds.length === 0) {
      return res.status(400).json({ message: 'Tidak ada akun yang dipilih', code: 'NO_ACCOUNTS' });
    }

    // Cari akun yang valid — admin bisa pakai semua akun
    const ownerFilter = req.user.role === 'admin' ? {} : { owner: req.user._id };
    const accounts = await SocialAccount.find({
      _id: { $in: accountIds }, ...ownerFilter, isActive: true
    });

    console.log(`[Amplify] POST user=${req.user._id} accountIds=${accountIds?.length} found=${accounts.length} platform=${platform} useAI=${aiConfig?.useAI || false}`);

    // Warning jika found=0
    if (accounts.length === 0) {
      const allSelected = await SocialAccount.find({ _id: { $in: accountIds } });
      const reasons = [];

      const notOwned = allSelected.filter(a => a.owner.toString() !== req.user._id.toString());
      const inactive = allSelected.filter(a => !a.isActive);
      const wrongPlatform = allSelected.filter(a => a.platform !== platform);

      if (notOwned.length) reasons.push(`${notOwned.length} akun bukan milik Anda`);
      if (inactive.length) reasons.push(`${inactive.length} akun tidak aktif`);
      if (wrongPlatform.length) reasons.push(`${wrongPlatform.length} akun platformnya bukan ${platform}`);
      if (allSelected.length === 0) reasons.push('ID akun tidak ditemukan di database');

      return res.status(400).json({
        message: `Tidak ada akun yang valid untuk amplifikasi (${reasons.join(', ')})`,
        code: 'NO_VALID_ACCOUNTS',
        reasons,
        suggestion: 'Pastikan akun sudah login dan platform sesuai dengan target amplifikasi.',
        totalSelected: accountIds.length,
        notOwned: notOwned.length,
        inactive: inactive.length,
        wrongPlatform: wrongPlatform.length
      });
    }

    if (accounts.length < accountIds.length) {
      console.log(`[Amplify] WARNING: Only ${accounts.length}/${accountIds.length} accounts are valid`);
    }

    const job = await AmplifyJob.create({
      createdBy: req.user._id,
      targetUrl: targetUrl || (targetUrls && targetUrls[0]),
      targetUrls: targetUrls || [targetUrl],
      platform,
      actions,
      accounts: accounts.map(a => a._id),
      status: 'pending',
      aiConfig: aiConfig || { useAI: false },
      meta: {
        totalSelected: accountIds.length,
        validAccounts: accounts.length,
        skippedReasons: []
      }
    });

    runAmplifyJob(job._id).catch(console.error);
    res.status(201).json(job);
  } catch (err) {
    console.error('[Amplify] Error creating job:', err);
    res.status(500).json({ message: err.message });
  }
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
