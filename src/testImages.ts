const JPEG_START = [0xff, 0xd8];

function u16(value: number): number[] {
  return [value >> 8, value & 0xff];
}

function exifSegment(orientation: number): number[] {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, ...u16(orientation), 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return [0xff, 0xe1, ...u16(body.length + 2), ...body];
}

export function jpegHeader(width: number, height: number, orientation?: number): Uint8Array {
  const exif = orientation === undefined ? [] : exifSegment(orientation);
  const sof = [0xff, 0xc0, 0, 17, 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([...JPEG_START, ...exif, ...sof, 0xff, 0xda]);
}

export function pngHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(24);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chars(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function box(type: string, body: readonly number[]): number[] {
  return [...u32(body.length + 8), ...chars(type), ...body];
}

const NO_FULL_BOX_FIELDS = [0, 0, 0, 0];

export function heifHeader(brand: string, sizes: ReadonlyArray<readonly [number, number]>, quarterTurns = 0): Uint8Array {
  const ispe = sizes.flatMap(([width, height]) => box('ispe', [...NO_FULL_BOX_FIELDS, ...u32(width), ...u32(height)]));
  const irot = quarterTurns === 0 ? [] : box('irot', [quarterTurns]);
  const properties = box('iprp', box('ipco', [...ispe, ...irot]));
  const meta = box('meta', [...NO_FULL_BOX_FIELDS, ...box('hdlr', NO_FULL_BOX_FIELDS), ...properties]);
  return new Uint8Array([...box('ftyp', [...chars(brand), ...NO_FULL_BOX_FIELDS]), ...meta]);
}

const LONGEST_SEGMENT_BYTES = 65537;

export function jpegHeaderAfterSegments(segments: number, width: number, height: number): Uint8Array {
  const frame = jpegHeader(width, height);
  const out = new Uint8Array(frame.length + segments * LONGEST_SEGMENT_BYTES);
  out.set(JPEG_START);
  for (let index = 0; index < segments; index += 1) {
    out.set([0xff, 0xe2, 0xff, 0xff], JPEG_START.length + index * LONGEST_SEGMENT_BYTES);
  }
  out.set(frame.subarray(JPEG_START.length), JPEG_START.length + segments * LONGEST_SEGMENT_BYTES);
  return out;
}

export function brandedHeader(brand: string): Uint8Array {
  const text = `ftyp${brand}`;
  return new Uint8Array([0, 0, 0, 24, ...Array.from(text, (char) => char.charCodeAt(0)), 0, 0, 0, 0]);
}
