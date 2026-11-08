interface Size {
  readonly width: number;
  readonly height: number;
}

interface BoxRange {
  readonly content: number;
  readonly end: number;
}

interface Box extends BoxRange {
  readonly type: number;
}

const BOX_META = 0x6d657461;
const BOX_IPRP = 0x69707270;
const BOX_IPCO = 0x6970636f;
const BOX_ISPE = 0x69737065;
const BOX_IROT = 0x69726f74;
const BOX_HEADER_BYTES = 8;
const BOX_TYPE_AT = 4;
const SIZE_RUNS_TO_PARENT_END = 0;
const FULL_BOX_FIELDS_BYTES = 4;
const ISPE_WIDTH_AT = 4;
const ISPE_HEIGHT_AT = 8;
const ODD_QUARTER_TURN = 1;

function boxesIn(view: DataView, range: BoxRange): Box[] {
  const boxes: Box[] = [];
  let at = range.content;
  while (at + BOX_HEADER_BYTES <= range.end) {
    const declared = view.getUint32(at);
    if (declared !== SIZE_RUNS_TO_PARENT_END && declared < BOX_HEADER_BYTES) {
      break;
    }
    const end = declared === SIZE_RUNS_TO_PARENT_END ? range.end : at + declared;
    boxes.push({ type: view.getUint32(at + BOX_TYPE_AT), content: at + BOX_HEADER_BYTES, end: Math.min(end, range.end) });
    at = end;
  }
  return boxes;
}

function childOf(view: DataView, range: BoxRange | undefined, type: number): Box | undefined {
  return range === undefined ? undefined : boxesIn(view, range).find((box) => box.type === type);
}

function imagePropertiesOf(view: DataView): Box[] {
  const meta = childOf(view, { content: 0, end: view.byteLength }, BOX_META);
  const afterFullBoxFields = meta === undefined ? undefined : { content: meta.content + FULL_BOX_FIELDS_BYTES, end: meta.end };
  const properties = childOf(view, childOf(view, afterFullBoxFields, BOX_IPRP), BOX_IPCO);
  return properties === undefined ? [] : boxesIn(view, properties);
}

function largestOf(view: DataView, properties: readonly Box[]): Size | undefined {
  const sizes = properties.filter((box) => box.type === BOX_ISPE).map((box) => ({ width: view.getUint32(box.content + ISPE_WIDTH_AT), height: view.getUint32(box.content + ISPE_HEIGHT_AT) }));
  return sizes.reduce<Size | undefined>((largest, size) => (largest === undefined || size.width * size.height > largest.width * largest.height ? size : largest), undefined);
}

function isTurnedSideways(view: DataView, properties: readonly Box[]): boolean {
  return properties.some((box) => box.type === BOX_IROT && (view.getUint8(box.content) & ODD_QUARTER_TURN) === ODD_QUARTER_TURN);
}

/** Reads the upright size of the main HEIC or AVIF image from its ispe and irot properties. */
export function bmffSize(view: DataView): Size | undefined {
  const properties = imagePropertiesOf(view);
  const size = largestOf(view, properties);
  if (size === undefined) {
    return undefined;
  }
  return isTurnedSideways(view, properties) ? { width: size.height, height: size.width } : size;
}
