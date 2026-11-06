const PATHS = {
  note: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  review: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5',
  org: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
  people:
    'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2c2.2.6 3.5 2.4 3.5 5.8',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  rect: 'M4 6h16v12H4z',
  pill: 'M8 6h8a6 6 0 0 1 0 12H8a6 6 0 0 1 0-12z',
  diamond: 'M12 3l9 9-9 9-9-9z',
  circle: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  pointer: 'M5 3l13 8-6 1.5L9 19z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  share: 'M6 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 5.5v1M4.5 11.5v1M4.5 17.5v1',
  tasks: 'M4 5h4v4H4zM4 15h4v4H4zM5 17l1 1 2-2M11 7h9M11 17h9',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16',
  image: 'M3 4h18v16H3zM9 8.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM21 16l-5-5-9 9',
  code: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  heading: 'M6 4v16M18 4v16M6 12h12',
  graph: 'M4 20h16M7 17v-6M12 17V6M17 17v-9',
  sketch: 'M3 4h7v6H3zM14 14h7v6h-7zM10 7h4a3 3 0 0 1 3 3v4',
  flow: 'M9 3h6v5H9zM12 8v3M5 13h14M5 13v3M19 13v3M2 16h6v5H2zM16 16h6v5h-6z',
  callout: 'M3 4h18v16H3zM7 9h10M7 13h6',
  quote: 'M7 7h4v4H7zM7 11c0 3-1 5-3 6M15 7h4v4h-4zM15 11c0 3-1 5-3 6',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  publish: 'M5 12.5l4.5 4.5L19 7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4 3.6-7 8-7s8 3 8 7',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, small, label }: { name: IconName; small?: boolean; label?: string }) {
  return (
    <svg
      className={small ? 'icon sm' : 'icon'}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
