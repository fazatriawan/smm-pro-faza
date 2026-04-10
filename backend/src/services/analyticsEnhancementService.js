/**
 * Analytics Enhancement Service
 * Menyediakan kalkulasi engagement rate, performance report, top content, dan content suggestions.
 */

const { Analytics, Post, SocialAccount } = require('../models');

/**
 * Menghitung engagement rate dari metrik konten.
 * Formula: (likes + comments + shares + saves) / views * 100
 * @param {number} views
 * @param {number} likes
 * @param {number} comments
 * @param {number} shares
 * @param {number} saves
 * @returns {{ engagementRate: number, grade: string, breakdown: Object }}
 */
function calculateEngagementRate(views, likes, comments, shares, saves) {
  const v = Number(views) || 0;
  const l = Number(likes) || 0;
  const c = Number(comments) || 0;
  const s = Number(shares) || 0;
  const sv = Number(saves) || 0;

  if (v === 0) {
    return { engagementRate: 0, grade: 'N/A', breakdown: { views: v, likes: l, comments: c, shares: s, saves: sv } };
  }

  const totalEngagements = l + c + s + sv;
  const rate = (totalEngagements / v) * 100;
  const rounded = Math.round(rate * 100) / 100;

  let grade;
  if (rate >= 6) grade = 'Excellent';
  else if (rate >= 3.5) grade = 'Good';
  else if (rate >= 1) grade = 'Average';
  else grade = 'Low';

  return {
    engagementRate: rounded,
    grade,
    breakdown: {
      views: v,
      likes: l,
      comments: c,
      shares: s,
      saves: sv,
      totalEngagements,
    },
  };
}

/**
 * Mengambil engagement rate dari database untuk satu post.
 * @param {string} postId - MongoDB ObjectId string
 * @returns {Promise<Object>}
 */
async function getPostEngagementRate(postId) {
  // Coba cari analytics snapshot yang terkait dengan post ini
  // Karena Analytics model menyimpan per-account, kita baca dari post targetAccounts
  const post = await Post.findById(postId).populate('targetAccounts.account', 'platform label');
  if (!post) throw new Error('Post tidak ditemukan');

  // Ambil analytics terbaru dari semua akun yang di-post
  const accountIds = post.targetAccounts.map(ta => ta.account && ta.account._id).filter(Boolean);
  const latest = await Analytics.find({ account: { $in: accountIds } }).sort({ date: -1 }).limit(accountIds.length * 2);

  let totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0, totalSaves = 0;
  for (const snap of latest) {
    totalViews += snap.views || snap.videoViews || 0;
    totalLikes += snap.likes || 0;
    totalComments += snap.comments || 0;
    totalShares += snap.shares || 0;
    totalSaves += snap.saves || 0;
  }

  const result = calculateEngagementRate(totalViews, totalLikes, totalComments, totalShares, totalSaves);
  return {
    postId,
    caption: post.caption ? post.caption.substring(0, 80) : '',
    platforms: [...new Set(post.targetAccounts.map(ta => ta.account && ta.account.platform).filter(Boolean))],
    ...result,
  };
}

/**
 * Generate laporan performa untuk satu akun dalam rentang waktu tertentu.
 * @param {string} accountId - MongoDB ObjectId
 * @param {{ startDate: Date|string, endDate: Date|string }} dateRange
 * @returns {Promise<Object>}
 */
async function generatePerformanceReport(accountId, dateRange) {
  const start = dateRange && dateRange.startDate ? new Date(dateRange.startDate) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
  const end = dateRange && dateRange.endDate ? new Date(dateRange.endDate) : new Date();

  const account = await SocialAccount.findById(accountId);
  if (!account) throw new Error('Akun tidak ditemukan');

  const snapshots = await Analytics.find({
    account: accountId,
    date: { $gte: start, $lte: end },
  }).sort('date');

  if (!snapshots.length) {
    return {
      accountId,
      label: account.label,
      platform: account.platform,
      dateRange: { start, end },
      summary: null,
      trend: [],
      message: 'Tidak ada data analytics dalam rentang waktu ini.',
    };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];

  const followerGrowth = (last.followers || last.subscribers || 0) - (first.followers || first.subscribers || 0);
  const totalReach = snapshots.reduce((s, a) => s + (a.reach || 0), 0);
  const totalEngagements = snapshots.reduce((s, a) => s + (a.engagements || 0), 0);
  const totalViews = snapshots.reduce((s, a) => s + (a.views || a.videoViews || 0), 0);
  const avgEngagementRate = snapshots.length > 0
    ? Math.round(snapshots.reduce((s, a) => {
        const v = a.views || a.videoViews || 1;
        const eng = (a.likes || 0) + (a.comments || 0) + (a.shares || 0) + (a.saves || 0);
        return s + (eng / v * 100);
      }, 0) / snapshots.length * 100) / 100
    : 0;

  return {
    accountId,
    label: account.label,
    platform: account.platform,
    dateRange: { start, end },
    summary: {
      followerGrowth,
      totalReach,
      totalEngagements,
      totalViews,
      avgEngagementRate,
      snapshotCount: snapshots.length,
    },
    trend: snapshots.map(s => ({
      date: s.date,
      followers: s.followers || s.subscribers || 0,
      reach: s.reach || 0,
      engagements: s.engagements || 0,
      views: s.views || s.videoViews || 0,
    })),
  };
}

