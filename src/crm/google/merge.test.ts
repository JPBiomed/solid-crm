import { describe, expect, it } from "vitest";
import { emptyContact } from "../model";
import { ContactIndex, emailKey, groupPeople, mergeInto, nameKey, phoneKey, tagsFor } from "./merge";
import { emptyPerson, type ImportPerson } from "./parse";

const person = (over: Partial<ImportPerson>): ImportPerson => ({ ...emptyPerson("s1"), ...over });

describe("keys", () => {
  it("treats Gmail's dots, plus-tags and googlemail.com as the same address", () => {
    expect(emailKey("Jane.Doe+news@GoogleMail.com")).toBe("janedoe@gmail.com");
    expect(emailKey("Jane.Doe@work.example")).toBe("jane.doe@work.example");
  });

  it("matches a phone number however it is written", () => {
    expect(phoneKey("+32 475 12 34 56")).toBe(phoneKey("0475/12.34.56"));
    expect(phoneKey("0032475123456")).toBe(phoneKey("0475123456"));
    expect(phoneKey("123")).toBe("");
  });

  it("ignores word order, case and accents in names", () => {
    expect(nameKey("Martin, Élodie")).toBe(nameKey("elodie martin"));
  });
});

describe("groupPeople", () => {
  it("joins the same person across accounts by any shared email or phone, transitively", () => {
    const groups = groupPeople([
      person({ sourceId: "personal", name: "Jane", emails: ["jane@gmail.com"] }),
      person({ sourceId: "work", name: "Jane Doe", emails: ["j.ane@gmail.com", "jane@work.example"], orgs: ["Work"] }),
      person({ sourceId: "file", name: "J. Doe", emails: ["jane@work.example"], phones: ["0475 12 34 56"] }),
      person({ sourceId: "work", name: "Someone Else", emails: ["else@x.example"] }),
    ]);
    expect(groups).toHaveLength(2);
    const jane = groups.find((g) => g.emails.includes("jane@gmail.com"))!;
    expect(jane.name).toBe("Jane Doe");
    expect(jane.emails).toEqual(["jane@gmail.com", "jane@work.example"]);
    expect(jane.sourceIds).toEqual(["personal", "work", "file"]);
    expect(jane.phones).toEqual(["0475 12 34 56"]);
  });

  it("prefers a saved contact's name over an Other contact's, and an address is never a name", () => {
    const [g] = groupPeople([
      person({ name: "jane@work.example", emails: ["jane@work.example"], other: true }),
      person({ name: "Jane Doe", emails: ["jane@work.example"] }),
    ]);
    expect(g.name).toBe("Jane Doe");
    expect(g.otherOnly).toBe(false);
  });

  it("gives the same key to the same person on every load", () => {
    const p = [person({ name: "A", emails: ["b@x.example", "a@x.example"] })];
    expect(groupPeople(p)[0].key).toBe(groupPeople([...p].reverse())[0].key);
  });
});

describe("matching and merging", () => {
  const existing = { ...emptyContact(), id: "c#1", name: "Jane Doe", emails: ["jane@work.example"], role: "Typed in the CRM", tags: ["vip"] };

  it("finds someone by email, then flags a full-name-only match as a suggestion", () => {
    const index = new ContactIndex([existing]);
    const [byEmail] = groupPeople([person({ name: "Other Name", emails: ["JANE@work.example"] })]);
    expect(index.match(byEmail)?.by).toBe("email");
    const [byName] = groupPeople([person({ name: "doe jane", emails: ["new@x.example"] })]);
    expect(index.match(byName)?.by).toBe("name");
    const [oneWord] = groupPeople([person({ name: "Jane", emails: ["new@x.example"] })]);
    expect(index.match(oneWord)).toBeNull();
  });

  it("recognises someone imported before by their Google id, even after an email changed", () => {
    const imported = { ...existing, emails: ["old@x.example"], externalIds: ["google:me@gmail.com:people/c1"] };
    const [c] = groupPeople([person({ externalId: "google:me@gmail.com:people/c1", emails: ["new@x.example"] })]);
    expect(new ContactIndex([imported]).match(c)?.by).toBe("import");
  });

  it("only adds: what was typed in the CRM is kept", () => {
    const [c] = groupPeople([person({ name: "J Doe", emails: ["jane@work.example", "jane@gmail.com"], role: "From Google", phones: ["0475 12 34 56"] })]);
    const { contact, changes } = mergeInto(existing, c, ["org#1"], ["personal"]);
    expect(contact.name).toBe("Jane Doe");
    expect(contact.role).toBe("Typed in the CRM");
    expect(contact.emails).toEqual(["jane@work.example", "jane@gmail.com"]);
    expect(contact.tags).toEqual(["vip", "personal"]);
    expect(changes).toEqual(["an email", "a phone", "an organization", "a tag"]);
  });

  it("keeps each label tied to the account it came from", () => {
    const [c] = groupPeople([
      person({ sourceId: "home", emails: ["a@x.example"], labels: ["Friends"] }),
      person({ sourceId: "work", emails: ["a@x.example"], labels: ["Partners", "Friends"] }),
      person({ sourceId: "file", emails: ["a@x.example"], labels: ["Makers"] }),
    ]);
    expect(tagsFor(c, { labelsAsTags: true, sourceTags: { home: ["personal"], work: ["mapsofmaking"] } })).toEqual([
      "personal/friends",
      "mapsofmaking/partners",
      "mapsofmaking/friends",
      "makers",
      "personal",
      "mapsofmaking",
    ]);
  });

  it("reports nothing when the CRM already has it all", () => {
    const [c] = groupPeople([person({ emails: ["jane@work.example"] })]);
    expect(mergeInto(existing, c, [], ["vip"]).changes).toEqual([]);
  });
});
