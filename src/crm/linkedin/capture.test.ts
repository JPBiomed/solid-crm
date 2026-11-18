import { describe, expect, it } from "vitest";
import { extractLinkedIn } from "../model";
import { bookmarkletSource, captureRoute, nameFromShare, shareTargetRoute, shortcutUrlPrefix } from "./capture";

const ANDROID_SHARE =
  "Check out Jane Doe’s profile on LinkedIn https://www.linkedin.com/in/jane-doe-1a2b3c?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app";

function queryOf(route: string): URLSearchParams {
  return new URLSearchParams(route.slice(route.indexOf("?") + 1));
}

describe("nameFromShare", () => {
  it("reads the name from the LinkedIn app's share sentence", () => {
    expect(nameFromShare(ANDROID_SHARE)).toBe("Jane Doe");
    expect(nameFromShare("Check out Ana's profile on LinkedIn https://linkedin.com/in/ana")).toBe("Ana");
  });

  it("reads the French and Dutch sentences", () => {
    expect(nameFromShare("Découvrez le profil de Marc Dupont sur LinkedIn https://…")).toBe("Marc Dupont");
    expect(nameFromShare("Bekijk het profiel van Els Peeters op LinkedIn https://…")).toBe("Els Peeters");
  });

  it("falls back to a page title", () => {
    expect(nameFromShare("https://www.linkedin.com/in/x", "Jane Doe | LinkedIn")).toBe("Jane Doe");
  });

  it("gives nothing rather than a wrong name", () => {
    expect(nameFromShare("https://www.linkedin.com/in/jane-doe")).toBe("");
    expect(nameFromShare("Look at this")).toBe("");
  });
});

describe("shareTargetRoute", () => {
  it("turns an Android share into the prefill route, with capture defaults", () => {
    const route = shareTargetRoute("/share-target", `?text=${encodeURIComponent(ANDROID_SHARE)}`)!;
    expect(route.startsWith("/contacts/new?")).toBe(true);
    const q = queryOf(route);
    expect(q.get("name")).toBe("Jane Doe");
    expect(q.get("source")).toBe("linkedin");
    expect(q.get("status")).toBe("interesting");
    // The core's prefill finds the profile in the text.
    expect(extractLinkedIn(q.get("text")!)).toBe("https://www.linkedin.com/in/jane-doe-1a2b3c/");
  });

  it("keeps a URL shared in its own field", () => {
    const q = queryOf(shareTargetRoute("/share-target", "?url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fbob")!);
    expect(extractLinkedIn(q.get("text")!)).toBe("https://www.linkedin.com/in/bob/");
  });

  it("ignores every other address, including the sign-in return", () => {
    expect(shareTargetRoute("/", "?code=abc&state=def")).toBeNull();
    expect(shareTargetRoute("/", "?text=hello")).toBeNull();
    expect(shareTargetRoute("/share-target", "")).toBeNull();
  });
});

describe("captureRoute", () => {
  it("omits the name when it cannot be read", () => {
    const q = queryOf(captureRoute({ url: "https://www.linkedin.com/in/bob" }));
    expect(q.has("name")).toBe(false);
  });
});

describe("shortcutUrlPrefix", () => {
  it("ends with text= so the Shortcut can append the shared text", () => {
    expect(shortcutUrlPrefix("https://crm.example.org/")).toBe(
      "https://crm.example.org/#/contacts/new?source=linkedin&status=interesting&text="
    );
  });
});

describe("bookmarkletSource", () => {
  it("is a single-line javascript: URL that opens this CRM", () => {
    const src = bookmarkletSource("https://crm.example.org");
    expect(src.startsWith("javascript:")).toBe(true);
    expect(src).not.toContain("\n");
    expect(src).toContain("https://crm.example.org/#/contacts/new?source=linkedin&status=interesting");
    // It must at least parse as JavaScript.
    expect(() => new Function(src.slice("javascript:".length))).not.toThrow();
  });
});
