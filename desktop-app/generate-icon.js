/**
 * Jalankan sekali: node generate-icon.js
 * Menghasilkan assets/icon.png (256x256) untuk window icon Electron.
 */
const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

(async () => {
  const htmlPath = path.resolve(__dirname, '../assets/generate-icon.html');
  const outDir   = path.resolve(__dirname, 'assets');
  const outPath  = path.join(outDir, 'icon.png');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();

  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#c');

  // Render ulang di ukuran 256x256 dan ambil sebagai PNG
  const pngBase64 = await page.evaluate(() => {
    const size = 256;
    const out  = document.createElement('canvas');
    out.width  = size;
    out.height = size;
    const octx = out.getContext('2d');
    // panggil draw() yang sama
    // eslint-disable-next-line no-undef
    draw(octx, size);
    return out.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  });

  fs.writeFileSync(outPath, Buffer.from(pngBase64, 'base64'));
  console.log('Icon saved:', outPath);

  await browser.close();
})();
