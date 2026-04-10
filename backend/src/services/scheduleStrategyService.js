/**
 * Schedule Strategy Service
 * Menyediakan strategi waktu posting optimal per platform dan generate jadwal konten.
 */

// Best posting times per platform (jam WIB / UTC+7)
const OPTIMAL_TIMES = {
  tiktok: {
    default: ['07:00', '12:00', '19:00'],
    video: ['07:00', '12:00', '19:00'],
    image: ['08:00', '13:00', '20:00'],
    bestDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  instagram: {
    default: ['11:00', '20:00'],
    reel: ['19:00', '21:00'],
    image: ['11:00', '13:00'],
    story: ['08:00', '21:00'],
    bestDays: ['Tuesday', 'Wednesday', 'Friday'],
  },
  youtube: {
    default: ['15:00'],
    video: ['14:00', '16:00'],
    short: ['12:00', '18:00'],
    bestDays: ['Thursday', 'Friday', 'Saturday'],
  },
  linkedin: {
    default: ['09:00'],
    post: ['08:00', '10:00'],
    article: ['09:00'],
    video: ['10:00'],
    bestDays: ['Tuesday', 'Wednesday', 'Thursday'],
  },
  twitter: {
    default: ['09:00', '12:00', '17:00'],
    tweet: ['09:00', '12:00', '17:00'],
    thread: ['10:00', '15:00'],
    bestDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  facebook: {
    default: ['14:00'],
    post: ['13:00', '16:00'],
    reel: ['14:00', '18:00'],
    bestDays: ['Wednesday', 'Thursday', 'Friday'],
  },
  threads: {
    default: ['10:00', '19:00'],
    post: ['10:00', '19:00'],
    bestDays: ['Monday', 'Wednesday', 'Friday'],
  },
  pinterest: {
    default: ['20:00', '21:00'],
    pin: ['20:00', '21:00'],
    bestDays: ['Saturday', 'Sunday', 'Friday'],
  },
};

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_ID = {
  Sunday: 'Minggu',
  Monday: 'Senin',
  Tuesday: 'Selasa',
  Wednesday: 'Rabu',
  Thursday: 'Kamis',
  Friday: 'Jumat',
  Saturday: 'Sabtu',
};

/**
 * Mendapatkan waktu posting optimal untuk satu platform + content type.
 * @param {string} platform
 * @param {string} contentType - (opsional) e.g. 'video', 'image', 'reel'
 * @returns {{ platform: string, contentType: string, bestTimes: string[], bestDays: string[], note: string }}
 */
function getOptimalPostingTime(platform, contentType) {
  const key = (platform || '').toLowerCase().replace('/', '_').replace('twitter_x', 'twitter');
  const config = OPTIMAL_TIMES[key];
  if (!config) {
    return {
      platform,
      contentType: contentType || 'default',
      bestTimes: ['10:00', '19:00'],
      bestDays: DAYS_OF_WEEK,
      note: 'Platform tidak dikenali, gunakan waktu umum.',
    };
  }

  const typeKey = (contentType || '').toLowerCase();
  const bestTimes = config[typeKey] || config.default;
  const bestDays = config.bestDays;

  return {
    platform,
    contentType: typeKey || 'default',
    bestTimes,
    bestDays,
    bestDaysId: bestDays.map(d => DAYS_ID[d] || d),
    note: `Waktu optimal untuk ${platform} (${typeKey || 'default'})`,
  };
}

/**
 * Generate jadwal mingguan untuk beberapa platform dan content type.
 * @param {string[]} platforms
 * @param {string[]} contentTypes
 * @returns {Object} Jadwal per hari dalam seminggu
 */
function generateWeeklySchedule(platforms, contentTypes) {
  const targetPlatforms = platforms && platforms.length > 0
    ? platforms
    : Object.keys(OPTIMAL_TIMES);

  const schedule = {};

  for (const day of DAYS_OF_WEEK) {
    schedule[day] = { dayId: DAYS_ID[day], slots: [] };

    for (const platform of targetPlatforms) {
      const key = platform.toLowerCase().replace('/', '_').replace('twitter_x', 'twitter');
      const config = OPTIMAL_TIMES[key];
      if (!config) continue;
      if (!config.bestDays.includes(day)) continue;

      const contentType = contentTypes && contentTypes.length > 0
        ? contentTypes.find(ct => config[ct]) || 'default'
        : 'default';
      const times = config[contentType] || config.default;

      for (const time of times) {
        schedule[day].slots.push({ platform, contentType, time });
      }
    }

    // Sort by time
    schedule[day].slots.sort((a, b) => a.time.localeCompare(b.time));
  }

  return schedule;
}

/**
 * Suggest batch schedule untuk sejumlah konten ke beberapa platform.
 * Distribusikan konten secara merata sepanjang minggu.
 * @param {number} videoCount - Jumlah konten yang akan dijadwalkan
 * @param {string[]} platforms
 * @returns {{ schedule: Array<{ date: string, day: string, platform: string, time: string }>, totalSlots: number }}
 */
function suggestBatchSchedule(videoCount, platforms) {
  const targetPlatforms = platforms && platforms.length > 0
    ? platforms
    : ['tiktok', 'instagram'];

  const count = Math.max(1, Number(videoCount) || 7);
  const today = new Date();
  const slots = [];

  // Kumpulkan semua slot tersedia dalam 2 minggu ke depan
  const availableSlots = [];
  for (let d = 0; d < 14; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dayName = DAYS_OF_WEEK[date.getDay()];

    for (const platform of targetPlatforms) {
      const key = platform.toLowerCase().replace('/', '_').replace('twitter_x', 'twitter');
      const config = OPTIMAL_TIMES[key];
      if (!config) continue;
      if (!config.bestDays.includes(dayName)) continue;

      const times = config.default;
      for (const time of times) {
        const [hour, minute] = time.split(':').map(Number);
        const slotDate = new Date(date);
        slotDate.setHours(hour, minute, 0, 0);
        if (slotDate > today) {
          availableSlots.push({
            date: slotDate.toISOString(),
            dateFormatted: `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, '0')}-${String(slotDate.getDate()).padStart(2, '0')}`,
            day: dayName,
            dayId: DAYS_ID[dayName],
            platform,
            time,
          });
        }
      }
    }
  }

  // Ambil slot secara merata, distribusi round-robin per platform
  const perPlatformSlots = {};
  for (const p of targetPlatforms) perPlatformSlots[p] = availableSlots.filter(s => s.platform === p);

  let remaining = count;
  let idx = 0;
  while (remaining > 0 && idx < availableSlots.length * 2) {
    for (const p of targetPlatforms) {
      if (remaining <= 0) break;
      const pSlots = perPlatformSlots[p];
      const slotIdx = slots.filter(s => s.platform === p).length;
      if (slotIdx < pSlots.length) {
        slots.push(pSlots[slotIdx]);
        remaining--;
      }
    }
    idx++;
    if (targetPlatforms.every(p => slots.filter(s => s.platform === p).length >= perPlatformSlots[p].length)) break;
  }

  slots.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    schedule: slots.slice(0, count),
    totalSlots: slots.length,
    videoCount: count,
    platforms: targetPlatforms,
  };
}

module.exports = { getOptimalPostingTime, generateWeeklySchedule, suggestBatchSchedule, OPTIMAL_TIMES };
