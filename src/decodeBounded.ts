import { ImageDecodeFailure } from './ImageDecodeFailure';
import { ImageFormat } from './ImageFormat';
import { probeImage } from './probeImage';

import type { BoundedDecodeOptions, BoundedDecodeResult, ImageDecodeFailed, ImageProbe } from './types';

export const DEFAULT_MAX_SIDE = 1600;
export const DEFAULT_MAX_SOURCE_PIXELS = 220_000_000;
export const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;

const HEAD_BYTES = 1024 * 1024;
const MEMORY_MESSAGE = /memory|allocat/i;
const UNKNOWN_IMAGE: ImageProbe = { format: ImageFormat.Unknown };

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Limits {
  readonly maxSide: number;
  readonly maxSourcePixels: number;
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function failed(failure: ImageDecodeFailure, probe: ImageProbe, errorName?: string): ImageDecodeFailed {
  return { ok: false, failure, format: probe.format, sourceWidth: probe.width, sourceHeight: probe.height, errorName };
}

function decoded(bitmap: ImageBitmap, format: ImageFormat, size: Size): BoundedDecodeResult {
  return { ok: true, bitmap, format, sourceWidth: size.width, sourceHeight: size.height };
}

function fitWithin(size: Size, maxSide: number): Size {
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

function resized(source: ImageBitmapSource, size: Size): Promise<ImageBitmap> {
  return createImageBitmap(source, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
}

async function decodeKnownSize(file: Blob, format: ImageFormat, size: Size, maxSide: number): Promise<BoundedDecodeResult> {
  const target = fitWithin(size, maxSide);
  const first = await resized(file, target);
  const cameBackRotated = target.width !== target.height && first.width === target.height && first.height === target.width;
  if (!cameBackRotated) {
    return decoded(first, format, size);
  }
  first.close();
  return decoded(await resized(file, { width: target.height, height: target.width }), format, size);
}

async function decodeUnknownSize(file: Blob, format: ImageFormat, limits: Limits): Promise<BoundedDecodeResult> {
  const full = await createImageBitmap(file);
  const size = { width: full.width, height: full.height };
  try {
    if (size.width * size.height > limits.maxSourcePixels) {
      return failed(ImageDecodeFailure.TooLarge, { format, ...size });
    }
    return decoded(await resized(full, fitWithin(size, limits.maxSide)), format, size);
  } finally {
    full.close();
  }
}

function failureOfDecode(error: unknown, format: ImageFormat): ImageDecodeFailure {
  const isMemory = error instanceof Error && (error.name === 'RangeError' || MEMORY_MESSAGE.test(error.message));
  if (isMemory) {
    return ImageDecodeFailure.OutOfMemory;
  }
  const isUnsupported = format === ImageFormat.Heic || format === ImageFormat.Avif || format === ImageFormat.Unknown;
  return isUnsupported ? ImageDecodeFailure.UnsupportedFormat : ImageDecodeFailure.DecodeFailed;
}

async function decodeProbed(file: Blob, probe: ImageProbe, limits: Limits): Promise<BoundedDecodeResult> {
  const { width, height, format } = probe;
  if (width === undefined || height === undefined) {
    return decodeUnknownSize(file, format, limits);
  }
  if (width * height > limits.maxSourcePixels) {
    return failed(ImageDecodeFailure.TooLarge, probe);
  }
  return decodeKnownSize(file, format, { width, height }, limits.maxSide);
}

/** Decodes a photo no larger than `maxSide`; never throws, a failure names its reason and carries no image data. */
export async function decodeBounded(file: Blob, options: BoundedDecodeOptions = {}): Promise<BoundedDecodeResult> {
  if (file.size > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) {
    return failed(ImageDecodeFailure.TooLarge, UNKNOWN_IMAGE);
  }
  if (file.size === 0) {
    return failed(ImageDecodeFailure.ReadFailed, UNKNOWN_IMAGE, 'EmptyFile');
  }
  let probe: ImageProbe;
  try {
    probe = probeImage(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()));
  } catch (error) {
    return failed(ImageDecodeFailure.ReadFailed, UNKNOWN_IMAGE, errorNameOf(error));
  }
  const limits = { maxSide: options.maxSide ?? DEFAULT_MAX_SIDE, maxSourcePixels: options.maxSourcePixels ?? DEFAULT_MAX_SOURCE_PIXELS };
  try {
    return await decodeProbed(file, probe, limits);
  } catch (error) {
    return failed(failureOfDecode(error, probe.format), probe, errorNameOf(error));
  }
}
