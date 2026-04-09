require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const accountRoutes = require('./routes/accounts');
const postRoutes = require('./routes/posts');
const scheduleRoutes = require('./routes/schedule');
const notifRoutes = require('./routes/notifications');
const analyticsRoutes = require('./routes/analytics');
const amplifyRoutes = require('./routes/amplify');
const warmupRoutes = require('./routes/warmup');
const authMetaRoutes = require('./routes/authMeta');
const authYoutubeRoutes = require('./routes/authYoutube');
const authTwitterRoutes = require('./routes/authTwitter');
const authThreadsRoutes = require('./routes/authThreads');
const aiRoutes = require('./routes/ai');
const { startTokenScheduler } = require('./cron/tokenScheduler');
const { startScheduler } = require('./services/schedulerService');
const { initSocket } = require('./services/socketService');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL, credentials: true }
});

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/amplify', amplifyRoutes);
app.use('/api/warmup', warmupRoutes);
app.use('/api/auth', authMetaRoutes);
app.use('/api/auth', authYoutubeRoutes);
app.use('/api/auth', authTwitterRoutes);
app.use('/api/auth', authThreadsRoutes);
app.use('/api/ai', aiRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// MongoDB + Start
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    initSocket(io);
    startScheduler(io);
    server.listen(process.env.PORT || 5000, () =>
      console.log(`🚀 Server running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error('❌ DB Error:', err); process.exit(1); });

module.exports = { app, io };
