import { bmffSize } from './bmffSize';
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
const EXIF_HEADER_BYTES = 6;
const TIFF_IFD_OFFSET_AT = 4;
const IFD_COUNT_BYTES = 2;
const IFD_ENTRY_VALUE_AT = 8;
const JPEG_START_BYTES = 2;
const MARKER_BYTES = 2;
const MARKER_CODE_AT = 1;
const SEGMENT_LENGTH_AT = 2;
const SEGMENT_BODY_AT = 4;
const FRAME_HEIGHT_AT = 5;
const FRAME_WIDTH_AT = 7;
const FIRST_FRAME_MARKER = 0xc0;
const LAST_FRAME_MARKER = 0xcf;
const HUFFMAN_TABLE_MARKER = 0xc4;
const RESERVED_JPEG_MARKER = 0xc8;
const ARITHMETIC_TABLE_MARKER = 0xcc;
const TEMPORARY_MARKER = 0x01;
const FIRST_RESTART_MARKER = 0xd0;
const END_OF_IMAGE_MARKER = 0xd9;
const SECOND_BYTE_AT = 1;
const THIRD_BYTE_AT = 2;
const SECOND_BYTE_SHIFT = 8;
const THIRD_BYTE_SHIFT = 16;
const FOURCC_BYTES = 4;
const WEBP_CHUNK_AT = 12;
const VP8X_WIDTH_AT = 24;
const VP8X_HEIGHT_AT = 27;
const VP8L_BITS_AT = 21;
const VP8L_HEIGHT_SHIFT = 14;
const VP8_WIDTH_AT = 26;
const VP8_HEIGHT_AT = 28;
const WEBP_SIZE_MASK = 0x3fff;
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
  const tiff = start + EXIF_HEADER_BYTES;
  const little = view.getUint16(tiff) === LITTLE_ENDIAN_MARK;
  const ifd = tiff + view.getUint32(tiff + TIFF_IFD_OFFSET_AT, little);
  const entries = view.getUint16(ifd, little);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + IFD_COUNT_BYTES + index * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, little) === EXIF_ORIENTATION_TAG) {
      return view.getUint16(entry + IFD_ENTRY_VALUE_AT, little);
    }
  }
  return undefined;
}

function isFrameHeader(marker: number): boolean {
  const isInFrameRange = marker >= FIRST_FRAME_MARKER && marker <= LAST_FRAME_MARKER;
  return isInFrameRange && marker !== HUFFMAN_TABLE_MARKER && marker !== RESERVED_JPEG_MARKER && marker !== ARITHMETIC_TABLE_MARKER;
}

function hasNoLength(marker: number): boolean {
  return marker === TEMPORARY_MARKER || (marker >= FIRST_RESTART_MARKER && marker <= END_OF_IMAGE_MARKER);
}

function jpegSize(view: DataView): Size | undefined {
  let at = JPEG_START_BYTES;
  let orientation = 1;
  while (at + MARKER_CODE_AT < view.byteLength) {
    const marker = view.getUint8(at + MARKER_CODE_AT);
    if (view.getUint8(at) !== MARKER_PREFIX || marker === MARKER_PREFIX) {
      at += 1;
    } else if (isFrameHeader(marker)) {
      const rotated = orientation >= FIRST_ROTATING_ORIENTATION;
      const size = { width: view.getUint16(at + FRAME_WIDTH_AT), height: view.getUint16(at + FRAME_HEIGHT_AT) };
      return rotated ? { width: size.height, height: size.width } : size;
    } else if (hasNoLength(marker)) {
      at += MARKER_BYTES;
    } else {
      orientation = marker === APP1 ? (exifOrientation(view, at + SEGMENT_BODY_AT) ?? orientation) : orientation;
      at += MARKER_BYTES + view.getUint16(at + SEGMENT_LENGTH_AT);
    }
  }
  return undefined;
}

function uint24(view: DataView, at: number): number {
  return view.getUint8(at) | (view.getUint8(at + SECOND_BYTE_AT) << SECOND_BYTE_SHIFT) | (view.getUint8(at + THIRD_BYTE_AT) << THIRD_BYTE_SHIFT);
}

function webpSize(head: Uint8Array, view: DataView): Size | undefined {
  const chunk = ascii(head, WEBP_CHUNK_AT, FOURCC_BYTES);
  if (chunk === 'VP8X') {
    return { width: uint24(view, VP8X_WIDTH_AT) + 1, height: uint24(view, VP8X_HEIGHT_AT) + 1 };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(VP8L_BITS_AT, true);
    return { width: (bits & WEBP_SIZE_MASK) + 1, height: ((bits >>> VP8L_HEIGHT_SHIFT) & WEBP_SIZE_MASK) + 1 };
  }
  return chunk === 'VP8 ' ? { width: view.getUint16(VP8_WIDTH_AT, true) & WEBP_SIZE_MASK, height: view.getUint16(VP8_HEIGHT_AT, true) & WEBP_SIZE_MASK } : undefined;
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
  if (format === ImageFormat.Webp) {
    return webpSize(head, view);
  }
  return format === ImageFormat.Heic || format === ImageFormat.Avif ? bmffSize(view) : undefined;
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
