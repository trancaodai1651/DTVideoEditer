const paths = {
  library: "M4 5h7v6H4z M13 5h7v6h-7z M4 13h7v6H4z M13 13h7v6h-7z",
  settings: "M4 7h16 M4 12h16 M4 17h16 M8 5v4 M16 10v4 M10 15v4",
  folder: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  plus: "M12 5v14 M5 12h14",
  video: "M4 6h16v12H4z M9 6v12 M15 6v12 M4 10h5 M4 14h5 M15 10h5 M15 14h5",
  audio: "M4 10v4 M8 6v12 M12 4v16 M16 8v8 M20 10v4",
  image: "M4 4h16v16H4z M4 16l5-5 4 4 2-2 5 5 M15 8h.01",
  shield: "M12 3l7 3v5c0 5-3.1 8-7 10-3.9-2-7-5-7-10V6z M9 12l2 2 4-4",
  play: "M9 5l11 7-11 7z",
  timeline: "M4 7h10 M16 7h4 M4 12h5 M11 12h9 M4 17h12 M18 17h2",
  close: "M6 6l12 12 M18 6L6 18",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  check: "M5 12l4 4L19 6",
  undo: "M9 7L4 12l5 5 M4 12h10a6 6 0 0 1 0 12h-1",
  redo: "M15 7l5 5-5 5 M20 12H10a6 6 0 0 0 0 12h1",
  split: "M12 3v18 M5 8l4 4-4 4 M19 8l-4 4 4 4",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5",
  export: "M12 15V4 M8 8l4-4 4 4 M5 14v5h14v-5",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16 16l4 4 M11 8v6 M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16 16l4 4 M8 11h6",
  send: "M4 12l16-8-6 16-3-7z M11 13l9-9",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  refresh: "M20 11a8 8 0 0 0-14-5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14 5l2-2 M20 20v-4h-4",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
