// The design system's line icons (ui_kits/studio/icons.jsx on claude.ai/design,
// Lucide idiom: 24px grid, 1.8 stroke, round caps), plus the few Hoppper needs
// that it doesn't have — hops, editor, stop, record, quantise, trash, edit,
// log out — drawn in the same idiom. Each icon is a list of SVG child elements.

type El = [tag: 'path' | 'circle' | 'rect', attrs: Record<string, string | number>];

const filled = { fill: 'currentColor', stroke: 'none' };

export const ICONS = {
  logo: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M8.5 7.5v9M15.5 7.5v9M8.5 12h7' }]],
  note: [['circle', { cx: 7, cy: 18, r: 2.5 }], ['circle', { cx: 18, cy: 16, r: 2.5 }], ['path', { d: 'M9.5 18V6l11-2v12' }]],
  headphones: [['path', { d: 'M3 18v-6a9 9 0 0 1 18 0v6' }], ['path', { d: 'M21 19a2 2 0 0 1-2 2h-1v-7h3v5zM3 19a2 2 0 0 0 2 2h1v-7H3v5z' }]],
  users: [['circle', { cx: 9, cy: 7, r: 3.2 }], ['path', { d: 'M2.5 20.5v-1a6 6 0 0 1 12 0v1' }], ['path', { d: 'M16.5 4.2a3.2 3.2 0 0 1 0 6.1' }], ['path', { d: 'M21.5 20.5v-1a6 6 0 0 0-3.6-5.5' }]],
  hops: [['path', { d: 'M2.5 19c1.3-6 4.7-6 6 0' }], ['path', { d: 'M8.5 19c1.7-10 5.8-10 7.5 0' }], ['path', { d: 'M16 19c1-4 3.5-4 4.5 0' }]],
  editor: [['path', { d: 'M2.5 12h2l1.5-4 2.5 9 2-5' }], ['path', { d: 'M16 12h1l1.2-3 1.6 6 1-3h.7' }], ['path', { d: 'M13 3.5v17' }], ['circle', { cx: 13, cy: 3.5, r: 1.4, ...filled }]],
  user: [['circle', { cx: 12, cy: 8, r: 3.6 }], ['path', { d: 'M4.5 20.5v-.5a7.5 7.5 0 0 1 15 0v.5' }]],
  gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M12 2.5l1 2.6a7.5 7.5 0 0 1 1.8.7l2.6-1 1.8 3.1-2 1.8a7.6 7.6 0 0 1 0 1.9l2 1.8-1.8 3.1-2.6-1a7.5 7.5 0 0 1-1.8.8l-1 2.5h-2l-1-2.5a7.5 7.5 0 0 1-1.8-.8l-2.6 1-1.8-3.1 2-1.8a7.6 7.6 0 0 1 0-1.9l-2-1.8 1.8-3.1 2.6 1a7.5 7.5 0 0 1 1.8-.7l1-2.6z' }]],
  play: [['path', { d: 'M7 4.5 19 12 7 19.5V4.5z', ...filled }]],
  pause: [['rect', { x: 6, y: 5, width: 4, height: 14, rx: 1, ...filled }], ['rect', { x: 14, y: 5, width: 4, height: 14, rx: 1, ...filled }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, ...filled }]],
  record: [['circle', { cx: 12, cy: 12, r: 6, ...filled }]],
  quantise: [['path', { d: 'M5 4v16M12 4v16M19 4v16' }], ['circle', { cx: 12, cy: 12, r: 2.6, ...filled }]],
  chevR: [['path', { d: 'm9 6 6 6-6 6' }]],
  edit: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }], ['path', { d: 'm13.5 6.5 4 4' }]],
  trash: [['path', { d: 'M4 7h16' }], ['path', { d: 'M9 7V4.5h6V7' }], ['path', { d: 'M6.5 7l1 13h9l1-13' }]],
  expand: [['path', { d: 'M3 12h18' }], ['path', { d: 'm7 8-4 4 4 4' }], ['path', { d: 'm17 8 4 4-4 4' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  copy: [['rect', { x: 8, y: 8, width: 12, height: 12, rx: 2 }], ['path', { d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' }]],
  undo: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }]],
  redo: [['path', { d: 'm15 14 5-5-5-5' }], ['path', { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13' }]],
  logout: [['path', { d: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3' }], ['path', { d: 'M10 16l-4-4 4-4M6 12h10' }]],
} satisfies Record<string, El[]>;

export type IconName = keyof typeof ICONS;
