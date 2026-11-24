/**
 * Contact files exported from Google Contacts (and most other address books),
 * read into one flat shape the import screen works with.
 *
 * Two formats, because contacts.google.com offers both and people pick either:
 * - vCard (`.vcf`): versions 2.1, 3.0 and 4.0. Google exports 3.0.
 * - CSV: Google's own ("First Name", "E-mail 1 - Value", "Labels"…), its older
 *   layout ("Given Name", "Group Membership"…), and Outlook's ("E-mail Address",
 *   "Company"…). Columns are found by name, so their order does not matter.
 *
 * Pure functions, no I/O.
 */
import { extractLinkedIn } from "../model";

/** One person as a source describes them, before matching or merging. */
export interface ImportPerson {
  /** The source it came from (a file, a Google account). */
  sourceId: string;
  /** `google:<account>:people/c123` when the source has stable ids, else "". */
  externalId: string;
  name: string;
  emails: string[];
  phones: string[];
  /** Organization names, first is the main one. */
  orgs: string[];
  role: string;
  links: string[];
  /** Normalized LinkedIn URL when one of the links is a profile. */
  linkedin: string;
  /** Google labels (contact groups), as shown in Google Contacts. */
  labels: string[];
  note: string;
  /** From Google's "Other contacts": people saved automatically because they were emailed. */
  other: boolean;
}

export function emptyPerson(sourceId: string): ImportPerson {
  return { sourceId, externalId: "", name: "", emails: [], phones: [], orgs: [], role: "", links: [], linkedin: "", labels: [], note: "", other: false };
}

/**
 * Google's built-in groups that say nothing about the person: everyone is in
 * "myContacts", and "Imported on 3/4/21" is a leftover of an earlier import.
 */
export function isNoiseLabel(label: string): boolean {
  const l = label.replace(/^\*\s*/, "").trim();
  return !l || /^(my ?contacts|all|chat ?buddies|blocked)$/i.test(l) || /^imported on\b/i.test(l);
}

