# Changelog

## 0.1.1

- The first decode of an image with no readable size is bounded by `resizeWidth`; `sourceWidth` and `sourceHeight` then report the decoded size.
- HEIC and AVIF sizes are read from `ispe` and `irot`, so the pixel cap applies before decoding.
- JPEG, HEIC and AVIF headers past the first megabyte are found, up to 16 MB.
- Every decode asks for `imageOrientation: 'from-image'`.

## 0.1.0

- `decodeBounded`: header probe, pixel and byte caps, one-step downscaled decode, named failure reasons.
- `probeImage`: format, size and EXIF orientation for JPEG, PNG, GIF and WebP.
