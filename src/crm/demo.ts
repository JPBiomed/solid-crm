/**
 * Sample records for `?demo`. Invented people and places — nothing here is
 * anyone's real data.
 */
import {
  contactToThing,
  emptyContact,
  emptyInteraction,
  emptyOrganization,
  emptyProject,
  emptyTask,
  interactionToThing,
  localDate,
  organizationToThing,
  projectToThing,
  taskToThing,
} from "./model";
import type { CrmStore } from "./store";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export async function seedDemo(store: CrmStore): Promise<void> {
  const [lab, guild, fund] = await store.saveMany(
    "organizations",
    [
      { ...emptyOrganization(), name: "Northside Fablab", location: "Brussels", website: "https://example.org/northside", tags: ["fablab", "brussels"] },
      { ...emptyOrganization(), name: "Riverside Makers Guild", location: "Ghent", tags: ["makerspace"] },
      { ...emptyOrganization(), name: "Open Workshop Fund", location: "Online", tags: ["funder"] },
    ],
    (r) => organizationToThing(r)
  );
  const [ana, ben, chloe] = await store.saveMany(
    "contacts",
    [
      { ...emptyContact(), name: "Ana Example", role: "Lab manager", orgs: [lab.id], emails: ["ana@example.org"], matrixId: "@ana:example.org", tags: ["fablab", "brussels"] },
      { ...emptyContact(), name: "Ben Sample", role: "Woodworking lead", orgs: [guild.id], emails: ["ben@example.org"], tags: ["makerspace"] },
      { ...emptyContact(), name: "Chloé Placeholder", role: "Programme officer", orgs: [fund.id], linkedin: "https://www.linkedin.com/in/chloe-placeholder/", linkedinStatus: "interesting" as const, tags: ["funder"], source: "linkedin" },
    ],
    (r) => contactToThing(r)
  );
  const [mapping, grant] = await store.saveMany(
    "projects",
    [
      { ...emptyProject("active"), name: "Map Brussels makerspaces", members: [lab.id, ana.id], tags: ["mapping"] },
      { ...emptyProject("proposal"), name: "Workshop grant application", members: [fund.id, chloe.id], tags: ["grant"] },
      { ...emptyProject("idea"), name: "Ghent tool library partnership", members: [guild.id, ben.id] },
    ],
    (r) => projectToThing(r)
  );
  const yesterday = new Date(Date.now() - 86400000);
  await store.saveMany(
    "interactions",
    [
      { ...emptyInteraction([ana.id, lab.id, mapping.id]), channel: "meeting" as const, date: yesterday, title: "Walked through the map data model", body: "Ana will share the list of member workshops." },
      { ...emptyInteraction([chloe.id, fund.id, grant.id]), channel: "email" as const, date: new Date(Date.now() - 4 * 86400000), title: "Call for proposals details" },
    ],
    (r) => interactionToThing(r)
  );
  await store.saveMany(
    "tasks",
    [
      { ...emptyTask([grant.id, chloe.id]), title: "Send the draft budget", due: daysFromNow(2) },
      { ...emptyTask([ana.id]), title: "Follow up on the workshop list", due: daysFromNow(-1) },
      { ...emptyTask([ben.id]), title: "Ask Ben about the tool inventory", due: daysFromNow(10) },
    ],
    (r) => taskToThing(r)
  );
}
