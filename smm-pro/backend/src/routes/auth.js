const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { protect } = require('../middleware/auth');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email sudah terdaftar' });
    const user = await User.create({ name, email, password, role });
    const token = signToken(user._id);
    res.status(201).json({ token, user: { id: user._id, name, email, role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Email atau password salah' });
    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Me
router.get('/me', protect, (req, res) => res.json(req.user));

module.exports = router;
