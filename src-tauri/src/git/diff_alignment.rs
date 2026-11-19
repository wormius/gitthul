//! Refine replacement runs without changing either stream of original bytes.
//!
//! Git can report a whole-file replacement when every line changes LF/CRLF.
//! The matching key ignores that distinction, but not a missing final newline
//! or a bare CR at EOF. Equal raw lines become context; genuine EOL changes
//! remain adjacent removed/added lines with their original coordinates.

use std::collections::HashMap;

use super::{DiffLine, DiffLineKind, LineEnding, LineEndingChange, TextLineEndings};

const MAX_DISTANCE: usize = 512;
const MAX_WORK: usize = 1_000_000;
const MAX_TRACE_CELLS: usize = 1_000_000;

pub(super) fn refine(lines: Vec<DiffLine>) -> Vec<DiffLine> {
    let mut output = Vec::with_capacity(lines.len());
    let mut input = lines.into_iter().peekable();
    while let Some(line) = input.peek() {
        if line.kind == DiffLineKind::Context {
            output.push(input.next().expect("peeked context line"));
            continue;
        }
        let mut removed = Vec::new();
        let mut added = Vec::new();
        while input
            .peek()
            .is_some_and(|line| line.kind == DiffLineKind::Removed)
        {
            removed.push(input.next().expect("peeked removed line"));
        }
        while input
            .peek()
            .is_some_and(|line| line.kind == DiffLineKind::Added)
        {
            added.push(input.next().expect("peeked added line"));
        }
        let (before, after) = keys(&removed, &added);
        let anchors = matches(&before, &after);
        let mut old = removed.into_iter().enumerate().peekable();
        let mut new = added.into_iter().enumerate().peekable();
        for (old_index, new_index) in anchors {
            while old.peek().is_some_and(|(index, _)| *index < old_index) {
                output.push(old.next().expect("remaining old line").1);
            }
            while new.peek().is_some_and(|(index, _)| *index < new_index) {
                output.push(new.next().expect("remaining new line").1);
            }
            let mut left = old.next().expect("matched old line").1;
            let mut right = new.next().expect("matched new line").1;
            if left.ending == right.ending {
                left.kind = DiffLineKind::Context;
                left.new_line = right.new_line;
                left.words.clear();
                output.push(left);
            } else {
                // Different endings are a real selectable edit, never context.
                // The key excludes bare CR differences at an unterminated EOF.
                debug_assert!(!left.no_newline && !right.no_newline);
                let change = LineEndingChange {
                    before: style(left.ending),
                    after: style(right.ending),
                };
                left.line_ending_change = Some(change.clone());
                right.line_ending_change = Some(change);
                output.push(left);
                output.push(right);
            }
        }
        output.extend(old.map(|(_, line)| line));
        output.extend(new.map(|(_, line)| line));
    }
    output
}

fn style(ending: LineEnding) -> TextLineEndings {
    match ending {
        LineEnding::Lf => TextLineEndings::Lf,
        LineEnding::CrLf => TextLineEndings::CrLf,
    }
}

fn keys<'a>(before: &'a [DiffLine], after: &'a [DiffLine]) -> (Vec<usize>, Vec<usize>) {
    // Intern once, so the bounded search compares integer keys instead of
    // repeatedly scanning very long text lines.
    let mut interned = HashMap::new();
    let mut key = |line: &'a DiffLine| {
        let next = interned.len();
        *interned
            .entry((
                line.text.as_str(),
                line.no_newline,
                line.no_newline && line.ending == LineEnding::CrLf,
            ))
            .or_insert(next)
    };
    let old = before.iter().map(&mut key).collect();
    let new = after.iter().map(key).collect();
    (old, new)
}

