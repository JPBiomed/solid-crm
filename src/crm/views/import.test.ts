import { describe, expect, it } from "vitest";
import { defaultAccountTags } from "./import";

describe("defaultAccountTags", () => {
  it("tags a personal Gmail 'personal' and a work account with its domain", () => {
    expect(defaultAccountTags("me@gmail.com")).toEqual(["personal"]);
    expect(defaultAccountTags("jason@mapsofmaking.org")).toEqual(["mapsofmaking"]);
    expect(defaultAccountTags("j@team.fixmymedtech.eu")).toEqual(["team.fixmymedtech"]);
  });
});
