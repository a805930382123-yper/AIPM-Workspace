import { execFile, type ExecFileException } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const languages = ['chi_sim', 'eng'] as const;
type Language = (typeof languages)[number];
type EngineSource = 'configured' | 'path' | 'windows_install';
type OcrEngine = { executable: string; source: EngineSource };

const messages = {
  local_ocr_executable_missing: '未找到 Tesseract，请安装后加入 PATH，或设置 FMCG_TESSERACT_PATH。',
  local_ocr_executable_path_invalid: 'FMCG_TESSERACT_PATH 指向的 Tesseract 无法启动，请检查可执行文件路径和权限。',
  local_ocr_tessdata_path_invalid: 'TESSDATA_PREFIX 无法读取，请指向存放 traineddata 文件的目录。',
  local_ocr_language_missing: 'Tesseract 缺少所需语言数据。',
  local_ocr_language_load_failed: 'Tesseract 无法加载语言数据，请检查 traineddata 文件及 TESSDATA_PREFIX。',
  local_ocr_check_failed: 'Tesseract 环境检查失败，请检查安装和运行权限。',
  local_ocr_timeout: '本机 OCR 运行超时。',
  local_ocr_execution_failed: 'Tesseract 未能处理这张图片。',
  local_ocr_image_decode_failed: '本机无法解码这张图片。',
  local_ocr_unavailable: '本机 OCR 执行失败。',
} as const;

export class LocalOcrError extends Error {
  constructor(
    readonly code: keyof typeof messages,
    readonly source?: EngineSource,
    readonly affectedLanguages: readonly Language[] = [],
  ) {
    super(
      affectedLanguages.length
        ? `${messages[code]} 请检查 ${affectedLanguages.map((language) => `${language}.traineddata`).join('、')}。`
        : messages[code],
    );
  }
}

function execute(executable: string, args: string[], bytes?: Buffer) {
  return new Promise<{ stdout: string; stderr: string; error: ExecFileException | null }>((resolve) => {
    const child = execFile(
      executable,
      args,
      {
        timeout: bytes ? 25_000 : 5_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      },
      (error, stdout, stderr) => resolve({ stdout, stderr, error }),
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(bytes);
  });
}

/** Probe the resolved executable before recognition, with only safe error details. */
export async function checkLocalOcr(): Promise<OcrEngine> {
  const configured = process.env.FMCG_TESSERACT_PATH?.trim();
  const prefix = process.env.TESSDATA_PREFIX;
  if (prefix && !(await readdir(prefix).catch(() => undefined)))
    throw new LocalOcrError('local_ocr_tessdata_path_invalid');

  const candidates: OcrEngine[] = configured
    ? [{ executable: configured, source: 'configured' }]
    : [{ executable: 'tesseract', source: 'path' }];
  if (!configured && process.platform === 'win32') {
    const folders = new Set([
      process.env.ProgramW6432,
      process.env.ProgramFiles || 'C:/Program Files',
      process.env['ProgramFiles(x86)'],
    ]);
    for (const folder of folders) {
      if (folder)
        candidates.push({ executable: path.join(folder, 'Tesseract-OCR', 'tesseract.exe'), source: 'windows_install' });
    }
  }

  for (const engine of candidates) {
    const { error, stdout } = await execute(engine.executable, ['--list-langs']);
    if (error) {
      if (engine.source === 'configured' && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code)))
        throw new LocalOcrError('local_ocr_executable_path_invalid', engine.source);
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw new LocalOcrError('local_ocr_check_failed', engine.source);
    }
    const available = new Set(stdout.trim().split(/\r?\n/u));
    const missing = languages.filter((language) => !available.has(language));
    if (missing.length) throw new LocalOcrError('local_ocr_language_missing', engine.source, missing);
    return engine;
  }
  throw new LocalOcrError('local_ocr_executable_missing');
}

export async function readLocalOcrTsv(engine: OcrEngine, bytes: Buffer): Promise<string> {
  const { error, stdout, stderr } = await execute(
    engine.executable,
    ['stdin', 'stdout', '-l', languages.join('+'), '--psm', '11', 'tsv'],
    bytes,
  );
  // Tesseract can exit successfully when only one of the requested languages loads.
  const failedLanguages = languages.filter((language) => stderr.includes(`Failed loading language '${language}'`));
  if (failedLanguages.length || /Error opening data file|Tesseract couldn't load any languages/u.test(stderr))
    throw new LocalOcrError('local_ocr_language_load_failed', engine.source, failedLanguages);
  if (error?.killed) throw new LocalOcrError('local_ocr_timeout', engine.source);
  if (error) throw new LocalOcrError('local_ocr_execution_failed', engine.source);
  return stdout;
}
