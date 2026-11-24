import { describe, expect, it } from "vitest";
import { emptyContact, emptyOrganization } from "../model";
import { groupPeople } from "./merge";
import { emptyPerson, type ImportPerson } from "./parse";
import { planRows, planWrites } from "./plan";

const person = (over: Partial<ImportPerson>): ImportPerson => ({ ...emptyPerson("acct"), ...over });
const opts = { labelsAsTags: true, sourceTags: { acct: ["personal"] } };

describe("plan", () => {
  const org = { ...emptyOrganization(), id: "orgs#lab", name: "Fablab Brussels" };
  const jane = { ...emptyContact(), id: "contacts#jane", name: "Jane Doe", emails: ["jane@x.example"], tags: ["personal"] };
  const people = [
    person({ name: "Jane Doe", emails: ["jane@x.example"] }),
    person({ name: "Ana New", emails: ["ana@x.example"], orgs: ["fablab brussels"], labels: ["Makers"] }),
    person({ name: "Ben New", emails: ["ben@x.example"], orgs: ["New Org"] }),
    person({ name: "Cara Other", emails: ["cara@x.example"], orgs: ["new org"] }),
    person({ name: "Jane Doe", phones: ["0475 00 00 00"] }),
  ];

  it("says what happens to each person", () => {
    const rows = planRows(groupPeople(people), [jane], [org], opts);
    expect(rows.map((r) => r.status)).toEqual(["same", "new", "new", "new", "name"]);
  });

  it("writes new people with tags and organizations, creating each new organization once", () => {
    const rows = planRows(groupPeople(people), [jane], [org], opts);
    const all = new Set(rows.map((r) => r.candidate.key));
    const w = planWrites(rows, all, new Set(), [org], opts, "orgs", "contacts");
    expect(w.organizations.map((o) => o.name)).toEqual(["New Org"]);
    const ana = w.contacts.find((c) => c.name === "Ana New")!;
    expect(ana.orgs).toEqual(["orgs#lab"]);
    expect(ana.tags).toEqual(["personal/makers", "personal"]);
    expect(ana.source).toBe("google");
    const ben = w.contacts.find((c) => c.name === "Ben New")!;
    const cara = w.contacts.find((c) => c.name === "Cara Other")!;
    expect(ben.orgs).toEqual(cara.orgs);
    // The name-only Jane is added as someone new unless the person says merge.
    expect(w.created).toBe(4);
    expect(w.updated).toBe(0);
  });

  it("merges a name-only match when asked, and leaves out unticked people", () => {
    const rows = planRows(groupPeople(people), [jane], [org], opts);
    const nameRow = rows.find((r) => r.status === "name")!;
    const w = planWrites(rows, new Set([nameRow.candidate.key]), new Set([nameRow.candidate.key]), [org], opts, "orgs", "contacts");
    expect(w.contacts).toHaveLength(1);
    expect(w.contacts[0].id).toBe("contacts#jane");
    expect(w.contacts[0].phones).toEqual(["0475 00 00 00"]);
    expect(w.updated).toBe(1);
  });
});
