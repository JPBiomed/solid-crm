import { toast } from "../../ui/patterns";
import { byName, emptyOrganization, matches, organizationToThing, parseTags, tagCounts, type Organization } from "../model";
import { registerRoute, shortId, type Ctx } from "../routes";
import {
  $,
  busy,
  byShortId,
  esc,
  field,
  formValue,
  notFound,
  recordLinks,
  renderFilterBar,
  renderScreen,
  renderTasksSection,
  renderTimeline,
  tagChips,
  wireDelete,
  wireFilterBar,
  wireTasks,
  wireTimeline,
} from "../ui";

const peopleOf = (o: Organization, ctx: Ctx) => ctx.data.contacts.filter((c) => c.orgs.includes(o.id)).sort(byName);

function renderRows(ctx: Ctx): string {
  const q = ctx.query.get("q") ?? "";
  const tag = ctx.query.get("tag") ?? "";
  const list = ctx.data.organizations
    .filter((o) => !tag || o.tags.includes(tag))
    .filter((o) => matches(q, o.name, o.location, o.tags, o.note, o.website))
    .sort(byName);
  if (list.length === 0) {
    return ctx.data.organizations.length === 0
      ? `<div class="empty-state"><h2>No organizations yet</h2><p class="lead">Makerspaces, fablabs, partners and funders. You can also create one from a contact's form.</p></div>`
      : `<p class="hint">No organization matches.</p>`;
  }
  return `
    <p class="hint">${list.length} of ${ctx.data.organizations.length}</p>
    <ul class="crm-list">
      ${list
        .map((o) => {
          const n = peopleOf(o, ctx).length;
          return `
        <li>
          <a class="crm-list-name" href="#/organizations/${encodeURIComponent(shortId(o.id))}">${esc(o.name)}</a>
          <span class="crm-list-sub">${esc([o.location, n ? `${n} ${n === 1 ? "person" : "people"}` : ""].filter(Boolean).join(" · "))}</span>
          ${tagChips(o.tags)}
        </li>`;
        })
        .join("")}
    </ul>`;
}

function renderList(ctx: Ctx): void {
  renderScreen(ctx, {
    title: "Organizations",
    actions: `<a class="crm-button" href="#/organizations/new">New organization</a>`,
    body: `
      ${renderFilterBar(ctx, "/organizations", tagCounts(ctx.data.organizations))}
      <div id="results">${renderRows(ctx)}</div>`,
  });
  wireFilterBar(ctx);
  $(ctx.app, ".crm-filter").addEventListener("crm-filter", () => ($(ctx.app, "#results").innerHTML = renderRows(ctx)));
}

function renderDetail(ctx: Ctx): void {
  const o = byShortId(ctx.data.organizations, ctx.params.id);
  if (!o) return notFound(ctx, "Organization", "/organizations");
  const people = peopleOf(o, ctx);
  const projects = ctx.data.projects.filter((p) => p.members.includes(o.id));
  const facts: [string, string][] = [
    ["Website", o.website ? `<a href="${esc(o.website)}" target="_blank" rel="noopener">${esc(o.website.replace(/^https?:\/\//, ""))}</a>` : ""],
    ["Location", esc(o.location)],
    ["People", people.map((c) => `<a href="#/contacts/${encodeURIComponent(shortId(c.id))}">${esc(c.name)}</a>${c.role ? ` <span class="hint">${esc(c.role)}</span>` : ""}`).join("<br>")],
    ["Projects", recordLinks(projects.map((p) => p.id), ctx.data)],
    ["Tags", tagChips(o.tags, "#/organizations")],
  ];
  renderScreen(ctx, {
    eyebrow: "Organization",
    title: o.name,
    actions: `
      <a class="crm-button ghost" href="#/contacts/new?org=${encodeURIComponent(o.name)}">Add person</a>
      <a class="crm-button ghost" href="#/organizations/${encodeURIComponent(shortId(o.id))}/edit">Edit</a>
      <button class="ghost" id="delete">Delete</button>`,
    body: `
      <dl class="crm-facts">
        ${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt class="label-mono">${k}</dt><dd>${v}</dd></div>`).join("")}
      </dl>
      ${o.note ? `<p class="crm-note">${esc(o.note)}</p>` : ""}
      ${renderTasksSection(ctx.data, o.id)}
      ${renderTimeline(ctx.data, o.id)}`,
  });
  wireTasks(ctx);
  wireTimeline(ctx);
  wireDelete(ctx, document.querySelector("#delete"), "organizations", o.id, o.name, "/organizations");
}

function renderForm(ctx: Ctx, mode: "new" | "edit"): void {
  let org = emptyOrganization();
  if (mode === "edit") {
    const found = byShortId(ctx.data.organizations, ctx.params.id);
    if (!found) return notFound(ctx, "Organization", "/organizations");
    org = found;
  } else {
    org.name = ctx.query.get("name") ?? "";
  }
  renderScreen(ctx, {
    eyebrow: mode === "new" ? "New organization" : "Edit organization",
    title: mode === "new" ? "New organization" : org.name,
    body: `
      <form id="org-form" class="stack crm-form">
        ${field("Name", "name", org.name, { required: true })}
        ${field("Website", "website", org.website, { type: "url", placeholder: "https://" })}
        ${field("Location", "location", org.location, { placeholder: "Brussels, BE" })}
        ${field("Tags", "tags", org.tags.join(", "), { hint: "Comma separated, e.g. fablab, partner, funder." })}
        ${field("Note", "note", org.note, { textarea: true })}
        <div class="crm-actions">
          <button type="submit">${mode === "new" ? "Add organization" : "Save"}</button>
          <a href="${mode === "new" ? "#/organizations" : `#/organizations/${encodeURIComponent(shortId(org.id))}`}">Cancel</a>
        </div>
      </form>`,
  });
  const form = $(ctx.app, "#org-form") as HTMLFormElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = new FormData(form);
    const updated: Organization = {
      ...org,
      name: formValue(f, "name"),
      website: formValue(f, "website"),
      location: formValue(f, "location"),
      tags: parseTags(formValue(f, "tags")),
      note: formValue(f, "note"),
    };
    busy(form.querySelector("button[type=submit]"), async () => {
      const saved = await ctx.store.save("organizations", updated, (r) => organizationToThing(r));
      toast(mode === "new" ? `Added ${saved.name}.` : "Saved.");
      ctx.go(`/organizations/${encodeURIComponent(shortId(saved.id))}`);
    });
  });
}

registerRoute({ pattern: "/organizations", nav: "Organizations", navOrder: 30, render: renderList });
registerRoute({ pattern: "/organizations/new", render: (ctx) => renderForm(ctx, "new") });
registerRoute({ pattern: "/organizations/:id", render: renderDetail });
registerRoute({ pattern: "/organizations/:id/edit", render: (ctx) => renderForm(ctx, "edit") });
