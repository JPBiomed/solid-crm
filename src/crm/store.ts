/**
 * Reading and writing the CRM in the pod.
 *
 * Layout: one Turtle document per collection under `<pod>/crm/`. A personal
 * CRM holds hundreds of records, not millions, and one document per
 * collection makes the home screen six requests instead of one per record.
 * Interactions are the collection that grows; if it ever gets heavy, it can be
 * split by year without changing a single record IRI's shape (`<doc>#<id>`).
 *
 * Two rules, both from the kit:
 * - Screens read through `readTurtle` (ETag revalidation, ADR 007): the server
 *   is asked every time, so what is shown is never older than the pod.
 * - Writes NEVER start from what a screen showed. Each write reads the
 *   document fresh, changes one Thing, and saves; solid-client sends only the
 *   difference as a PATCH, so an edit made meanwhile on another device to
 *   another record survives.
 */
import {
  createSolidDataset,
  FetchError,
  getSolidDataset,
  getThing,
  getThingAll,
  removeThing,
  saveSolidDatasetAt,
  setThing,
  type SolidDataset,
  type Thing,
} from "@inrupt/solid-client";
import { authFetch } from "../lib/auth";
import { readTurtle } from "../lib/read";
import {
  DEFAULT_STAGES,
  newId,
  stageToThing,
  thingToContact,
  thingToInteraction,
  thingToOrganization,
  thingToProject,
  thingToStage,
  thingToTask,
  type Contact,
  type Interaction,
  type Organization,
  type Project,
  type RecordBase,
  type Stage,
  type Task,
} from "./model";

export const COLLECTIONS = [
  "contacts",
  "organizations",
  "projects",
  "interactions",
  "tasks",
  "settings",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface CrmData {
  contacts: Contact[];
  organizations: Organization[];
  projects: Project[];
  interactions: Interaction[];
  tasks: Task[];
  stages: Stage[];
}

/** A fetch that revalidates against the in-memory copy, for display reads. */
const displayFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const res = await readTurtle(url);
  // readTurtle hands back `new Response(body)`, whose `url` is "". solid-client
  // resolves every IRI in the document against `response.url`, so without this
  // it throws "Invalid base URL" on the first document that has any content.
  if (!res.url) Object.defineProperty(res, "url", { value: url });
  return res;
};

function isNotFound(err: unknown): boolean {
  return err instanceof FetchError && err.statusCode === 404;
}

function collect<T>(ds: SolidDataset, parse: (t: Thing) => T | null): T[] {
  return getThingAll(ds).map(parse).filter((x): x is T => x !== null);
}

export class CrmStore {
  /** Container URL, ending in `/`. */
  readonly root: string;

  constructor(podRoot: string, folder = "crm/") {
    this.root = new URL(folder, podRoot).href;
  }

  docUrl(collection: Collection): string {
    return `${this.root}${collection}.ttl`;
  }

  /** For display. A missing document is an empty collection, not an error. */
  protected async read(collection: Collection): Promise<SolidDataset> {
    try {
      return await getSolidDataset(this.docUrl(collection), { fetch: displayFetch });
    } catch (err) {
      if (isNotFound(err)) return createSolidDataset();
      throw err;
    }
  }

  /** For writes: no cache, ever (conditional.ts invariant 1). */
  protected async readFresh(collection: Collection): Promise<SolidDataset> {
    try {
      return await getSolidDataset(this.docUrl(collection), { fetch: authFetch });
    } catch (err) {
      if (isNotFound(err)) return createSolidDataset();
      throw err;
    }
  }

  protected async write(collection: Collection, ds: SolidDataset): Promise<void> {
    await saveSolidDatasetAt(this.docUrl(collection), ds, { fetch: authFetch });
  }

  async load(): Promise<CrmData> {
    const [c, o, p, i, t, s] = await Promise.all(COLLECTIONS.map((name) => this.read(name)));
    const stages = collect(s, thingToStage).sort((a, b) => a.position - b.position);
    return {
      contacts: collect(c, thingToContact),
      organizations: collect(o, thingToOrganization),
      projects: collect(p, thingToProject),
      interactions: collect(i, thingToInteraction),
      tasks: collect(t, thingToTask),
      stages: stages.length > 0 ? stages : this.defaultStages(),
    };
  }

  private defaultStages(): Stage[] {
    return DEFAULT_STAGES.map((s) => ({ ...s, id: `${this.docUrl("settings")}#stage-${s.key}` }));
  }

  /**
   * Saves one record. A record without an id gets one here; the saved record,
   * with its id, is returned.
   */
  async save<T extends RecordBase>(
    collection: Collection,
    record: T,
    toThing: (r: T) => Thing
  ): Promise<T> {
    const saved = { ...record, id: record.id || `${this.docUrl(collection)}#${newId()}` };
    let ds = await this.readFresh(collection);
    ds = setThing(ds, toThing(saved));
    await this.write(collection, ds);
    return saved;
  }

  /** Saves several records of one collection in a single write (imports, bulk edits). */
  async saveMany<T extends RecordBase>(
    collection: Collection,
    records: T[],
    toThing: (r: T) => Thing
  ): Promise<T[]> {
    const saved = records.map((r) => ({ ...r, id: r.id || `${this.docUrl(collection)}#${newId()}` }));
    let ds = await this.readFresh(collection);
    for (const r of saved) ds = setThing(ds, toThing(r));
    await this.write(collection, ds);
    return saved;
  }

  async remove(collection: Collection, id: string): Promise<void> {
    let ds = await this.readFresh(collection);
    if (!getThing(ds, id)) return;
    ds = removeThing(ds, id);
    await this.write(collection, ds);
  }

  /** Replaces the whole stage list: renames, reorders, additions and removals. */
  async saveStages(stages: Stage[]): Promise<void> {
    let ds = await this.readFresh("settings");
    for (const t of getThingAll(ds)) if (thingToStage(t)) ds = removeThing(ds, t);
    stages.forEach((s, position) => {
      const id = s.id || `${this.docUrl("settings")}#stage-${s.key}`;
      ds = setThing(ds, stageToThing({ ...s, id, position }));
    });
    await this.write("settings", ds);
  }
}

/**
 * The same CRM with nothing leaving the tab: `?demo` in the address. For
 * trying the app, and for checking screens without a pod (ADR 005: demo mode
 * is per app). Gone on reload.
 */
export class DemoStore extends CrmStore {
  private docs = new Map<Collection, SolidDataset>();

  constructor() {
    super("https://demo.invalid/");
  }

  protected async read(collection: Collection): Promise<SolidDataset> {
    return this.docs.get(collection) ?? createSolidDataset();
  }

  protected async readFresh(collection: Collection): Promise<SolidDataset> {
    return this.read(collection);
  }

  protected async write(collection: Collection, ds: SolidDataset): Promise<void> {
    this.docs.set(collection, ds);
  }
}
