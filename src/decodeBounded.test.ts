import { decodeBounded, DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_SIDE } from './decodeBounded';
import { ImageDecodeFailure } from './ImageDecodeFailure';
import { ImageFormat } from './ImageFormat';
import { brandedHeader, jpegHeader } from './testImages';

const CHANNELS = 4;
const createBitmap = jest.fn();

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: jest.fn() } as unknown as ImageBitmap;
}

function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes.buffer as ArrayBuffer]);
}

function unreadableBlob(errorName: string): Blob {
  const failure = Object.assign(new Error('secret-name.jpg could not be read'), { name: errorName });
  return { size: 100, slice: () => ({ arrayBuffer: () => Promise.reject(failure) }) } as unknown as Blob;
}

function decodeError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function echoRequestedSize(): void {
  createBitmap.mockImplementation((_file: Blob, options: ImageBitmapOptions) => Promise.resolve(bitmap(Number(options.resizeWidth), Number(options.resizeHeight))));
}

describe('decodeBounded', () => {
  beforeEach(() => {
    createBitmap.mockReset();
    (globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = createBitmap;
  });

  it.each([
    ['12 MP', 4000, 3000],
    ['50 MP', 8160, 6120],
    ['108 MP', 12000, 9000],
  ])('with a %s JPEG, decodes once at the bounded size and never at full size', async (_label, width, height) => {
    echoRequestedSize();

    const result = await decodeBounded(blobOf(jpegHeader(width, height)));

    expect(result.ok).toBe(true);
    expect(createBitmap).toHaveBeenCalledTimes(1);
    const options = createBitmap.mock.calls[0][1] as { resizeWidth: number; resizeHeight: number };
    expect(options.resizeWidth).toBe(DEFAULT_MAX_SIDE);
    expect(options.resizeWidth * options.resizeHeight * CHANNELS).toBeLessThanOrEqual(DEFAULT_MAX_SIDE * DEFAULT_MAX_SIDE * CHANNELS);
  });

  it('with a portrait photo rotated by EXIF, asks for a portrait bitmap', async () => {
    echoRequestedSize();

    await decodeBounded(blobOf(jpegHeader(4000, 3000, 6)), { maxSide: 400 });

    expect(createBitmap.mock.calls[0][1]).toMatchObject({ resizeWidth: 300, resizeHeight: 400 });
  });

  it('when the browser resizes before rotating, decodes again with the sides swapped', async () => {
    const wrong = bitmap(400, 300);
    createBitmap.mockResolvedValueOnce(wrong).mockResolvedValueOnce(bitmap(300, 400));

    const result = await decodeBounded(blobOf(jpegHeader(4000, 3000, 6)), { maxSide: 400 });

    expect(wrong.close).toHaveBeenCalledTimes(1);
    expect(createBitmap.mock.calls[1][1]).toMatchObject({ resizeWidth: 400, resizeHeight: 300 });
    expect(result).toMatchObject({ ok: true, sourceWidth: 3000, sourceHeight: 4000 });
  });

  it('with a photo smaller than the limit, keeps its size', async () => {
    createBitmap.mockResolvedValue(bitmap(640, 480));

    await decodeBounded(blobOf(jpegHeader(640, 480)));

    expect(createBitmap.mock.calls[0][1]).toMatchObject({ resizeWidth: 640, resizeHeight: 480 });
  });

  it('with more pixels than the cap, fails too-large without decoding', async () => {
    const result = await decodeBounded(blobOf(jpegHeader(12000, 9000)), { maxSourcePixels: 1000 });

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.TooLarge, format: ImageFormat.Jpeg, sourceWidth: 12000, sourceHeight: 9000 });
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('with a file over the byte cap, fails too-large without reading', async () => {
    const slice = jest.fn();
    const huge = { size: DEFAULT_MAX_FILE_BYTES + 1, slice } as unknown as Blob;

    const result = await decodeBounded(huge);

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.TooLarge });
    expect(slice).not.toHaveBeenCalled();
  });

  it('with a file that cannot be read, fails read and keeps only the error name', async () => {
    const result = await decodeBounded(unreadableBlob('NotReadableError'));

    expect(result).toEqual({ ok: false, failure: ImageDecodeFailure.ReadFailed, format: ImageFormat.Unknown, errorName: 'NotReadableError' });
    expect(JSON.stringify(result)).not.toContain('secret-name');
  });

  it('with an empty file, fails read', async () => {
    const result = await decodeBounded(new Blob([]));

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.ReadFailed, errorName: 'EmptyFile' });
  });

  it('with a JPEG the browser cannot decode, fails decode with the source size', async () => {
    createBitmap.mockRejectedValue(decodeError('InvalidStateError', 'The source image could not be decoded.'));

    const result = await decodeBounded(blobOf(jpegHeader(12000, 9000)));

    expect(result).toEqual({ ok: false, failure: ImageDecodeFailure.DecodeFailed, format: ImageFormat.Jpeg, sourceWidth: 12000, sourceHeight: 9000, errorName: 'InvalidStateError' });
  });

  it('with an out of memory error, fails memory', async () => {
    createBitmap.mockRejectedValue(decodeError('RangeError', 'Array buffer allocation failed'));

    const result = await decodeBounded(blobOf(jpegHeader(12000, 9000)));

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.OutOfMemory });
  });

  it('with an HEIC the browser cannot decode, fails format and names HEIC', async () => {
    createBitmap.mockRejectedValue(decodeError('InvalidStateError', 'The source image could not be decoded.'));

    const result = await decodeBounded(blobOf(brandedHeader('heic')));

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.UnsupportedFormat, format: ImageFormat.Heic });
  });

  it('with an HEIC the browser can decode, downscales the decoded bitmap', async () => {
    const full = bitmap(4000, 3000);
    createBitmap.mockResolvedValueOnce(full).mockResolvedValueOnce(bitmap(1600, 1200));

    const result = await decodeBounded(blobOf(brandedHeader('heic')));

    expect(result).toMatchObject({ ok: true, format: ImageFormat.Heic, sourceWidth: 4000, sourceHeight: 3000 });
    expect(createBitmap.mock.calls[1][0]).toBe(full);
    expect(full.close).toHaveBeenCalledTimes(1);
  });

  it('with an unknown-size image over the pixel cap, closes it and fails too-large', async () => {
    const full = bitmap(4000, 3000);
    createBitmap.mockResolvedValueOnce(full);

    const result = await decodeBounded(blobOf(brandedHeader('avif')), { maxSourcePixels: 1000 });

    expect(result).toMatchObject({ ok: false, failure: ImageDecodeFailure.TooLarge, sourceWidth: 4000, sourceHeight: 3000 });
    expect(full.close).toHaveBeenCalledTimes(1);
  });
});
