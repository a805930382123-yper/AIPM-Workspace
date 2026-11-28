import type { ReactNode } from 'react';

export function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="pb-field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="pb-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Multi({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: [string, string][];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="pb-multi">
      <legend>{label}</legend>
      {options.length === 0 && <small>暂无可选项</small>}
      {options.map(([id, name]) => (
        <label key={id}>
          <input
            type="checkbox"
            checked={values.includes(id)}
            onChange={(e) => onChange(e.target.checked ? [...values, id] : values.filter((v) => v !== id))}
          />{' '}
          {name}
        </label>
      ))}
    </fieldset>
  );
}
export function Card({
  id,
  title,
  onRemove,
  children,
}: {
  id: string;
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <article className="pb-card" id={`pb-${id}`} tabIndex={-1}>
      <div className="pb-card-head">
        <strong>{title}</strong>
        <button type="button" className="text-button" onClick={onRemove}>
          删除
        </button>
      </div>
      {children}
    </article>
  );
}
export const key = () => `new:${crypto.randomUUID()}`;
