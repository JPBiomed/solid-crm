/**
 * The LinkedIn plugin's screen: people worth connecting with, by status, and
 * how to capture them from a phone or a computer.
 *
 * Only people added on purpose are here: there is no bulk import of the
 * LinkedIn network (Jason's choice). The records are ordinary contacts, so the
 * contact form, search and timeline all work on them; this screen adds the
 * status board and logs each step on the person's timeline.
 */
import { toast } from "../../ui/patterns";
import {
  byName,
  contactToThing,
  emptyInteraction,
  interactionToThing,
  LINKEDIN_STATUSES,
  localDate,
  matches,
  type Contact,
  type LinkedInStatus,
} from "../model";
import { registerRoute, shortId, type Ctx } from "../routes";
import { $, busy, esc, nameOf, renderScreen, tagChips } from "../ui";
import { STATUS_LABEL } from "./contacts";
import { bookmarkletSource, captureRoute, shortcutUrlPrefix } from "../linkedin/capture";

/** What moving someone to a status writes on their timeline. Interesting is the starting point, so it logs nothing. */
const STEP_TITLE: Partial<Record<LinkedInStatus, string>> = {
  "request-sent": "Sent a connection request on LinkedIn",
  connected: "Connected on LinkedIn",
  met: "Met in person",
};

export function onLinkedIn(c: Contact): boolean {
  return Boolean(c.linkedinStatus);
}

/** The contact after moving to `status`: Connected stamps today's date unless one is already set. */
export function withStatus(c: Contact, status: LinkedInStatus, today = localDate(new Date())): Contact {
  const next: Contact = { ...c, linkedinStatus: status };
  if ((status === "connected" || status === "met") && !c.connectedOn) next.connectedOn = today;
  return next;
}

async function move(ctx: Ctx, contact: Contact, status: LinkedInStatus): Promise<void> {
  if (contact.linkedinStatus === status) return;
  await ctx.store.save("contacts", withStatus(contact, status), (r) => contactToThing(r));
  const title = STEP_TITLE[status];
  const logged = title
    ? await ctx.store.save("interactions", { ...emptyInteraction([contact.id, ...contact.orgs]), channel: "linkedin" as const, title }, (r) =>
        interactionToThing(r)
      )
    : null;
  toast(`${contact.name} → ${STATUS_LABEL[status]}`, {
    undo: () =>
      void (async () => {
        await ctx.store.save("contacts", contact, (r) => contactToThing(r));
        if (logged) await ctx.store.remove("interactions", logged.id);
        await ctx.refresh();
      })(),
  });
  await ctx.refresh();
}

