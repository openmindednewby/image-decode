import { ImageFormat } from './ImageFormat';
import { probeImage } from './probeImage';
import { brandedHeader, jpegHeader, pngHeader } from './testImages';

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0, 0x20, 0]);
const VP8L = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f, 0xaf, 0xcf, 0x1f, 0x03]);
const VP8 = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0]);
const VP8X = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x63, 0, 0, 0xc7, 0, 0]);

describe('probeImage', () => {
  it('with a JPEG, reads width and height from the frame header', () => {
    const probe = probeImage(jpegHeader(4000, 3000));

    expect(probe).toEqual({ format: ImageFormat.Jpeg, width: 4000, height: 3000 });
  });

  it('with a JPEG rotated by EXIF, swaps width and height', () => {
    const probe = probeImage(jpegHeader(4000, 3000, 6));

    expect(probe).toEqual({ format: ImageFormat.Jpeg, width: 3000, height: 4000 });
  });

  it('with a JPEG cut off before its frame header, keeps the format and no size', () => {
    const probe = probeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff]));

    expect(probe).toEqual({ format: ImageFormat.Jpeg });
  });

  it('with a PNG, reads the size', () => {
    const probe = probeImage(pngHeader(800, 600));

    expect(probe).toEqual({ format: ImageFormat.Png, width: 800, height: 600 });
  });

  it('with a GIF, reads the size', () => {
    const probe = probeImage(GIF);

    expect(probe).toEqual({ format: ImageFormat.Gif, width: 16, height: 32 });
  });

  it('with a lossless WebP, reads the size', () => {
    const probe = probeImage(VP8L);

    expect(probe).toEqual({ format: ImageFormat.Webp, width: 4016, height: 3200 });
  });

  it('with a lossy WebP, reads the size', () => {
    const probe = probeImage(VP8);

    expect(probe).toEqual({ format: ImageFormat.Webp, width: 320, height: 240 });
  });

  it('with an extended WebP, reads the size', () => {
    const probe = probeImage(VP8X);

    expect(probe).toEqual({ format: ImageFormat.Webp, width: 100, height: 200 });
  });

  it('with an HEIC brand, names HEIC', () => {
    const probe = probeImage(brandedHeader('heic'));

    expect(probe).toEqual({ format: ImageFormat.Heic });
  });

  it('with an AVIF brand, names AVIF', () => {
    const probe = probeImage(brandedHeader('avif'));

    expect(probe).toEqual({ format: ImageFormat.Avif });
  });

  it('with bytes that are no known image, names unknown', () => {
    const probe = probeImage(new Uint8Array([1, 2, 3, 4]));

    expect(probe).toEqual({ format: ImageFormat.Unknown });
  });
});
