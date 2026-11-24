/**
 * Turning people from several sources (files, Google accounts) into CRM
 * contacts without making duplicates.
 *
 * Three steps, all pure:
 * 1. `groupPeople` joins the same person seen in several sources: two entries
 *    that share an email, a phone, a LinkedIn URL or a Google id are one person.
 * 2. `matchContact` finds who each of them already is in the CRM: by an id
 *    an earlier import stored, then email, LinkedIn, phone. A name alone is
 *    only a suggestion; the screen asks before merging on it.
 * 3. `mergeInto` adds what the CRM does not have yet. It never overwrites or
 *    removes: what was typed in the CRM wins over what Google says.
 */
import { emptyContact, fold, normalizeLinkedIn, parseTags, type Contact, type Organization } from "../model";
import type { ImportPerson } from "./parse";

// ---------------------------------------------------------------- keys

const GMAIL = /^(gmail|googlemail)\.com$/;

/** `Jane.Doe+news@GoogleMail.com` → `janedoe@gmail.com`; other domains only lower-cased. */
export function emailKey(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (GMAIL.test(domain)) return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  return `${local}@${domain}`;
}

/**
 * The last nine digits: `+32 475 12 34 56`, `0032475123456` and `0475/12.34.56`
 * are the same Belgian mobile. Nine digits is a whole national number in most
 * of Europe, so different numbers almost never collide. Under six digits is not
 * a phone number (an extension, a typo) and gives no key.
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "";
  return digits.slice(-9);
}

/** "Doe,  Jane" and "jane doe" → "doe jane". */
export function nameKey(name: string): string {
  return fold(name)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function keysOf(p: { emails: string[]; phones: string[]; linkedin: string; externalIds: string[] }): string[] {
  return [
    ...p.emails.map((e) => `e:${emailKey(e)}`),
    ...p.phones.map(phoneKey).filter(Boolean).map((k) => `p:${k}`),
    ...(p.linkedin ? [`l:${normalizeLinkedIn(p.linkedin) || p.linkedin}`] : []),
    ...p.externalIds.map((x) => `x:${x}`),
  ];
}

// ---------------------------------------------------------------- grouping

/** One person after joining every source that has them. */
export interface Candidate {
  /** Stable across re-renders and re-loads of the same sources. */
  key: string;
  name: string;
  emails: string[];
  phones: string[];
  orgs: string[];
  role: string;
  links: string[];
  linkedin: string;
  labels: string[];
  /** The same labels by the source they come from: "Friends" in the personal account is not "Friends" at work. */
  labelsBySource: Record<string, string[]>;
  note: string;
  externalIds: string[];
  sourceIds: string[];
  /** Only ever seen in Google's "Other contacts". */
  otherOnly: boolean;
}

function addUnique(list: string[], values: string[], key: (v: string) => string = (v) => v.toLowerCase()): void {
  const seen = new Set(list.map(key));
  for (const v of values) {
    const k = key(v);
    if (v && !seen.has(k)) {
      seen.add(k);
      list.push(v);
    }
  }
}

/** A real name beats an email address used as a name, and a fuller name beats a shorter one. */
function betterName(a: string, b: string): string {
  const score = (n: string) => (n.includes("@") ? 0 : 1000) + n.length;
  return score(b) > score(a) ? b : a;
}

export function groupPeople(people: ImportPerson[]): Candidate[] {
  // Union-find over people; any shared key joins two of them.
  const parent = people.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  people.forEach((p, i) => {
    for (const k of keysOf({ ...p, externalIds: p.externalId ? [p.externalId] : [] })) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, ImportPerson[]>();
  people.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p]);
  });

  return [...groups.values()].map((members) => {
    // Saved contacts before "Other contacts": they carry the name and labels you chose.
    const ordered = [...members].sort((a, b) => Number(a.other) - Number(b.other));
    const c: Candidate = {
      key: "",
      name: "",
      emails: [],
      phones: [],
      orgs: [],
      role: "",
      links: [],
      linkedin: "",
      labels: [],
      labelsBySource: {},
      note: "",
      externalIds: [],
      sourceIds: [],
      otherOnly: ordered.every((p) => p.other),
    };
    for (const p of ordered) {
      c.name = c.name ? betterName(c.name, p.name) : p.name;
      addUnique(c.emails, p.emails, emailKey);
      addUnique(c.phones, p.phones, (v) => phoneKey(v) || v);
      addUnique(c.orgs, p.orgs, fold);
      if (!c.role) c.role = p.role;
      addUnique(c.links, p.links);
      if (!c.linkedin) c.linkedin = p.linkedin;
      addUnique(c.labels, p.labels);
      addUnique((c.labelsBySource[p.sourceId] ??= []), p.labels);
      if (p.note && !c.note.includes(p.note)) c.note = c.note ? `${c.note}\n\n${p.note}` : p.note;
      if (p.externalId) addUnique(c.externalIds, [p.externalId], (v) => v);
      addUnique(c.sourceIds, [p.sourceId], (v) => v);
    }
    if (!c.name) c.name = c.emails[0] ?? c.phones[0] ?? "";
    c.key = keysOf(c).sort()[0] ?? `n:${nameKey(c.name)}`;
    return c;
  });
}

// ---------------------------------------------------------------- matching

