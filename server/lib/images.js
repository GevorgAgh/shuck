import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { badRequest } from './errors.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'gif']);

/** URLs for one stored image (thumb + large). file_path is the base path inside uploads/. */
export function imageUrls(filePath) {
  if (!filePath) return null;
  return { thumb: `/uploads/${filePath}-thumb.webp`, large: `/uploads/${filePath}-large.webp` };
}

/**
 * Checks that the bytes really are an image (the file name and the browser's MIME type
 * can lie: a renamed .exe is caught here), then writes a 400px thumbnail and a 1200px
 * large version as WebP. Returns the base path to keep in SQLite.
 * Runs OUTSIDE any database transaction.
 */
export async function processImage(buffer, originalName = 'file') {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw badRequest(`"${originalName}" is not an image. Upload a JPEG, PNG or WebP photo.`);
  }
  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw badRequest(`"${originalName}" is not a supported image type. Upload a JPEG, PNG or WebP photo.`);
  }
  if (!meta.width || !meta.height || meta.width < 50 || meta.height < 50) {
    throw badRequest(`"${originalName}" is too small. Use a photo at least 50×50 pixels.`);
  }

  const id = crypto.randomBytes(9).toString('base64url');
  const rel = `products/${id}`;
  const base = path.join(config.uploadsDir, rel);
  await fs.mkdir(path.dirname(base), { recursive: true });

  const img = sharp(buffer, { failOn: 'error' }).rotate(); // respect phone EXIF orientation
  await Promise.all([
    img.clone().resize(400, 400, { fit: 'cover' }).webp({ quality: 78 }).toFile(`${base}-thumb.webp`),
    img.clone().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(`${base}-large.webp`),
  ]);
  return rel;
}

export async function deleteImageFiles(filePath) {
  const base = path.join(config.uploadsDir, filePath);
  await Promise.all([fs.rm(`${base}-thumb.webp`, { force: true }), fs.rm(`${base}-large.webp`, { force: true })]);
}
