import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { env } from '../config/env.js';
import { downloadFile } from './drive.js';
import { getFfmpegExecutable, probeFfmpeg } from '../utils/ffmpegPath.js';

export { probeFfmpeg };

let ffmpegChecked = false;
let ffmpegAvailable = false;
let ffmpegResolvedPath = '';

const FFMPEG_INSTALL_HINT =
  'ffmpeg tidak ditemukan.\n' +
  'Windows: winget install Gyan.FFmpeg lalu restart terminal & npm start.\n' +
  'Jika sudah install: tambahkan di .env FFMPEG_PATH=C:/.../ffmpeg.exe';

const VF_FILTERS = {
  vertical:
    'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
  square:
    'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black',
  landscape:
    'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
};

/**
 * @param {string} network
 */
export function isImageToVideoNetwork(network) {
  const n = (network || '').toLowerCase();
  return env.imageToVideoNetworks.includes(n);
}

/**
 * @param {string[]} networks
 */
export function networksNeedingImageToVideo(networks, hasVideo, hasImages) {
  if (hasVideo || !hasImages) return [];
  return networks.filter((n) => isImageToVideoNetwork(n));
}

export function getDurationForNetwork(network) {
  const n = (network || '').toLowerCase();
  const custom = env.imageToVideoDurationByNetwork?.[n];
  if (custom != null) {
    return Math.max(3, Math.min(60, Number(custom) || env.imageToVideoDurationSec));
  }
  return env.imageToVideoDurationSec;
}

/**
 * @param {string[]} args
 */
function runFfmpeg(args) {
  const exe = getFfmpegExecutable();
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else {
        reject(
          new Error(
            `ffmpeg gagal (code ${code}): ${stderr.slice(-600) || 'no output'}`
          )
        );
      }
    });
  });
}

export async function isFfmpegAvailable() {
  if (ffmpegChecked) return ffmpegAvailable;
  ffmpegChecked = true;
  const probe = probeFfmpeg();
  ffmpegResolvedPath = probe.path;
  ffmpegAvailable = probe.ok;
  if (ffmpegAvailable) {
    console.log(`[FFmpeg] OK — ${ffmpegResolvedPath}`);
  }
  return ffmpegAvailable;
}

/**
 * @param {string} audioPath
 */
