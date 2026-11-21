//! Line-preserving edits of block-style YAML.
//!
//! DeepSeek Harness files carry `!!js` tags, quoted versions and hand-written
//! comments that a parse/serialize round trip would rewrite. Every edit here
//! only replaces the lines of the keys being changed; all other bytes are kept.
//! Callers verify the edited document semantically before writing it.

use crate::error::AppError;
use serde_norway::Value as Yaml;

pub(crate) fn unsupported(detail: &str) -> AppError {
    AppError::Other(format!(
        "DeepSeek Harness 配置文件结构无法安全修改（{detail}），已停止写入"
    ))
}

#[derive(Debug, Clone)]
pub(crate) struct Lines {
    bom: bool,
    eol: &'static str,
    /// Whether the last line ends with a line break.
    trailing_eol: bool,
    pub(crate) lines: Vec<String>,
}

/// How the value after `key:` is written on the key line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Inline {
    /// Nothing (or only a comment): the value is the indented block below.
    Block,
    /// `{}`
    EmptyMap,
    /// Any other inline value.
    Other,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct KeyLine {
    pub(crate) line: usize,
    pub(crate) indent: usize,
    pub(crate) inline: Inline,
}

/// Lines `[start, end)` holding the children of a mapping whose own key sits at
/// `parent_indent` (`None` for the document root).
#[derive(Debug, Clone, Copy)]
pub(crate) struct Block {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) parent_indent: Option<usize>,
}

impl Lines {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, AppError> {
        let text = std::str::from_utf8(bytes)
            .map_err(|_| AppError::Other("DeepSeek Harness 配置文件不是 UTF-8 编码".into()))?;
        let (bom, text) = match text.strip_prefix('\u{feff}') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let trailing_eol = text.is_empty() || text.ends_with('\n');
        let mut lines: Vec<String> = text
            .split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
            .collect();
        if lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        if lines.iter().any(|line| leading_tab(line)) {
            return Err(unsupported("缩进中含有制表符"));
        }
        Ok(Self {
            bom,
            eol,
            trailing_eol,
            lines,
        })
    }

    pub(crate) fn from_lines<S: Into<String>>(lines: impl IntoIterator<Item = S>) -> Self {
        Self {
            bom: false,
            eol: "\n",
            trailing_eol: true,
            lines: lines.into_iter().map(Into::into).collect(),
        }
    }

    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        let mut out = String::new();
        if self.bom {
            out.push('\u{feff}');
        }
        for (index, line) in self.lines.iter().enumerate() {
            out.push_str(line);
            if self.trailing_eol || index + 1 < self.lines.len() {
                out.push_str(self.eol);
            }
        }
        out.into_bytes()
    }

    pub(crate) fn len(&self) -> usize {
        self.lines.len()
    }

    pub(crate) fn root(&self) -> Block {
        Block {
            start: 0,
            end: self.lines.len(),
            parent_indent: None,
        }
    }

    pub(crate) fn is_content(&self, index: usize) -> bool {
        is_content(&self.lines[index])
    }

    /// Indentation of the first child of `block`, if it has any content.
    pub(crate) fn child_indent(&self, block: Block) -> Option<usize> {
        (block.start..block.end)
            .find(|&index| self.is_content(index))
            .map(|index| virtual_indent(&self.lines[index]))
    }

    /// Indentation new children of `block` get.
    pub(crate) fn new_child_indent(&self, block: Block) -> usize {
        self.child_indent(block)
            .unwrap_or_else(|| block.parent_indent.map_or(0, |indent| indent + 2))
    }

    /// Mapping keys directly inside `block`.
    pub(crate) fn keys(&self, block: Block) -> Vec<(String, KeyLine)> {
        let Some(indent) = self.child_indent(block) else {
            return Vec::new();
        };
        (block.start..block.end)
            .filter(|&index| self.is_content(index))
            .filter(|&index| {
                let line = &self.lines[index];
                raw_indent(line) == indent && virtual_indent(line) == indent
            })
            .filter_map(|index| {
                let (key, rest) = parse_key(&self.lines[index][indent..])?;
                Some((
                    key,
                    KeyLine {
                        line: index,
                        indent,
                        inline: inline_kind(rest),
                    },
                ))
            })
            .collect()
    }

    pub(crate) fn find_key(&self, block: Block, key: &str) -> Option<KeyLine> {
        self.keys(block)
            .into_iter()
            .find(|(name, _)| name == key)
            .map(|(_, line)| line)
    }

    /// One past the last content line belonging to the value of `key`
    /// (comments trailing a value stay with the next sibling).
    pub(crate) fn value_end(&self, key: KeyLine, limit: usize) -> usize {
        let mut last = key.line;
        for index in key.line + 1..limit {
            if !self.is_content(index) {
                continue;
            }
            if virtual_indent(&self.lines[index]) <= key.indent {
                break;
            }
            last = index;
        }
        last + 1
    }

    /// The children of a block-mapping value.
    pub(crate) fn child_block(&self, key: KeyLine, limit: usize) -> Block {
        Block {
            start: key.line + 1,
            end: self.value_end(key, limit),
            parent_indent: Some(key.indent),
        }
    }

    /// One past the last content line of `block` (where new children go).
    pub(crate) fn content_end(&self, block: Block) -> usize {
        (block.start..block.end)
            .rev()
            .find(|&index| self.is_content(index))
            .map_or(block.start, |index| index + 1)
    }

    pub(crate) fn remove(&mut self, start: usize, end: usize) {
        self.lines.drain(start..end);
    }

    pub(crate) fn insert(&mut self, at: usize, lines: Vec<String>) {
        self.lines.splice(at..at, lines);
    }

    pub(crate) fn replace_line(&mut self, index: usize, line: String) {
        self.lines[index] = line;
    }
}

