import { describe, expect, it } from "vitest";
import { fromGooglePerson, groupLabels } from "./people";

describe("People API", () => {
  const groups = groupLabels([
    { resourceName: "contactGroups/myContacts", formattedName: "My Contacts", groupType: "SYSTEM_CONTACT_GROUP" },
    { resourceName: "contactGroups/starred", formattedName: "Starred", groupType: "SYSTEM_CONTACT_GROUP" },
    { resourceName: "contactGroups/abc", name: "Fix My MedTech", formattedName: "Fix My MedTech", groupType: "USER_CONTACT_GROUP" },
  ]);

  it("keeps user labels and Starred, not Google's other built-in groups", () => {
    expect([...groups.values()]).toEqual(["Starred", "Fix My MedTech"]);
  });

  it("maps a person, with an id that names the account", () => {
    const p = fromGooglePerson(
      {
        resourceName: "people/c42",
        names: [{ displayName: "Ana Example" }],
        emailAddresses: [{ value: "ana@x.example" }],
        phoneNumbers: [{ value: "0475 12 34 56", canonicalForm: "+32475123456" }],
        organizations: [{ name: "Lab", title: "Manager" }],
        urls: [{ value: "linkedin.com/in/ana" }],
        memberships: [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/abc" } }, { contactGroupMembership: { contactGroupResourceName: "contactGroups/myContacts" } }],
      },
      "me@work.example",
      "google:me@work.example",
      groups
    );
    expect(p).toMatchObject({
      externalId: "google:me@work.example:people/c42",
      name: "Ana Example",
      emails: ["ana@x.example"],
      phones: ["+32475123456"],
      orgs: ["Lab"],
      role: "Manager",
      linkedin: "https://www.linkedin.com/in/ana/",
      labels: ["Fix My MedTech"],
      other: false,
    });
  });

  it("labels Other contacts so they can be filtered", () => {
    const p = fromGooglePerson({ resourceName: "otherContacts/c1", emailAddresses: [{ value: "x@y.example" }] }, "me@gmail.com", "s", groups, true);
    expect(p.labels).toEqual(["Other contacts"]);
    expect(p.other).toBe(true);
  });
});
