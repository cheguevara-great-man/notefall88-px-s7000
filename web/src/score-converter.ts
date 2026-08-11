export const STUDIO_SCORE_EXTENSIONS = [
  "mscz",
  "mscx",
  "gp",
  "gp3",
  "gp4",
  "gp5",
  "gpx",
  "gtp",
  "ptb",
  "kar",
] as const;

export type StudioScoreFormat = (typeof STUDIO_SCORE_EXTENSIONS)[number];
export type ConverterInputFormat = StudioScoreFormat | "midi";

export interface NormalizedScoreSource {
  buffer: ArrayBuffer;
  fileName: string;
  convertedFrom?: StudioScoreFormat;
}

interface WebMscoreScore {
  saveXml(): Promise<string>;
  destroy(soft?: boolean): void;
}

interface WebMscoreRuntime {
  ready: Promise<void>;
  load(
    format: ConverterInputFormat,
    data: Uint8Array,
    fonts?: Uint8Array[],
    doLayout?: boolean,
  ): Promise<WebMscoreScore>;
}

interface WebMscoreModule {
  default: WebMscoreRuntime;
}

export type ConverterRuntimeLoader = () => Promise<WebMscoreModule>;
export type ConverterProgress = (message: string) => void;

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 64 * 1024 * 1024;
const STUDIO_RUNTIME_PATH = "./vendor/webmscore-0.21.0-a/webmscore.mjs";

export function studioScoreFormat(fileName: string): StudioScoreFormat | undefined {
  const match = /\.([^.]+)$/.exec(fileName.trim().toLowerCase());
  if (!match) return undefined;
  return STUDIO_SCORE_EXTENSIONS.find((extension) => extension === match[1]);
}

export function converterInputFormat(fileName: string): ConverterInputFormat | undefined {
  if (/\.(mid|midi)$/i.test(fileName.trim())) return "midi";
  return studioScoreFormat(fileName);
}

export function isNativeScoreFile(fileName: string): boolean {
  return /\.(mid|midi|xml|musicxml|mxl)$/i.test(fileName.trim());
}

export function studioScoreAcceptList(): string {
  return STUDIO_SCORE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
}

function convertedFileName(fileName: string): string {
  const base = fileName.trim().replace(/\.[^.]+$/, "").trim() || "converted-score";
  return `${base}.musicxml`;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function loadBundledRuntime(): Promise<WebMscoreModule> {
  if (typeof document === "undefined") throw new Error("Studio 转换引擎只能在浏览器或平板应用中运行");
  const url = new URL(STUDIO_RUNTIME_PATH, document.baseURI).href;
  return import(/* @vite-ignore */ url) as Promise<WebMscoreModule>;
}

export async function convertScoreToMusicXml(
  buffer: ArrayBuffer,
  fileName: string,
  progress: ConverterProgress = () => undefined,
  loadRuntime: ConverterRuntimeLoader = loadBundledRuntime,
): Promise<NormalizedScoreSource & { xml: string }> {
  const format = converterInputFormat(fileName);
  if (!format) throw new Error("转换引擎不支持此文件格式");
  if (buffer.byteLength === 0) throw new Error("乐谱文件是空的");
  if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("乐谱超过 64 MB 安全上限");

  progress("正在加载 Studio 离线转换引擎…");
  const module = await loadRuntime();
  const runtime = module.default;
  if (!runtime || typeof runtime.load !== "function") throw new Error("转换引擎文件不完整");
  await runtime.ready;

  progress(`正在转换 ${format.toUpperCase()} 乐谱…`);
  let score: WebMscoreScore | undefined;
  try {
    // MusicXML export needs MuseScore's full score layout model. Boost mode
    // (`doLayout = false`) is valid for metadata/MIDI only and can emit XML
    // with zero staves, which OSMD correctly rejects.
    score = await runtime.load(format, new Uint8Array(buffer), [], true);
    const xml = await score.saveXml();
    const encoded = new TextEncoder().encode(xml);
    if (encoded.byteLength > MAX_XML_BYTES) throw new Error("转换后的 MusicXML 超过 64 MB 安全上限");
    if (!/<score-(?:partwise|timewise)\b/i.test(xml)) throw new Error("转换引擎未返回有效的 MusicXML");
    progress("转换完成，正在建立练习时间线…");
    return {
      buffer: asArrayBuffer(encoded),
      fileName: convertedFileName(fileName),
      convertedFrom: format === "midi" ? undefined : format,
      xml,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${format.toUpperCase()} 转换失败：${detail}`);
  } finally {
    // Each conversion owns one worker. Terminating it releases the 20 MB WASM
    // runtime instead of leaving an invisible worker alive after batch import.
    score?.destroy(false);
  }
}

export async function normalizeScoreSource(
  buffer: ArrayBuffer,
  fileName: string,
  studioEdition: boolean,
  progress: ConverterProgress = () => undefined,
  loadRuntime: ConverterRuntimeLoader = loadBundledRuntime,
): Promise<NormalizedScoreSource> {
  if (isNativeScoreFile(fileName)) return { buffer, fileName };

  const format = studioScoreFormat(fileName);
  if (!format) throw new Error("支持 MIDI、MusicXML、MXL、MuseScore 和 Guitar Pro 乐谱");
  if (!studioEdition) throw new Error("此格式需使用 NoteFall Studio 离线转换后导入");
  return convertScoreToMusicXml(buffer, fileName, progress, loadRuntime);
}
