import {
  Search, Plus, FileText, Folder, FolderOpen, ChevronRight, ChevronDown, Ellipsis, Star, Trash2, Pencil,
  Sun, Moon, Monitor, ChevronsLeft, PanelLeftOpen, Heading1, Heading2, Heading3, Type, List, ListOrdered,
  ListTodo, Quote, CodeXml, Minus, Table, Link, Bold, Italic, Strikethrough, Highlighter, Check, Clock,
  ArrowUpRight, FolderPlus, FilePlus, CornerDownLeft, Copy, Info, TriangleAlert, Lightbulb, X, Hash, Image,
  ArrowLeftRight, House, Sparkles, BookOpen, ArrowRight, FileSymlink, Library, GripVertical, CircleCheck,
  Flame, LogOut, HardDrive, FolderInput, Unlink, CircleAlert, ExternalLink, Feather, MessageSquare,
  Waypoints, LayoutTemplate, CalendarDays, ZoomIn, ZoomOut, Scan, Lock, Underline, Eraser,
  Users, UserPlus, Share2, Globe, Download, Mail,
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
  graph: Waypoints, template: LayoutTemplate, calendar: CalendarDays, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, fit: Scan, lock: Lock, users: Users, 'user-plus': UserPlus, share: Share2, globe: Globe, underline: Underline, eraser: Eraser, download: Download, mail: Mail,
};

const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');

export function icon(name, size = 16, stroke = 1.75) {
  const node = ICONS[name];
  if (!node) return '';
  const children = node[2].map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg class="i" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

// The Extended mark: a stacked page pair on a forest tile with an E badge.
export function logo(size = 28) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="lg-tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2e6452"/><stop offset="1" stop-color="#0c221d"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#lg-tile)"/>
    <g transform="rotate(-7 15 17)">
      <rect x="8.4" y="8.8" width="12.2" height="16.2" rx="1.4" fill="#dcd6c6"/>
    </g>
    <path d="M13.2 8.2h9.2l3.4 3.4V24a1.4 1.4 0 0 1-1.4 1.4h-11.2A1.4 1.4 0 0 1 11.8 24V9.6a1.4 1.4 0 0 1 1.4-1.4z" fill="#fff"/>
    <path d="M22.4 8.2v2.4c0 .6.5 1 1 1h2.4" fill="#cfcbc0"/>
    <rect x="14.5" y="14.2" width="6.6" height="1.5" rx=".75" fill="#2b2a27" opacity=".85"/>
    <rect x="14.5" y="17.4" width="5" height="1.5" rx=".75" fill="#2b2a27" opacity=".45"/>
    <rect x="14.5" y="20.6" width="4" height="1.5" rx=".75" fill="#2b2a27" opacity=".3"/>
    <circle cx="24.2" cy="24.1" r="4.5" fill="#e8835a" stroke="#fff" stroke-width=".9"/>
    <text x="24.2" y="26.7" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="6.8" font-weight="700" fill="#fff">E</text>
  </svg>`;
}
