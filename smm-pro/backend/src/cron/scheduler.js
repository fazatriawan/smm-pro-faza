const cron = require('node-cron');
const { Post } = require('../models');
const { uploadToCloudinary } = require('../services/uploadService');
const { publishPost } = require('../services/publishService');
const fs = require('fs');

function startScheduler() {
  console.log('⏰ Scheduler started');

  // Jalankan setiap menit
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // Cari post yang sudah waktunya diposting
      const duePosts = await Post.find({
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });

      if (duePosts.length === 0) return;

      console.log(`[Scheduler] Found ${duePosts.length} post(s) due for publishing`);

      for (const post of duePosts) {
        try {
          // Tandai sebagai processing untuk hindari race condition
          await Post.findByIdAndUpdate(post._id, { status: 'processing' });
          console.log(`[Scheduler] Processing post: ${post._id}`);

          // Upload media lokal ke Cloudinary jika ada
          if (post.mediaUrls && post.mediaUrls.length > 0) {
            const cloudUrls = [];
            for (const mediaPath of post.mediaUrls) {
              // Cek apakah ini path lokal (bukan URL Cloudinary)
              if (!mediaPath.startsWith('http')) {
                try {
                  if (fs.existsSync(mediaPath)) {
                    const cloudUrl = await uploadToCloudinary(mediaPath);
                    cloudUrls.push(cloudUrl);
                    fs.unlink(mediaPath, () => {});
                    console.log(`[Scheduler] Uploaded to Cloudinary: ${cloudUrl}`);
                  } else {
                    console.error(`[Scheduler] Local file not found: ${mediaPath}`);
                  }
                } catch (uploadErr) {
                  console.error(`[Scheduler] Upload error: ${uploadErr.message}`);
                }
              } else {
                // Sudah URL Cloudinary, langsung pakai
                cloudUrls.push(mediaPath);
              }
            }
            // Update mediaUrls dengan URL Cloudinary
            await Post.findByIdAndUpdate(post._id, { mediaUrls: cloudUrls });
          }

          // Publish post
          await publishPost(post._id);
          console.log(`[Scheduler] Published post: ${post._id}`);

        } catch (err) {
          console.error(`[Scheduler] Failed to process post ${post._id}:`, err.message);

          // Cek apakah masih bisa retry
          const updatedPost = await Post.findById(post._id);
          const retryCount = (updatedPost?.retryCount || 0) + 1;
          const maxRetries = updatedPost?.maxRetries || 3;

          if (retryCount < maxRetries) {
            // Jadwalkan retry 5 menit kemudian
            const retryAt = new Date(Date.now() + 5 * 60 * 1000);
            await Post.findByIdAndUpdate(post._id, {
              status: 'scheduled',
              scheduledAt: retryAt,
              retryCount
            });
            console.log(`[Scheduler] Retry ${retryCount}/${maxRetries} scheduled at ${retryAt}`);
          } else {
            // Tandai sebagai failed setelah max retries
            await Post.findByIdAndUpdate(post._id, {
              status: 'failed',
              retryCount
            });
            console.log(`[Scheduler] Post ${post._id} failed after ${maxRetries} retries`);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] Cron error:', err.message);
    }
  });
}

module.exports = { startScheduler };