fn matches(before: &[usize], after: &[usize]) -> Vec<(usize, usize)> {
    let mut prefix = 0;
    while prefix < before.len() && prefix < after.len() && before[prefix] == after[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < before.len() - prefix
        && suffix < after.len() - prefix
        && before[before.len() - suffix - 1] == after[after.len() - suffix - 1]
    {
        suffix += 1;
    }
    let mut result = (0..prefix).map(|index| (index, index)).collect::<Vec<_>>();
    result.extend(
        myers(
            &before[prefix..before.len() - suffix],
            &after[prefix..after.len() - suffix],
        )
        .into_iter()
        .map(|(old, new)| (old + prefix, new + prefix)),
    );
    result.extend(
        (0..suffix).map(|index| (before.len() - suffix + index, after.len() - suffix + index)),
    );
    result
}

fn myers(before: &[usize], after: &[usize]) -> Vec<(usize, usize)> {
    let n = before.len();
    let m = after.len();
    if n == 0 || m == 0 {
        return Vec::new();
    }
    if n.abs_diff(m) > MAX_DISTANCE {
        return anchored(before, after);
    }
    let maximum = (n + m).min(MAX_DISTANCE);
    let offset = maximum as isize + 1;
    let mut frontier = vec![0_isize; 2 * maximum + 3];
    let mut trace = Vec::new();
    let mut work = 0;
    for distance in 0..=maximum {
        if (trace.len() + 1) * frontier.len() > MAX_TRACE_CELLS {
            return anchored(before, after);
        }
        trace.push(frontier.clone());
        let d = distance as isize;
        for diagonal in (-d..=d).step_by(2) {
            work += 1;
            if work > MAX_WORK {
                return anchored(before, after);
            }
            let slot = (offset + diagonal) as usize;
            let down = diagonal == -d || (diagonal != d && frontier[slot - 1] < frontier[slot + 1]);
            let mut x = if down {
                frontier[slot + 1]
            } else {
                frontier[slot - 1] + 1
            };
            let mut y = x - diagonal;
            while x < n as isize && y < m as isize && before[x as usize] == after[y as usize] {
                work += 1;
                if work > MAX_WORK {
                    return anchored(before, after);
                }
                x += 1;
                y += 1;
            }
            frontier[slot] = x;
            if x == n as isize && y == m as isize {
                return walk_back(&trace, distance, offset, n, m);
            }
        }
    }
    anchored(before, after)
}

fn walk_back(
    trace: &[Vec<isize>],
    distance: usize,
    offset: isize,
    n: usize,
    m: usize,
) -> Vec<(usize, usize)> {
    let mut x = n as isize;
    let mut y = m as isize;
    let mut anchors = Vec::new();
    for distance in (0..=distance).rev() {
        if distance == 0 {
            while x > 0 && y > 0 {
                x -= 1;
                y -= 1;
                anchors.push((x as usize, y as usize));
            }
            break;
        }
        let d = distance as isize;
        let diagonal = x - y;
        let frontier = &trace[distance];
        let slot = (offset + diagonal) as usize;
        let previous =
            if diagonal == -d || (diagonal != d && frontier[slot - 1] < frontier[slot + 1]) {
                diagonal + 1
            } else {
                diagonal - 1
            };
        let old_x = frontier[(offset + previous) as usize];
        let old_y = old_x - previous;
        while x > old_x && y > old_y {
            x -= 1;
            y -= 1;
            anchors.push((x as usize, y as usize));
        }
        x = old_x;
        y = old_y;
    }
    anchors.reverse();
    anchors
}

fn increasing(candidates: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut tails: Vec<usize> = Vec::new();
    let mut previous = vec![None; candidates.len()];
    for (index, &(_, new)) in candidates.iter().enumerate() {
        let slot = tails.partition_point(|&tail| candidates[tail].1 < new);
        if slot > 0 {
            previous[index] = Some(tails[slot - 1]);
        }
        if slot == tails.len() {
            tails.push(index);
        } else {
            tails[slot] = index;
        }
    }
    let mut ordered = Vec::with_capacity(tails.len());
    let mut index = tails.last().copied();
    while let Some(current) = index {
        ordered.push(candidates[current]);
        index = previous[current];
    }
    ordered.reverse();
    ordered
}

fn anchored(before: &[usize], after: &[usize]) -> Vec<(usize, usize)> {
    let mut positions: HashMap<usize, Vec<usize>> = HashMap::new();
    for (index, &key) in after.iter().enumerate() {
        positions.entry(key).or_default().push(index);
    }
    let mut counts = HashMap::new();
    for &key in before {
        *counts.entry(key).or_insert(0_usize) += 1;
    }
    let unique = before
        .iter()
        .enumerate()
        .filter_map(|(old, key)| {
            let new = positions.get(key)?;
            (counts[key] == 1 && new.len() == 1).then_some((old, new[0]))
        })
        .collect::<Vec<_>>();
    let unique = increasing(&unique);
    let mut result = Vec::new();
    let mut old_start = 0;
    let mut new_start = 0;
    for (old_end, new_end) in unique.into_iter().chain([(before.len(), after.len())]) {
        let mut local: HashMap<usize, Vec<usize>> = HashMap::new();
        for (index, &key) in after.iter().enumerate().take(new_end).skip(new_start) {
            local.entry(key).or_default().push(index);
        }
        let mut used = HashMap::new();
        let mut repeated = Vec::new();
        for (old, &key) in before.iter().enumerate().take(old_end).skip(old_start) {
            let occurrence = used.entry(key).or_insert(0_usize);
            if let Some(&new) = local.get(&key).and_then(|values| values.get(*occurrence)) {
                repeated.push((old, new));
            }
            *occurrence += 1;
        }
        result.extend(increasing(&repeated));
        if old_end < before.len() {
            result.push((old_end, new_end));
        }
        old_start = old_end + 1;
        new_start = new_end + 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(kind: DiffLineKind, number: u64, text: &str, ending: LineEnding) -> DiffLine {
        DiffLine {
            kind,
            old_line: (kind == DiffLineKind::Removed).then_some(number),
            new_line: (kind == DiffLineKind::Added).then_some(number),
            text: text.to_owned(),
            words: Vec::new(),
            line_ending_change: None,
            no_newline: false,
            ending,
        }
    }

    fn raw(lines: &[DiffLine], old: bool) -> Vec<(u64, String, bool, LineEnding)> {
        lines
            .iter()
            .filter_map(|line| {
                let number = if old { line.old_line } else { line.new_line }?;
                Some((number, line.text.clone(), line.no_newline, line.ending))
            })
            .collect()
    }

    #[test]
    fn insertion_and_global_endings_keep_exact_streams_and_matching_coordinates() {
        let mut lines = ["cabecera", "uno", "dos", "fin"]
            .into_iter()
            .enumerate()
            .map(|(i, text)| line(DiffLineKind::Removed, i as u64 + 1, text, LineEnding::CrLf))
            .collect::<Vec<_>>();
        lines.extend(
            ["cabecera", "insertada", "uno", "DOS", "fin"]
                .into_iter()
                .enumerate()
                .map(|(i, text)| line(DiffLineKind::Added, i as u64 + 1, text, LineEnding::Lf)),
        );
        let old = raw(&lines, true);
        let new = raw(&lines, false);
        let refined = refine(lines);
        assert_eq!(raw(&refined, true), old);
        assert_eq!(raw(&refined, false), new);
        let anchor = refined
            .iter()
            .position(|line| line.old_line == Some(2))
            .unwrap();
        assert_eq!(refined[anchor + 1].new_line, Some(3));
        assert!(refined[anchor].line_ending_change.is_some());
        assert_eq!(refined[anchor].kind, DiffLineKind::Removed);
    }

    #[test]
    fn exact_shared_lines_become_context_but_eol_changes_remain_selectable() {
        let output = refine(vec![
            line(DiffLineKind::Removed, 1, "before", LineEnding::Lf),
            line(DiffLineKind::Removed, 2, "shared", LineEnding::Lf),
            line(DiffLineKind::Removed, 3, "ending", LineEnding::Lf),
            line(DiffLineKind::Added, 1, "after", LineEnding::Lf),
            line(DiffLineKind::Added, 2, "shared", LineEnding::Lf),
            line(DiffLineKind::Added, 3, "ending", LineEnding::CrLf),
        ]);
        assert_eq!(output[2].kind, DiffLineKind::Context);
        assert_eq!(output[2].old_line, Some(2));
        assert_eq!(output[2].new_line, Some(2));
        assert!(output[2].line_ending_change.is_none());
        assert_eq!(output[3].kind, DiffLineKind::Removed);
        let json = serde_json::to_value(&output[3]).unwrap();
        assert_eq!(json["lineEndingChange"]["before"], "lf");
        assert_eq!(json["lineEndingChange"]["after"], "crlf");
    }

    #[test]
    fn final_newline_presence_and_bare_cr_are_part_of_the_key() {
        let mut old = line(DiffLineKind::Removed, 1, "repeated", LineEnding::Lf);
        let mut new = line(DiffLineKind::Added, 1, "repeated", LineEnding::Lf);
        new.no_newline = true;
        let output = refine(vec![old, new]);
        assert_eq!(output.len(), 2);
        assert!(output.iter().all(|line| line.line_ending_change.is_none()));
        old = line(DiffLineKind::Removed, 1, "bare", LineEnding::CrLf);
        new = line(DiffLineKind::Added, 1, "bare", LineEnding::Lf);
        old.no_newline = true;
        new.no_newline = true;
        let output = refine(vec![old, new]);
        assert_eq!(output.len(), 2);
        assert!(output.iter().all(|line| line.line_ending_change.is_none()));
    }

    #[test]
    fn matching_repeated_short_sequences_never_crosses_or_reuses_a_position() {
        let mut variants = vec![Vec::new()];
        for size in 1..=5 {
            for bits in 0..1_usize << size {
                variants.push((0..size).map(|i| (bits >> i) & 1).collect::<Vec<_>>());
            }
        }
        for before in &variants {
            for after in &variants {
                let anchors = matches(before, after);
                assert!(anchors
                    .windows(2)
                    .all(|pair| pair[0].0 < pair[1].0 && pair[0].1 < pair[1].1));
                assert!(anchors.iter().all(|&(old, new)| before[old] == after[new]));
            }
        }
    }

    #[test]
    fn bounded_fallback_retains_unique_and_repeated_interior_islands() {
        let mut before = (0..1500).collect::<Vec<_>>();
        let mut after = (2000..3500).collect::<Vec<_>>();
        before.extend([9_999, 10_000, 10_000, 10_000, 9_998]);
        after.extend([9_999, 10_000, 10_000, 10_000, 9_998]);
        before.extend(4000..5500);
        after.extend(6000..7500);
        let anchors = matches(&before, &after);
        assert_eq!(anchors, (1500..1505).map(|i| (i, i)).collect::<Vec<_>>());
    }

    #[test]
    fn bounded_fallback_keeps_repetitions_without_any_unique_shared_line() {
        let before = [vec![1; 1500], vec![42; 200], vec![2; 1500]].concat();
        let after = [vec![3; 1500], vec![42; 200], vec![4; 1500]].concat();
        let anchors = matches(&before, &after);
        assert_eq!(anchors, (1500..1700).map(|i| (i, i)).collect::<Vec<_>>());
    }

    #[test]
    fn parsed_hunk_keeps_identity_ranges_and_real_line_coordinates() {
        let before = "cabecera\nuno\ndos\ntres\ncuatro\ncinco\nfin\n";
        let after = "cabecera\r\nUNO\r\ndos\r\nnueva\r\ntres\r\ncuatro\r\ncinco\r\nfin\r\n";
        let mut patch = "@@ -1,7 +1,8 @@\n".to_owned();
        for line in before.split_inclusive('\n') {
            patch.push('-');
            patch.push_str(line);
        }
        for line in after.split_inclusive('\n') {
            patch.push('+');
            patch.push_str(line);
        }
        let hunks = super::super::parse_hunks(&patch).unwrap();
        let hunk = &hunks[0];
        assert_eq!(hunk.id, "hunk-1-7-1-8-0");
        assert_eq!((hunk.old_start, hunk.old_lines), (1, 7));
        assert_eq!((hunk.new_start, hunk.new_lines), (1, 8));
        let row = hunk
            .lines
            .iter()
            .position(|line| line.old_line == Some(6))
            .unwrap();
        assert_eq!(hunk.lines[row].text, "cinco");
        assert_eq!(hunk.lines[row + 1].new_line, Some(7));
        assert_eq!(hunk.lines[row + 1].text, "cinco");
        assert!(hunk.lines[row].words.is_empty());
        assert!(hunk.lines[row + 1].words.is_empty());
        assert_eq!(
            hunk.lines
                .iter()
                .filter_map(|line| line.old_line)
                .collect::<Vec<_>>(),
            (1..=7).collect::<Vec<_>>()
        );
        assert_eq!(
            hunk.lines
                .iter()
                .filter_map(|line| line.new_line)
                .collect::<Vec<_>>(),
            (1..=8).collect::<Vec<_>>()
        );
    }

    #[test]
    fn deletion_before_and_insertion_after_an_ending_pair_are_separate_groups() {
        let patch = "@@ -1,3 +1,3 @@\n-borrada\r\n-comun\r\n-fin\r\n+comun\n+nueva\n+fin\n";
        let hunks = super::super::parse_hunks(patch).unwrap();
        let lines = &hunks[0].lines;
        assert_eq!(super::super::change_group_ranges(lines, 0), (0..1, 1..1));
        assert_eq!(super::super::change_group_ranges(lines, 1), (1..2, 2..3));
        assert_eq!(super::super::change_group_ranges(lines, 3), (3..3, 3..4));
        assert_eq!(super::super::change_group_ranges(lines, 4), (4..5, 5..6));
        assert!(lines.iter().all(|line| line.words.is_empty()));
    }
}
