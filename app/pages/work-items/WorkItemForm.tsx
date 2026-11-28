import type { WorkItemsState } from './useWorkItemsState';

export function WorkItemForm({ state }: { state: WorkItemsState }) {
  const { title, setTitle, feedback, setFeedback, goal, setGoal, createError, creating, create, product } = state;
  return (
    <form className="panel work-section work-create" onSubmit={(event) => void create(event)}>
      <fieldset className="work-form" disabled={creating}>
        <label className="field">
          {product ? '事项标题' : '问题标题'}
          <input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {product ? (
          <div className="field">
            <label htmlFor="work-create-goal">分析目标</label>
            <textarea
              id="work-create-goal"
              required
              maxLength={20_000}
              rows={4}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
        ) : (
          <label className="field">
            客户反馈
            <textarea
              required
              maxLength={20_000}
              rows={6}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </label>
        )}
        <p className="work-note">
          {product
            ? '创建后可补充数据口径、关联资料并保存阶段成果。'
            : '保存后，你可以补充客户、项目、复现过程及相关资料。'}
        </p>
        {createError && (
          <p className="form-error" role="alert">
            {createError}
          </p>
        )}
        <div className="work-buttons">
          <button className="primary-button" type="submit">
            {creating ? '正在创建…' : '创建事项'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
