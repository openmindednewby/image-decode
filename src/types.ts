import type { ImageDecodeFailure } from './ImageDecodeFailure';
import type { ImageFormat } from './ImageFormat';

export interface BoundedDecodeOptions {
  readonly maxSide?: number;
  readonly maxSourcePixels?: number;
  readonly maxFileBytes?: number;
}

export interface ImageProbe {
  readonly format: ImageFormat;
  readonly width?: number;
  readonly height?: number;
}

export interface DecodedImage {
  readonly ok: true;
  readonly bitmap: ImageBitmap;
  readonly format: ImageFormat;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export interface ImageDecodeFailed {
  readonly ok: false;
  readonly failure: ImageDecodeFailure;
  readonly format: ImageFormat;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly errorName?: string;
}

export type BoundedDecodeResult = DecodedImage | ImageDecodeFailed;
