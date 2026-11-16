/**
 * A tiny, dependency-free JPEG luma probe.
 *
 * The review loop is allowed to look at the finished picture but not to spawn
 * FFmpeg: `sampleFrames` hands it JPEGs. Black-frame detection needs one number
 * per frame, not a full bitmap, so this reads the baseline JPEG's DC
 * coefficients and reconstructs the mean luma of the luma component. That is
 * the same quantity the analysis pass measures on decoded grey frames
 * (`mean_luma`), at a fraction of the work.
 *
 * Scope: baseline sequential JPEG (SOF0/SOF1), 8-bit, one or three components,
 * with standard or optimised Huffman tables — what FFmpeg and the Windows
 * imaging stack emit for a review thumbnail. Progressive JPEG (SOF2) returns
 * `undefined`; callers treat "could not measure" as "do not invent a failure".
 */

interface HuffmanTable {
  counts: number[];
  symbols: number[];
  minCode: number[];
  maxCode: number[];
  valPtr: number[];
}

interface Component {
  id: number;
  h: number;
  v: number;
  quantTableId: number;
  /** Quantiser for the DC coefficient. */
  dcQuant: number;
  predictor: number;
}

interface LumaAccumulator {
  sum: number;
  count: number;
  /** Non-zero AC coefficients in luma blocks; the cheap detail signal. */
  acCount: number;
}

const SOI = 0xffd8;
const MARKER_SOF0 = 0xc0;
const MARKER_SOF1 = 0xc1;
const MARKER_SOF2 = 0xc2;
const MARKER_DHT = 0xc4;
const MARKER_DQT = 0xdb;
const MARKER_DRI = 0xdd;
const MARKER_SOS = 0xda;
const MARKER_EOI = 0xd9;

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function buildTable(counts: number[], symbols: number[]): HuffmanTable {
  const minCode: number[] = new Array<number>(17).fill(0);
  const maxCode: number[] = new Array<number>(17).fill(-1);
  const valPtr: number[] = new Array<number>(17).fill(0);

  let code = 0;
  let symbolIndex = 0;
  for (let length = 1; length <= 16; length += 1) {
    valPtr[length] = symbolIndex;
    minCode[length] = code;
    const count = counts[length - 1] ?? 0;
    symbolIndex += count;
    if (count > 0) {
      maxCode[length] = code + count - 1;
      code += count;
    }
    code <<= 1;
  }

  return { counts, symbols, minCode, maxCode, valPtr };
}

class BitReader {
  private pos: number;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }

  /** Reads one entropy-coded bit, undoing 0xFF00 byte stuffing. */
  readBit(): number | null {
    if (this.bitCount === 0) {
      if (this.pos >= this.bytes.length) return null;
      const byte = this.bytes[this.pos] ?? 0;
      if (byte === 0xff) {
        const next = this.bytes[this.pos + 1];
        if (next === 0x00) {
          this.pos += 2;
        } else {
          // A restart or EOI marker; the entropy segment is over.
          return null;
        }
      } else {
        this.pos += 1;
      }
      this.bitBuffer = byte;
      this.bitCount = 8;
    }

    this.bitCount -= 1;
    return (this.bitBuffer >> this.bitCount) & 1;
  }

  /** Discards buffered bits, consumes the next RSTn marker, resets predictors. */
  restart(predictors: Component[]): boolean {
    this.bitCount = 0;
    while (this.pos < this.bytes.length) {
      if (this.bytes[this.pos] !== 0xff) {
        this.pos += 1;
        continue;
      }
      const marker = this.bytes[this.pos + 1];
      if (marker === undefined) return false;
      if (marker >= 0xd0 && marker <= 0xd7) {
        this.pos += 2;
        for (const component of predictors) component.predictor = 0;
        return true;
      }
      if (marker === 0x00) {
        this.pos += 2;
        continue;
      }
      return false;
    }
    return false;
  }
}

function receive(reader: BitReader, length: number): number | null {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    const bit = reader.readBit();
    if (bit === null) return null;
    value = (value << 1) | bit;
  }
  return value;
}