fn leading_tab(line: &str) -> bool {
    line.chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .any(|c| c == '\t')
}

fn is_content(line: &str) -> bool {
    let trimmed = line.trim_start();
    !trimmed.is_empty() && !trimmed.starts_with('#')
}

fn raw_indent(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

/// Indentation counting sequence dashes (`- `) as indentation, so that
/// `- id: x` has the indent of the mapping it opens.
pub(crate) fn virtual_indent(line: &str) -> usize {
    let bytes = line.as_bytes();
    let mut index = raw_indent(line);
    while index < bytes.len()
        && bytes[index] == b'-'
        && (index + 1 == bytes.len() || bytes[index + 1] == b' ')
    {
        index += 1;
        while index < bytes.len() && bytes[index] == b' ' {
            index += 1;
        }
    }
    index
}

/// `(key, rest after the colon)` of a mapping key line without indentation.
pub(crate) fn parse_key(text: &str) -> Option<(String, &str)> {
    let first = text.chars().next()?;
    let (key, after) = match first {
        '"' => {
            let mut key = String::new();
            let mut escaped = false;
            let mut close = None;
            for (offset, c) in text.char_indices().skip(1) {
                if escaped {
                    key.push(c);
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    close = Some(offset);
                    break;
                } else {
                    key.push(c);
                }
            }
            (key, &text[close? + 1..])
        }
        '\'' => {
            let mut key = String::new();
            let mut chars = text.char_indices().skip(1).peekable();
            let mut close = None;
            while let Some((offset, c)) = chars.next() {
                if c == '\'' {
                    if chars.peek().is_some_and(|(_, next)| *next == '\'') {
                        key.push('\'');
                        chars.next();
                    } else {
                        close = Some(offset);
                        break;
                    }
                } else {
                    key.push(c);
                }
            }
            (key, &text[close? + 1..])
        }
        '[' | '{' | '?' | '&' | '*' | '!' | '|' | '>' | '%' | '@' | '`' | '-' => return None,
        _ => {
            let bytes = text.as_bytes();
            let position = (0..bytes.len()).find(|&index| {
                bytes[index] == b':' && (index + 1 == bytes.len() || bytes[index + 1] == b' ')
            })?;
            (text[..position].trim_end().to_string(), &text[position..])
        }
    };
    let after = after.trim_start_matches(' ');
    let rest = after.strip_prefix(':')?;
    if !(rest.is_empty() || rest.starts_with(' ')) {
        return None;
    }
    Some((key, rest))
}

fn inline_kind(rest: &str) -> Inline {
    let trimmed = rest.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return Inline::Block;
    }
    if let Some(after) = trimmed.strip_prefix("{}") {
        let after = after.trim_start();
        if after.is_empty() || after.starts_with('#') {
            return Inline::EmptyMap;
        }
    }
    Inline::Other
}

fn emit(value: &Yaml) -> Result<String, AppError> {
    serde_norway::to_string(value)
        .map_err(|error| AppError::Other(format!("生成 DeepSeek Harness 配置失败: {error}")))
}

/// Render `key: value` at `indent` as block YAML lines.
pub(crate) fn render_entry(
    key: &str,
    value: &Yaml,
    indent: usize,
) -> Result<Vec<String>, AppError> {
    let pad = " ".repeat(indent);
    let key_text = emit(&Yaml::String(key.to_string()))?;
    let key_text = key_text.trim_end();
    let body = emit(value)?;
    let collection = match value {
        Yaml::Mapping(map) => !map.is_empty(),
        Yaml::Sequence(items) => !items.is_empty(),
        _ => false,
    };
    let mut lines = Vec::new();
    if collection {
        lines.push(format!("{pad}{key_text}:"));
        for line in body.lines() {
            lines.push(if line.is_empty() {
                String::new()
            } else {
                format!("{pad}  {line}")
            });
        }
    } else {
        let mut body_lines = body.lines();
        let first = body_lines.next().unwrap_or("");
        lines.push(format!("{pad}{key_text}: {first}").trim_end().to_string());
        for line in body_lines {
            lines.push(if line.is_empty() {
                String::new()
            } else {
                format!("{pad}{line}")
            });
        }
    }
    Ok(lines)
}

