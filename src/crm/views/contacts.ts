import { toast } from "../../ui/patterns";
import {
  byName,
  contactToThing,
  emptyContact,
  emptyOrganization,
  extractLinkedIn,
  findContactByLinkedIn,
  LINKEDIN_STATUSES,
  matches,
  normalizeLinkedIn,
  normalizeMatrixId,
  organizationToThing,
  parseList,
  parseTags,
  tagCounts,
  type Contact,
  type LinkedInStatus,
} from "../model";
import { registerRoute, shortId, type Ctx } from "../routes";
import {
  $,
  busy,
  byShortId,
  esc,
  field,
  formValue,
  formValues,
  notFound,
  pickField,
  recordLinks,
  renderFilterBar,
  renderScreen,
  renderTasksSection,
  renderTimeline,
  selectField,
  tagChips,
  wireDelete,
  wireFilterBar,
  wirePickFilters,
  wireTasks,
  wireTimeline,
} from "../ui";

export const STATUS_LABEL: Record<LinkedInStatus, string> = {
  interesting: "Interesting",
  "request-sent": "Request sent",
  connected: "Connected",
  met: "Met",
};

function orgNames(c: Contact, ctx: Ctx): string[] {
  return c.orgs.map((o) => ctx.data.organizations.find((x) => x.id === o)?.name ?? "");
}

function renderContactRows(ctx: Ctx): string {
  const q = ctx.query.get("q") ?? "";
  const tag = ctx.query.get("tag") ?? "";
  const list = ctx.data.contacts
    .filter((c) => !tag || c.tags.includes(tag))
    .filter((c) => matches(q, c.name, c.role, c.emails, c.tags, c.note, c.matrixId, orgNames(c, ctx)))
    .sort(byName);
  if (list.length === 0) {
    return ctx.data.contacts.length === 0
      ? `<div class="empty-state"><h2>No contacts yet</h2><p class="lead">Add the people you work with on Maps of Making — makers, fablab managers, partners.</p></div>`
      : `<p class="hint">No contact matches.</p>`;
  }
  return `
    <p class="hint">${list.length} of ${ctx.data.contacts.length}</p>
    <ul class="crm-list">
      ${list
        .map(
          (c) => `
        <li>
          <a class="crm-list-name" href="#/contacts/${encodeURIComponent(shortId(c.id))}">${esc(c.name || "(no name)")}</a>
          <span class="crm-list-sub">${esc([c.role, ...orgNames(c, ctx)].filter(Boolean).join(" · "))}</span>
          ${c.linkedinStatus ? `<span class="crm-status">${esc(STATUS_LABEL[c.linkedinStatus])}</span>` : ""}
          ${tagChips(c.tags)}
        </li>`
        )
        .join("")}
    </ul>`;
}

function renderList(ctx: Ctx): void {
  renderScreen(ctx, {
    title: "Contacts",
    actions: `<a class="crm-button" href="#/contacts/new">New contact</a>`,
    body: `
      ${renderFilterBar(ctx, "/contacts", tagCounts(ctx.data.contacts))}
      <div id="results">${renderContactRows(ctx)}</div>`,
  });
  wireFilterBar(ctx);
  // On the form, not on #app: #app outlives every screen and would collect one listener per visit.
  $(ctx.app, ".crm-filter").addEventListener("crm-filter", () => ($(ctx.app, "#results").innerHTML = renderContactRows(ctx)));
}

