const cron = require('node-cron');
const { Post } = require('../models');
const { publishPost } = require('./publishService');

let io;

function startScheduler(socketIo) {
  io = socketIo;

  // Check every minute for due posts
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const duePosts = await Post.find({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });

      for (const post of duePosts) {
        console.log(`[Scheduler] Publishing post ${post._id}`);
        try {
          await publishPost(post._id);
          if (io) io.emit('post:published', { postId: post._id, status: 'completed' });
        } catch (err) {
          console.error(`[Scheduler] Failed post ${post._id}:`, err.message);
          if (io) io.emit('post:failed', { postId: post._id, error: err.message });
        }
      }
    } catch (err) {
      console.error('[Scheduler] Cron error:', err.message);
    }
  });

  // Daily analytics fetch at 02:00
  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Running daily analytics fetch...');
    // Call fetchAllAnalytics() here
  });

  console.log('⏰ Scheduler started');
}

module.exports = { startScheduler };
