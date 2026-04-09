const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { generateCaption, generateCaptionVariations, generateComments, generateHashtags, generateReply } = require('../services/aiService');

// Generate caption tunggal
router.post('/caption', protect, async (req, res) => {
  try {
    const caption = await generateCaption(req.body);
    res.json({ caption });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate variasi caption untuk banyak akun
router.post('/caption/variations', protect, async (req, res) => {
  try {
    const variations = await generateCaptionVariations(req.body);
    res.json({ variations });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate komentar untuk amplifikasi
router.post('/comments', protect, async (req, res) => {
  try {
    const comments = await generateComments(req.body);
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate hashtag
router.post('/hashtags', protect, async (req, res) => {
  try {
    const hashtags = await generateHashtags(req.body);
    res.json({ hashtags });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Generate reply komentar
router.post('/reply', protect, async (req, res) => {
  try {
    const reply = await generateReply(req.body);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
