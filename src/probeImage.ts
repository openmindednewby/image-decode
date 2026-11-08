import { ImageFormat } from './ImageFormat';

import type { ImageProbe } from './types';

interface Size {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const MARKER_PREFIX = 0xff;
const APP1 = 0xe1;
const EXIF_WORD = 0x45786966;
const EXIF_ORIENTATION_TAG = 0x0112;
const LITTLE_ENDIAN_MARK = 0x4949;
const FIRST_ROTATING_ORIENTATION = 5;
const IFD_ENTRY_BYTES = 12;
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
const AVIF_BRANDS = ['avif', 'avis'];

function hasSignature(head: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => head[index] === byte);
}

function ascii(head: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...head.subarray(at, at + length));
}

function bmffBrands(head: Uint8Array, view: DataView): string[] {
  const end = Math.min(view.getUint32(0), head.length);
  const brands = [ascii(head, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) {
    brands.push(ascii(head, at, 4));
  }
  return brands;
}

function bmffFormat(head: Uint8Array, view: DataView): ImageFormat {
  const brands = bmffBrands(head, view);
  if (brands.some((brand) => AVIF_BRANDS.includes(brand))) {
    return ImageFormat.Avif;
  }
  return brands.some((brand) => HEIC_BRANDS.includes(brand)) ? ImageFormat.Heic : ImageFormat.Unknown;
}

function formatOf(head: Uint8Array, view: DataView): ImageFormat {
  if (hasSignature(head, JPEG_SIGNATURE)) {
    return ImageFormat.Jpeg;
  }
  if (hasSignature(head, PNG_SIGNATURE)) {
    return ImageFormat.Png;
  }
  if (ascii(head, 0, 4) === 'GIF8') {
    return ImageFormat.Gif;
  }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return ImageFormat.Webp;
  }
  return ascii(head, 4, 4) === 'ftyp' ? bmffFormat(head, view) : ImageFormat.Unknown;
}

function exifOrientation(view: DataView, start: number): number | undefined {
  if (view.getUint32(start) !== EXIF_WORD) {
    return undefined;
  }
  const tiff = start + 6;
  const little = view.getUint16(tiff) === LITTLE_ENDIAN_MARK;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  const entries = view.getUint16(ifd, little);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, little) === EXIF_ORIENTATION_TAG) {
      return view.getUint16(entry + 8, little);
    }
  }
  return undefined;
}

function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function hasNoLength(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function jpegSize(view: DataView): Size | undefined {
  let at = 2;
  let orientation = 1;
  while (at + 1 < view.byteLength) {
    const marker = view.getUint8(at + 1);
    if (view.getUint8(at) !== MARKER_PREFIX || marker === MARKER_PREFIX) {
      at += 1;
    } else if (isFrameHeader(marker)) {
      const rotated = orientation >= FIRST_ROTATING_ORIENTATION;
      const size = { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      return rotated ? { width: size.height, height: size.width } : size;
    } else if (hasNoLength(marker)) {
      at += 2;
    } else {
      orientation = marker === APP1 ? (exifOrientation(view, at + 4) ?? orientation) : orientation;
      at += 2 + view.getUint16(at + 2);
    }
  }
  return undefined;
}

function uint24(view: DataView, at: number): number {
  return view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
}

function webpSize(head: Uint8Array, view: DataView): Size | undefined {
  const chunk = ascii(head, 12, 4);
  if (chunk === 'VP8X') {
    return { width: uint24(view, 24) + 1, height: uint24(view, 27) + 1 };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return chunk === 'VP8 ' ? { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff } : undefined;
}

function sizeOf(format: ImageFormat, head: Uint8Array, view: DataView): Size | undefined {
  if (format === ImageFormat.Jpeg) {
    return jpegSize(view);
  }
  if (format === ImageFormat.Png) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (format === ImageFormat.Gif) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  return format === ImageFormat.Webp ? webpSize(head, view) : undefined;
}

/** Reads format, upright size and nothing else from the first bytes of an image. */
export function probeImage(head: Uint8Array): ImageProbe {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const format = formatOf(head, view);
  try {
    return { format, ...sizeOf(format, head, view) };
  } catch {
    return { format };
  }
}