/** Sign-extends a JPEG magnitude category. */
function extend(value: number, length: number): number {
  if (length === 0) return 0;
  const threshold = 1 << (length - 1);
  return value < threshold ? value - (1 << length) + 1 : value;
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number | null {
  let code = 0;
  for (let length = 1; length <= 16; length += 1) {
    const bit = reader.readBit();
    if (bit === null) return null;
    code = (code << 1) | bit;

    const max = table.maxCode[length] ?? -1;
    if (max >= 0 && code <= max) {
      const index = (table.valPtr[length] ?? 0) + code - (table.minCode[length] ?? 0);
      return table.symbols[index] ?? null;
    }
  }
  return null;
}

interface ScanComponent {
  component: Component;
  dcTable: HuffmanTable;
  acTable: HuffmanTable;
  isLuma: boolean;
}

function decodeBlock(
  reader: BitReader,
  scan: ScanComponent,
  accumulator: LumaAccumulator,
): boolean {
  const dcLength = decodeSymbol(reader, scan.dcTable);
  if (dcLength === null) return false;

  let difference = 0;
  if (dcLength > 0) {
    const magnitude = receive(reader, dcLength);
    if (magnitude === null) return false;
    difference = extend(magnitude, dcLength);
  }
  scan.component.predictor += difference;

  if (scan.isLuma) {
    // The DC term of an 8x8 block is 8x its average sample value; JPEG shifts
    // samples by +128 before the DCT, so undo both to get luma in 0..255.
    const dc = scan.component.predictor * scan.component.dcQuant;
    accumulator.sum += dc / 8 + 128;
    accumulator.count += 1;
  }

  for (let coefficient = 1; coefficient < 64; coefficient += 1) {
    const symbol = decodeSymbol(reader, scan.acTable);
    if (symbol === null) return false;
    const run = symbol >> 4;
    const size = symbol & 0x0f;
    if (size === 0) {
      if (run === 15) {
        coefficient += 15;
        continue;
      }
      break; // End of block.
    }
    const magnitude = receive(reader, size);
    if (magnitude === null) return false;
    if (scan.isLuma) accumulator.acCount += 1;
    coefficient += run;
  }

  return true;
}

export interface JpegStats {
  /** Mean luma, normalised to 0..1. */
  luma: number;
  /**
   * Fraction of luma AC coefficients that are non-zero, 0..1. A flat frame sits
   * near 0; a sharp, detailed frame sits well above it. Used as a relative
   * softness signal between frames of the same take, never as an absolute
   * notion of quality: the encoder's quantiser is unknown here.
   */
  detail: number;
}

/**
 * Mean luma and AC detail of a base64 JPEG. Returns `undefined` when the
 * payload is not a baseline JPEG this reader understands.
 */
export function jpegStats(base64: string): JpegStats | undefined {
  const cleaned = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  if (cleaned.trim().length === 0) return undefined;

  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(cleaned, 'base64');
  } catch {
    return undefined;
  }
  if (bytes.length < 4 || u16(bytes, 0) !== SOI) return undefined;

  const header = readHeader(bytes);
  if (header === undefined) return undefined;

  const reader = new BitReader(bytes, header.scanStart);
  const luma: LumaAccumulator = { sum: 0, count: 0, acCount: 0 };

  let maxH = 1;
  let maxV = 1;
  for (const component of header.components) {
    maxH = Math.max(maxH, component.h);
    maxV = Math.max(maxV, component.v);
  }

  const scan: ScanComponent[] = [];
  for (const entry of header.scanTables) {
    const component = header.components.find((candidate) => candidate.id === entry.componentId);
    if (component === undefined) return undefined;
    const dcTable = header.dcTables[entry.dcTableId];
    const acTable = header.acTables[entry.acTableId];
    if (dcTable === undefined || acTable === undefined) return undefined;
    component.dcQuant = header.dcQuants[component.quantTableId] ?? 1;
    scan.push({
      component,
      dcTable,
      acTable,
      isLuma: component === header.components[0],
    });
  }
  if (scan.length === 0) return undefined;

  const decodeMcu = (): boolean => {
    for (const entry of scan) {
      const blocks =
        scan.length === 1
          ? 1
          : entry.component.h * entry.component.v;
      for (let block = 0; block < blocks; block += 1) {
        if (!decodeBlock(reader, entry, luma)) return false;
      }
    }
    return true;
  };

  if (scan.length === 1) {
    const only = scan[0];
    if (only === undefined) return undefined;
    const sampleWidth = Math.ceil((header.width * only.component.h) / maxH);
    const sampleHeight = Math.ceil((header.height * only.component.v) / maxV);
    const blocksX = Math.ceil(sampleWidth / 8);
    const blocksY = Math.ceil(sampleHeight / 8);
    const totalMcus = blocksX * blocksY;

    for (let mcu = 0; mcu < totalMcus; mcu += 1) {
      if (
        header.restartInterval > 0 &&
        mcu > 0 &&
        mcu % header.restartInterval === 0 &&
        !reader.restart(header.components)
      ) {
        return undefined;
      }
      if (!decodeMcu()) return undefined;
    }
  } else {
    const mcusX = Math.ceil(header.width / (8 * maxH));
    const mcusY = Math.ceil(header.height / (8 * maxV));
    const totalMcus = mcusX * mcusY;

    for (let mcu = 0; mcu < totalMcus; mcu += 1) {
      if (
        header.restartInterval > 0 &&
        mcu > 0 &&
        mcu % header.restartInterval === 0 &&
        !reader.restart(header.components)
      ) {
        return undefined;
      }
      if (!decodeMcu()) return undefined;
    }
  }

  if (luma.count === 0) return undefined;
  const mean = luma.sum / luma.count;
  if (!Number.isFinite(mean)) return undefined;
  return {
    luma: Math.min(1, Math.max(0, mean / 255)),
    detail: Math.min(1, luma.acCount / (luma.count * 63)),
  };
}

