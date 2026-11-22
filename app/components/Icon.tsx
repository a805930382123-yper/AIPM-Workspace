import type { ReactNode } from 'react';
const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" />
    </>
  ),
  book: (
    <>
      <path d="M3 5.5c3-1 6-.5 9 1.5v13c-3-2-6-2.5-9-1.5zM21 5.5c-3-1-6-.5-9 1.5v13c3-2 6-2.5 9-1.5z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18" />
    </>
  ),
  code: (
    <>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4.9a7 7 0 0 0-1.7-1L14.4 3h-4.8l-.4 3a7 7 0 0 0-1.7 1l-2.4-.9-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-.9a7 7 0 0 0 1.7 1l.4 3h4.8l.4-3a7 7 0 0 0 1.7-1l2.4.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3M7 8l5-5 5 5M4 15v5h16v-5" />
    </>
  ),
  work: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />
    </>
  ),
  automation: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="nav-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
