import { describe, expect, it } from "vitest";
import { matchPattern, parseHash, shortId } from "./routes";

describe("routes", () => {
  it("parses a hash with a query", () => {
    const { path, query } = parseHash("#/contacts/new?name=Jane%20Doe&linkedin=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fjane");
    expect(path).toBe("/contacts/new");
    expect(query.get("name")).toBe("Jane Doe");
    expect(query.get("linkedin")).toBe("https://www.linkedin.com/in/jane");
  });

  it("treats an empty hash as home", () => {
    expect(parseHash("").path).toBe("/");
    expect(parseHash("#").path).toBe("/");
  });

  it("matches parameters, and only whole segments", () => {
    expect(matchPattern("/contacts/:id", "/contacts/abc")).toEqual({ id: "abc" });
    expect(matchPattern("/contacts/:id", "/contacts/abc/edit")).toBeNull();
    expect(matchPattern("/contacts", "/contactsx")).toBeNull();
  });

  it("takes the short id from a record IRI", () => {
    expect(shortId("https://pod.example/crm/contacts.ttl#k3j9")).toBe("k3j9");
  });
});
