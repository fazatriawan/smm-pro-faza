function parseError(platform, error) {
  const response = error.response?.data;

  switch (platform) {
    case 'facebook':
    case 'instagram':
      return parseFacebookError(response);
    case 'youtube':
      return parseYouTubeError(response);
    case 'twitter':
      return parseTwitterError(response);
    default:
      return {
        friendlyMessage: error.message || 'Terjadi kesalahan tidak diketahui',
        actionNeeded: 'Coba lagi atau hubungi support'
      };
  }
}

function parseFacebookError(response) {
  const code = response?.error?.code;
  const subcode = response?.error?.error_subcode;
  const msg = response?.error?.message || '';

  switch (code) {
    case 190:
      if (subcode === 463) return {
        friendlyMessage: 'Token Facebook expired (sesi berakhir)',
        actionNeeded: 'Putus dan hubungkan ulang akun Facebook di menu Akun & User'
      };
      if (subcode === 467) return {
        friendlyMessage: 'Token Facebook tidak valid',
        actionNeeded: 'Putus dan hubungkan ulang akun Facebook di menu Akun & User'
      };
      return {
        friendlyMessage: 'Token Facebook bermasalah',
        actionNeeded: 'Putus dan hubungkan ulang akun Facebook di menu Akun & User'
      };
    case 200:
      return {
        friendlyMessage: 'Tidak punya izin untuk aksi ini di Page tersebut',
        actionNeeded: 'Pastikan kamu adalah Admin (bukan Editor) di Facebook Page ini'
      };
    case 100:
      if (msg.includes('video')) return {
        friendlyMessage: 'Tidak ada izin upload video di Page ini',
        actionNeeded: 'Tambahkan permission publish_video di Meta Developer'
      };
      return {
        friendlyMessage: 'Parameter tidak valid: ' + msg.slice(0, 80),
        actionNeeded: 'Periksa format konten yang dikirim'
      };
    case 32:
      return {
        friendlyMessage: 'Terlalu banyak request ke Facebook (rate limit)',
        actionNeeded: 'Tunggu beberapa menit lalu coba lagi'
      };
    case 4:
      return {
        friendlyMessage: 'Limit aplikasi Facebook tercapai',
        actionNeeded: 'Tunggu 1 jam lalu coba lagi'
      };
    case 341:
      return {
        friendlyMessage: 'Batas posting harian Facebook tercapai',
        actionNeeded: 'Coba lagi besok'
      };
    case 368:
      return {
        friendlyMessage: 'Akun Facebook dibatasi sementara oleh Meta',
        actionNeeded: 'Tunggu 24-48 jam, jangan lakukan aktivitas berulang'
      };
    default:
      return {
        friendlyMessage: `Facebook error #${code}: ${msg.slice(0, 100)}`,
        actionNeeded: 'Periksa log untuk detail lebih lanjut'
      };
  }
}

function parseYouTubeError(response) {
  const errors = response?.error?.errors || [];
  const reason = errors[0]?.reason || '';
  const message = response?.error?.message || '';
  const code = response?.error?.code;

  switch (reason) {
    case 'quotaExceeded':
      return {
        friendlyMessage: 'Kuota YouTube API harian habis',
        actionNeeded: 'Tunggu hingga pukul 08.00 WIB (reset kuota harian Google)'
      };
    case 'forbidden':
      return {
        friendlyMessage: 'Tidak ada izin untuk aksi ini di YouTube',
        actionNeeded: 'Putus dan hubungkan ulang akun YouTube di menu Akun & User'
      };
    case 'authError':
    case 'invalidCredentials':
      return {
        friendlyMessage: 'Token YouTube expired atau tidak valid',
        actionNeeded: 'Putus dan hubungkan ulang akun YouTube di menu Akun & User'
      };
    case 'uploadLimitExceeded':
      return {
        friendlyMessage: 'Batas upload video YouTube harian tercapai',
        actionNeeded: 'Coba lagi besok'
      };
    case 'videoNotFound':
      return {
        friendlyMessage: 'Video YouTube tidak ditemukan',
        actionNeeded: 'Periksa URL video yang dimasukkan'
      };
    case 'commentsDisabled':
      return {
        friendlyMessage: 'Komentar dinonaktifkan di video ini',
        actionNeeded: 'Tidak bisa berkomentar di video ini'
      };
    case 'duplicate':
      return {
        friendlyMessage: 'Sudah subscribe/like video/channel ini sebelumnya',
        actionNeeded: 'Tidak perlu aksi lanjutan'
      };
    default:
      if (code === 401) return {
        friendlyMessage: 'Token YouTube tidak valid atau expired',
        actionNeeded: 'Putus dan hubungkan ulang akun YouTube di menu Akun & User'
      };
      return {
        friendlyMessage: `YouTube error: ${message.slice(0, 100)}`,
        actionNeeded: 'Periksa log untuk detail lebih lanjut'
      };
  }
}

function parseTwitterError(response) {
  const title = response?.title || '';
  const detail = response?.detail || '';
  const status = response?.status;

  if (detail.includes('credits')) return {
    friendlyMessage: 'Akun Twitter tidak punya credits untuk aksi ini (Free tier)',
    actionNeeded: 'Upgrade ke Twitter Basic ($100/bln) untuk akses penuh'
  };

  switch (status) {
    case 401:
      return {
        friendlyMessage: 'Token Twitter expired atau tidak valid',
        actionNeeded: 'Putus dan hubungkan ulang akun Twitter di menu Akun & User'
      };
    case 403:
      return {
        friendlyMessage: 'Tidak ada izin untuk aksi ini di Twitter',
        actionNeeded: 'Periksa permission OAuth di Twitter Developer Portal'
      };
    case 429:
      return {
        friendlyMessage: 'Terlalu banyak request ke Twitter (rate limit)',
        actionNeeded: 'Tunggu 15 menit lalu coba lagi'
      };
    default:
      return {
        friendlyMessage: `Twitter error: ${detail.slice(0, 100)}`,
        actionNeeded: 'Periksa log untuk detail lebih lanjut'
      };
  }
}

module.exports = { parseError };
