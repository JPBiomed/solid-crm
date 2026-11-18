/**
 * The CRM's records, and how each maps to and from RDF.
 *
 * Pure functions only, no I/O: everything here is testable without a pod.
 * `store.ts` does the reading and writing.
 *
 * Every record is a Thing whose IRI is `<collection document>#<id>`, so a
 * record's identity is a URL anyone with access can dereference, and links
 * between records (a contact's organization, a project's members, what an
 * interaction is about) are plain IRIs.
 */
import {
  buildThing,
  createThing,
  getBoolean,
  getDatetime,
  getInteger,
  getStringNoLocale,
  getStringNoLocaleAll,
  getUrl,
  getUrlAll,
  type Thing,
} from "@inrupt/solid-client";
import { readLiteral } from "../lib/literal";
import { CRM, DCT, ICAL, RDF_TYPE, SCHEMA, VCARD } from "./vocab";

// ---------------------------------------------------------------- types

export interface RecordBase {
  /** The record's IRI. Empty on a record not yet saved. */
  id: string;
  created?: Date;
  modified?: Date;
}

export const LINKEDIN_STATUSES = ["interesting", "request-sent", "connected", "met"] as const;
export type LinkedInStatus = (typeof LINKEDIN_STATUSES)[number];

export interface Contact extends RecordBase {
  name: string;
  emails: string[];
  phones: string[];
  /** Job title or headline. */
  role: string;
  /** Organization IRIs. */
  orgs: string[];
  /** Normalized `https://www.linkedin.com/in/<slug>/`, the dedup key. */
  linkedin: string;
  linkedinStatus: LinkedInStatus | "";
  /** `YYYY-MM-DD`, local. */
  connectedOn: string;
  /** `@user:server`. */
  matrixId: string;
  /** Other web addresses: a site, a portfolio, a wiki page. */
  links: string[];
  tags: string[];
  note: string;
  /** Where the record came from: "manual", "linkedin", "gmail", "matrix"… */
  source: string;
}

export interface Organization extends RecordBase {
  name: string;
  website: string;
  location: string;
  tags: string[];
  note: string;
}

export interface Project extends RecordBase {
  name: string;
  /** A `Stage.key` from the settings. */
  stage: string;
  description: string;
  /** Contact and organization IRIs. */
  members: string[];
  start: string;
  end: string;
  tags: string[];
}

