import { toast } from "../../ui/patterns";
import { byName, emptyProject, matches, parseTags, projectToThing, type Project, type Stage } from "../model";
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
  renderScreen,
  renderTasksSection,
  renderTimeline,
  selectField,
  tagChips,
  wireDelete,
  wirePickFilters,
  wireTasks,
  wireTimeline,
} from "../ui";

const href = (p: Project) => `#/projects/${encodeURIComponent(shortId(p.id))}`;

function stageOptions(stages: Stage[]) {
  return stages.map((s) => ({ value: s.key, label: s.label }));
}

async function moveTo(ctx: Ctx, project: Project, stage: string): Promise<void> {
  if (project.stage === stage) return;
  const label = ctx.data.stages.find((s) => s.key === stage)?.label ?? stage;
  const before = project.stage;
  await ctx.store.save("projects", { ...project, stage }, (r) => projectToThing(r));
  toast(`${project.name} → ${label}`, {
    undo: () => void ctx.store.save("projects", { ...project, stage: before }, (r) => projectToThing(r)).then(() => ctx.refresh()),
  });
  await ctx.refresh();
}

function renderCard(ctx: Ctx, p: Project): string {
  const open = ctx.data.tasks.filter((t) => !t.done && t.about.includes(p.id)).length;
  return `
    <li class="crm-card" draggable="true" data-id="${esc(p.id)}">
      <a class="crm-card-name" href="${href(p)}">${esc(p.name)}</a>
      ${p.members.length ? `<span class="hint">${recordLinks(p.members, ctx.data)}</span>` : ""}
      ${open ? `<span class="meta">${open} open task${open === 1 ? "" : "s"}</span>` : ""}
      ${tagChips(p.tags)}
      <label class="visually-hidden" for="move-${esc(shortId(p.id))}">Stage of ${esc(p.name)}</label>
      <select class="crm-move" id="move-${esc(shortId(p.id))}">
        ${ctx.data.stages.map((s) => `<option value="${esc(s.key)}"${s.key === p.stage ? " selected" : ""}>${esc(s.label)}</option>`).join("")}
      </select>
    </li>`;
}

function renderBoard(ctx: Ctx): void {
  const q = ctx.query.get("q") ?? "";
  const projects = ctx.data.projects.filter((p) => matches(q, p.name, p.description, p.tags)).sort(byName);
  const known = new Set(ctx.data.stages.map((s) => s.key));
  // A project whose stage was removed in the settings still has to show up somewhere.
  const columns = [
    ...ctx.data.stages.map((s) => ({ key: s.key, label: s.label })),
    ...(projects.some((p) => !known.has(p.stage)) ? [{ key: "", label: "No stage" }] : []),
  ];
  renderScreen(ctx, {
    title: "Projects & partnerships",
    wide: true,
    actions: `<a class="crm-button" href="#/projects/new">New project</a>`,
    body:
      ctx.data.projects.length === 0
        ? `<div class="empty-state"><h2>No projects yet</h2><p class="lead">Track partnerships, workshops, grant applications and mapping projects as they move from an idea to done.</p></div>`
        : `
      <form class="crm-filter" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search projects" aria-label="Search projects" /></form>
      <div class="crm-board">
        ${columns
          .map((col) => {
            const items = projects.filter((p) => (col.key ? p.stage === col.key : !known.has(p.stage)));
            return `
          <section class="crm-column" data-stage="${esc(col.key)}" aria-label="${esc(col.label)}">
            <h2 class="crm-column-head"><span>${esc(col.label)}</span><span class="meta">${items.length}</span></h2>
            <ul class="crm-cards">${items.map((p) => renderCard(ctx, p)).join("")}</ul>
            ${col.key ? `<a class="crm-column-add hint" href="#/projects/new?stage=${encodeURIComponent(col.key)}">+ Add</a>` : ""}
          </section>`;
          })
          .join("")}
      </div>`,
  });

  ctx.app.querySelector<HTMLFormElement>(".crm-filter")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = new FormData(e.target as HTMLFormElement).get("q");
    ctx.go(`/projects${value ? `?q=${encodeURIComponent(String(value))}` : ""}`);
  });

  ctx.app.querySelectorAll<HTMLSelectElement>(".crm-move").forEach((select) => {
    select.addEventListener("change", () => {
      const p = ctx.data.projects.find((x) => x.id === select.closest<HTMLElement>("[data-id]")!.dataset.id);
      if (p) busy(null, () => moveTo(ctx, p, select.value));
    });
  });

  // Drag and drop is the quick way on a desktop; the select above is the way
  // that works with a keyboard, a screen reader and a phone.
  ctx.app.querySelectorAll<HTMLElement>(".crm-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", card.dataset.id!);
      card.classList.add("crm-card-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("crm-card-dragging"));
  });
  ctx.app.querySelectorAll<HTMLElement>(".crm-column").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      if (!col.dataset.stage) return;
      e.preventDefault();
      col.classList.add("crm-column-over");
    });
    col.addEventListener("dragleave", () => col.classList.remove("crm-column-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("crm-column-over");
      const p = ctx.data.projects.find((x) => x.id === e.dataTransfer?.getData("text/plain"));
      if (p && col.dataset.stage) busy(null, () => moveTo(ctx, p, col.dataset.stage!));
    });
  });
}

