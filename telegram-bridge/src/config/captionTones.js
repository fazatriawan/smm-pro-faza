/** @type {Record<string, { label: string, prompt: string }>} */
export const CAPTION_TONES = {
  informative: {
    label: '📰 Informatif',
    prompt:
      'Gaya INFORMATIF: jelas, faktual, minim hype, cocok berita/ekonomi. Hindari clickbait berlebihan.',
  },
  viral: {
    label: '🔥 Viral',
    prompt:
      'Gaya VIRAL: hook kuat di awal, CTA ajak komentar/share, tetap relevan dengan media. ' +
      'Hindari metafor klise (jas hujan, badai) kecuali memang ada di video. Fokus fakta & manfaat.',
  },
  formal: {
    label: '🏛 Formal',
    prompt:
      'Gaya FORMAL: sopan, profesional, seperti rilis media/korporat, tanpa slang berlebihan.',
  },
};

export function getTonePrompt(toneKey) {
  return CAPTION_TONES[toneKey]?.prompt || '';
}

export function getToneLabel(toneKey) {
  return CAPTION_TONES[toneKey]?.label || toneKey;
}
