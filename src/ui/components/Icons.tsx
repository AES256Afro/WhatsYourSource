import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: P, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Logo = (p: P) =>
  base({ strokeWidth: 2.2, ...p }, (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.5-4.5" />
      <path d="M8 10.5l1.8 1.8 3.2-3.6" />
    </>
  ));
export const Clock = (p: P) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ));
export const Sliders = (p: P) =>
  base(p, (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ));
export const External = (p: P) =>
  base({ strokeWidth: 2.4, ...p }, (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" />
    </>
  ));
export const Check = (p: P) => base({ strokeWidth: 2.6, ...p }, <path d="M5 12l4 4L19 7" />);
export const Alert = (p: P) =>
  base(p, (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4" />
      <path d="M12 18h.01" />
    </>
  ));
export const Image = (p: P) =>
  base(p, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ));
export const Lines = (p: P) => base(p, <path d="M4 6h16M4 12h10M4 18h7" />);
export const Globe = (p: P) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ));
export const Copy = (p: P) =>
  base(p, (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ));
export const Refresh = (p: P) =>
  base(p, (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ));
export const Close = (p: P) => base({ strokeWidth: 2.4, ...p }, <path d="M6 6l12 12M18 6L6 18" />);
export const ChevronRight = (p: P) => base({ strokeWidth: 2.2, ...p }, <path d="M9 6l6 6-6 6" />);
export const ArrowLeft = (p: P) => base({ strokeWidth: 2.2, ...p }, <path d="M19 12H5M11 6l-6 6 6 6" />);
export const Shield = (p: P) =>
  base(p, (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ));
export const Sparkle = (p: P) => (
  <svg width={p.size ?? 12} height={p.size ?? 12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={p.className}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);
export const Search = (p: P) =>
  base({ strokeWidth: 2.2, ...p }, (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ));
export const Camera = (p: P) =>
  base(p, (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ));
export const Cpu = (p: P) =>
  base(p, (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ));
export const Trash = (p: P) => base(p, <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const Link = (p: P) =>
  base(p, (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ));
export const Download = (p: P) =>
  base(p, (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ));
