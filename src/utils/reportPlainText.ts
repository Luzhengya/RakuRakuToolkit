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

const HTML_ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };

// 編集できない Notion ブロック（段組み等）はサーバーで作った HTML しか持たないため、タグを外して文字だけ取る。
// 結果はクリップボード用のプレーンテキスト（HTML として描画しない）。正規表現の置換を重ねると
// 実体参照の復元で < が戻る形になるため、1 文字ずつ読んでタグと実体参照を同時に処理する
function htmlToText(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end < 0) break;
      const tag = html.slice(i + 1, end).trim().toLowerCase();
      if (/^(br\b|\/(p|div|li|h[1-6]|tr)\b)/.test(tag)) out += '\n';
      else if (/^\/t[dh]\b/.test(tag)) out += '\t';
      i = end + 1;
      continue;
    }
    if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      const entity = semi > i ? HTML_ENTITIES[html.slice(i, semi + 1)] : undefined;
      if (entity !== undefined) {
        out += entity;
        i = semi + 1;
        continue;
      }
    }
    out += html[i];
    i++;
  }
  return out.replace(/\t\n/g, '\n').trim();
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
