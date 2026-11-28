import { uploadWorkScreenshot, workScreenshotUrl } from '../../api';
import type { WorkItemDetailState } from './useWorkItemDetail';

export function WorkItemMaterials({ state }: { state: WorkItemDetailState }) {
  const {
    saved,
    selectedRaw,
    setSelectedRaw,
    imageFile,
    setImageFile,
    imageNote,
    setImageNote,
    brokenImages,
    setBrokenImages,
    busy,
    save,
    update,
    renderNotice,
    rawById,
    availableRaws,
    onOpenRaw,
  } = state;
  return (
    <section className="panel work-section" aria-labelledby="work-materials">
      <div className="work-section-heading">
        <h2 id="work-materials">资料与成果</h2>
      </div>
      <div className="work-materials-grid">
        <div>
          <h3>关联 Raw</h3>
          {saved.rawIds.length === 0 && <p className="work-note">暂无关联资料。</p>}
          <ul className="work-links">
            {saved.rawIds.map((rawId) => (
              <li key={rawId}>
                {rawById.has(rawId) ? (
                  <button className="text-button" onClick={() => onOpenRaw(rawId)}>
                    {rawById.get(rawId)?.title} · 查看原文
                  </button>
                ) : (
                  <span className="work-note">
                    Raw 来源不可用 <small>{rawId}</small>
                  </span>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void update('materials', { rawIds: saved.rawIds.filter((id) => id !== rawId) }, '已移除关联。')
                  }
                >
                  移除关联
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedRaw)
                void update('materials', { rawIds: [...saved.rawIds, selectedRaw] }, '已关联 Raw。', () =>
                  setSelectedRaw(''),
                );
            }}
          >
            <fieldset className="work-form" disabled={busy}>
              <div className="field">
                <label htmlFor="work-raw-choice">选择已有 Raw</label>
                <select
                  id="work-raw-choice"
                  value={selectedRaw}
                  onChange={(event) => setSelectedRaw(event.target.value)}
                >
                  <option value="">{availableRaws.length ? '选择一条资料' : '暂无可选资料'}</option>
                  {availableRaws.map((raw) => (
                    <option key={raw.id} value={raw.id}>
                      {raw.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="work-buttons">
                <button className="secondary-button" type="submit" disabled={!selectedRaw}>
                  添加关联
                </button>
              </div>
            </fieldset>
          </form>
        </div>
        <div>
          <h3>截图</h3>
          <ul className="work-images">
            {saved.screenshots.map((image) => {
              const url = workScreenshotUrl(saved.id, image.id);
              return (
                <li key={image.id}>
                  {brokenImages.includes(image.id) ? (
                    <p className="form-error" role="alert">
                      截图无法预览。
                    </p>
                  ) : (
                    <a href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={image.note ? `截图：${image.note}` : '已保存的事项截图'}
                        onError={() => setBrokenImages((ids) => [...ids, image.id])}
                      />
                      <span>打开截图</span>
                    </a>
                  )}
                  {image.note && <p className="work-prose">{image.note}</p>}
                </li>
              );
            })}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!imageFile) return;
              const formElement = event.currentTarget;
              const form = new FormData();
              form.set('file', imageFile);
              form.set('note', imageNote);
              form.set('baseRevision', String(saved.revision));
              void save(
                'materials',
                () => uploadWorkScreenshot(saved.id, form),
                '截图已保存。',
                () => {
                  formElement.reset();
                  setImageFile(null);
                  setImageNote('');
                },
              );
            }}
          >
            <fieldset className="work-form" disabled={busy}>
              <label className="field">
                截图文件
                <input
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  aria-describedby="work-image-hint"
                  onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <p className="work-note" id="work-image-hint">
                PNG 或 JPEG，最多 5 MiB。
              </p>
              <label className="field">
                截图说明（选填）
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={imageNote}
                  onChange={(event) => setImageNote(event.target.value)}
                />
              </label>
              <div className="work-buttons">
                <button className="secondary-button" type="submit" disabled={!imageFile}>
                  上传截图
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
      {renderNotice('materials')}
    </section>
  );
}
