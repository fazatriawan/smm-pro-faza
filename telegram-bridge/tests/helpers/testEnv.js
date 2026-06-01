/** Minimal env so `src/config/env.js` loads in tests without a real .env */
export function applyTestEnv() {
  process.env.TELEGRAM_BOT_TOKEN ??=
    '1234567890:AAHtest_token_for_unit_tests_only_xx';
  process.env.OUTSTAND_API_KEY ??=
    'test_outstand_api_key_minimum_32_chars_!!';
  process.env.GEMINI_API_KEY ??= 'test_gemini_api_key_for_unit_tests';
  process.env.AUTO_COMMENT_ENABLED ??= '0';
}