/**
 * Mendapatkan top performing content untuk satu akun.
 * @param {string} accountId - MongoDB ObjectId
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
async function getTopPerformingContent(accountId, limit) {
  const maxLimit = Math.min(Number(limit) || 10, 50);

  const account = await SocialAccount.findById(accountId);
  if (!account) throw new Error('Akun tidak ditemukan');

  // Ambil analytics snapshots dengan engagement terbaik
  const snapshots = await Analytics.find({ account: accountId })
    .sort({ engagements: -1 })
    .limit(maxLimit);

  // Cari post yang dibuat oleh pemilik akun dalam periode yang sama
  const posts = await Post.find({
    createdBy: account.owner,
    'targetAccounts.account': accountId,
    status: { $in: ['completed', 'partial'] },
  })
    .sort('-createdAt')
    .limit(maxLimit);

  const topContent = posts.map((post, i) => {
    const snap = snapshots[i];
    const views = snap ? (snap.views || snap.videoViews || 0) : 0;
    const likes = snap ? (snap.likes || 0) : 0;
    const comments = snap ? (snap.comments || 0) : 0;
    const shares = snap ? (snap.shares || 0) : 0;
    const saves = snap ? (snap.saves || 0) : 0;
    const { engagementRate, grade } = calculateEngagementRate(views, likes, comments, shares, saves);

    return {
      postId: post._id,
      caption: post.caption ? post.caption.substring(0, 100) : '',
      createdAt: post.createdAt,
      scheduledAt: post.scheduledAt,
      status: post.status,
      metrics: { views, likes, comments, shares, saves },
      engagementRate,
      grade,
    };
  });

  topContent.sort((a, b) => b.engagementRate - a.engagementRate);
  return topContent.slice(0, maxLimit);
}

/**
 * Memberikan rekomendasi strategi konten berdasarkan data analytics.
 * @param {Object} analyticsData - Data analytics (bisa berupa summary atau array snapshots)
 * @returns {Object} Rekomendasi konten
 */
function suggestContentStrategy(analyticsData) {
  const suggestions = [];

  if (!analyticsData) {
    return {
      suggestions: ['Mulai rekam data analytics untuk mendapatkan rekomendasi yang lebih akurat.'],
      priority: 'low',
    };
  }

  const { avgEngagementRate, followerGrowth, totalViews, platform } = analyticsData;

  // Rekomendasi berdasarkan engagement rate
  if (avgEngagementRate !== undefined) {
    if (avgEngagementRate < 1) {
      suggestions.push('Engagement rate sangat rendah (<1%). Coba variasikan format konten: tambahkan video pendek, polls, atau pertanyaan interaktif.');
      suggestions.push('Posting di waktu optimal: cek /api/schedule-strategy/optimal-time untuk jam terbaik di platform Anda.');
    } else if (avgEngagementRate < 3.5) {
      suggestions.push('Engagement rate rata-rata (1-3.5%). Fokus pada konsistensi posting dan tingkatkan kualitas visual konten.');
      suggestions.push('Gunakan storytelling yang lebih kuat di caption untuk meningkatkan interaksi.');
    } else if (avgEngagementRate >= 6) {
      suggestions.push('Engagement rate sangat baik (>6%)! Pertahankan strategi konten saat ini dan repurpose konten terbaik Anda.');
    }
  }

  // Rekomendasi berdasarkan follower growth
  if (followerGrowth !== undefined) {
    if (followerGrowth < 0) {
      suggestions.push('Terjadi penurunan followers. Audit konten terakhir dan pastikan konsistensi niche/topik Anda.');
    } else if (followerGrowth === 0) {
      suggestions.push('Pertumbuhan followers stagnan. Coba kolaborasi, giveaway, atau cross-promotion dengan akun lain.');
    } else if (followerGrowth > 100) {
      suggestions.push('Pertumbuhan followers pesat! Manfaatkan momentum ini dengan posting lebih konsisten dan berinteraksi dengan followers baru.');
    }
  }

  // Rekomendasi berdasarkan platform
  if (platform) {
    const platformTips = {
      tiktok: 'TikTok: Posting 1-3x per hari, gunakan trending sounds, dan konsisten dengan niche untuk boost algoritma.',
      instagram: 'Instagram: Mix konten Reels, Carousel, dan Stories. Reels mendapatkan reach organik terbesar saat ini.',
      youtube: 'YouTube: Fokus pada judul & thumbnail yang menarik. Video 8-15 menit optimal untuk watch time.',
      linkedin: 'LinkedIn: Konten edukatif dan personal story mendapat engagement tertinggi. Posting 3-5x per minggu.',
      twitter: 'Twitter/X: Thread informatif dan replies aktif meningkatkan visibility. Posting 3-5x per hari.',
      facebook: 'Facebook: Video pendek (Reels) dan konten komunitas mendapat jangkauan organik terbaik.',
    };
    if (platformTips[platform]) suggestions.push(platformTips[platform]);
  }

  if (suggestions.length === 0) {
    suggestions.push('Terus konsisten posting dan pantau analytics mingguan untuk mengidentifikasi tren performa.');
  }

  return {
    suggestions,
    priority: avgEngagementRate < 1 ? 'high' : avgEngagementRate < 3.5 ? 'medium' : 'low',
    basedOn: { avgEngagementRate, followerGrowth, totalViews, platform },
  };
}

module.exports = {
  calculateEngagementRate,
  getPostEngagementRate,
  generatePerformanceReport,
  getTopPerformingContent,
  suggestContentStrategy,
};