export function cleanLabels(labels: string[]): string[] {
  const out = labels.map((l) => l.replace(/^\*\s*/, "").trim()).filter((l) => !isNoiseLabel(l));
  return [...new Set(out)];
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values.map((x) => x.trim()).filter(Boolean)) {
    const k = v.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/** Fills `linkedin` from the links and drops it from them, so it is not stored twice. */
export function finishPerson(p: ImportPerson): ImportPerson {
  const links = uniq(p.links);
  const linkedin = p.linkedin || links.map(extractLinkedIn).find(Boolean) || "";
  return {
    ...p,
    name: p.name.replace(/\s+/g, " ").trim(),
    emails: uniq(p.emails.map((e) => e.replace(/^mailto:/i, ""))).filter((e) => e.includes("@")),
    phones: uniq(p.phones.map((x) => x.replace(/^tel:/i, ""))),
    orgs: uniq(p.orgs),
    role: p.role.trim(),
    links: links.filter((l) => !extractLinkedIn(l)),
    linkedin,
    labels: cleanLabels(p.labels),
    note: p.note.trim(),
  };
}

/** True when the person has something to recognise them by. */
export function isUsable(p: ImportPerson): boolean {
  return Boolean(p.name || p.emails.length || p.phones.length);
}

// ---------------------------------------------------------------- vCard

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "=" && /^[0-9A-F]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(value.charCodeAt(i) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function unescapeVcard(value: string): string {
  return value.replace(/\\([nN,;:\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits on `sep` except where escaped with a backslash. */
function splitUnescaped(value: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      cur += value[i] + value[i + 1];
      i++;
    } else if (value[i] === sep) {
      parts.push(cur);
      cur = "";
    } else cur += value[i];
  }
  parts.push(cur);
  return parts;
}

interface VLine {
  name: string;
  params: string;
  value: string;
}

function parseVLine(line: string): VLine | null {
  // The value starts at the first colon outside a quoted parameter.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const [nameWithGroup, ...params] = head.split(";");
  const name = nameWithGroup.replace(/^[^.]*\./, "").toUpperCase();
  const paramText = params.join(";").toUpperCase();
  if (/ENCODING=QUOTED-PRINTABLE|(^|;)QUOTED-PRINTABLE/.test(paramText)) value = decodeQuotedPrintable(value);
  return { name, params: paramText, value };
}

/** Joins folded lines (a line starting with a space continues the previous one) and quoted-printable soft breaks. */
function unfold(text: string): string[] {
  const raw = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/=\n/g, "");
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

export function parseVcards(text: string, sourceId: string): ImportPerson[] {
  const people: ImportPerson[] = [];
  let p: ImportPerson | null = null;
  let structuredName = "";
  for (const line of unfold(text)) {
    const l = parseVLine(line);
    if (!l) continue;
    if (l.name === "BEGIN" && /^vcard$/i.test(l.value.trim())) {
      p = emptyPerson(sourceId);
      structuredName = "";
      continue;
    }
    if (!p) continue;
    const v = l.value;
    switch (l.name) {
      case "END":
        if (!p.name) p.name = structuredName;
        people.push(finishPerson(p));
        p = null;
        break;
      case "FN":
        p.name = unescapeVcard(v);
        break;
      case "N": {
        const [family = "", given = "", middle = "", prefix = "", suffix = ""] = splitUnescaped(v, ";").map(unescapeVcard);
        structuredName = [prefix, given, middle, family, suffix].filter((x) => x.trim()).join(" ");
        break;
      }
      case "EMAIL":
        p.emails.push(unescapeVcard(v));
        break;
      case "TEL":
        p.phones.push(unescapeVcard(v));
        break;
      case "ORG": {
        const org = unescapeVcard(splitUnescaped(v, ";")[0] ?? "");
        if (org.trim()) p.orgs.push(org);
        break;
      }
      case "TITLE":
        if (!p.role) p.role = unescapeVcard(v);
        break;
      case "URL":
      case "X-SOCIALPROFILE":
        p.links.push(unescapeVcard(v));
        break;
      case "NOTE":
        p.note = p.note ? `${p.note}\n${unescapeVcard(v)}` : unescapeVcard(v);
        break;
      case "CATEGORIES":
        p.labels.push(...splitUnescaped(v, ",").map(unescapeVcard));
        break;
    }
  }
  return people.filter(isUsable);
}

// ---------------------------------------------------------------- CSV

/** RFC 4180: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Google puts several values in one cell separated by " ::: ". */
const multi = (cell: string) => cell.split(":::").map((x) => x.trim()).filter(Boolean);

export function parseContactsCsv(text: string, sourceId: string): ImportPerson[] {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return [];
  const cols = header.map((h) => h.trim().toLowerCase());
  const one = (...names: string[]) => {
    const idx = names.map((n) => cols.indexOf(n.toLowerCase())).filter((i) => i >= 0);
    return (row: string[]) => idx.map((i) => (row[i] ?? "").trim()).find(Boolean) ?? "";
  };
  const all = (re: RegExp) => {
    const idx = cols.map((c, i) => (re.test(c) ? i : -1)).filter((i) => i >= 0);
    return (row: string[]) => idx.flatMap((i) => multi(row[i] ?? ""));
  };

  const fullName = one("name", "display name", "full name");
  const first = one("first name", "given name");
  const middle = one("middle name", "additional name");
  const last = one("last name", "family name");
  const nickname = one("nickname", "file as");
  const emails = all(/^e-?mail( \d+)? - value$|^e-?mail( \d+)? address$|^e-?mail$/);
  const phones = all(/^phone \d+ - value$|phone$|^mobile/);
  const org = one("organization name", "organization 1 - name", "company");
  const role = one("organization title", "organization 1 - title", "job title");
  const sites = all(/^website \d+ - value$|^web page$|^website$/);
  const labels = one("labels", "group membership", "categories");
  const notes = one("notes", "note");

  return rows
    .map((row) => {
      const p = emptyPerson(sourceId);
      p.name = fullName(row) || [first(row), middle(row), last(row)].filter(Boolean).join(" ") || nickname(row);
      p.emails = emails(row);
      p.phones = phones(row);
      const o = org(row);
      if (o) p.orgs = [o];
      p.role = role(row);
      p.links = sites(row);
      p.labels = multi(labels(row));
      p.note = notes(row);
      return finishPerson(p);
    })
    .filter(isUsable);
}

/** Reads a dropped file of either format. */
export function parseContactsFile(text: string, sourceId: string): ImportPerson[] {
  return /^\s*BEGIN:VCARD/i.test(text.replace(/^﻿/, "")) ? parseVcards(text, sourceId) : parseContactsCsv(text, sourceId);
}
