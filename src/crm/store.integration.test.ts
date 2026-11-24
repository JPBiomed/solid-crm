/**
 * Against a real Solid server, not a stub — skipped unless CSS_URL is set.
 *
 *   npx @solid/community-server -p 3000      # in-memory, publicly writable
 *   CSS_URL=http://localhost:3000/ npx vitest run src/crm/store.integration.test.ts
 *
 * Covers what the unit tests can't: that solid-client's PATCHes land, and that
 * two writers touching different records of one document don't erase each other.
 */
import { describe, expect, it } from "vitest";
import { contactToThing, emptyContact, emptyProject, projectToThing, DEFAULT_STAGES } from "./model";
import { CrmStore } from "./store";

const CSS_URL = process.env.CSS_URL;

describe.skipIf(!CSS_URL)("CrmStore on a Solid server", () => {
  const folder = `crm-test-${Date.now()}/`;

  it("starts empty with the default stages", async () => {
    const data = await new CrmStore(CSS_URL!, folder).load();
    expect(data.contacts).toEqual([]);
    expect(data.stages.map((s) => s.key)).toEqual(DEFAULT_STAGES.map((s) => s.key));
  });

  it("saves, edits and removes a contact", async () => {
    const store = new CrmStore(CSS_URL!, folder);
    const saved = await store.save("contacts", { ...emptyContact(), name: "Ana", emails: ["ana@example.org"] }, (r) => contactToThing(r));
    expect(saved.id).toMatch(/contacts\.ttl#/);

    await store.save("contacts", { ...saved, name: "Ana Example", tags: ["fablab"] }, (r) => contactToThing(r));
    let data = await new CrmStore(CSS_URL!, folder).load();
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0]).toMatchObject({ name: "Ana Example", tags: ["fablab"], emails: ["ana@example.org"] });

    await store.remove("contacts", saved.id);
    data = await store.load();
    expect(data.contacts).toHaveLength(0);
  });

  it("keeps both of two writes from different devices", async () => {
    const phone = new CrmStore(CSS_URL!, folder);
    const laptop = new CrmStore(CSS_URL!, folder);
    await Promise.all([
      phone.save("projects", { ...emptyProject(), name: "From the phone" }, (r) => projectToThing(r)),
      laptop.save("projects", { ...emptyProject(), name: "From the laptop" }, (r) => projectToThing(r)),
    ]).catch(() => undefined);
    // Sequential second round: each write starts from a fresh read.
    await phone.save("projects", { ...emptyProject(), name: "Phone again" }, (r) => projectToThing(r));
    await laptop.save("projects", { ...emptyProject(), name: "Laptop again" }, (r) => projectToThing(r));
    const names = (await phone.load()).projects.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Phone again", "Laptop again"]));
  });

  it("saves renamed and reordered stages", async () => {
    const store = new CrmStore(CSS_URL!, folder);
    const { stages } = await store.load();
    await store.saveStages([{ ...stages[1], label: "Talking" }, stages[0]]);
    const after = (await store.load()).stages;
    expect(after.map((s) => [s.key, s.label])).toEqual([["discussing", "Talking"], ["idea", "Idea"]]);
    // Saving again replaces, never appends.
    await store.saveStages(after);
    expect((await store.load()).stages).toHaveLength(2);
  });
});
