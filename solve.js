// A faster drop-in for csv-reader 1.0.0.
//
// Semantics (identical to the reference, on every input):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends);
//   - a quote that never closes is a literal character, and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, a record's short_row or
//     long_row when it ends: line is the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row is its record's
//     index in rows, null for the header.
//
// Speed: the reference builds every field one character at a time (value += c)
// and returns a fresh result object per field. This reader first tries a
// per-record fast path: a line holding no quote and no CR (after stripping a
// CRLF ending) is exactly its comma-split, taken natively in one call. Every
// other record goes through a tight charCodeAt scan that only remembers where
// the field's current clean segment starts, then takes the field with one
// slice; segments are joined only when a stray CR, an escaped quote or a CR
// inside quotes forces a join. No per-field objects, no per-char strings.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Shared field-result slots, so parsing a field allocates nothing.
  let fVal = '';
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters starting at pos, prefixed by `value`, up to the
  // next comma or line break. A CR not followed by LF is dropped (stray_cr).
  // Sets fVal / fEnded / fAdded (characters kept from the text itself).
  function readUnquoted(value) {
    let start = pos;
    let i = pos;
    let added = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        fVal = value + text.slice(start, i);
        fAdded = added + (i - start);
        pos = i + 1;
        fEnded = COMMA;
        return;
      }
      if (c === 10) {
        fVal = value + text.slice(start, i);
        fAdded = added + (i - start);
        pos = i + 1;
        line += 1;
        fEnded = LINE_BREAK;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          fVal = value + text.slice(start, i);
          fAdded = added + (i - start);
          pos = i + 2;
          line += 1;
          fEnded = LINE_BREAK;
          return;
        }
        // Stray CR: keep the segment before it, drop the CR, keep scanning.
        value += text.slice(start, i);
        added += i - start;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    fVal = value + text.slice(start, n);
    fAdded = added + (n - start);
    pos = n;
    fEnded = END;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal / fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = pos + 1;
    let segStart = i;
    let parts = null;
    let value = '';
    let closed = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i), '"');
          i += 2;
          segStart = i;
          continue;
        }
        if (parts === null) {
          value = text.slice(segStart, i);
        } else {
          parts.push(text.slice(segStart, i));
          value = parts.join('');
        }
        i += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        segStart = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted. Line counting restarts from the open.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    pos = i;
    if (pos >= n) {
      fVal = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = value;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands.
    readUnquoted(value);
    if (fAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let quoted = false;

    // Fast path: the record's first line, taken up to the next LF. If it
    // holds no quote and no CR (a trailing CR is its CRLF ending, stripped),
    // nothing in it can open a quoted field, drop a stray CR or span lines,
    // so the record is exactly that line split at its commas. The checks run
    // on the sliced line only, so their cost stays inside the line.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    let lineStr = text.slice(pos, lineEnd);
    if (lf !== -1 && lineStr.charCodeAt(lineStr.length - 1) === 13) {
      lineStr = lineStr.slice(0, -1);
    }
    if (lineStr.length > 0 && lineStr.indexOf('"') === -1 && lineStr.indexOf('\r') === -1) {
      fields = lineStr.split(',');
      pos = lf === -1 ? n : lf + 1;
      if (lf !== -1) line += 1;
    } else {
      fields = [];
      do {
        if (pos < n && text.charCodeAt(pos) === 34) {
          quoted = true;
          readQuoted();
        } else {
          quoted = false;
          readUnquoted('');
        }
        fields.push(fVal);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
