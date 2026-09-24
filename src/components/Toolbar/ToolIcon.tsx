const paths = {
  highlight: 'm9 4 11 11-5 5L4 9z M4 9l-2 5 5 5 5-2 M2 22h8',
  select: 'm5 3 14 10-7 1-3 7z',
  hand: 'M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-4-1-6-4l-4-6a2 2 0 0 1 3-2l2 2',
  text: 'M4 7V4h16v3 M12 4v16 M8 20h8',
  arrow: 'M5 19 19 5 M7 5h12v12',
  undo: 'M8 4 3 9l5 5 M3 9h11a6 6 0 0 1 0 12',
  redo: 'm16 4 5 5-5 5 M21 9H10a6 6 0 0 0 0 12',
  panel: 'M3 4h18v16H3z M15 4v16',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
};

export default function ToolIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="tool-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