/// Render one top-level sequence item.
pub(crate) fn render_item(value: &Yaml) -> Result<Vec<String>, AppError> {
    let body = emit(&Yaml::Sequence(vec![value.clone()]))?;
    Ok(body.lines().map(str::to_string).collect())
}

/// Remove `key` (with its value) from `block`. Returns whether it existed.
pub(crate) fn remove_key(doc: &mut Lines, block: Block, key: &str) -> bool {
    let Some(found) = doc.find_key(block, key) else {
        return false;
    };
    let end = doc.value_end(found, block.end);
    doc.remove(found.line, end);
    true
}

/// Replace or append `key: value` in `block`. Returns the number of lines the
/// block grew by (negative when it shrank).
pub(crate) fn set_key(
    doc: &mut Lines,
    block: Block,
    key: &str,
    value: &Yaml,
) -> Result<isize, AppError> {
    let indent = doc.new_child_indent(block);
    let rendered = render_entry(key, value, indent)?;
    let added = rendered.len() as isize;
    if let Some(found) = doc.find_key(block, key) {
        let end = doc.value_end(found, block.end);
        let removed = (end - found.line) as isize;
        doc.remove(found.line, end);
        doc.insert(found.line, rendered);
        Ok(added - removed)
    } else {
        let at = doc.content_end(block);
        doc.insert(at, rendered);
        Ok(added)
    }
}

/// Whether `block` holds any non-comment line.
pub(crate) fn has_content(doc: &Lines, block: Block) -> bool {
    (block.start..block.end).any(|index| doc.is_content(index))
}

/// The value below a block key must itself be a block mapping (not a
/// sequence or scalar continuation) before keys are added to it.
fn check_mapping(doc: &Lines, block: Block, key: &str) -> Result<(), AppError> {
    let Some(first) = (block.start..block.end).find(|&index| doc.is_content(index)) else {
        return Ok(());
    };
    let line = &doc.lines[first];
    let indent = raw_indent(line);
    if indent != virtual_indent(line) || parse_key(&line[indent..]).is_none() {
        return Err(unsupported(&format!("{key} 不是映射")));
    }
    Ok(())
}

/// The children of mapping `key` inside `block`; `None` when the key is
/// missing. `key: {}` yields an empty block that must not be inserted into.
pub(crate) fn child_map(doc: &Lines, block: Block, key: &str) -> Result<Option<Block>, AppError> {
    let Some(found) = doc.find_key(block, key) else {
        return Ok(None);
    };
    match found.inline {
        Inline::Block => {
            let child = doc.child_block(found, block.end);
            check_mapping(doc, child, key)?;
            Ok(Some(child))
        }
        Inline::EmptyMap => Ok(Some(Block {
            start: found.line + 1,
            end: found.line + 1,
            parent_indent: Some(found.indent),
        })),
        Inline::Other => Err(unsupported(&format!("{key} 不是映射"))),
    }
}

fn key_line(key: &str, indent: usize) -> Result<String, AppError> {
    let key_text = emit(&Yaml::String(key.to_string()))?;
    Ok(format!("{}{}:", " ".repeat(indent), key_text.trim_end()))
}

/// Like [`child_map`], creating `key:` (or expanding `key: {}`) so that new
/// children can be inserted into the returned block.
pub(crate) fn ensure_child_map(
    doc: &mut Lines,
    block: Block,
    key: &str,
) -> Result<Block, AppError> {
    match doc.find_key(block, key) {
        None => {
            let indent = doc.new_child_indent(block);
            let at = doc.content_end(block);
            doc.insert(at, vec![key_line(key, indent)?]);
            Ok(Block {
                start: at + 1,
                end: at + 1,
                parent_indent: Some(indent),
            })
        }
        Some(found) if found.inline == Inline::EmptyMap => {
            doc.replace_line(found.line, key_line(key, found.indent)?);
            Ok(Block {
                start: found.line + 1,
                end: found.line + 1,
                parent_indent: Some(found.indent),
            })
        }
        Some(_) => child_map(doc, block, key)?.ok_or_else(|| unsupported(key)),
    }
}

