import {
  Search, Plus, FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Ellipsis, Star, Trash2, Pencil,
  Sun, Moon, Monitor, ChevronsLeft, PanelLeftOpen, Heading1, Heading2, Heading3, Type, List, ListOrdered,
  ListTodo, Quote, CodeXml, Minus, Table, Link, Bold, Italic, Strikethrough, Highlighter, Check, Clock,
  ArrowUpRight, FolderPlus, FilePlus, CornerDownLeft, Copy, Info, TriangleAlert, Lightbulb, X, Hash, Image,
  ArrowLeftRight, House, Sparkles, BookOpen, ArrowRight, FileSymlink, Library, GripVertical, CircleCheck,
  Flame, LogOut, HardDrive, FolderInput, Unlink, CircleAlert, ExternalLink, Feather, MessageSquare,
  Waypoints, LayoutTemplate, CalendarDays, ZoomIn, ZoomOut, Scan, Lock, Underline, Eraser,
  Users, UserPlus, Share2, Globe, Download,
} from 'lucide';

const ICONS = {
  search: Search, plus: Plus, page: FileText, folder: Folder, 'folder-open': FolderOpen,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown, more: Ellipsis, star: Star, trash: Trash2,
  pencil: Pencil, sun: Sun, moon: Moon, monitor: Monitor, 'sidebar-close': ChevronsLeft,
  'sidebar-open': PanelLeftOpen, h1: Heading1, h2: Heading2, h3: Heading3, text: Type, bullet: List,
  numbered: ListOrdered, todo: ListTodo, quote: Quote, code: CodeXml, divider: Minus, table: Table, link: Link,
  bold: Bold, italic: Italic, strike: Strikethrough, highlight: Highlighter, check: Check, clock: Clock,
  'arrow-up-right': ArrowUpRight, 'folder-plus': FolderPlus, 'file-plus': FilePlus, enter: CornerDownLeft,
  copy: Copy, info: Info, warning: TriangleAlert, tip: Lightbulb, x: X, hash: Hash, image: Image,
  switch: ArrowLeftRight, home: House, sparkles: Sparkles, book: BookOpen, 'arrow-right': ArrowRight,
  'page-link': FileSymlink, library: Library, grip: GripVertical, success: CircleCheck, flame: Flame,
  logout: LogOut, drive: HardDrive, move: FolderInput, unlink: Unlink, error: CircleAlert,
  external: ExternalLink, feather: Feather, note: MessageSquare,
  graph: Waypoints, template: LayoutTemplate, calendar: CalendarDays, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, fit: Scan, lock: Lock, users: Users, 'user-plus': UserPlus, share: Share2, globe: Globe, underline: Underline, eraser: Eraser, download: Download,
};

const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');

export function icon(name, size = 16, stroke = 1.75) {
  const node = ICONS[name];
  if (!node) return '';
  const children = node[2].map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg class="i" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

// The Local Notes mark: a page with a folded corner resting on a soft tile.
export function logo(size = 28) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="lg-tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3a3935"/><stop offset="1" stop-color="#151513"/>
      </linearGradient>
      <linearGradient id="lg-page" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ecebe7"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#lg-tile)"/>
    <path d="M10 7.5h8.6l4.9 4.9V23a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 23V9A1.5 1.5 0 0 1 10 7.5z" fill="url(#lg-page)"/>
    <path d="M18.6 7.5v3.4c0 .8.7 1.5 1.5 1.5h3.4" fill="#cfcdc6"/>
    <rect x="11.5" y="15" width="9" height="1.6" rx=".8" fill="#2b2a27" opacity=".85"/>
    <rect x="11.5" y="18.4" width="6.4" height="1.6" rx=".8" fill="#2b2a27" opacity=".4"/>
    <circle cx="21.6" cy="21.4" r="2.6" fill="#e8835a"/>
  </svg>`;
}