function renderCard(ctx: Ctx, c: Contact): string {
  const sub = [c.role, ...c.orgs.map((o) => nameOf(o, ctx.data))].filter(Boolean).join(" · ");
  const sid = esc(shortId(c.id));
  return `
    <li class="crm-card linkedin-card" data-id="${esc(c.id)}">
      <a class="crm-card-name" href="#/contacts/${encodeURIComponent(shortId(c.id))}">${esc(c.name || "(no name)")}</a>
      ${sub ? `<span class="hint">${esc(sub)}</span>` : ""}
      ${c.note ? `<span class="linkedin-card-note">${esc(c.note)}</span>` : ""}
      ${c.linkedin ? `<a class="hint" href="${esc(c.linkedin)}" target="_blank" rel="noopener">Open on LinkedIn</a>` : ""}
      ${tagChips(c.tags)}
      <label class="visually-hidden" for="status-${sid}">Status of ${esc(c.name)}</label>
      <select class="crm-move linkedin-move" id="status-${sid}">
        ${LINKEDIN_STATUSES.map((s) => `<option value="${s}"${s === c.linkedinStatus ? " selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
      </select>
    </li>`;
}

function renderSetup(): string {
  const origin = location.origin;
  return `
    <section class="stack crm-section" aria-labelledby="capture-h">
      <h2 id="capture-h">Capture people from LinkedIn</h2>
      <p class="hint">Each way opens the new-contact form with the profile filled in and the status set to Interesting. Someone already in your CRM opens their page instead.</p>
      <details class="linkedin-setup">
        <summary>Android phone</summary>
        <ol>
          <li>Open this CRM in Chrome and choose <strong>Add to home screen</strong> (or <strong>Install app</strong>) from the menu.</li>
          <li>In the LinkedIn app, open a profile, tap <strong>⋯</strong> then <strong>Share via</strong>, and pick <strong>Maps of Making CRM</strong>.</li>
          <li>Add a note on why they're interesting, then save.</li>
        </ol>
      </details>
      <details class="linkedin-setup">
        <summary>iPhone</summary>
        <p class="hint">iOS only lets apps from the App Store into the share menu, so a Shortcut does it for the CRM. You set it up once.</p>
        <ol>
          <li>Open the <strong>Shortcuts</strong> app and create a new shortcut named <strong>Add to CRM</strong>.</li>
          <li>Open its settings (ⓘ) and turn on <strong>Show in Share Sheet</strong>. Set it to receive <strong>URLs</strong> and <strong>Text</strong>.</li>
          <li>Add the action <strong>URL Encode</strong> on <em>Shortcut Input</em>.</li>
          <li>Add the action <strong>Text</strong> and paste this, then insert <em>URL Encoded Text</em> at the end:
            <div class="linkedin-copy">
              <code id="shortcut-prefix">${esc(shortcutUrlPrefix(origin))}</code>
              <button type="button" class="ghost" data-copy="#shortcut-prefix">Copy</button>
            </div>
          </li>
          <li>Add the action <strong>Open URLs</strong> on that text.</li>
          <li>In the LinkedIn app, open a profile, tap <strong>⋯</strong> then <strong>Share via</strong>, and pick <strong>Add to CRM</strong>.</li>
        </ol>
      </details>
      <details class="linkedin-setup">
        <summary>Computer</summary>
        <p>Drag this button to your bookmarks bar, then click it on anyone's LinkedIn profile. It also reads their headline.</p>
        <p><a class="crm-button ghost" id="bookmarklet" href="${esc(bookmarkletSource(origin))}">Add to CRM</a></p>
      </details>
    </section>`;
}

function renderLinkedIn(ctx: Ctx): void {
  const q = ctx.query.get("q") ?? "";
  const people = ctx.data.contacts
    .filter(onLinkedIn)
    .filter((c) => matches(q, c.name, c.role, c.tags, c.note))
    .sort(byName);
  const total = ctx.data.contacts.filter(onLinkedIn).length;

  renderScreen(ctx, {
    title: "To connect",
    eyebrow: "LinkedIn",
    wide: true,
    body: `
      <form id="linkedin-add" class="crm-row linkedin-add">
        <div class="field">
          <label for="f-profile">Add from a profile link</label>
          <input id="f-profile" name="profile" type="text" inputmode="url" placeholder="https://www.linkedin.com/in/…" required />
        </div>
        <div><button type="submit">Add</button></div>
      </form>
      ${
        total === 0
          ? `<div class="empty-state"><h2>Nobody to connect with yet</h2><p class="lead">When you spot someone interesting on LinkedIn, share their profile to the CRM. They'll show up here to follow from Interesting to Met.</p></div>`
          : `
      <form class="crm-filter" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search people" aria-label="Search people" /></form>
      <div class="crm-board">
        ${LINKEDIN_STATUSES.map((s) => {
          const items = people.filter((c) => c.linkedinStatus === s);
          return `
          <section class="crm-column" aria-label="${STATUS_LABEL[s]}">
            <h2 class="crm-column-head"><span>${STATUS_LABEL[s]}</span><span class="meta">${items.length}</span></h2>
            <ul class="crm-cards">${items.map((c) => renderCard(ctx, c)).join("")}</ul>
          </section>`;
        }).join("")}
      </div>`
      }
      ${renderSetup()}`,
  });

  const add = $(ctx.app, "#linkedin-add") as HTMLFormElement;
  add.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = String(new FormData(add).get("profile") ?? "").trim();
    if (!/linkedin\.com\/in\//i.test(text)) {
      toast("Paste a LinkedIn profile address (linkedin.com/in/…).");
      return;
    }
    ctx.go(captureRoute({ text }));
  });

  ctx.app.querySelector<HTMLFormElement>(".crm-filter")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = new FormData(e.target as HTMLFormElement).get("q");
    ctx.go(`/linkedin${value ? `?q=${encodeURIComponent(String(value))}` : ""}`);
  });

  ctx.app.querySelectorAll<HTMLSelectElement>(".linkedin-move").forEach((select) => {
    select.addEventListener("change", () => {
      const c = ctx.data.contacts.find((x) => x.id === select.closest<HTMLElement>("[data-id]")!.dataset.id);
      if (c) busy(null, () => move(ctx, c, select.value as LinkedInStatus));
    });
  });

  ctx.app.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = ctx.app.querySelector(button.dataset.copy!)?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied.");
      } catch {
        toast("Couldn't copy here. Select the text and copy it by hand.");
      }
    });
  });

  // A bookmarklet only works dragged to the bookmarks bar; clicked here it would run on the CRM itself.
  ctx.app.querySelector("#bookmarklet")?.addEventListener("click", (e) => {
    e.preventDefault();
    toast("Drag this button to your bookmarks bar, then use it on a LinkedIn profile.");
  });
}

registerRoute({ pattern: "/linkedin", nav: "LinkedIn", navOrder: 25, render: renderLinkedIn });
