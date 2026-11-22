// A fast reader for broken CSV, written to answer exactly as csv-reader 1.0.0 does.
//
// The reading policy, in brief: a leading U+FEFF is dropped; records end at LF or CRLF and
// empty lines are no records; a CR outside quotes that is not part of a CRLF is dropped and
// reported (stray_cr); a field that opens with a double quote runs to the next undoubled
// quote, "" inside it means one quote, and CR or CRLF inside it both read as LF; characters
// after a closing quote are appended as they stand (quote_junk); a quote that never closes
// becomes a literal character and the rest of the field is read again unquoted
// (unterminated_quote); fields are never trimmed or converted. The first record is the
// columns when header is true, and every later record is padded (short_row) or cut
// (long_row) to its width. Errors are {code, line, row} in the order met.
//
// Where the reference walks one character at a time and grows each field character by
// character, this reader scans with charCodeAt and copies each unbroken span of a field
// with a single slice, so a field costs one or two string operations instead of one per
// character. The scan state lives in locals; the field readers below report through the
// shared slots fText/fEnd instead of allocating a result object per field.

// How a field ended.
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_TEXT = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // index of the next character to read
  let line = 1; // the line that character sits on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field read most recently: its value, how it ended, and whether it opened with a quote.
  let fText = '';
  let fEnd = ENDED_TEXT;
  let fQuoted = false;

  function note(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos, starting from the value init, and sets fText/fEnd.
  // A CR not followed by LF is dropped (stray_cr). Stops at a comma, a line break, or the
  // end of the text.
  function readPlain(init) {
    let value = init;
    let seg = pos; // start of the span not yet copied into value
    let i = pos;
    for (;;) {
      if (i >= n) {
        if (seg < i) value += text.slice(seg, i);
        pos = i;
        fText = value;
        fEnd = ENDED_TEXT;
        return;
      }
      const c = text.charCodeAt(i);
      // Every special here (',', LF, CR) has a code of 44 or less, so one comparison
      // clears the ordinary characters that make up most of a file.
      if (c > 44) {
        i += 1;
        continue;
      }
      if (c === 44) { // ','
        if (seg < i) value += text.slice(seg, i);
        pos = i + 1;
        fText = value;
        fEnd = ENDED_COMMA;
        return;
      }
      if (c === 10) { // LF
        if (seg < i) value += text.slice(seg, i);
        pos = i + 1;
        line += 1;
        fText = value;
        fEnd = ENDED_BREAK;
        return;
      }
      if (c === 13) { // CR
        if (text.charCodeAt(i + 1) === 10) { // CRLF
          if (seg < i) value += text.slice(seg, i);
          pos = i + 2;
          line += 1;
          fText = value;
          fEnd = ENDED_BREAK;
          return;
        }
        if (seg < i) value += text.slice(seg, i);
        note('stray_cr');
        i += 1;
        seg = i;
        continue;
      }
      i += 1; // any other low character (space, quote, ...) is ordinary here
    }
  }

  // Reads a quoted field whose opening quote is at pos; sets fText/fEnd.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let seg = pos + 1; // start of the span not yet copied into value
    let i = pos + 1;
    for (;;) {
      if (i >= n) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        note('unterminated_quote');
        readPlain('"');
        return;
      }
      const c = text.charCodeAt(i);
      // The specials here ('"', CR, LF) all have codes of 34 or less.
      if (c > 34) {
        i += 1;
        continue;
      }
      if (c === 34) { // '"'
        if (text.charCodeAt(i + 1) === 34) { // a doubled quote is one quote
          value += text.slice(seg, i) + '"';
          i += 2;
          seg = i;
          continue;
        }
        // The closing quote.
        value += text.slice(seg, i);
        pos = i + 1;
        if (pos >= n) {
          fText = value;
          fEnd = ENDED_TEXT;
          return;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          fText = value;
          fEnd = ENDED_COMMA;
          return;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          fText = value;
          fEnd = ENDED_BREAK;
          return;
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fText = value;
          fEnd = ENDED_BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands, up to the next comma
        // or line break; if anything was appended, the field is reported when it ends.
        readPlain(value);
        if (fText.length > value.length) note('quote_junk');
        return;
      }
      if (c === 13) { // CR or CRLF inside quotes reads as one LF
        value += text.slice(seg, i) + '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) line += 1; // an LF inside quotes stays in the value, via the span
      i += 1;
    }
  }

  for (;;) {
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
    const fields = [];
    do {
      fQuoted = text.charCodeAt(pos) === 34;
      if (fQuoted) readQuoted();
      else readPlain('');
      fields.push(fText);
    } while (fEnd === ENDED_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !fQuoted) continue;

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
