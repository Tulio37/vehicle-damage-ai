import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const THUMBNAIL_WIDTH = 400;
const THUMBNAIL_QUALITY = 75;

export interface StoredFile {
  mediaId: string;
  originalUrl: string;
  thumbnailUrl: string;
  fileSizeBytes: number;
  mimeType: string;
  localPath: string;
  thumbnailLocalPath: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getUploadDir(): string {
  ensureDir(UPLOAD_DIR);
  return UPLOAD_DIR;
}

export async function saveMediaFile(
  tempPath: string,
  mediaId: string,
  occurrenceId: string,
  mimeType: string,
): Promise<StoredFile> {
  const occDir = path.join(UPLOAD_DIR, occurrenceId);
  ensureDir(occDir);

  const ext = mimeType.includes('png') ? '.png' : '.jpg';
  const originalFilename = `${mediaId}_original${ext}`;
  const thumbnailFilename = `${mediaId}_thumb.jpg`;

  const originalPath = path.join(occDir, originalFilename);
  const thumbnailPath = path.join(occDir, thumbnailFilename);

  // Copy original
  fs.copyFileSync(tempPath, originalPath);

  // Generate thumbnail
  await sharp(tempPath)
    .resize(THUMBNAIL_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toFile(thumbnailPath);

  const stats = fs.statSync(originalPath);

  return {
    mediaId,
    originalUrl: `/media/${occurrenceId}/${originalFilename}`,
    thumbnailUrl: `/media/${occurrenceId}/${thumbnailFilename}`,
    fileSizeBytes: stats.size,
    mimeType,
    localPath: originalPath,
    thumbnailLocalPath: thumbnailPath,
  };
}

export function getLocalPath(occurrenceId: string, mediaId: string, mimeType: string): string {
  const ext = mimeType.includes('png') ? '.png' : '.jpg';
  return path.join(UPLOAD_DIR, occurrenceId, `${mediaId}_original${ext}`);
}

export function deleteMediaFile(localPath: string): void {
  try {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  } catch (err) {
    console.error('[Storage] Erro ao deletar arquivo:', err);
  }
}
