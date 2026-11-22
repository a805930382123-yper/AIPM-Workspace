import './brand.css';

export function Brand() {
  return (
    <div className="aipm-brand" aria-label="AIPM Workspace">
      <img className="aipm-brand__mark" src="/aipm-mark.svg" alt="" />
      <span className="aipm-brand__name">
        <strong>AIPM</strong>
        <small>Workspace</small>
      </span>
    </div>
  );
}
