import { describe, expect, it } from "vitest";
import { emptyContact } from "../model";
import { onLinkedIn, withStatus } from "./linkedin";

describe("withStatus", () => {
  const c = { ...emptyContact(), name: "Jane", linkedinStatus: "request-sent" as const };

  it("stamps the connection date when someone connects", () => {
    expect(withStatus(c, "connected", "2026-11-18")).toMatchObject({ linkedinStatus: "connected", connectedOn: "2026-11-18" });
  });

  it("keeps a date already set", () => {
    expect(withStatus({ ...c, connectedOn: "2025-01-02" }, "met", "2026-11-18").connectedOn).toBe("2025-01-02");
  });

  it("sets no date before connecting", () => {
    expect(withStatus(c, "interesting", "2026-11-18").connectedOn).toBe("");
  });
});

describe("onLinkedIn", () => {
  it("lists people with a status, not every contact with a profile link", () => {
    expect(onLinkedIn({ ...emptyContact(), linkedin: "https://www.linkedin.com/in/a/" })).toBe(false);
    expect(onLinkedIn({ ...emptyContact(), linkedinStatus: "met" })).toBe(true);
  });
});
