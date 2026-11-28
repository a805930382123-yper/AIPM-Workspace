import type { Raw, RawImportResult } from '../../api';
import { bytesText, formatLabels } from '../../api';
import { isScannedPdf } from './rawPdf';
import type { ImportFailure } from './ImportDialog';
export function ResultPanel({
  result,
  prefill,
  onClose,
  onOpen,
  onAgain,
}: {
  result: RawImportResult;
  prefill: boolean;
  onClose: () => void;
  onOpen: () => void;
  onAgain: () => void;
}) {
  const scanned = isScannedPdf(result.raw);
  return (
    <section className="result-panel">
      <div className="result-head">
        <span className="result-dot" />
        {scanned ? '导入成功：扫描 PDF 原件已保存' : '导入成功：正文已入库，原件已保留'}
      </div>
      <ul className="result-list">
        <li>
          <span>Raw ID</span>
          <code>{result.raw.id}</code>
        </li>
        <li>
          <span>资料标题</span>
          <span>{result.raw.title}</span>
        </li>
        <li>
          <span>正文</span>
          <span>
            {scanned ? (
              '无文字层，可逐页查看图像'
            ) : (
              <>
                {result.extraction.bodyChars.toLocaleString()} 字符 · SHA-256{' '}
                <code>{result.raw.bodySha256.slice(0, 16)}…</code>
              </>
            )}
          </span>
        </li>
        <li>
          <span>提取方式</span>
          <span>{result.extraction.parser}</span>
        </li>
        <li>
          <span>原件</span>
          <span>
            {result.asset.fileName} · {formatLabels[result.asset.format] ?? result.asset.format} ·{' '}
            {bytesText(result.asset.byteSize)}
          </span>
        </li>
        <li>
          <span>原件位置</span>
          <code>knowledge/raw/assets/{result.asset.storedFile}</code>
        </li>
        <li>
          <span>原件 SHA-256</span>
          <code>{result.asset.sha256}</code>
        </li>
      </ul>
      <p className="extract-note">{result.extraction.note}</p>
      <div className="dialog-footer">
        <span className="footer-note">
          {scanned
            ? '在资料详情查看页图，并按需发起 AI 页理解。'
            : prefill
              ? '旧记录保持不变'
              : '正文与原件关联都已保存；列表与统计已同步'}
        </span>
        <div>
          <button type="button" className="secondary-button" onClick={onAgain}>
            继续导入下一条
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="primary-button" onClick={onOpen}>
            {scanned ? '查看 PDF 页面' : '查看这条资料'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function PartialPanel({
  failure,
  raw,
  onClose,
  onOpen,
  onAgain,
}: {
  failure: ImportFailure;
  raw: Raw;
  onClose: () => void;
  onOpen: () => void;
  onAgain: () => void;
}) {
  if (failure.code === 'RAW_MEDIA_IMPORT_INCOMPLETE')
    return (
      <section className="result-panel partial">
        <div className="result-head warn">
          <span className="result-dot warn" />
          正文已保存，图片解析记录未完成
        </div>
        <p className="notice-warn">{failure.message}</p>
        <ul className="result-list">
          <li>
            <span>Raw ID</span>
            <code>{raw.id}</code>
          </li>
          <li>
            <span>资料标题</span>
            <span>{raw.title}</span>
          </li>
        </ul>
        <p className="extract-note">这条资料已保存在列表中，请打开查看已保存内容，不要重复导入同一篇网页。</p>
        <div className="dialog-footer">
          <span className="footer-note">图片解析记录未完成</span>
          <div>
            <button type="button" className="secondary-button" onClick={onAgain}>
              继续导入下一条
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="primary-button" onClick={onOpen}>
              打开已保存资料
            </button>
          </div>
        </div>
      </section>
    );
  return (
    <section className="result-panel partial">
      <div className="result-head warn">
        <span className="result-dot warn" />
        部分提交：正文已入库，原件关联待恢复
      </div>
      <ul className="result-list">
        <li>
          <span>Raw ID</span>
          <code>{raw.id}</code>
        </li>
        <li>
          <span>资料标题</span>
          <span>{raw.title}</span>
        </li>
        <li>
          <span>原件</span>
          <span>
            {failure.fileName || raw.assetFileName || '上传的文件'} · {bytesText(failure.byteSize ?? raw.assetByteSize)}
          </span>
        </li>
        <li>
          <span>asset ID</span>
          <code>{failure.assetId || raw.assetId}</code>
        </li>
        <li>
          <span>原件 SHA-256</span>
          <code>{failure.sha256 || raw.assetSha256}</code>
        </li>
        <li>
          <span>未完成</span>
          <span>
            {failure.code} · {failure.message}
          </span>
        </li>
      </ul>
      <p className="notice-warn">
        正文与原件字节都已保存在本机，只有「原件 ↔
        Raw」的关联记录没有写完。请不要重复导入同一文件；解除磁盘故障后，在本目录下次启动工作台会自动补齐该关联（若 Raw
        实际未提交，则只把原件记为待处理并保留原件）。
      </p>
      <p className="extract-note">
        这条 Raw 已经出现在资料列表与首页统计中；原件保存在 knowledge/raw/assets/，请勿手工移动或改名。
      </p>
      <div className="dialog-footer">
        <span className="footer-note">待恢复 · 重启工作台自动对账</span>
        <div>
          <button type="button" className="secondary-button" onClick={onAgain}>
            继续导入下一条
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="primary-button" onClick={onOpen}>
            查看已创建的 Raw
          </button>
        </div>
      </div>
    </section>
  );
}