async function assertAudioFile(audioPath) {
  try {
    const stat = await fs.stat(audioPath);
    if (!stat.isFile()) {
      throw new Error(`File musik tidak ditemukan: ${audioPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `File musik tidak ditemukan: ${audioPath}\n` +
          'Taruh MP3 di assets/audio/ atau set IMAGE_TO_VIDEO_AUDIO_PATH di .env.'
      );
    }
    throw err;
  }
}

function getVideoFilter() {
  return VF_FILTERS.vertical || VF_FILTERS.square;
}

/**
 * @param {{ imageBuffer: Buffer, imageName: string, audioPath: string, durationSec: number, suffix?: string }} options
 */
export async function buildVideoFromImage({
  imageBuffer,
  imageName,
  audioPath,
  durationSec,
  suffix = 'reel',
}) {
  if (!(await isFfmpegAvailable())) {
    throw new Error(FFMPEG_INSTALL_HINT);
  }

  await assertAudioFile(audioPath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-reel-'));
  const ext = path.extname(imageName) || '.jpg';
  const imgPath = path.join(tmpDir, `frame${ext}`);
  const outPath = path.join(tmpDir, 'out.mp4');

  try {
    await fs.writeFile(imgPath, imageBuffer);

    await runFfmpeg([
      '-y',
      '-loop',
      '1',
      '-i',
      imgPath,
      '-stream_loop',
      '-1',
      '-i',
      audioPath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-vf',
      getVideoFilter(),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      String(durationSec),
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const buffer = await fs.readFile(outPath);
    const base = path.basename(imageName, ext) || 'konten';
    return {
      buffer,
      name: `${base}-${suffix}.mp4`,
      mimeType: 'video/mp4',
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {{ imageBuffer: Buffer, imageName: string, durationSec: number, suffix?: string }} options
 */
export async function buildVideoFromImageSilent({
  imageBuffer,
  imageName,
  durationSec,
  suffix = 'reel',
}) {
  if (!(await isFfmpegAvailable())) {
    throw new Error(FFMPEG_INSTALL_HINT);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-reel-'));
  const ext = path.extname(imageName) || '.jpg';
  const imgPath = path.join(tmpDir, `frame${ext}`);
  const outPath = path.join(tmpDir, 'out-silent.mp4');

  try {
    await fs.writeFile(imgPath, imageBuffer);
    await runFfmpeg([
      '-y',
      '-loop',
      '1',
      '-i',
      imgPath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-vf',
      getVideoFilter(),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-t',
      String(durationSec),
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const buffer = await fs.readFile(outPath);
    const base = path.basename(imageName, ext) || 'konten';
    return {
      buffer,
      name: `${base}-${suffix}.mp4`,
      mimeType: 'video/mp4',
      silent: true,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Gambar Drive → MP4 vertikal + musik (Reels / Shorts / video post).
 * @param {{ id: string, name: string, mimeType: string }} driveImage
 * @param {string} [network]
 */
/**
 * Beberapa gambar → slideshow video + musik.
 * @param {Array<{ id: string, name: string }>} driveImages
 * @param {string} network
 */
export async function convertDriveImagesToSocialVideo(driveImages, network = 'social') {
  if (!driveImages?.length) {
    throw new Error('Tidak ada gambar untuk dikonversi.');
  }
  if (driveImages.length === 1) {
    return convertDriveImageToSocialVideo(driveImages[0], network);
  }

  const durationSec = getDurationForNetwork(network);
  const downloaded = await Promise.all(driveImages.map(resolveImageBuffer));

  const audioPath = env.imageToVideoAudioPath;
  if (audioPath) {
    return buildCarouselVideo({
      items: downloaded,
      audioPath,
      durationSec,
      suffix: network === 'youtube' ? 'yt' : 'reel',
    });
  }
  if (env.imageToVideoAllowSilent) {
    return buildCarouselVideoSilent({
      items: downloaded,
      durationSec,
      suffix: 'reel',
    });
  }
  throw new Error('Gambar→video (carousel) butuh musik di assets/audio/.');
}

async function buildCarouselVideo({ items, audioPath, durationSec, suffix }) {
  if (!(await isFfmpegAvailable())) throw new Error(FFMPEG_INSTALL_HINT);
  await assertAudioFile(audioPath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-carousel-'));
  const segDur = Math.max(2, durationSec / items.length);
  const segPaths = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const ext = path.extname(items[i].name) || '.jpg';
      const imgPath = path.join(tmpDir, `img${i}${ext}`);
      const segPath = path.join(tmpDir, `seg${i}.mp4`);
      await fs.writeFile(imgPath, items[i].buffer);
      await runFfmpeg([
        '-y',
        '-loop',
        '1',
        '-i',
        imgPath,
        '-vf',
        getVideoFilter(),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-t',
        String(segDur),
        '-an',
        segPath,
      ]);
      segPaths.push(segPath);
    }

    const listPath = path.join(tmpDir, 'list.txt');
    const listBody = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(listPath, listBody);

    const outPath = path.join(tmpDir, 'carousel.mp4');
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-stream_loop',
      '-1',
      '-i',
      audioPath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      String(durationSec),
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const buffer = await fs.readFile(outPath);
    return {
      buffer,
      name: `carousel-${items.length}-${suffix}.mp4`,
      mimeType: 'video/mp4',
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildCarouselVideoSilent({ items, durationSec, suffix }) {
  if (!(await isFfmpegAvailable())) throw new Error(FFMPEG_INSTALL_HINT);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-carousel-'));
  const segDur = Math.max(2, durationSec / items.length);
  const segPaths = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const ext = path.extname(items[i].name) || '.jpg';
      const imgPath = path.join(tmpDir, `img${i}${ext}`);
      const segPath = path.join(tmpDir, `seg${i}.mp4`);
      await fs.writeFile(imgPath, items[i].buffer);
      await runFfmpeg([
        '-y',
        '-loop',
        '1',
        '-i',
        imgPath,
        '-vf',
        getVideoFilter(),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-t',
        String(segDur),
        '-an',
        segPath,
      ]);
      segPaths.push(segPath);
    }

    const listPath = path.join(tmpDir, 'list.txt');
    await fs.writeFile(
      listPath,
      segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    );

    const outPath = path.join(tmpDir, 'carousel-silent.mp4');
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-t',
      String(durationSec),
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const buffer = await fs.readFile(outPath);
    return {
      buffer,
      name: `carousel-${items.length}-${suffix}.mp4`,
      mimeType: 'video/mp4',
      silent: true,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {{ id?: string, buffer?: Buffer, name?: string }} imageFile
 */
async function resolveImageBuffer(imageFile) {
  if (imageFile.buffer) {
    return {
      buffer: imageFile.buffer,
      name: imageFile.name || 'image.jpg',
    };
  }
  if (imageFile.id) {
    const { buffer, name } = await downloadFile(imageFile.id);
    return { buffer, name };
  }
  throw new Error('Gambar tanpa id atau buffer.');
}

export async function convertDriveImageToSocialVideo(driveImage, network = 'social') {
  const { buffer, name } = await resolveImageBuffer(driveImage);
  const opts = {
    imageBuffer: buffer,
    imageName: name,
    durationSec: getDurationForNetwork(network),
    suffix: network === 'youtube' ? 'yt' : 'reel',
  };

  const audioPath = env.imageToVideoAudioPath;
  if (audioPath) {
    return buildVideoFromImage({ ...opts, audioPath });
  }

  if (env.imageToVideoAllowSilent) {
    console.warn(
      `[${network}] Tidak ada musik — video tanpa suara. Taruh MP3 di assets/audio/.`
    );
    return buildVideoFromImageSilent(opts);
  }

  throw new Error(
    'Gambar→video butuh musik latar.\n' +
      'Taruh MP3 di telegram-bridge/assets/audio/ atau set IMAGE_TO_VIDEO_AUDIO_PATH di .env.\n' +
      'Atau IMAGE_TO_VIDEO_ALLOW_SILENT=true untuk video tanpa suara.'
  );
}

/** @deprecated */
export async function convertDriveImageToYoutubeVideo(driveImage) {
  return convertDriveImageToSocialVideo(driveImage, 'youtube');
}
