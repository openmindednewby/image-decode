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

export function brandedHeader(brand: string): Uint8Array {
  const text = `ftyp${brand}`;
  return new Uint8Array([0, 0, 0, 24, ...Array.from(text, (char) => char.charCodeAt(0)), 0, 0, 0, 0]);
}
