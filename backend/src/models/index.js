const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── USER (Admin/Operator) ───────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'operator'], default: 'operator' },
  createdAt: { type: Date, default: Date.now }
});
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
UserSchema.methods.comparePassword = function(p) {
  return bcrypt.compare(p, this.password);
};
const User = mongoose.model('User', UserSchema);

// ─── SOCIAL ACCOUNT ──────────────────────────────────────────────────────────
const SocialAccountSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, required: true },         // e.g. "@brand_official"
  platform: {
    type: String,
    enum: ['youtube', 'instagram', 'facebook', 'facebook_personal', 'twitter', 'tiktok'],
    required: true
  },
  platformUserId: String,
  platformUsername: String,
  accessToken: String,       // encrypted in production
  refreshToken: String,
  tokenExpiresAt: Date,
  pageId: String,            // for Facebook Pages
  isActive: { type: Boolean, default: true },
  connectedAt: { type: Date, default: Date.now },
  // Warmup settings per account
  warmup: {
    enabled: { type: Boolean, default: false },
    dailyLikes: { type: Number, default: 30 },
    dailyComments: { type: Number, default: 10 },
    dailyFollows: { type: Number, default: 5 },
    dailySearches: { type: Number, default: 15 },
    dailySaves: { type: Number, default: 10 }
  }
}, { timestamps: true });
const SocialAccount = mongoose.model('SocialAccount', SocialAccountSchema);

// ─── POST ─────────────────────────────────────────────────────────────────────
const PostSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  caption: { type: String, required: true },
  mediaUrls: [String],          // uploaded file paths
  mediaType: { type: String, enum: ['image', 'video', 'text', 'reel', 'short'] },
  targetAccounts: [{            // which social accounts to post to
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    platformPostId: String,
    sentAt: Date,
    error: String
  }],
  scheduledAt: Date,
  isImmediate: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'scheduled', 'processing', 'completed', 'partial', 'failed'], default: 'draft' },
  retryCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 3 },
  hashtags: [String],
  link: String,
  platformOverrides: {          // per-platform caption override
    youtube: { title: String, description: String, tags: [String] },
    instagram: { caption: String },
    facebook: { caption: String },
    twitter: { caption: String },
    tiktok: { caption: String }
  }
}, { timestamps: true });
const Post = mongoose.model('Post', PostSchema);

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
const NotificationSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
  platform: String,
  type: { type: String, enum: ['like', 'comment', 'follow', 'mention', 'share', 'dm', 'system'] },
  content: String,
  fromUser: String,
  postId: String,
  isRead: { type: Boolean, default: false },
  rawData: mongoose.Schema.Types.Mixed,
  receivedAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

// ─── ANALYTICS SNAPSHOT ───────────────────────────────────────────────────────
const AnalyticsSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
  date: { type: Date, required: true },
  followers: Number,
  following: Number,
  posts: Number,
  reach: Number,
  impressions: Number,
  engagements: Number,
  likes: Number,
  comments: Number,
  shares: Number,
  saves: Number,
  profileViews: Number,
  // YouTube specific
  subscribers: Number,
  views: Number,
  watchTimeMinutes: Number,
  // TikTok specific
  videoViews: Number,
  completionRate: Number
}, { timestamps: true });
AnalyticsSchema.index({ account: 1, date: -1 });
const Analytics = mongoose.model('Analytics', AnalyticsSchema);

// ─── WARMUP LOG ──────────────────────────────────────────────────────────────
const WarmupLogSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
  date: { type: Date, default: Date.now },
  action: { type: String, enum: ['like', 'comment', 'follow', 'search', 'save', 'view'] },
  targetUrl: String,
  success: Boolean,
  error: String
});
const WarmupLog = mongoose.model('WarmupLog', WarmupLogSchema);

// ─── AMPLIFY JOB ─────────────────────────────────────────────────────────────
const AmplifyJobSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetUrl: { type: String, required: true },
  platform: String,
  actions: [{
    type: { type: String, enum: ['like', 'dislike', 'comment', 'share', 'repost', 'save', 'subscribe', 'follow', 'bookmark'] },
    enabled: Boolean,
    commentTemplates: [String]
  }],
  accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' }],
  results: [{
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount' },
    action: String,
    success: Boolean,
    error: String,
    executedAt: Date
  }],
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed', 'stopped'], default: 'pending' },
}, { timestamps: true });
const AmplifyJob = mongoose.model('AmplifyJob', AmplifyJobSchema);

module.exports = { User, SocialAccount, Post, Notification, Analytics, WarmupLog, AmplifyJob };
