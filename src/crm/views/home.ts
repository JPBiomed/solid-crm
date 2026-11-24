import { logout } from "../../lib/auth";
import { forgetReads } from "../../lib/read";
import { toast } from "../../ui/patterns";
import { byDateDesc, dueState, type Stage } from "../model";
import { registerRoute, type Ctx } from "../routes";
import {
  $,
  busy,
  esc,
  renderInteractionList,
  renderScreen,
  renderTaskForm,
  renderTaskList,
  wireInteractionDeletes,
  wireTasks,
} from "../ui";

function renderHome(ctx: Ctx): void {
  const { data } = ctx;
  const urgent = data.tasks.filter((t) => !t.done && ["overdue", "today", "soon"].includes(dueState(t.due)));
  const recent = [...data.interactions].sort(byDateDesc).slice(0, 8);
  const empty = data.contacts.length + data.organizations.length + data.projects.length === 0;
  renderScreen(ctx, {
    title: "Today",
    body: `
      ${
        empty
          ? `<div class="empty-state">
              <h2>Your CRM is empty</h2>
              <p class="lead">Everything you add is stored in your own pod, under <code>${esc(ctx.store.root)}</code>.</p>
              <p class="crm-actions">
                <a class="crm-button" href="#/contacts/new">Add a contact</a>
                <a class="crm-button ghost" href="#/organizations/new">Add an organization</a>
                <a class="crm-button ghost" href="#/projects/new">Start a project</a>
              </p>
            </div>`
          : ""
      }
      <section class="stack crm-section" aria-labelledby="due-h">
        <h2 id="due-h">Due this week</h2>
        ${renderTaskForm()}
        ${urgent.length ? renderTaskList(urgent, data) : `<p class="hint">Nothing due this week. <a href="#/tasks">All tasks</a></p>`}
      </section>
      <section class="stack crm-section" aria-labelledby="pipe-h">
        <h2 id="pipe-h"><a href="#/projects">Pipeline</a></h2>
        <ul class="crm-pipeline-summary">
          ${data.stages
            .map((s: Stage) => {
              const n = data.projects.filter((p) => p.stage === s.key).length;
              return `<li><span class="crm-count">${n}</span> <span class="hint">${esc(s.label)}</span></li>`;
            })
            .join("")}
        </ul>
      </section>
      <section class="stack crm-section" aria-labelledby="recent-h">
        <h2 id="recent-h">Recently</h2>
        ${renderInteractionList(recent, data)}
      </section>`,
  });
  wireTasks(ctx);
  wireInteractionDeletes(ctx);
}

function renderTasks(ctx: Ctx): void {
  const showDone = ctx.query.get("show") === "done";
  const tasks = ctx.data.tasks.filter((t) => t.done === showDone);
  renderScreen(ctx, {
    title: showDone ? "Done" : "Tasks",
    actions: showDone ? `<a href="#/tasks">Open tasks</a>` : `<a href="#/tasks?show=done">Done</a>`,
    body: `
      ${showDone ? "" : renderTaskForm()}
      ${renderTaskList(tasks, ctx.data)}`,
  });
  wireTasks(ctx);
}

function slug(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "stage";
}

function renderSettings(ctx: Ctx): void {
  const stages = ctx.data.stages.map((s) => ({ ...s }));
  const draw = () => {
    $(ctx.app, "#stages").innerHTML = stages
      .map((s, i) => {
        const used = ctx.data.projects.filter((p) => p.stage === s.key).length;
        return `
        <li class="crm-stage-row" data-i="${i}">
          <label class="visually-hidden" for="stage-${i}">Stage ${i + 1}</label>
          <input type="text" id="stage-${i}" value="${esc(s.label)}" />
          <span class="meta">${used}</span>
          <button type="button" class="ghost small" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(s.label)} up">↑</button>
          <button type="button" class="ghost small" data-act="down" ${i === stages.length - 1 ? "disabled" : ""} aria-label="Move ${esc(s.label)} down">↓</button>
          <button type="button" class="ghost small" data-act="remove" ${used ? `disabled title="${used} project(s) are in this stage"` : ""} aria-label="Remove ${esc(s.label)}">Remove</button>
        </li>`;
      })
      .join("");
  };
  renderScreen(ctx, {
    title: "Settings",
    body: `
      <section class="stack crm-section" aria-labelledby="stages-h">
        <h2 id="stages-h">Pipeline stages</h2>
        <p class="hint">Renaming a stage keeps its projects in it. A stage with projects in it can't be removed.</p>
        <ol id="stages" class="crm-stages"></ol>
        <form id="add-stage" class="crm-row">
          <div class="field"><label for="new-stage">New stage</label><input type="text" id="new-stage" required /></div>
          <div class="crm-row-button"><button type="submit" class="ghost small">Add</button></div>
        </form>
        <div><button id="save-stages">Save stages</button></div>
      </section>
      <section class="stack crm-section" aria-labelledby="import-h">
        <h2 id="import-h">Import</h2>
        <p class="hint">Bring in contacts from your Google accounts or from vCard and CSV files.</p>
        <div><a class="crm-button ghost" href="#/import">Import contacts</a></div>
      </section>
      <section class="stack crm-section" aria-labelledby="pod-h">
        <h2 id="pod-h">Your pod</h2>
        <dl class="crm-facts">
          <div><dt class="label-mono">Signed in as</dt><dd><code>${esc(ctx.webId)}</code></dd></div>
          <div><dt class="label-mono">CRM data</dt><dd><code>${esc(ctx.store.root)}</code></dd></div>
        </dl>
        <div><button class="ghost" id="logout">Sign out</button></div>
      </section>`,
  });
  draw();
  const list = $(ctx.app, "#stages");
  list.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    stages[Number(input.closest<HTMLElement>("[data-i]")!.dataset.i)].label = input.value;
  });
  list.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!button) return;
    const i = Number(button.closest<HTMLElement>("[data-i]")!.dataset.i);
    const act = button.dataset.act;
    if (act === "up") [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]];
    if (act === "down") [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]];
    if (act === "remove") stages.splice(i, 1);
    draw();
  });
  $(ctx.app, "#add-stage").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $(ctx.app, "#new-stage") as HTMLInputElement;
    const label = input.value.trim();
    if (!label) return;
    let key = slug(label);
    while (stages.some((s) => s.key === key)) key += "-2";
    stages.push({ id: "", key, label, position: stages.length });
    input.value = "";
    draw();
  });
  $(ctx.app, "#save-stages").addEventListener("click", (e) => {
    if (stages.some((s) => !s.label.trim())) return toast("Every stage needs a name.");
    busy(e.currentTarget as HTMLButtonElement, async () => {
      await ctx.store.saveStages(stages.map((s) => ({ ...s, label: s.label.trim() })));
      toast("Stages saved.");
      await ctx.refresh();
    });
  });
  $(ctx.app, "#logout").addEventListener("click", async () => {
    forgetReads();
    await logout();
    location.hash = "";
    location.reload();
  });
}

registerRoute({ pattern: "/", nav: "Today", navOrder: 10, render: renderHome });
registerRoute({ pattern: "/tasks", nav: "Tasks", navOrder: 50, render: renderTasks });
registerRoute({ pattern: "/settings", nav: "Settings", navOrder: 1000, render: renderSettings });
