const EMOJI_GROUPS = [
  ['🔥', '⚡', '💥', '✨'],
  ['✅', '👍', '💯', '🎯'],
  ['❤️', '🧡', '💛', '💚'],
  ['😍', '🤩', '😊', '🥰'],
  ['💪', '🙌', '✊', '👊'],
  ['👀', '🫣', '🧐', '👁️'],
  ['🎉', '🥳', '🎊', '🎈'],
];

/**
 * Variasi ringan caption per-akun agar tidak identik antar akun.
 * index=0 selalu kembalikan caption asli tanpa modifikasi.
 *
 * @param {string} caption
 * @param {number} index - nomor urut akun (0-based)
 * @returns {string}
 */
export function varyCaption(caption, index) {
  if (!caption || index === 0) return caption;

  let result = caption;

  // 1. Rotasi urutan hashtag
  const hashtagRegex = /#[\wÀ-ɏ一-鿿]+/g;
  const hashtags = result.match(hashtagRegex) || [];
  if (hashtags.length >= 2) {
    const shift = index % hashtags.length;
    const rotated = [...hashtags.slice(shift), ...hashtags.slice(0, shift)];
    let i = 0;
    result = result.replace(hashtagRegex, () => rotated[i++]);
  }

  // 2. Swap satu emoji berdasarkan index
  for (const group of EMOJI_GROUPS) {
    for (let gi = 0; gi < group.length; gi++) {
      if (result.includes(group[gi])) {
        const replacement = group[(gi + index) % group.length];
        if (replacement !== group[gi]) {
          result = result.replace(group[gi], replacement);
        }
        return result; // hanya swap satu emoji per caption
      }
    }
  }

  return result;
}
