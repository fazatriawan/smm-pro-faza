// src/main/queuePublisher.js
// In-process async queue — tidak butuh Redis/BullMQ

const { publishJob } = require('../services/internalPublisher');

const jobQueue  = [];
let processing  = false;
let _supabase   = null;
let _encKey     = null;
let _logFn      = null;

function initQueue(supabase, encryptionKey, addLog) {
  _supabase = supabase;
  _encKey   = encryptionKey;
  _logFn    = addLog;
}

async function runQueue() {
  if (processing) return;
  processing = true;
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    try {
      const r = await publishJob(_supabase, _encKey, job);
      _logFn?.({ type: 'success', message: `✅ [${r.platform}] @${r.username}: Berhasil diposting` });
    } catch (err) {
      _logFn?.({ type: 'error', message: `❌ [${job.platform}] ID ${job.accountId}: ${err.message}` });
      // update status to failed in Supabase
      try {
        await _supabase.from('post_targets').update({
          status:        'failed',
          error_message: err.message,
        }).eq('id', job.postTargetId);
      } catch (_) { /* silent */ }
    }
  }
  processing = false;
}

async function pushJob(_redisUrl, jobData) {
  if (!_supabase) throw new Error('Queue belum diinisialisasi — simpan Pengaturan Supabase terlebih dahulu');
  jobQueue.push(jobData);
  runQueue(); // fire-and-forget
  return `local-${Date.now()}`;
}

module.exports = { pushJob, initQueue };
