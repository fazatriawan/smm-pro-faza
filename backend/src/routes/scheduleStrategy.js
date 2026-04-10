const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getOptimalPostingTime,
  generateWeeklySchedule,
  suggestBatchSchedule,
} = require('../services/scheduleStrategyService');

// GET /api/schedule-strategy/optimal-time?platform=tiktok&contentType=video
router.get('/optimal-time', protect, (req, res) => {
  try {
    const { platform, contentType } = req.query;
    if (!platform) {
      return res.status(400).json({ message: 'platform wajib diisi' });
    }
    const result = getOptimalPostingTime(platform, contentType);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/schedule-strategy/weekly — Generate jadwal mingguan
router.post('/weekly', protect, (req, res) => {
  try {
    const { platforms, contentTypes } = req.body;
    const schedule = generateWeeklySchedule(platforms, contentTypes);
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/schedule-strategy/batch — Suggest batch schedule
router.post('/batch', protect, (req, res) => {
  try {
    const { videoCount, platforms } = req.body;
    const result = suggestBatchSchedule(videoCount, platforms);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
