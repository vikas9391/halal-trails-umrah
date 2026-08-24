import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('data');
const BOOKING_DIR = path.join(ROOT, 'bookings');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

function getKey() {
  const raw = process.env.BOOKING_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('BOOKING_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function encrypt(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decrypt(buffer) {
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function ensureDataDirs() {
  await fs.mkdir(BOOKING_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveBooking(booking) {
  await ensureDataDirs();
  const file = path.join(BOOKING_DIR, `${booking.id}.enc`);
  const data = Buffer.from(JSON.stringify(booking, null, 2), 'utf8');
  await fs.writeFile(file, encrypt(data), { mode: 0o600 });
  return booking;
}

export async function getBooking(id) {
  const file = path.join(BOOKING_DIR, `${id}.enc`);
  const encrypted = await fs.readFile(file);
  return JSON.parse(decrypt(encrypted).toString('utf8'));
}

export async function updateBooking(id, mutator) {
  const booking = await getBooking(id);
  const next = await mutator(structuredClone(booking));
  return saveBooking(next);
}

export async function saveUpload({ bookingId, fieldname, originalname, mimetype, buffer }) {
  await ensureDataDirs();
  const safeExt = path.extname(originalname || '').replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
  const token = crypto.randomBytes(12).toString('hex');
  const storageKey = `${bookingId}-${fieldname}-${token}${safeExt}.enc`;
  await fs.writeFile(path.join(UPLOAD_DIR, storageKey), encrypt(buffer), { mode: 0o600 });
  return { fieldname, originalname, mimetype, storageKey, size: buffer.length };
}