/// Write `key: {}` in place of a block mapping key that lost all children.
pub(crate) fn collapse_empty_map(doc: &mut Lines, block: Block, key: &str) -> Result<(), AppError> {
    if let Some(found) = doc.find_key(block, key) {
        if found.inline == Inline::Block && !has_content(doc, doc.child_block(found, block.end)) {
            doc.replace_line(found.line, format!("{} {{}}", key_line(key, found.indent)?));
        }
    }
    Ok(())
}

/// Remove a block mapping key that lost all children. Returns whether it did.
pub(crate) fn remove_empty_map(doc: &mut Lines, block: Block, key: &str) -> bool {
    match doc.find_key(block, key) {
        Some(found)
            if found.inline == Inline::Block
                && !has_content(doc, doc.child_block(found, block.end)) =>
        {
            remove_key(doc, block, key)
        }
        _ => false,
    }
}

/// Item line ranges plus the line of a bare `[]`, if any.
pub(crate) type TopLevel = (Vec<(usize, usize)>, Option<usize>);

/// Top-level sequence items as `[start, end)` line ranges. A document that is
/// only `[]` (plus comments) yields no items and reports the `[]` line.
pub(crate) fn top_level_items(doc: &Lines) -> Result<TopLevel, AppError> {
    let mut starts = Vec::new();
    let mut empty_flow = None;
    for index in 0..doc.len() {
        if !doc.is_content(index) {
            continue;
        }
        let line = &doc.lines[index];
        if raw_indent(line) != 0 {
            if starts.is_empty() {
                return Err(unsupported("顶层不是 YAML 列表"));
            }
            continue;
        }
        let trimmed = line.trim_end();
        if trimmed == "-" || trimmed.starts_with("- ") {
            if empty_flow.is_some() {
                return Err(unsupported("顶层列表格式混杂"));
            }
            starts.push(index);
        } else if trimmed.starts_with("[]") && starts.is_empty() && empty_flow.is_none() {
            let after = trimmed[2..].trim_start();
            if !(after.is_empty() || after.starts_with('#')) {
                return Err(unsupported("顶层列表格式无法识别"));
            }
            empty_flow = Some(index);
        } else {
            return Err(unsupported("顶层不是块格式 YAML 列表"));
        }
    }
    let items = starts
        .iter()
        .enumerate()
        .map(|(position, &start)| {
            let limit = starts.get(position + 1).copied().unwrap_or(doc.len());
            let end = (start + 1..limit)
                .rev()
                .find(|&index| doc.is_content(index))
                .map_or(start + 1, |index| index + 1);
            (start, end)
        })
        .collect();
    Ok((items, empty_flow))
}

/// The mapping body of a top-level item (keys after the `- ` line).
pub(crate) fn item_block(doc: &Lines, item: (usize, usize)) -> Block {
    Block {
        start: item.0 + 1,
        end: item.1,
        parent_indent: Some(virtual_indent(&doc.lines[item.0]).saturating_sub(2)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_parsing_handles_plain_and_quoted_keys() {
        assert_eq!(parse_key("a: 1").unwrap().0, "a");
        assert_eq!(parse_key("aihelper-claude:").unwrap().0, "aihelper-claude");
        assert_eq!(parse_key("\"q\\\"k\": x").unwrap().0, "q\"k");
        assert_eq!(parse_key("'it''s': x").unwrap().0, "it's");
        assert_eq!(parse_key("url: https://a.b/c").unwrap().0, "url");
        assert!(parse_key("- id: x").is_none());
        assert!(parse_key("plain scalar").is_none());
    }

    #[test]
    fn virtual_indent_counts_sequence_dashes() {
        assert_eq!(virtual_indent("- id: x"), 2);
        assert_eq!(virtual_indent("    - id: x"), 6);
        assert_eq!(virtual_indent("  key: v"), 2);
        assert_eq!(virtual_indent("---"), 0);
    }

    #[test]
    fn crlf_and_bom_are_preserved() {
        let raw = "\u{feff}a: 1\r\nb: 2\r\n".as_bytes();
        let doc = Lines::parse(raw).unwrap();
        assert_eq!(doc.to_bytes(), raw);
        let raw = b"a: 1\nb: 2";
        assert_eq!(Lines::parse(raw).unwrap().to_bytes(), raw);
    }

    #[test]
    fn compact_sequences_stay_inside_their_key() {
        let doc = Lines::parse(b"a:\n  list:\n  - x\n  - y\n  next: 1\n").unwrap();
        let root = doc.root();
        let a = doc.find_key(root, "a").unwrap();
        let block = doc.child_block(a, root.end);
        let list = doc.find_key(block, "list").unwrap();
        assert_eq!(doc.value_end(list, block.end), 4);
        assert!(doc.find_key(block, "next").is_some());
    }
}
