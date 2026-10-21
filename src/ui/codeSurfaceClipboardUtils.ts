import type { EditorState } from '@codemirror/state';

import { MAX_DISPLAY_LINE_LENGTH } from './codeSurfaceUtils';

/** Copy source characters, excluding decorations and the long-line display notice. */
export function selectedCodeText(state: EditorState, source: string, truncated: boolean): string {
  const starts = [0];
  const lengths: number[] = [];
  for (const match of source.matchAll(/\r\n?|\n/g)) {
    lengths.push(match.index - starts[starts.length - 1]!);
    starts.push(match.index + match[0].length);
  }
  lengths.push(source.length - starts[starts.length - 1]!);

  const sourceOffset = (position: number) => {
    const line = state.doc.lineAt(position);
    const column = position - line.from;
    const length = lengths[line.number - 1] ?? 0;
    const offset =
      truncated && length > MAX_DISPLAY_LINE_LENGTH && column > MAX_DISPLAY_LINE_LENGTH
        ? length
        : Math.min(column, length);
    return (starts[line.number - 1] ?? source.length) + offset;
  };

  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => source.slice(sourceOffset(range.from), sourceOffset(range.to)))
    .join(state.lineBreak);
}
