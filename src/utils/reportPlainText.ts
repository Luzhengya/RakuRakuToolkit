import type { JSONContent } from '@tiptap/react';

// レポート本文（Tiptap JSON）を AI へ渡すプレーンテキストにする（「AI文書整理」用）。
// 段落・見出しは 1 行ずつ、表は列をタブ・行を改行で区切る。画像・区切り線は含めない
export function reportToPlainText(doc: JSONContent): string {
  const lines: string[] = [];
  walk(doc, lines, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function inlineText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(inlineText).join('');
}

// 編集できない Notion ブロック（段組み等）はサーバーで作った HTML しか持たないため、タグを外して文字だけ取る
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]*>/g, '')
    // 入れ子の崩れたタグ（例: <<b>script>）の残りも消す。実体参照の < > は次の行で文字に戻す
    .replace(/[<>]/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\t\n/g, '\n')
    .trim();
}

function walk(node: JSONContent, lines: string[], indent: string) {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
    case 'detailsSummary':
      lines.push(indent + inlineText(node));
      return;
    case 'table':
      for (const row of node.content ?? []) {
        lines.push((row.content ?? []).map((cell) => (cell.content ?? []).map(inlineText).join(' ').replace(/\s*\n\s*/g, ' ')).join('\t'));
      }
      return;
    case 'bulletList':
    case 'taskList':
    case 'orderedList':
      (node.content ?? []).forEach((item, i) => {
        const mark = node.type === 'orderedList' ? `${Number(node.attrs?.start ?? 1) + i}. ` : '・';
        const sub: string[] = [];
        (item.content ?? []).forEach((child) => walk(child, sub, indent + '  '));
        if (sub.length) sub[0] = indent + mark + sub[0].trimStart();
        lines.push(...sub);
      });
      return;
    case 'notionBlock':
      lines.push(htmlToText(String(node.attrs?.html ?? '')));
      return;
    case 'image':
    case 'horizontalRule':
      return;
    default:
      (node.content ?? []).forEach((child) => walk(child, lines, indent));
  }
}
