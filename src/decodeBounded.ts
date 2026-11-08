import { ImageDecodeFailure } from './ImageDecodeFailure';
import { ImageFormat } from './ImageFormat';
import { probeImage } from './probeImage';

import type { BoundedDecodeOptions, BoundedDecodeResult, ImageDecodeFailed, ImageProbe } from './types';

export const DEFAULT_MAX_SIDE = 1600;
export const DEFAULT_MAX_SOURCE_PIXELS = 220_000_000;
export const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;

const HEAD_BYTES = 1024 * 1024;
const MOST_HEAD_BYTES = 16 * HEAD_BYTES;
const DECODE_STYLE: ImageBitmapOptions = { imageOrientation: 'from-image', resizeQuality: 'medium' };
const HEADER_CAN_SIT_DEEP: ReadonlySet<ImageFormat> = new Set([ImageFormat.Jpeg, ImageFormat.Heic, ImageFormat.Avif]);
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
  return createImageBitmap(source, { ...DECODE_STYLE, resizeWidth: size.width, resizeHeight: size.height });
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

async function decodeUnknownSize(file: Blob, format: ImageFormat, maxSide: number): Promise<BoundedDecodeResult> {
  const first = await createImageBitmap(file, { ...DECODE_STYLE, resizeWidth: maxSide });
  const size = { width: first.width, height: first.height };
  if (Math.max(size.width, size.height) <= maxSide) {
    return decoded(first, format, size);
  }
  try {
    return decoded(await resized(first, fitWithin(size, maxSide)), format, size);
  } finally {
    first.close();
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
    return decodeUnknownSize(file, format, limits.maxSide);
  }
  if (width * height > limits.maxSourcePixels) {
    return failed(ImageDecodeFailure.TooLarge, probe);
  }
  return decodeKnownSize(file, format, { width, height }, limits.maxSide);
}

async function probeHead(file: Blob, bytes: number): Promise<ImageProbe> {
  return probeImage(new Uint8Array(await file.slice(0, bytes).arrayBuffer()));
}

async function probeFile(file: Blob): Promise<ImageProbe> {
  const probe = await probeHead(file, HEAD_BYTES);
  const isWorthReadingMore = probe.width === undefined && HEADER_CAN_SIT_DEEP.has(probe.format) && file.size > HEAD_BYTES;
  return isWorthReadingMore ? probeHead(file, MOST_HEAD_BYTES) : probe;
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
    probe = await probeFile(file);
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