function renderDetail(ctx: Ctx): void {
  const p = byShortId(ctx.data.projects, ctx.params.id);
  if (!p) return notFound(ctx, "Project", "/projects");
  const facts: [string, string][] = [
    ["With", recordLinks(p.members, ctx.data)],
    ["Dates", esc([p.start, p.end].filter(Boolean).join(" → "))],
    ["Tags", tagChips(p.tags)],
  ];
  renderScreen(ctx, {
    eyebrow: "Project",
    title: p.name,
    actions: `
      <a class="crm-button ghost" href="${href(p)}/edit">Edit</a>
      <button class="ghost" id="delete">Delete</button>`,
    body: `
      <div class="crm-stage-picker">${selectField("Stage", "stage", p.stage, stageOptions(ctx.data.stages))}</div>
      <dl class="crm-facts">
        ${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt class="label-mono">${k}</dt><dd>${v}</dd></div>`).join("")}
      </dl>
      ${p.description ? `<p class="crm-note">${esc(p.description)}</p>` : ""}
      ${renderTasksSection(ctx.data, p.id)}
      ${renderTimeline(ctx.data, p.id)}`,
  });
  $(ctx.app, "#f-stage").addEventListener("change", (e) => busy(null, () => moveTo(ctx, p, (e.target as HTMLSelectElement).value)));
  wireTasks(ctx);
  // Logging on a project also lands on the timelines of the people and organizations in it.
  wireTimeline(ctx, p.members);
  wireDelete(ctx, document.querySelector("#delete"), "projects", p.id, p.name, "/projects");
}

function renderForm(ctx: Ctx, mode: "new" | "edit"): void {
  let project = emptyProject(ctx.query.get("stage") ?? ctx.data.stages[0]?.key ?? "idea");
  if (mode === "edit") {
    const found = byShortId(ctx.data.projects, ctx.params.id);
    if (!found) return notFound(ctx, "Project", "/projects");
    project = found;
  } else {
    project.name = ctx.query.get("name") ?? "";
    const with_ = ctx.query.get("with");
    if (with_) project.members = [with_];
  }
  const memberOptions = [
    ...[...ctx.data.organizations].sort(byName).map((o) => ({ value: o.id, label: `${o.name} (organization)` })),
    ...[...ctx.data.contacts].sort(byName).map((c) => ({ value: c.id, label: c.name })),
  ];
  renderScreen(ctx, {
    eyebrow: mode === "new" ? "New project" : "Edit project",
    title: mode === "new" ? "New project" : project.name,
    body: `
      <form id="project-form" class="stack crm-form">
        ${field("Name", "name", project.name, { required: true, placeholder: "Map of Brussels makerspaces" })}
        ${selectField("Stage", "stage", project.stage, stageOptions(ctx.data.stages))}
        ${field("Description", "description", project.description, { textarea: true })}
        ${pickField("With", "members", project.members, memberOptions, "People and organizations involved.")}
        <div class="crm-row">
          ${field("Start", "start", project.start, { type: "date" })}
          ${field("End", "end", project.end, { type: "date" })}
        </div>
        ${field("Tags", "tags", project.tags.join(", "), { hint: "Comma separated, e.g. grant, workshop, partnership." })}
        <div class="crm-actions">
          <button type="submit">${mode === "new" ? "Add project" : "Save"}</button>
          <a href="${mode === "new" ? "#/projects" : href(project)}">Cancel</a>
        </div>
      </form>`,
  });
  wirePickFilters(ctx.app);
  const form = $(ctx.app, "#project-form") as HTMLFormElement;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = new FormData(form);
    const updated: Project = {
      ...project,
      name: formValue(f, "name"),
      stage: formValue(f, "stage"),
      description: formValue(f, "description"),
      members: formValues(f, "members"),
      start: formValue(f, "start"),
      end: formValue(f, "end"),
      tags: parseTags(formValue(f, "tags")),
    };
    busy(form.querySelector("button[type=submit]"), async () => {
      const saved = await ctx.store.save("projects", updated, (r) => projectToThing(r));
      toast(mode === "new" ? `Added ${saved.name}.` : "Saved.");
      ctx.go(`/projects/${encodeURIComponent(shortId(saved.id))}`);
    });
  });
}

registerRoute({ pattern: "/projects", nav: "Pipeline", navOrder: 40, render: renderBoard });
registerRoute({ pattern: "/projects/new", render: (ctx) => renderForm(ctx, "new") });
registerRoute({ pattern: "/projects/:id", render: renderDetail });
registerRoute({ pattern: "/projects/:id/edit", render: (ctx) => renderForm(ctx, "edit") });
