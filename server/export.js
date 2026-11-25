'use strict';

// Note export: Markdown is the source of truth, so every format is rendered from
// the same token stream. The module is shared by the local vault server and the
// team server, and has no Electron or browser dependencies.

const path = require('path');
const MarkdownIt = require('markdown-it');
const { imageSize } = require('image-size');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ExternalHyperlink, ShadingType,
} = require('docx');
const PDFDocument = require('pdfkit');

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const FORMATS = ['docx', 'pdf', 'txt', 'html', 'md'];
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};


function cleanFilename(value) {
  return String(value || 'Untitled')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'Untitled';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tokenText(token) {
  if (!token) return '';
  if (token.type === 'text' || token.type === 'code_inline') return token.content;
  if (token.type === 'image') return token.content || token.attrGet?.('alt') || '';
  if (token.children) return token.children.map(tokenText).join('');
  return '';
}

function inlinePlain(children) {
  const out = [];
  for (const token of children || []) {
    if (token.type === 'text' || token.type === 'code_inline') out.push(token.content);
    else if (token.type === 'image') out.push(`[Image: ${token.attrGet?.('alt') || token.content || 'image'}]`);
    else if (token.type === 'softbreak' || token.type === 'hardbreak') out.push('\n');
    else if (token.children) out.push(inlinePlain(token.children));
  }
  return out.join('');
}

function plainText(markdown) {
  const tokens = md.parse(String(markdown || '').replace(/^\uFEFF/, ''), {});
  const lines = [];
  let current = '';
  const listTypes = [];
  const counters = [];
  const flush = () => {
    if (current.trim()) lines.push(current.trimEnd());
    current = '';
  };
  const nextPrefix = () => {
    if (!listTypes.length) return '';
    const level = Math.max(0, listTypes.length - 1);
    return '  '.repeat(level) + (listTypes[listTypes.length - 1] === 'ordered' ? `${counters[counters.length - 1] || 1}. ` : '- ');
  };
  for (const token of tokens) {
    if (token.type === 'heading_open') {
      flush();
      current = '';
    } else if (token.type === 'heading_close') {
      flush();
      lines.push('');
    } else if (token.type === 'paragraph_open') {
      if (!current) current = nextPrefix();
    } else if (token.type === 'inline') {
      current += inlinePlain(token.children);
    } else if (token.type === 'paragraph_close') {
      flush();
    } else if (token.type === 'bullet_list_open') {
      listTypes.push('bullet');
      counters.push(0);
    } else if (token.type === 'ordered_list_open') {
      listTypes.push('ordered');
      counters.push(0);
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      flush();
      listTypes.pop();
      counters.pop();
    } else if (token.type === 'list_item_open') {
      flush();
      if (counters.length) counters[counters.length - 1] += 1;
      current = nextPrefix();
    } else if (token.type === 'list_item_close') {
      flush();
    } else if (token.type === 'fence' || token.type === 'code_block') {
      flush();
      lines.push(token.content.replace(/\s+$/, ''));
      lines.push('');
    } else if (token.type === 'blockquote_open') {
      flush();
    } else if (token.type === 'blockquote_close') {
      flush();
    } else if (token.type === 'hr') {
      flush();
      lines.push('---');
    } else if (token.type === 'table_open') {
      flush();
    } else if (token.type === 'table_cell_close') {
      current += ' | ';
    } else if (token.type === 'table_row_close') {
      flush();
    }
  }
  flush();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function imageInfo(buffer) {
  try {
    const size = imageSize(buffer);
    if (!size || !size.width || !size.height) return null;
    return { width: size.width, height: size.height, type: size.type || '' };
  } catch {
    return null;
  }
}

function imageDimensions(info, maxWidth = 480, maxHeight = 320) {
  const ratio = Math.min(1, maxWidth / info.width, maxHeight / info.height);
  return { width: Math.round(info.width * ratio), height: Math.round(info.height * ratio) };
}

function monoType(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  if (ext === 'png') return 'png';
  return null;
}

async function inlineRuns(children, readImage, { size = 22, quote = false } = {}) {
  const runs = [];
  const marks = { bold: false, italic: false, code: false, strike: false };
  let link = null;
  let linkRuns = null;
  const push = (run) => (linkRuns ? linkRuns.push(run) : runs.push(run));
  const style = () => ({
    bold: marks.bold,
    italics: marks.italic,
    strike: marks.strike,
    font: marks.code ? 'JetBrains Mono' : undefined,
    color: marks.code ? '444444' : quote ? '555555' : undefined,
  });
  for (const token of children || []) {
    if (token.type === 'strong_open') marks.bold = true;
    else if (token.type === 'strong_close') marks.bold = false;
    else if (token.type === 'em_open') marks.italic = true;
    else if (token.type === 'em_close') marks.italic = false;
    else if (token.type === 's_open' || token.type === 'strike_open') marks.strike = true;
    else if (token.type === 's_close' || token.type === 'strike_close') marks.strike = false;
    else if (token.type === 'code_inline') {
      push(new TextRun({ text: token.content, ...style(), font: 'JetBrains Mono', color: '444444', size }));
    } else if (token.type === 'text') {
      push(new TextRun({ text: decodeEntities(token.content), ...style(), size }));
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      push(new TextRun({ text: '\n', ...style(), size }));
    } else if (token.type === 'image') {
      const src = token.attrGet?.('src') || token.attrs?.[0]?.[1];
      const alt = token.attrGet?.('alt') || token.content || '';
      const buffer = src && readImage ? await readImage(src) : null;
      const info = buffer ? imageInfo(buffer) : null;
      const type = monoType(src);
      if (buffer && info && type) {
        const dims = imageDimensions(info);
        push(new ImageRun({ data: buffer, transformation: dims, type }));
      } else if (alt) {
        push(new TextRun({ text: `[Image: ${alt}]`, italics: true, color: '777777', size }));
      }
    } else if (token.type === 'link_open') {
      link = token.attrGet?.('href') || '#';
      linkRuns = [];
    } else if (token.type === 'link_close') {
      if (linkRuns?.length) {
        runs.push(new ExternalHyperlink({ link, children: linkRuns }));
      }
      link = null;
      linkRuns = null;
    }
  }
  return runs;
}

async function docxExport({ title, markdown, readImage }) {
  const tokens = md.parse(String(markdown || '').replace(/^\uFEFF/, ''), {});
  const children = [];
  const listTypes = [];
  const listCounters = [];
  let inQuote = false;

  const addInline = async (token, extra = {}) => {
    const runs = await inlineRuns(token.children, readImage, { size: 22, quote: inQuote });
    return new Paragraph({ children: runs.length ? runs : [new TextRun('')], ...extra });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const level = Number(token.tag.slice(1)) || 1;
      children.push(new Paragraph({
        children: [new TextRun({ text: inline?.content || '', bold: true, font: 'Source Serif 4', size: level === 1 ? 34 : level === 2 ? 28 : 24 })],
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: 260, after: 100 },
      }));
      i += 2;
    } else if (token.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      const inList = listTypes.length > 0;
      const listIndex = listTypes.length - 1;
      const runs = await inlineRuns(inline.children, readImage, { size: 22, quote: inQuote });
      if (inList) {
        if (listTypes[listIndex] === 'ordered') {
          runs.unshift(new TextRun({ text: `${listCounters[listIndex] || 1}. `, size: 22, color: '333333' }));
        }
        children.push(new Paragraph({
          children: runs.length ? runs : [new TextRun('')],
          bullet: listTypes[listIndex] === 'bullet' ? { level: listIndex } : undefined,
          indent: listTypes[listIndex] === 'ordered' ? { left: 360 * (listIndex + 1) } : undefined,
          spacing: { after: 80 },
        }));
      } else {
        children.push(new Paragraph({
          children: runs.length ? runs : [new TextRun('')],
          indent: inQuote ? { left: 480 } : undefined,
          spacing: { after: 150 },
        }));
      }
      i += 2;
    } else if (token.type === 'bullet_list_open') {
      listTypes.push('bullet');
      listCounters.push(0);
    } else if (token.type === 'ordered_list_open') {
      listTypes.push('ordered');
      listCounters.push(0);
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listTypes.pop();
      listCounters.pop();
    } else if (token.type === 'list_item_open') {
      if (listCounters.length) listCounters[listCounters.length - 1] += 1;
    } else if (token.type === 'blockquote_open') {
      inQuote = true;
    } else if (token.type === 'blockquote_close') {
      inQuote = false;
    } else if (token.type === 'fence' || token.type === 'code_block') {
      children.push(new Paragraph({
        children: [new TextRun({ text: token.content.replace(/\s+$/, ''), font: 'JetBrains Mono', size: 18, color: '333333' })],
        shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
        spacing: { before: 120, after: 160 },
      }));
    } else if (token.type === 'hr') {
      children.push(new Paragraph({ text: '', border: { bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 } } }));
    } else if (token.type === 'table_open') {
      const rows = [];
      let row = null;
      let cell = null;
      let j = i + 1;
      for (; j < tokens.length && tokens[j].type !== 'table_close'; j += 1) {
        const t = tokens[j];
        if (t.type === 'table_row_open') row = [];
        else if (t.type === 'table_cell_open') cell = [];
        else if (t.type === 'inline' && cell) cell.push(...(t.children || []));
        else if (t.type === 'table_cell_close' && row && cell) {
          row.push(new TableCell({ children: [new Paragraph({ children: await inlineRuns(cell, readImage, { size: 20 }) })] }));
          cell = null;
        } else if (t.type === 'table_row_close' && row) {
          rows.push(new TableRow({ children: row }));
          row = null;
        }
      }
      if (rows.length) {
        children.push(new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
          },
        }));
      }
      i = j;
    }
  }

  const doc = new Document({
    creator: 'Local Notes',
    title: title || 'Local Notes export',
    description: 'Exported from Local Notes',
    styles: {
      default: {
        document: {
          run: { font: 'Inter', size: 22, color: '222222' },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [{ children: children.length ? children : [new Paragraph({ text: 'This note is empty.' })] }],
  });
  return Packer.toBuffer(doc);
}

// PDF standard fonts ship with every PDF reader. The app's custom typefaces
// remain in HTML/DOCX exports; standard fonts keep PDF generation deterministic
// on every OS.

async function pdfExport({ title, markdown, readImage }) {
  const tokens = md.parse(String(markdown || '').replace(/^\uFEFF/, ''), {});
  const buffers = [];
  const doc = new PDFDocument({
    size: 'A4',
    margin: 64,
    bufferPages: true,
    info: { Title: title || 'Local Notes export', Creator: 'Local Notes' },
  });
  doc.on('data', (chunk) => buffers.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const writeParagraph = async (inline, { size = 11.5, color = '#222222', indent = 0, quote = false, prefix = '' } = {}) => {
    const segments = [];
    let bold = false;
    let italic = false;
    let code = false;
    if (prefix) segments.push({ text: prefix, bold: false, italic: false, code: false, color: quote ? '#555555' : color });
    const push = (text) => {
      if (!text) return;
      segments.push({ text, bold, italic, code, color: quote ? '#555555' : color });
    };
    for (const token of inline?.children || []) {
      if (token.type === 'strong_open') bold = true;
      else if (token.type === 'strong_close') bold = false;
      else if (token.type === 'em_open') italic = true;
      else if (token.type === 'em_close') italic = false;
      else if (token.type === 'code_inline') code = true, push(token.content), code = false;
      else if (token.type === 'text') push(decodeEntities(token.content));
      else if (token.type === 'softbreak' || token.type === 'hardbreak') push('\n');
      else if (token.type === 'image') {
        const src = token.attrGet?.('src') || token.attrs?.[0]?.[1];
        const alt = token.attrGet?.('alt') || token.content || '';
        const buffer = src && readImage ? await readImage(src) : null;
        const info = buffer ? imageInfo(buffer) : null;
        if (buffer && info && /^(png|jpe?g)$/i.test(path.extname(src).slice(1))) {
          const dims = imageDimensions(info, pageWidth, 300);
          if (doc.y + dims.height > doc.page.height - doc.page.margins.bottom) doc.addPage();
          doc.image(buffer, { fit: [dims.width, dims.height], align: 'center' });
          doc.moveDown(0.5);
        } else if (alt) push(`[Image: ${alt}]`);
      }
    }
    if (!segments.length) return;
    let first = true;
    for (const segment of segments) {
      const font = segment.code
        ? 'Courier'
        : segment.bold && segment.italic
          ? 'Helvetica-BoldOblique'
          : segment.bold
            ? 'Helvetica-Bold'
            : segment.italic
              ? 'Helvetica-Oblique'
              : 'Helvetica';
      doc.font(font).fontSize(segment.code ? 9.5 : size).fillColor(segment.color);
      doc.text(segment.text, { continued: true, indent: first ? indent : 0 });
      first = false;
    }
    doc.text('', { continued: false });
    doc.moveDown(0.65);
  };

  doc.font('Times-Bold').fontSize(24).fillColor('#1d1d1b').text(title || 'Untitled', { align: 'left' });
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(11.5).fillColor('#222222');

  let listLevel = 0;
  const ordered = [];
  const counters = [];
  let quote = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      const level = Number(token.tag.slice(1));
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(level === 1 ? 0.6 : 0.4);
      doc.font('Times-Bold').fontSize(level === 1 ? 19 : level === 2 ? 15.5 : 13).fillColor('#1d1d1b');
      doc.text(tokenText(tokens[i + 1]));
      doc.moveDown(0.55);
      i += 2;
    } else if (token.type === 'paragraph_open') {
      const inList = listLevel > 0;
      const prefix = inList ? (ordered[ordered.length - 1] ? `${counters[counters.length - 1] || 1}. ` : '• ') : '';
      await writeParagraph(tokens[i + 1], {
        indent: inList ? Math.max(0, listLevel - 1) * 18 : quote ? 18 : 0,
        quote,
        prefix,
      });
      i += 2;
    } else if (token.type === 'bullet_list_open') {
      ordered.push(false);
      counters.push(0);
      listLevel += 1;
    } else if (token.type === 'ordered_list_open') {
      ordered.push(true);
      counters.push(0);
      listLevel += 1;
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      ordered.pop();
      counters.pop();
      listLevel = Math.max(0, listLevel - 1);
    } else if (token.type === 'list_item_open') {
      if (counters.length) counters[counters.length - 1] += 1;
    } else if (token.type === 'blockquote_open') {
      quote = true;
    } else if (token.type === 'blockquote_close') {
      quote = false;
    } else if (token.type === 'fence' || token.type === 'code_block') {
      doc.font('Courier').fontSize(9.5).fillColor('#333333');
      doc.text(token.content.replace(/\s+$/, ''), { indent: 12 });
      doc.moveDown(0.6);
    } else if (token.type === 'hr') {
      doc.moveDown(0.5);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.7);
    } else if (token.type === 'table_open') {
      // Tables are rendered as aligned text rows so they remain useful when copied.
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== 'table_close') {
        if (tokens[j].type === 'inline') {
          doc.font('Helvetica').fontSize(9.5).fillColor('#333333').text(tokens[j].content, { indent: 8 });
        }
        j += 1;
      }
      doc.moveDown(0.5);
      i = j - 1;
    }
  }
  doc.end();
  await finished;
  return Buffer.concat(buffers);
}

