import { describe, expect, it } from "vitest";
import { parseContactsCsv, parseContactsFile, parseCsvRows, parseVcards } from "./parse";

const GOOGLE_VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Élodie Martin",
  "N:Martin;Élodie;;;",
  "EMAIL;TYPE=INTERNET;TYPE=WORK:elodie@fablab.example",
  "EMAIL;TYPE=INTERNET:Elodie.Martin@gmail.com",
  "TEL;TYPE=CELL:+32 475 12 34 56",
  "ORG:Fablab Brussels;Workshop",
  "TITLE:Lab manager",
  "item1.URL:https\\://www.linkedin.com/in/Elodie-Martin/",
  "item1.X-ABLabel:LinkedIn",
  "NOTE:Met at the maker faire\\, 2024.\\nLikes maps.",
  "CATEGORIES:myContacts,starred,Fix My MedTech",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Dupr=C3=A9;Jean;;;",
  "TEL;CELL:0475/99.88.77",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "NOTE:nobody",
  "END:VCARD",
].join("\r\n");

describe("vCard", () => {
  it("reads Google's export: names, addresses, org, links, notes and labels", () => {
    const [a, b] = parseVcards(GOOGLE_VCF, "file:a.vcf");
    expect(a.name).toBe("Élodie Martin");
    expect(a.emails).toEqual(["elodie@fablab.example", "Elodie.Martin@gmail.com"]);
    expect(a.phones).toEqual(["+32 475 12 34 56"]);
    expect(a.orgs).toEqual(["Fablab Brussels"]);
    expect(a.role).toBe("Lab manager");
    expect(a.linkedin).toBe("https://www.linkedin.com/in/elodie-martin/");
    expect(a.links).toEqual([]);
    expect(a.note).toBe("Met at the maker faire, 2024.\nLikes maps.");
    expect(a.labels).toEqual(["starred", "Fix My MedTech"]);
    expect(b.name).toBe("Jean Dupré");
  });

  it("drops entries with nothing to recognise them by", () => {
    expect(parseVcards(GOOGLE_VCF, "f")).toHaveLength(2);
  });

  it("joins folded lines", () => {
    const [p] = parseVcards("BEGIN:VCARD\nFN:Ana\nNOTE:a long\n  note\nEND:VCARD", "f");
    expect(p.note).toBe("a long note");
  });
});

describe("CSV", () => {
  it("keeps commas, quotes and line breaks inside quoted cells", () => {
    expect(parseCsvRows('a,"b, ""c""",d\r\n"x\ny",z\n')).toEqual([
      ["a", 'b, "c"', "d"],
      ["x\ny", "z"],
    ]);
  });

  it("reads Google's current CSV, with several values per cell", () => {
    const csv = [
      "First Name,Middle Name,Last Name,Organization Name,Organization Title,Labels,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Website 1 - Value,Notes",
      'Ben,,Sample,Guild,Lead,* myContacts ::: Makers,* Work,ben@guild.example ::: ben@home.example,,+32 2 555 00 00,https://guild.example,"Hi, there"',
    ].join("\n");
    const [p] = parseContactsCsv(csv, "file:g.csv");
    expect(p).toMatchObject({
      name: "Ben Sample",
      orgs: ["Guild"],
      role: "Lead",
      labels: ["Makers"],
      emails: ["ben@guild.example", "ben@home.example"],
      phones: ["+32 2 555 00 00"],
      links: ["https://guild.example"],
      note: "Hi, there",
    });
  });

  it("reads Google's older CSV and Outlook's", () => {
    const old = "Name,Given Name,Family Name,Group Membership,E-mail 1 - Value,Organization 1 - Name\nCara Old,Cara,Old,Friends ::: * myContacts,cara@x.example,Org";
    expect(parseContactsCsv(old, "f")[0]).toMatchObject({ name: "Cara Old", labels: ["Friends"], orgs: ["Org"] });
    const outlook = "First Name,Last Name,E-mail Address,Company,Job Title,Mobile Phone\nDan,Out,dan@o.example,Acme,CTO,0470 00 00 00";
    expect(parseContactsCsv(outlook, "f")[0]).toMatchObject({ name: "Dan Out", emails: ["dan@o.example"], orgs: ["Acme"], role: "CTO", phones: ["0470 00 00 00"] });
  });

  it("picks the format from the content, not the file name", () => {
    expect(parseContactsFile("﻿BEGIN:VCARD\nFN:A\nEND:VCARD", "f")[0].name).toBe("A");
    expect(parseContactsFile("Name\nB", "f")[0].name).toBe("B");
  });
});