export const CHANNELS = ["note", "email", "meeting", "call", "chat", "linkedin", "event"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Interaction extends RecordBase {
  channel: Channel;
  date: Date;
  title: string;
  body: string;
  /** Contact, organization and project IRIs this interaction belongs to. */
  about: string[];
  /** The id in the system it came from (a Gmail message id, a Matrix event id). */
  externalId: string;
}

export interface Task extends RecordBase {
  title: string;
  /** `YYYY-MM-DD`, local; empty when there is no due date. */
  due: string;
  done: boolean;
  about: string[];
  note: string;
}

export interface Stage {
  id: string;
  /** Stable machine key stored on projects; survives a rename of the label. */
  key: string;
  label: string;
  position: number;
}

export const DEFAULT_STAGES: Omit<Stage, "id">[] = [
  { key: "idea", label: "Idea", position: 0 },
  { key: "discussing", label: "Discussing", position: 1 },
  { key: "proposal", label: "Proposal", position: 2 },
  { key: "active", label: "Active", position: 3 },
  { key: "done", label: "Done", position: 4 },
  { key: "paused", label: "Paused", position: 5 },
];

// ---------------------------------------------------------------- helpers

/** Short, URL-safe, random. Collisions across a personal CRM are not a concern at 10 chars. */
export function newId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * `https://linkedin.com/in/Jane-Doe-123?utm=x` → `https://www.linkedin.com/in/jane-doe-123/`.
 * Returns "" for anything that is not a LinkedIn profile or company page, so a
 * bad paste never becomes a dedup key.
 */
export function normalizeLinkedIn(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return "";
  const m = url.pathname.match(/^\/(in|company)\/([^/]+)/i);
  if (!m) return "";
  return `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}/`;
}

/** `@user:server` or "" — accepts a matrix.to link too. */
export function normalizeMatrixId(input: string): string {
  let raw = input.trim();
  const m = raw.match(/matrix\.to\/#\/(@[^/?]+)/i);
  if (m) raw = decodeURIComponent(m[1]);
  return /^@[^:\s]+:[^\s]+$/.test(raw) ? raw : "";
}

/** Splits "a, b ,c" into trimmed, deduplicated, lower-case tags. */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Splits a field holding several values (one per line or comma separated). */
export function parseList(input: string): string[] {
  return [...new Set(input.split(/[\n,;]/).map((t) => t.trim()).filter(Boolean))];
}

/** `YYYY-MM-DD` in local time. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A local calendar day is stored as an xsd:dateTime at local noon, not as an
 * xsd:date: solid-client writes xsd:date with the UTC offset of the *instant*,
 * which shifts the day for anyone east or west of Greenwich. Noon is far enough
 * from midnight that no timezone can push it to another day on the way back.
 */
export function dayToDatetime(day: string): Date | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

const str = (t: Thing, p: string) => readLiteral(t, p) ?? "";
const strs = (t: Thing, p: string) => getStringNoLocaleAll(t, p);
const day = (t: Thing, p: string) => {
  const d = getDatetime(t, p);
  return d ? localDate(d) : "";
};

/** Strips `mailto:` / `tel:` from IRIs, or reads a plain literal. */
function addresses(t: Thing, p: string, scheme: string): string[] {
  const fromUrls = getUrlAll(t, p)
    .filter((u) => u.startsWith(scheme))
    .map((u) => decodeURIComponent(u.slice(scheme.length)));
  return [...fromUrls, ...strs(t, p)];
}

function base(t: Thing): Pick<RecordBase, "id" | "created" | "modified"> {
  return {
    id: t.url,
    created: getDatetime(t, DCT("created")) ?? undefined,
    modified: getDatetime(t, DCT("modified")) ?? undefined,
  };
}

/** Starts a Thing with the shared bookkeeping: types, created, modified. */
function start(record: RecordBase, types: string[], now: Date) {
  let b = buildThing(createThing({ url: record.id }));
  for (const type of types) b = b.addUrl(RDF_TYPE, type);
  return b
    .setDatetime(DCT("created"), record.created ?? now)
    .setDatetime(DCT("modified"), now);
}

function isType(t: Thing, type: string): boolean {
  return getUrlAll(t, RDF_TYPE).includes(type);
}

// ---------------------------------------------------------------- contacts

export const CONTACT_TYPE = VCARD("Individual");

export function emptyContact(): Contact {
  return {
    id: "", name: "", emails: [], phones: [], role: "", orgs: [], linkedin: "",
    linkedinStatus: "", connectedOn: "", matrixId: "", links: [], tags: [], note: "",
    source: "manual",
  };
}

export function contactToThing(c: Contact, now = new Date()): Thing {
  let b = start(c, [CONTACT_TYPE, SCHEMA("Person")], now).addStringNoLocale(VCARD("fn"), c.name);
  for (const e of c.emails) b = b.addUrl(VCARD("hasEmail"), `mailto:${e}`);
  for (const p of c.phones) b = b.addUrl(VCARD("hasTelephone"), `tel:${p.replace(/\s+/g, "")}`);
  if (c.role) b = b.addStringNoLocale(VCARD("title"), c.role);
  for (const o of c.orgs) b = b.addUrl(SCHEMA("worksFor"), o);
  if (c.linkedin) b = b.addUrl(SCHEMA("sameAs"), c.linkedin);
  for (const l of c.links) b = b.addUrl(VCARD("url"), l);
  if (c.linkedinStatus) b = b.addStringNoLocale(CRM("linkedinStatus"), c.linkedinStatus);
  const connected = dayToDatetime(c.connectedOn);
  if (connected) b = b.addDatetime(CRM("connectedOn"), connected);
  if (c.matrixId) b = b.addStringNoLocale(CRM("matrixId"), c.matrixId);
  for (const t of c.tags) b = b.addStringNoLocale(SCHEMA("keywords"), t);
  if (c.note) b = b.addStringNoLocale(VCARD("note"), c.note);
  if (c.source) b = b.addStringNoLocale(DCT("source"), c.source);
  return b.build();
}

export function thingToContact(t: Thing): Contact | null {
  if (!isType(t, CONTACT_TYPE)) return null;
  const sameAs = getUrlAll(t, SCHEMA("sameAs"));
  const status = str(t, CRM("linkedinStatus")) as LinkedInStatus;
  return {
    ...base(t),
    name: str(t, VCARD("fn")),
    emails: addresses(t, VCARD("hasEmail"), "mailto:"),
    phones: addresses(t, VCARD("hasTelephone"), "tel:"),
    role: str(t, VCARD("title")),
    orgs: getUrlAll(t, SCHEMA("worksFor")),
    linkedin: sameAs.map(normalizeLinkedIn).find(Boolean) ?? "",
    linkedinStatus: LINKEDIN_STATUSES.includes(status) ? status : "",
    connectedOn: day(t, CRM("connectedOn")),
    matrixId: str(t, CRM("matrixId")),
    links: getUrlAll(t, VCARD("url")),
    tags: strs(t, SCHEMA("keywords")),
    note: str(t, VCARD("note")),
    source: str(t, DCT("source")),
  };
}

// ---------------------------------------------------------------- organizations

export const ORG_TYPE = VCARD("Organization");

export function emptyOrganization(): Organization {
  return { id: "", name: "", website: "", location: "", tags: [], note: "" };
}

export function organizationToThing(o: Organization, now = new Date()): Thing {
  let b = start(o, [ORG_TYPE, SCHEMA("Organization")], now).addStringNoLocale(VCARD("fn"), o.name);
  if (o.website) b = b.addUrl(SCHEMA("url"), o.website);
  if (o.location) b = b.addStringNoLocale(SCHEMA("location"), o.location);
  for (const t of o.tags) b = b.addStringNoLocale(SCHEMA("keywords"), t);
  if (o.note) b = b.addStringNoLocale(VCARD("note"), o.note);
  return b.build();
}

export function thingToOrganization(t: Thing): Organization | null {
  if (!isType(t, ORG_TYPE)) return null;
  return {
    ...base(t),
    name: str(t, VCARD("fn")),
    website: getUrl(t, SCHEMA("url")) ?? "",
    location: str(t, SCHEMA("location")),
    tags: strs(t, SCHEMA("keywords")),
    note: str(t, VCARD("note")),
  };
}

// ---------------------------------------------------------------- projects

export const PROJECT_TYPE = SCHEMA("Project");

export function emptyProject(stage = "idea"): Project {
  return { id: "", name: "", stage, description: "", members: [], start: "", end: "", tags: [] };
}

export function projectToThing(p: Project, now = new Date()): Thing {
  let b = start(p, [PROJECT_TYPE], now)
    .addStringNoLocale(SCHEMA("name"), p.name)
    .addStringNoLocale(CRM("stage"), p.stage);
  if (p.description) b = b.addStringNoLocale(SCHEMA("description"), p.description);
  for (const m of p.members) b = b.addUrl(SCHEMA("member"), m);
  const s = dayToDatetime(p.start);
  if (s) b = b.addDatetime(SCHEMA("startDate"), s);
  const e = dayToDatetime(p.end);
  if (e) b = b.addDatetime(SCHEMA("endDate"), e);
  for (const t of p.tags) b = b.addStringNoLocale(SCHEMA("keywords"), t);
  return b.build();
}

export function thingToProject(t: Thing): Project | null {
  if (!isType(t, PROJECT_TYPE)) return null;
  return {
    ...base(t),
    name: str(t, SCHEMA("name")),
    stage: str(t, CRM("stage")) || "idea",
    description: str(t, SCHEMA("description")),
    members: getUrlAll(t, SCHEMA("member")),
    start: day(t, SCHEMA("startDate")),
    end: day(t, SCHEMA("endDate")),
    tags: strs(t, SCHEMA("keywords")),
  };
}

// ---------------------------------------------------------------- interactions

export const INTERACTION_TYPE = CRM("Interaction");

export function emptyInteraction(about: string[] = []): Interaction {
  return { id: "", channel: "note", date: new Date(), title: "", body: "", about, externalId: "" };
}

export function interactionToThing(i: Interaction, now = new Date()): Thing {
  let b = start(i, [INTERACTION_TYPE, SCHEMA("CommunicateAction")], now)
    .addStringNoLocale(CRM("channel"), i.channel)
    .addDatetime(SCHEMA("startTime"), i.date);
  if (i.title) b = b.addStringNoLocale(SCHEMA("name"), i.title);
  if (i.body) b = b.addStringNoLocale(SCHEMA("description"), i.body);
  for (const a of i.about) b = b.addUrl(SCHEMA("about"), a);
  if (i.externalId) b = b.addStringNoLocale(SCHEMA("identifier"), i.externalId);
  return b.build();
}

export function thingToInteraction(t: Thing): Interaction | null {
  if (!isType(t, INTERACTION_TYPE)) return null;
  const channel = str(t, CRM("channel")) as Channel;
  return {
    ...base(t),
    channel: CHANNELS.includes(channel) ? channel : "note",
    date: getDatetime(t, SCHEMA("startTime")) ?? new Date(0),
    title: str(t, SCHEMA("name")),
    body: str(t, SCHEMA("description")),
    about: getUrlAll(t, SCHEMA("about")),
    externalId: str(t, SCHEMA("identifier")),
  };
}

// ---------------------------------------------------------------- tasks

export const TASK_TYPE = ICAL("Vtodo");

export function emptyTask(about: string[] = []): Task {
  return { id: "", title: "", due: "", done: false, about, note: "" };
}

export function taskToThing(task: Task, now = new Date()): Thing {
  let b = start(task, [TASK_TYPE], now)
    .addStringNoLocale(ICAL("summary"), task.title)
    .addStringNoLocale(ICAL("status"), task.done ? "COMPLETED" : "NEEDS-ACTION")
    .addBoolean(CRM("done"), task.done);
  const due = dayToDatetime(task.due);
  if (due) b = b.addDatetime(ICAL("due"), due);
  for (const a of task.about) b = b.addUrl(SCHEMA("about"), a);
  if (task.note) b = b.addStringNoLocale(ICAL("description"), task.note);
  return b.build();
}

export function thingToTask(t: Thing): Task | null {
  if (!isType(t, TASK_TYPE)) return null;
  const status = str(t, ICAL("status"));
  return {
    ...base(t),
    title: str(t, ICAL("summary")),
    due: day(t, ICAL("due")),
    done: getBoolean(t, CRM("done")) ?? status === "COMPLETED",
    about: getUrlAll(t, SCHEMA("about")),
    note: str(t, ICAL("description")),
  };
}

// ---------------------------------------------------------------- stages

export const STAGE_TYPE = CRM("Stage");

export function stageToThing(s: Stage): Thing {
  return buildThing(createThing({ url: s.id }))
    .addUrl(RDF_TYPE, STAGE_TYPE)
    .addStringNoLocale(CRM("key"), s.key)
    .addStringNoLocale(SCHEMA("name"), s.label)
    .addInteger(SCHEMA("position"), s.position)
    .build();
}

export function thingToStage(t: Thing): Stage | null {
  if (!isType(t, STAGE_TYPE)) return null;
  const key = getStringNoLocale(t, CRM("key"));
  if (!key) return null;
  return {
    id: t.url,
    key,
    label: str(t, SCHEMA("name")) || key,
    position: getInteger(t, SCHEMA("position")) ?? 0,
  };
}

// ---------------------------------------------------------------- queries

/** Lower-case, accent-folded, for search. "Élodie" matches "elodie". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** True when every word of the query appears somewhere in the haystack. */
export function matches(query: string, ...haystack: (string | string[])[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(haystack.flat().join(" "));
  return words.every((w) => text.includes(w));
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Newest first. */
export function byDateDesc(a: Interaction, b: Interaction): number {
  return b.date.getTime() - a.date.getTime();
}

/** Open tasks first, then by due date (no date last), then by title. */
export function byTaskOrder(a: Task, b: Task): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return a.title.localeCompare(b.title);
}

/** Every tag used across the records, sorted, with how often. */
export function tagCounts(records: { tags: string[] }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of records) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
}

/** "overdue" | "today" | "soon" (within 7 days) | "later" | "none". */
export function dueState(due: string, today = localDate(new Date())): "overdue" | "today" | "soon" | "later" | "none" {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const in7 = dayToDatetime(today)!;
  in7.setDate(in7.getDate() + 7);
  return due <= localDate(in7) ? "soon" : "later";
}

/** Finds a contact by e-mail address, case-insensitively. Used by the integrations to match. */
export function findContactByEmail(contacts: Contact[], email: string): Contact | undefined {
  const e = email.trim().toLowerCase();
  return contacts.find((c) => c.emails.some((x) => x.toLowerCase() === e));
}

export function findContactByLinkedIn(contacts: Contact[], url: string): Contact | undefined {
  const key = normalizeLinkedIn(url);
  return key ? contacts.find((c) => c.linkedin === key) : undefined;
}

/**
 * Finds the first LinkedIn profile or company URL in free text — what a phone's
 * share menu hands over is often "Check out Jane's profile https://…".
 */
export function extractLinkedIn(text: string): string {
  for (const candidate of text.match(/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/[^\s"'<>]+/gi) ?? []) {
    const url = normalizeLinkedIn(candidate);
    if (url) return url;
  }
  return "";
}