async function htmlExport({ title, markdown, readImage }) {
  const raw = md.render(String(markdown || ''), {});
  const imageCache = new Map();
  const replacements = [];
  const regex = /<img\b[^>]*src="([^"]+)"[^>]*>/gi;
  for (const match of raw.matchAll(regex)) {
    const src = decodeEntities(match[1]);
    if (/^(https?:|data:)/i.test(src)) continue;
    let buffer = null;
    try { buffer = readImage ? await readImage(src) : null; } catch { buffer = null; }
    if (!buffer) continue;
    if (!imageCache.has(src)) {
      const ext = path.extname(src).slice(1).toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      imageCache.set(src, `data:${mime};base64,${buffer.toString('base64')}`);
    }
    replacements.push([match[0], match[0].replace(match[1], imageCache.get(src))]);
  }
  let body = raw;
  for (const [from, to] of replacements) body = body.replace(from, to);
  return Buffer.from(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Local Notes export')}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f7f7f3; color: #24251f; font: 16px/1.7 Inter, Segoe UI, sans-serif; }
  article { max-width: 760px; margin: 0 auto; padding: 56px 28px 96px; }
  h1, h2, h3, h4 { font-family: "Source Serif 4", Georgia, serif; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; }
  h1 { font-size: 2.2rem; } h2 { font-size: 1.55rem; margin-top: 2em; } h3 { font-size: 1.2rem; margin-top: 1.6em; }
  p { margin: 0 0 1.1em; } a { color: #315d4d; text-underline-offset: 3px; }
  blockquote { margin: 1.6em 0; padding: 2px 0 2px 20px; border-left: 3px solid #315d4d; color: #4e554b; font-family: "Source Serif 4", Georgia, serif; font-style: italic; font-size: 1.12em; }
  code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 0.85em; background: #eceae3; border-radius: 4px; padding: 2px 5px; }
  pre { overflow-x: auto; padding: 18px 20px; background: #efeee8; border: 1px solid #dfddd4; border-radius: 9px; }
  pre code { background: none; padding: 0; font-size: 0.82em; }
  ul, ol { padding-left: 1.5em; } li { margin: 0.3em 0; }
  li input[type="checkbox"] { margin-right: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.92em; }
  th, td { text-align: left; padding: 9px 11px; border-bottom: 1px solid #dddbd2; vertical-align: top; }
  th { font-weight: 600; border-bottom-color: #c8c5bb; }
  img { max-width: 100%; height: auto; border-radius: 9px; }
  hr { border: 0; border-top: 1px solid #d4d1c7; margin: 2.5em 0; }
  .meta { margin-top: 64px; padding-top: 16px; border-top: 1px solid #dddbd2; color: #787a70; font-size: 12px; }
  @media print { body { background: #fff; } article { padding: 0; } }
</style>
</head>
<body><article>
${body}
<div class="meta">Exported from Local Notes</div>
</article></body></html>`, 'utf8');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function materializeMedia(markdown) {
  return String(markdown || '').replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match, target, label) => {
    const src = encodeURI(target.trim());
    return `![${(label || target).trim()}](${src})`;
  });
}

async function exportNote({ title, markdown, format, baseName, readImage }) {
  const fmt = String(format || '').toLowerCase();
  if (!FORMATS.includes(fmt)) {
    const error = new Error(`Unsupported export format: ${format}`);
    error.status = 400;
    throw error;
  }
  const safeBase = cleanFilename(baseName || title || 'Untitled');
  if (fmt === 'md') {
    return { buffer: Buffer.from(String(markdown || ''), 'utf8'), filename: `${safeBase}.md`, mime: MIME.md };
  }
  const source = materializeMedia(String(markdown || '').replace(/^\uFEFF/, ''));
  if (fmt === 'txt') {
    return { buffer: Buffer.from(plainText(source), 'utf8'), filename: `${safeBase}.txt`, mime: MIME.txt };
  }
  if (fmt === 'html') {
    return { buffer: await htmlExport({ title, markdown: source, readImage }), filename: `${safeBase}.html`, mime: MIME.html };
  }
  if (fmt === 'docx') {
    return { buffer: await docxExport({ title, markdown: source, readImage }), filename: `${safeBase}.docx`, mime: MIME.docx };
  }
  return { buffer: await pdfExport({ title, markdown: source, readImage }), filename: `${safeBase}.pdf`, mime: MIME.pdf };
}

module.exports = exportNote;
module.exports.FORMATS = FORMATS;
module.exports.MIME = MIME;
module.exports.plainText = plainText;
