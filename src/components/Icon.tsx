/**
 * Inline SVG icon set (stroke icons, 24×24) — no runtime asset loading, so
 * the controls render even when icon CDNs are unavailable.
 */
const PATHS: Record<string, string> = {
  play: "M8 5.5v13l11-6.5-11-6.5z",
  pause: "M8 5h3v14H8zM13 5h3v14h-3z",
  prev: "M6 5v14M18 6l-9 6 9 6V6z",
  next: "M18 5v14M6 6l9 6-9 6V6z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.2-4.2",
  layers: "M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  map: "M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4zm0 0v13m6-10.5v13",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5 5-2z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8.5v.5",
  close: "M6 6l12 12M18 6 6 18",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
  book: "M4 5.5C6.5 4 9.5 4 12 6c2.5-2 5.5-2 8-.5V19c-2.5-1.5-5.5-1.5-8 .5-2.5-2-5.5-2-8-.5V5.5zM12 6v13.5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2.1-.6-.6-1.5 1-1.9-1.4-1.4-1.9 1-1.5-.6L12 4l-1.5.4-.6 2.1-1.5.6-1.9-1-1.4 1.4 1 1.9-.6 1.5L4 12l.4 1.5 2.1.6.6 1.5-1 1.9 1.4 1.4 1.9-1 1.5.6L12 20l1.5-.4.6-2.1 1.5-.6 1.9 1 1.4-1.4-1-1.9.6-1.5L20 12z",
  cube: "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3zm0 0v18M4 7.5l8 4.5 8-4.5",
  square: "M5 5h14v14H5z",
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5",
  scroll: "M7 4h11a2 2 0 0 1 2 2v1h-4M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v12M10 9h5M10 13h5",
  compare: "M12 3v18M5 7h4v10H5zM15 7h4v10h-4z",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7 2 2v5M8 12l3-4 3 1 2 4M11 8l-1 5",
  pin: "M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21zm0-14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  menu: "M4 7h16M4 12h16M4 17h16",
  send: "M4 12 20 4l-6 16-3-7-7-1z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "icon", title }: { name: IconName; className?: string; title?: string }) {
  const filled = name === "play" || name === "pause";
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Brand mark: a ford across the river, with the founding star. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#49EAD8" />
          <stop offset="1" stopColor="#E8B76B" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="#071923" stroke="url(#bm-g)" strokeWidth="1.5" />
      <path d="M8 31c6-4 10 2 16-2s10 2 16-2" fill="none" stroke="#49EAD8" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 36c6-4 10 2 16-2s10 2 16-2" fill="none" stroke="#49EAD8" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15 28V18l4-3 4 3v10M25 28V14l4-3 4 3v14" fill="none" stroke="#F2E8D5" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M36 9l.9 2.4 2.6.1-2 1.6.7 2.5L36 14.2l-2.2 1.4.7-2.5-2-1.6 2.6-.1z" fill="#E8B76B" />
    </svg>
  );
}