export type MatchBy = "import" | "email" | "linkedin" | "phone" | "name";

export interface Match {
  contact: Contact;
  by: MatchBy;
}

/** An index of the CRM's contacts by every key, built once per screen. */
export class ContactIndex {
  private byKey = new Map<string, Contact>();
  private byName = new Map<string, Contact>();

  constructor(contacts: Contact[]) {
    for (const c of contacts) {
      for (const k of keysOf(c)) if (!this.byKey.has(k)) this.byKey.set(k, c);
      const n = nameKey(c.name);
      if (n && !this.byName.has(n)) this.byName.set(n, c);
    }
  }

  match(c: Candidate): Match | null {
    const order: [MatchBy, string[]][] = [
      ["import", c.externalIds.map((x) => `x:${x}`)],
      ["email", c.emails.map((e) => `e:${emailKey(e)}`)],
      ["linkedin", c.linkedin ? [`l:${c.linkedin}`] : []],
      ["phone", c.phones.map(phoneKey).filter(Boolean).map((k) => `p:${k}`)],
    ];
    for (const [by, keys] of order) {
      for (const k of keys) {
        const contact = this.byKey.get(k);
        if (contact) return { contact, by };
      }
    }
    const n = nameKey(c.name);
    // A one-word name ("Marc") is too common to suggest anyone.
    const contact = n.includes(" ") ? this.byName.get(n) : undefined;
    return contact ? { contact, by: "name" } : null;
  }
}

// ---------------------------------------------------------------- merging

export interface ImportOptions {
  /**
   * Google labels become tags, prefixed with the first tag of the source they
   * come from: "Partners" in the work account becomes `mapsofmaking/partners`,
   * so it stays clear where a label was set. A source without a tag gives the
   * bare label.
   */
  labelsAsTags: boolean;
  /** Tags given to everyone from a source, by source id (e.g. the account's workspace). */
  sourceTags: Record<string, string[]>;
}

export function tagsFor(c: Candidate, opts: ImportOptions): string[] {
  const fromLabels = opts.labelsAsTags
    ? Object.entries(c.labelsBySource).flatMap(([source, labels]) => {
        const prefix = opts.sourceTags[source]?.[0];
        return labels.flatMap((l) => parseTags(l)).map((t) => (prefix ? `${prefix}/${t}` : t));
      })
    : [];
  const fromSources = c.sourceIds.flatMap((s) => opts.sourceTags[s] ?? []);
  return [...new Set([...fromLabels, ...fromSources])];
}

/** Finds an organization by name, accent- and case-insensitively. */
export function findOrgByName(orgs: Organization[], name: string): Organization | undefined {
  const k = fold(name.trim());
  return orgs.find((o) => fold(o.name.trim()) === k);
}

export interface MergeResult {
  contact: Contact;
  /** What changed, in words, for the review screen: "2 emails", "a phone"… Empty when nothing would. */
  changes: string[];
}

const count = (n: number, one: string, many: string) => (n === 1 ? `${one}` : `${n} ${many}`);

/**
 * Adds to `base` what the candidate has and it lacks. `orgIds` are the IRIs of
 * the candidate's organizations (resolved or about to be created).
 */
export function mergeInto(base: Contact, c: Candidate, orgIds: string[], tags: string[]): MergeResult {
  const next: Contact = { ...base, emails: [...base.emails], phones: [...base.phones], orgs: [...base.orgs], links: [...base.links], tags: [...base.tags], externalIds: [...base.externalIds] };
  const changes: string[] = [];
  const before = (list: unknown[]) => list.length;

  if (!next.name && c.name) {
    next.name = c.name;
    changes.push("the name");
  }
  let n = before(next.emails);
  addUnique(next.emails, c.emails, emailKey);
  if (next.emails.length > n) changes.push(count(next.emails.length - n, "an email", "emails"));
  n = before(next.phones);
  addUnique(next.phones, c.phones, (v) => phoneKey(v) || v);
  if (next.phones.length > n) changes.push(count(next.phones.length - n, "a phone", "phones"));
  n = before(next.orgs);
  addUnique(next.orgs, orgIds, (v) => v);
  if (next.orgs.length > n) changes.push(count(next.orgs.length - n, "an organization", "organizations"));
  if (!next.role && c.role) {
    next.role = c.role;
    changes.push("the role");
  }
  if (!next.linkedin && c.linkedin) {
    next.linkedin = c.linkedin;
    changes.push("LinkedIn");
  }
  n = before(next.links);
  addUnique(next.links, c.links);
  if (next.links.length > n) changes.push(count(next.links.length - n, "a link", "links"));
  n = before(next.tags);
  addUnique(next.tags, tags);
  if (next.tags.length > n) changes.push(count(next.tags.length - n, "a tag", "tags"));
  if (!next.note && c.note) {
    next.note = c.note;
    changes.push("a note");
  }
  // Remembering the Google id is bookkeeping, not news: it never counts as a change on its own.
  addUnique(next.externalIds, c.externalIds, (v) => v);
  if (changes.length === 0 && next.externalIds.length > base.externalIds.length) changes.push("the link to Google");
  return { contact: next, changes };
}

export function newContactFrom(c: Candidate, orgIds: string[], tags: string[]): Contact {
  return mergeInto({ ...emptyContact(), source: "google" }, c, orgIds, tags).contact;
}