/** Mean luma of a base64 JPEG, normalised to 0..1. */
export function meanLumaFromJpeg(base64: string): number | undefined {
  return jpegStats(base64)?.luma;
}

interface JpegHeader {
  width: number;
  height: number;
  components: Component[];
  dcTables: Array<HuffmanTable | undefined>;
  acTables: Array<HuffmanTable | undefined>;
  /** DC quantiser per quantisation table id. */
  dcQuants: number[];
  restartInterval: number;
  scanStart: number;
  scanTables: Array<{ componentId: number; dcTableId: number; acTableId: number }>;
}

/** Walks the marker stream once, up to and including SOS, then stops. */
function readHeader(bytes: Uint8Array): JpegHeader | undefined {
  const dcTables: Array<HuffmanTable | undefined> = [];
  const acTables: Array<HuffmanTable | undefined> = [];
  const dcQuants: number[] = [];
  const components: Component[] = [];
  let width = 0;
  let height = 0;
  let restartInterval = 0;

  let pos = 2;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }

    let marker = bytes[pos + 1] ?? 0;
    while (marker === 0xff && pos + 2 < bytes.length) {
      pos += 1;
      marker = bytes[pos + 1] ?? 0;
    }
    pos += 2;

    if (marker === MARKER_SOS) {
      if (pos + 1 >= bytes.length) return undefined;
      const length = u16(bytes, pos);
      if (length < 2 || pos + length > bytes.length) return undefined;
      const body = pos + 2;
      const end = pos + length;
      const count = bytes[body] ?? 0;
      const scanTables: JpegHeader['scanTables'] = [];
      for (let index = 0; index < count; index += 1) {
        const at = body + 1 + index * 2;
        const descriptor = bytes[at + 1] ?? 0;
        scanTables.push({
          componentId: bytes[at] ?? 0,
          dcTableId: descriptor >> 4,
          acTableId: descriptor & 0x0f,
        });
      }
      return {
        width,
        height,
        components,
        dcTables,
        acTables,
        dcQuants,
        restartInterval,
        scanStart: end,
        scanTables,
      };
    }

    if (marker === MARKER_EOI || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (marker === MARKER_EOI) return undefined;
      continue;
    }
    if (pos + 1 >= bytes.length) return undefined;

    const length = u16(bytes, pos);
    if (length < 2 || pos + length > bytes.length) return undefined;
    const body = pos + 2;
    const end = pos + length;

    if (marker === MARKER_DQT) {
      let at = body;
      while (at < end) {
        const descriptor = bytes[at] ?? 0;
        const precision = descriptor >> 4;
        const tableId = descriptor & 0x0f;
        at += 1;
        if (tableId > 3) return undefined;
        const dc = precision === 0 ? (bytes[at] ?? 0) : u16(bytes, at);
        dcQuants[tableId] = dc;
        at += precision === 0 ? 64 : 128;
      }
    } else if (marker === MARKER_SOF0 || marker === MARKER_SOF1) {
      const precision = bytes[body] ?? 0;
      if (precision !== 8) return undefined;
      height = u16(bytes, body + 1);
      width = u16(bytes, body + 3);
      const count = bytes[body + 5] ?? 0;
      if (width <= 0 || height <= 0 || count < 1 || count > 3) return undefined;

      for (let index = 0; index < count; index += 1) {
        const at = body + 6 + index * 3;
        const sampling = bytes[at + 1] ?? 0;
        components.push({
          id: bytes[at] ?? 0,
          h: Math.max(1, sampling >> 4),
          v: Math.max(1, sampling & 0x0f),
          quantTableId: bytes[at + 2] ?? 0,
          dcQuant: 1,
          predictor: 0,
        });
      }
    } else if (marker === MARKER_SOF2) {
      return undefined;
    } else if (marker === MARKER_DHT) {
      let at = body;
      while (at < end) {
        const descriptor = bytes[at] ?? 0;
        const tableClass = descriptor >> 4;
        const tableId = descriptor & 0x0f;
        at += 1;
        if (tableId > 3) return undefined;

        const counts: number[] = [];
        let total = 0;
        for (let index = 0; index < 16; index += 1) {
          const count = bytes[at + index] ?? 0;
          counts.push(count);
          total += count;
        }
        at += 16;
        if (at + total > end) return undefined;

        const symbols: number[] = [];
        for (let index = 0; index < total; index += 1) {
          symbols.push(bytes[at + index] ?? 0);
        }
        at += total;

        const table = buildTable(counts, symbols);
        if (tableClass === 0) dcTables[tableId] = table;
        else acTables[tableId] = table;
      }
    } else if (marker === MARKER_DRI) {
      restartInterval = u16(bytes, body);
    }

    pos = end;
  }

  return undefined;
}
