import { describe, expect, it } from "vitest";
import {
  contactToThing,
  dayToDatetime,
  dueState,
  emptyContact,
  emptyInteraction,
  emptyProject,
  emptyTask,
  extractLinkedIn,
  findContactByEmail,
  interactionToThing,
  localDate,
  matches,
  normalizeLinkedIn,
  normalizeMatrixId,
  parseTags,
  projectToThing,
  taskToThing,
  thingToContact,
  thingToInteraction,
  thingToOrganization,
  thingToProject,
  thingToTask,
  byTaskOrder,
  type Contact,
} from "./model";

const DOC = "https://pod.example/crm/contacts.ttl";

describe("normalizeLinkedIn", () => {
  it("normalizes host, case, query and trailing slash", () => {
    expect(normalizeLinkedIn("https://linkedin.com/in/Jane-Doe-123?utm_source=share")).toBe(
      "https://www.linkedin.com/in/jane-doe-123/"
    );
    expect(normalizeLinkedIn("be.linkedin.com/in/jane/details/experience/")).toBe("https://www.linkedin.com/in/jane/");
    expect(normalizeLinkedIn("https://www.linkedin.com/company/fablab-x")).toBe("https://www.linkedin.com/company/fablab-x/");
  });

  it("refuses anything that is not a profile or company page", () => {
    expect(normalizeLinkedIn("https://www.linkedin.com/feed/")).toBe("");
    expect(normalizeLinkedIn("https://evil-linkedin.com/in/jane")).toBe("");
    expect(normalizeLinkedIn("not a url at all")).toBe("");
  });

  it("finds the profile in text shared from a phone", () => {
    expect(extractLinkedIn("Check out Jane's profile on LinkedIn https://www.linkedin.com/in/jane-d?x=1")).toBe(
      "https://www.linkedin.com/in/jane-d/"
    );
    expect(extractLinkedIn("nothing here")).toBe("");
  });
});

describe("normalizeMatrixId", () => {
  it("accepts an id or a matrix.to link", () => {
    expect(normalizeMatrixId(" @ana:example.org ")).toBe("@ana:example.org");
    expect(normalizeMatrixId("https://matrix.to/#/@ana:example.org")).toBe("@ana:example.org");
    expect(normalizeMatrixId("ana")).toBe("");
  });
});

describe("contacts round-trip through RDF", () => {
  it("keeps every field", () => {
    const c: Contact = {
      ...emptyContact(),
      id: `${DOC}#abc`,
      name: "Élodie Exemple",
      emails: ["elodie@example.org", "e@example.com"],
      phones: ["+32 470 00 00 00"],
      role: "Fablab manager",
      orgs: ["https://pod.example/crm/organizations.ttl#org1"],
      linkedin: "https://www.linkedin.com/in/elodie/",
      linkedinStatus: "request-sent",
      connectedOn: "2026-03-04",
      matrixId: "@elodie:example.org",
      links: ["https://elodie.example"],
      tags: ["fablab", "brussels"],
      note: "Met at the open day.\nInterested in mapping.",
      source: "linkedin",
    };
    const back = thingToContact(contactToThing(c))!;
    expect(back).toMatchObject({ ...c, phones: ["+32470000000"] });
    expect(back.created).toBeInstanceOf(Date);
  });

  it("is not mistaken for another record type", () => {
    const t = contactToThing({ ...emptyContact(), id: `${DOC}#x`, name: "X" });
    expect(thingToOrganization(t)).toBeNull();
    expect(thingToTask(t)).toBeNull();
  });

  it("keeps the created date across edits", () => {
    const created = new Date("2025-01-01T10:00:00Z");
    const t = contactToThing({ ...emptyContact(), id: `${DOC}#x`, name: "X", created }, new Date("2026-01-01"));
    expect(thingToContact(t)!.created?.toISOString()).toBe(created.toISOString());
  });
});

describe("dates are local calendar days", () => {
  it("stores a day at local noon and reads the same day back", () => {
    const d = dayToDatetime("2026-11-30")!;
    expect(localDate(d)).toBe("2026-11-30");
    const t = taskToThing({ ...emptyTask(), id: "https://p/t.ttl#t", title: "T", due: "2026-11-30" });
    expect(thingToTask(t)!.due).toBe("2026-11-30");
  });

  it("classifies due dates", () => {
    expect(dueState("", "2026-11-18")).toBe("none");
    expect(dueState("2026-11-17", "2026-11-18")).toBe("overdue");
    expect(dueState("2026-11-18", "2026-11-18")).toBe("today");
    expect(dueState("2026-11-25", "2026-11-18")).toBe("soon");
    expect(dueState("2026-11-26", "2026-11-18")).toBe("later");
  });
});

describe("other records round-trip", () => {
  it("projects", () => {
    const p = { ...emptyProject("proposal"), id: "https://p/projects.ttl#p", name: "Map", members: ["https://p/c.ttl#a"], start: "2026-01-02", tags: ["grant"] };
    expect(thingToProject(projectToThing(p))).toMatchObject(p);
  });

  it("interactions", () => {
    const i = { ...emptyInteraction(["https://p/c.ttl#a"]), id: "https://p/i.ttl#i", channel: "email" as const, date: new Date("2026-11-18T10:00:00Z"), title: "Hi", externalId: "gmail:123" };
    expect(thingToInteraction(interactionToThing(i))).toMatchObject(i);
  });

  it("tasks", () => {
    const t = { ...emptyTask(["https://p/c.ttl#a"]), id: "https://p/t.ttl#t", title: "Call", done: true };
    expect(thingToTask(taskToThing(t))).toMatchObject(t);
  });
});

describe("helpers", () => {
  it("parses tags", () => {
    expect(parseTags(" Fablab, brussels,, fablab ")).toEqual(["fablab", "brussels"]);
  });

  it("searches across fields, accents folded", () => {
    expect(matches("elodie brux", "Élodie", ["Bruxelles"])).toBe(true);
    expect(matches("ghent", "Élodie", ["Bruxelles"])).toBe(false);
    expect(matches("", "anything")).toBe(true);
  });

  it("finds a contact by email, case-insensitively", () => {
    const c = { ...emptyContact(), id: "x", emails: ["Ana@Example.org"] };
    expect(findContactByEmail([c], "ana@example.ORG")).toBe(c);
  });

  it("orders tasks: open first, then by due date, undated last", () => {
    const t = (title: string, due: string, done = false) => ({ ...emptyTask(), title, due, done });
    const sorted = [t("c", ""), t("d", "2026-01-01", true), t("b", "2026-02-01"), t("a", "2026-01-01")].sort(byTaskOrder);
    expect(sorted.map((x) => x.title)).toEqual(["a", "b", "c", "d"]);
  });
});
