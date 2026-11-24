/**
 * What an import would do, row by row, and the writes that carry it out.
 * Pure: the screen renders `planRows` and saves what `planWrites` returns.
 */
import { emptyOrganization, fold, newId, type Contact, type Organization } from "../model";
import { ContactIndex, findOrgByName, mergeInto, newContactFrom, tagsFor, type Candidate, type ImportOptions, type Match } from "./merge";

export type RowStatus = "new" | "update" | "same" | "name";

export interface PlanRow {
  candidate: Candidate;
  match: Match | null;
  status: RowStatus;
  /** For "update": what would be added, in words. */
  changes: string[];
}

/**
 * Org IRIs for a candidate's organization names, as they would be once saved:
 * existing ones by name, new ones with the IRI they will get (`pending`).
 */
function orgIdsFor(names: string[], orgs: Organization[], pending: Map<string, Organization>, orgDoc: string): string[] {
  return names.map((name) => {
    const found = findOrgByName(orgs, name);
    if (found) return found.id;
    const k = fold(name.trim());
    let org = pending.get(k);
    if (!org) {
      org = { ...emptyOrganization(), id: `${orgDoc}#${newId()}`, name: name.trim(), tags: [] };
      pending.set(k, org);
    }
    return org.id;
  });
}

export function planRows(candidates: Candidate[], contacts: Contact[], orgs: Organization[], opts: ImportOptions): PlanRow[] {
  const index = new ContactIndex(contacts);
  const pending = new Map<string, Organization>();
  return candidates.map((candidate) => {
    const match = index.match(candidate);
    if (!match) return { candidate, match, status: "new" as const, changes: [] };
    if (match.by === "name") return { candidate, match, status: "name" as const, changes: [] };
    const { changes } = mergeInto(match.contact, candidate, orgIdsFor(candidate.orgs, orgs, pending, "x"), tagsFor(candidate, opts));
    return { candidate, match, status: changes.length ? ("update" as const) : ("same" as const), changes };
  });
}

export interface Writes {
  organizations: Organization[];
  contacts: Contact[];
  created: number;
  updated: number;
}

/**
 * The records to save for the chosen rows. `mergeByName` holds the keys of
 * name-only matches the person chose to merge; the others become new people.
 * Rows that end up on the same CRM contact are merged into it one after the
 * other, so nothing one of them adds is lost to the next.
 */
export function planWrites(
  rows: PlanRow[],
  chosen: Set<string>,
  mergeByName: Set<string>,
  orgs: Organization[],
  opts: ImportOptions,
  orgDoc: string,
  contactDoc: string
): Writes {
  const pending = new Map<string, Organization>();
  const out = new Map<string, Contact>();
  let created = 0;
  for (const row of rows) {
    if (!chosen.has(row.candidate.key) || row.status === "same") continue;
    const c = row.candidate;
    const orgIds = orgIdsFor(c.orgs, orgs, pending, orgDoc);
    const tags = tagsFor(c, opts);
    const target = row.match && (row.status !== "name" || mergeByName.has(c.key)) ? row.match.contact : null;
    if (target) {
      out.set(target.id, mergeInto(out.get(target.id) ?? target, c, orgIds, tags).contact);
    } else {
      const contact = { ...newContactFrom(c, orgIds, tags), id: `${contactDoc}#${newId()}` };
      out.set(contact.id, contact);
      created++;
    }
  }
  return { organizations: [...pending.values()], contacts: [...out.values()], created, updated: out.size - created };
}
