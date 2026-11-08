# @dloizides/image-decode

Decodes a photo in a browser or worker without holding it at full size.

```ts
const result = await decodeBounded(file, { maxSide: 1600 });
if (result.ok) use(result.bitmap);
else show(result.failure);
```

`decodeBounded` never throws. It reads the file header for the format and size, refuses a file over the pixel or byte cap, and asks the browser for the downscaled bitmap in one step. A failure is one of `ImageDecodeFailure` (`read`, `too-large`, `format`, `memory`, `decode`) with the format, source size and error name. It carries no image data, so it is safe to log.