function renderDetail(ctx: Ctx): void {
  const c = byShortId(ctx.data.contacts, ctx.params.id);
  if (!c) return notFound(ctx, "Contact", "/contacts");
  const projects = ctx.data.projects.filter((p) => p.members.includes(c.id));
  const facts: [string, string][] = [
    ["Role", esc(c.role)],
    ["Organization", recordLinks(c.orgs, ctx.data)],
    ["Email", c.emails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join("<br>")],
    ["Phone", c.phones.map((p) => `<a href="tel:${esc(p)}">${esc(p)}</a>`).join("<br>")],
    ["Matrix", c.matrixId ? `<a href="https://matrix.to/#/${esc(c.matrixId)}" target="_blank" rel="noopener">${esc(c.matrixId)}</a>` : ""],
    [
      "LinkedIn",
      c.linkedin
        ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">Profile</a>${
            c.linkedinStatus ? ` · ${esc(STATUS_LABEL[c.linkedinStatus])}` : ""
          }${c.connectedOn ? ` · since ${esc(c.connectedOn)}` : ""}`
        : "",
    ],
    ["Links", c.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, ""))}</a>`).join("<br>")],
    ["Projects", recordLinks(projects.map((p) => p.id), ctx.data)],
    ["Tags", tagChips(c.tags, "#/contacts")],
  ];
  renderScreen(ctx, {
    eyebrow: "Contact",
    title: c.name || "(no name)",
    actions: `
      <a class="crm-button ghost" href="#/contacts/${encodeURIComponent(shortId(c.id))}/edit">Edit</a>
      <button class="ghost" id="delete">Delete</button>`,
    body: `
      <dl class="crm-facts">
        ${facts
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><dt class="label-mono">${k}</dt><dd>${v}</dd></div>`)
          .join("")}
      </dl>
      ${c.note ? `<p class="crm-note">${esc(c.note)}</p>` : ""}
      ${renderTasksSection(ctx.data, c.id)}
      ${renderTimeline(ctx.data, c.id)}`,
  });
  wireTasks(ctx);
  // An interaction with someone is also one with their organizations.
  wireTimeline(ctx, c.orgs);
  wireDelete(ctx, document.querySelector("#delete"), "contacts", c.id, c.name, "/contacts");
}

/**
 * Prefill from the query string — the entry point for the LinkedIn bookmarklet
 * and the phone's share menu: name, role, linkedin (or text: any shared text
 * containing a LinkedIn URL), email, org (matched by name, created if new),
 * tags, note, status, source.
 */
function prefill(ctx: Ctx): { contact: Contact; newOrg: string } {
  const q = ctx.query;
  const c = emptyContact();
  c.name = q.get("name") ?? "";
  c.role = q.get("role") ?? q.get("headline") ?? "";
  c.linkedin = normalizeLinkedIn(q.get("linkedin") ?? "") || extractLinkedIn(`${q.get("linkedin") ?? ""} ${q.get("text") ?? ""} ${q.get("url") ?? ""}`);
  c.emails = parseList(q.get("email") ?? "");
  c.tags = parseTags(q.get("tags") ?? "");
  c.note = q.get("note") ?? "";
  c.matrixId = normalizeMatrixId(q.get("matrix") ?? "");
  const status = q.get("status") as LinkedInStatus;
  if (LINKEDIN_STATUSES.includes(status)) c.linkedinStatus = status;
  c.source = q.get("source") ?? "manual";
  let newOrg = "";
  const orgName = (q.get("org") ?? "").trim();
  if (orgName) {
    const org = ctx.data.organizations.find((o) => o.name.toLowerCase() === orgName.toLowerCase());
    if (org) c.orgs = [org.id];
    else newOrg = orgName;
  }
  return { contact: c, newOrg };
}

function renderForm(ctx: Ctx, mode: "new" | "edit"): void {
  let contact: Contact;
  let newOrg = "";
  if (mode === "edit") {
    const found = byShortId(ctx.data.contacts, ctx.params.id);
    if (!found) return notFound(ctx, "Contact", "/contacts");
    contact = found;
  } else {
    ({ contact, newOrg } = prefill(ctx));
    // Already known? Open that person rather than making a duplicate.
    const existing = contact.linkedin && findContactByLinkedIn(ctx.data.contacts, contact.linkedin);
    if (existing) {
      toast(`${existing.name} is already in your contacts.`);
      ctx.go(`/contacts/${encodeURIComponent(shortId(existing.id))}`);
      return;
    }
  }

  const orgOptions = [...ctx.data.organizations].sort(byName).map((o) => ({ value: o.id, label: o.name }));
  renderScreen(ctx, {
    eyebrow: mode === "new" ? "New contact" : "Edit contact",
    title: mode === "new" ? contact.name || "New contact" : contact.name,
    body: `
      <form id="contact-form" class="stack crm-form">
        ${field("Name", "name", contact.name, { required: true })}
        ${field("Role or headline", "role", contact.role)}
        ${pickField("Organizations", "orgs", contact.orgs, orgOptions)}
        ${field("New organization", "newOrg", newOrg, { hint: "Type a name to create it and link this person to it." })}
        ${field("Email", "emails", contact.emails.join("\n"), { textarea: true, hint: "One per line. Used to match Gmail threads." })}
        ${field("Phone", "phones", contact.phones.join("\n"), { textarea: true })}
        ${field("Matrix ID", "matrixId", contact.matrixId, { placeholder: "@name:matrix.org", hint: "Used to match Matrix chats." })}
        <div class="crm-row">
          ${field("LinkedIn profile", "linkedin", contact.linkedin, { type: "url", placeholder: "https://www.linkedin.com/in/…" })}
          ${selectField("LinkedIn status", "linkedinStatus", contact.linkedinStatus, [
            { value: "", label: "—" },
            ...LINKEDIN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ])}
          ${field("Connected on", "connectedOn", contact.connectedOn, { type: "date" })}
        </div>
        ${field("Other links", "links", contact.links.join("\n"), { textarea: true, hint: "One per line: website, portfolio, wiki page." })}
        ${field("Tags", "tags", contact.tags.join(", "), { hint: "Comma separated, e.g. fablab, brussels, funder." })}
        ${field("Note", "note", contact.note, { textarea: true })}
        <div class="crm-actions">
          <button type="submit">${mode === "new" ? "Add contact" : "Save"}</button>
          <a href="${mode === "new" ? "#/contacts" : `#/contacts/${encodeURIComponent(shortId(contact.id))}`}">Cancel</a>
        </div>
      </form>`,
  });
  wirePickFilters(ctx.app);

  const form = $(ctx.app, "#contact-form") as HTMLFormElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = new FormData(form);
    const linkedinRaw = formValue(f, "linkedin");
    const linkedin = normalizeLinkedIn(linkedinRaw);
    if (linkedinRaw && !linkedin) {
      toast("That LinkedIn address doesn't look like a profile (linkedin.com/in/…).");
      return;
    }
    const matrixRaw = formValue(f, "matrixId");
    const matrixId = normalizeMatrixId(matrixRaw);
    if (matrixRaw && !matrixId) {
      toast("A Matrix ID looks like @name:server.org.");
      return;
    }
    const updated: Contact = {
      ...contact,
      name: formValue(f, "name"),
      role: formValue(f, "role"),
      orgs: formValues(f, "orgs"),
      emails: parseList(formValue(f, "emails")),
      phones: parseList(formValue(f, "phones")),
      matrixId,
      linkedin,
      linkedinStatus: formValue(f, "linkedinStatus") as Contact["linkedinStatus"],
      connectedOn: formValue(f, "connectedOn"),
      links: parseList(formValue(f, "links")),
      tags: parseTags(formValue(f, "tags")),
      note: formValue(f, "note"),
    };
    const orgName = formValue(f, "newOrg");
    busy(form.querySelector("button[type=submit]"), async () => {
      if (orgName) {
        const existing = ctx.data.organizations.find((o) => o.name.toLowerCase() === orgName.toLowerCase());
        const org = existing ?? (await ctx.store.save("organizations", { ...emptyOrganization(), name: orgName }, (r) => organizationToThing(r)));
        if (!updated.orgs.includes(org.id)) updated.orgs.push(org.id);
      }
      const saved = await ctx.store.save("contacts", updated, (r) => contactToThing(r));
      toast(mode === "new" ? `Added ${saved.name}.` : "Saved.");
      ctx.go(`/contacts/${encodeURIComponent(shortId(saved.id))}`);
    });
  });
}

registerRoute({ pattern: "/contacts", nav: "Contacts", navOrder: 20, render: renderList });
registerRoute({ pattern: "/contacts/new", render: (ctx) => renderForm(ctx, "new") });
registerRoute({ pattern: "/contacts/:id", render: renderDetail });
registerRoute({ pattern: "/contacts/:id/edit", render: (ctx) => renderForm(ctx, "edit") });
