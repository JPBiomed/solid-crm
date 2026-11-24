/**
 * Pieces every CRM screen shares: the shell around a screen, form fields,
 * the interaction timeline, the task list. Plain strings and one `wire…`
 * function per interactive block — the kit's shape, no component system.
 */
import { focusView } from "../ui/a11y";
import { esc, toast } from "../ui/patterns";
import { renderThemeButton } from "../ui/theme";
import { APP_NAME } from "../config";
import {
  byDateDesc,
  byTaskOrder,
  CHANNELS,
  dueState,
  emptyInteraction,
  emptyTask,
  interactionToThing,
  localDate,
  taskToThing,
  type Channel,
  type Interaction,
  type Task,
} from "./model";
import { navEntries, shortId, type Ctx } from "./routes";
import type { Collection, CrmData } from "./store";

export { esc };

// ---------------------------------------------------------------- shell

export function renderScreen(
  ctx: Ctx,
  opts: { title: string; body: string; wide?: boolean; actions?: string; eyebrow?: string }
): void {
  const current = "/" + (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "");
  const nav = navEntries()
    .map(({ label, path }) => {
      const active = path === "/" ? current === "/" : current === path;
      return `<a href="#${esc(path)}"${active ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
    })
    .join("");
  ctx.app.innerHTML = `
    <div class="crm-shell">
      <header class="crm-header">
        <a class="crm-brand" href="#/">${esc(APP_NAME)}</a>
        <nav class="crm-nav" aria-label="Sections">${nav}</nav>
        ${renderThemeButton()}
      </header>
      <main class="crm-main${opts.wide ? " crm-main-wide" : ""} stack">
        <div class="crm-title-row">
          <div>
            ${opts.eyebrow ? `<p class="label-mono">${opts.eyebrow}</p>` : ""}
            <h1 data-view-title tabindex="-1">${esc(opts.title)}</h1>
          </div>
          ${opts.actions ? `<div class="crm-actions">${opts.actions}</div>` : ""}
        </div>
        ${opts.body}
      </main>
    </div>`;
  focusView(ctx.app);
}

export function $(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
}

/** Runs a save, keeps the button disabled meanwhile, reports failure in a toast. */
export async function busy(button: HTMLButtonElement | null, work: () => Promise<void>): Promise<void> {
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Saving…";
  }
  try {
    await work();
  } catch (err) {
    console.error(err);
    toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`, { durationMs: 10000 });
    if (button) {
      button.disabled = false;
      button.textContent = label ?? "Save";
    }
  }
}

// ---------------------------------------------------------------- fields

interface FieldOpts {
  type?: string;
  textarea?: boolean;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  list?: string;
}

export function field(label: string, name: string, value: string, opts: FieldOpts = {}): string {
  const id = `f-${name}`;
  const attrs = `id="${id}" name="${esc(name)}"${opts.required ? " required" : ""}${
    opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""
  }${opts.list ? ` list="${esc(opts.list)}"` : ""}`;
  const control = opts.textarea
    ? `<textarea ${attrs} rows="4">${esc(value)}</textarea>`
    : `<input ${attrs} type="${opts.type ?? "text"}" value="${esc(value)}" />`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      ${control}
      ${opts.hint ? `<p class="hint">${esc(opts.hint)}</p>` : ""}
    </div>`;
}

export function selectField(
  label: string,
  name: string,
  value: string,
  options: { value: string; label: string }[]
): string {
  const id = `f-${name}`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}" name="${esc(name)}">
        ${options
          .map((o) => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label)}</option>`)
          .join("")}
      </select>
    </div>`;
}

/** Checkbox list for picking related records (orgs of a contact, members of a project). */
export function pickField(
  label: string,
  name: string,
  selected: string[],
  options: { value: string; label: string }[],
  hint?: string
): string {
  if (options.length === 0) {
    return `<div class="field"><span class="crm-label">${esc(label)}</span><p class="hint">${esc(hint ?? "Nothing to pick yet.")}</p></div>`;
  }
  return `
    <fieldset class="field crm-pick">
      <legend class="crm-label">${esc(label)}</legend>
      <input type="search" class="crm-pick-filter" placeholder="Filter…" aria-label="Filter ${esc(label)}" />
      <div class="crm-pick-options">
        ${options
          .map(
            (o) => `
          <label class="crm-check"><input type="checkbox" name="${esc(name)}" value="${esc(o.value)}"${
              selected.includes(o.value) ? " checked" : ""
            } /> ${esc(o.label)}</label>`
          )
          .join("")}
      </div>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
    </fieldset>`;
}

export function wirePickFilters(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>(".crm-pick-filter").forEach((input) => {
    input.addEventListener("input", () => {
      const q = input.value.toLowerCase();
      input.parentElement!.querySelectorAll<HTMLLabelElement>(".crm-check").forEach((l) => {
        l.hidden = !!q && !l.textContent!.toLowerCase().includes(q) && !l.querySelector("input")!.checked;
      });
    });
  });
}

export function formValue(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function formValues(form: FormData, name: string): string[] {
  return form.getAll(name).map(String);
}

// ---------------------------------------------------------------- records

/** Where a record IRI lives in the app. */
export function hrefFor(iri: string, data: CrmData): string {
  const id = encodeURIComponent(shortId(iri));
  if (data.contacts.some((c) => c.id === iri)) return `#/contacts/${id}`;
  if (data.organizations.some((o) => o.id === iri)) return `#/organizations/${id}`;
  if (data.projects.some((p) => p.id === iri)) return `#/projects/${id}`;
  return iri;
}

export function nameOf(iri: string, data: CrmData): string {
  return (
    data.contacts.find((c) => c.id === iri)?.name ??
    data.organizations.find((o) => o.id === iri)?.name ??
    data.projects.find((p) => p.id === iri)?.name ??
    "(removed)"
  );
}

export function recordLinks(iris: string[], data: CrmData, exclude = ""): string {
  return iris
    .filter((i) => i !== exclude)
    .map((i) => `<a href="${esc(hrefFor(i, data))}">${esc(nameOf(i, data))}</a>`)
    .join(", ");
}

export function tagChips(tags: string[], baseHref?: string): string {
  if (tags.length === 0) return "";
  return `<span class="crm-tags">${tags
    .map((t) =>
      baseHref
        ? `<a class="crm-tag" href="${esc(baseHref)}?tag=${encodeURIComponent(t)}">${esc(t)}</a>`
        : `<span class="crm-tag">${esc(t)}</span>`
    )
    .join("")}</span>`;
}

/** Finds a record by the short id in the URL. */
export function byShortId<T extends { id: string }>(records: T[], id: string): T | undefined {
  return records.find((r) => shortId(r.id) === id);
}

export function notFound(ctx: Ctx, what: string, back: string): void {
  renderScreen(ctx, {
    title: `${what} not found`,
    body: `<p class="lead">It may have been removed, or the link is from another pod.</p>
           <p><a href="#${esc(back)}">Back to the list</a></p>`,
  });
}

/** Wires a "Delete" button: confirm, remove, then go to `after`. */
export function wireDelete(ctx: Ctx, button: HTMLElement | null, collection: Collection, id: string, label: string, after: string): void {
  button?.addEventListener("click", async () => {
    if (!confirm(`Delete ${label}? This removes it from your pod.`)) return;
    await busy(button as HTMLButtonElement, async () => {
      await ctx.store.remove(collection, id);
      toast(`Deleted ${label}.`);
      ctx.go(after);
    });
  });
}

// ---------------------------------------------------------------- timeline

const CHANNEL_LABEL: Record<Channel, string> = {
  note: "Note",
  email: "Email",
  meeting: "Meeting",
  call: "Call",
  chat: "Chat",
  linkedin: "LinkedIn",
  event: "Event",
};

function formatWhen(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function datetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The interactions about `about` (newest first) and a form to log a new one.
 * `about` is the record whose page this is; `alsoAbout` are records the new
 * interaction should link too (a contact's organizations, say).
 */
export function renderTimeline(data: CrmData, about: string, limit = Infinity): string {
  const items = data.interactions.filter((i) => i.about.includes(about)).sort(byDateDesc);
  return `
    <section class="stack crm-section" aria-labelledby="timeline-h">
      <h2 id="timeline-h">Timeline</h2>
      <form class="crm-log stack" data-about="${esc(about)}">
        <div class="crm-row">
          ${selectField("Type", "channel", "note", CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })))}
          ${field("When", "date", datetimeLocal(new Date()), { type: "datetime-local" })}
        </div>
        ${field("Summary", "title", "", { placeholder: "Coffee at the fablab, talked about the map", required: true })}
        ${field("Details", "body", "", { textarea: true })}
        <div><button type="submit" class="small">Log it</button></div>
      </form>
      ${renderInteractionList(items.slice(0, limit), data, about)}
    </section>`;
}

export function renderInteractionList(items: Interaction[], data: CrmData, context = ""): string {
  if (items.length === 0) return `<p class="hint">Nothing logged yet.</p>`;
  return `
    <ol class="crm-timeline">
      ${items
        .map(
          (i) => `
        <li class="crm-timeline-item" data-id="${esc(i.id)}">
          <div class="crm-timeline-head">
            <span class="crm-channel crm-channel-${esc(i.channel)}">${esc(CHANNEL_LABEL[i.channel])}</span>
            <time class="meta" datetime="${esc(i.date.toISOString())}">${esc(formatWhen(i.date))}</time>
            <button class="link-button crm-delete-interaction" aria-label="Delete this entry">Delete</button>
          </div>
          <p class="crm-timeline-title">${esc(i.title || "(no summary)")}</p>
          ${i.body ? `<p class="crm-timeline-body">${esc(i.body)}</p>` : ""}
          ${i.about.filter((a) => a !== context).length ? `<p class="hint">With ${recordLinks(i.about, data, context)}</p>` : ""}
        </li>`
        )
        .join("")}
    </ol>`;
}

export function wireTimeline(ctx: Ctx, alsoAbout: string[] = []): void {
  const form = ctx.app.querySelector<HTMLFormElement>(".crm-log");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const f = new FormData(form);
    const about = [form.dataset.about!, ...alsoAbout];
    const interaction: Interaction = {
      ...emptyInteraction([...new Set(about)]),
      channel: formValue(f, "channel") as Channel,
      date: new Date(formValue(f, "date") || Date.now()),
      title: formValue(f, "title"),
      body: formValue(f, "body"),
    };
    busy(form.querySelector("button"), async () => {
      await ctx.store.save("interactions", interaction, (r) => interactionToThing(r));
      toast("Logged.");
      await ctx.refresh();
    });
  });
  wireInteractionDeletes(ctx);
}

export function wireInteractionDeletes(ctx: Ctx): void {
  ctx.app.querySelectorAll<HTMLButtonElement>(".crm-delete-interaction").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.closest<HTMLElement>("[data-id]")!.dataset.id!;
      if (!confirm("Delete this timeline entry?")) return;
      busy(button, async () => {
        await ctx.store.remove("interactions", id);
        await ctx.refresh();
      });
    });
  });
}

// ---------------------------------------------------------------- tasks

const DUE_LABEL = { overdue: "Overdue", today: "Today", soon: "This week", later: "", none: "" };

export function renderTaskList(tasks: Task[], data: CrmData, context = ""): string {
  if (tasks.length === 0) return `<p class="hint">No tasks.</p>`;
  return `
    <ul class="crm-tasks">
      ${[...tasks]
        .sort(byTaskOrder)
        .map((t) => {
          const state = t.done ? "none" : dueState(t.due);
          return `
        <li class="crm-task${t.done ? " crm-task-done" : ""}" data-id="${esc(t.id)}">
          <label class="crm-check">
            <input type="checkbox" class="crm-task-toggle"${t.done ? " checked" : ""} />
            <span>${esc(t.title)}</span>
          </label>
          <span class="crm-task-meta">
            ${t.due ? `<span class="crm-due crm-due-${state}">${esc(DUE_LABEL[state] || t.due)}${DUE_LABEL[state] ? ` · ${esc(t.due)}` : ""}</span>` : ""}
            ${t.about.filter((a) => a !== context).length ? `<span class="hint">${recordLinks(t.about, data, context)}</span>` : ""}
            <button class="link-button crm-task-delete" aria-label="Delete task ${esc(t.title)}">Delete</button>
          </span>
        </li>`;
        })
        .join("")}
    </ul>`;
}

export function renderTaskForm(about: string[] = []): string {
  return `
    <form class="crm-task-form crm-row" data-about="${esc(about.join(" "))}">
      ${field("New task", "title", "", { placeholder: "Send the workshop report", required: true })}
      ${field("Due", "due", "", { type: "date" })}
      <div class="crm-row-button"><button type="submit" class="small">Add</button></div>
    </form>`;
}

export function renderTasksSection(data: CrmData, about: string): string {
  const tasks = data.tasks.filter((t) => t.about.includes(about));
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  return `
    <section class="stack crm-section" aria-labelledby="tasks-h">
      <h2 id="tasks-h">Tasks</h2>
      ${renderTaskForm([about])}
      ${renderTaskList(open, data, about)}
      ${done.length ? `<details><summary class="hint">${done.length} done</summary>${renderTaskList(done, data, about)}</details>` : ""}
    </section>`;
}

export function wireTasks(ctx: Ctx): void {
  ctx.app.querySelectorAll<HTMLFormElement>(".crm-task-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const f = new FormData(form);
      const about = (form.dataset.about ?? "").split(" ").filter(Boolean);
      const task: Task = { ...emptyTask(about), title: formValue(f, "title"), due: formValue(f, "due") };
      busy(form.querySelector("button"), async () => {
        await ctx.store.save("tasks", task, (r) => taskToThing(r));
        await ctx.refresh();
      });
    });
  });
  ctx.app.querySelectorAll<HTMLInputElement>(".crm-task-toggle").forEach((box) => {
    box.addEventListener("change", async () => {
      const id = box.closest<HTMLElement>("[data-id]")!.dataset.id!;
      const task = ctx.data.tasks.find((t) => t.id === id);
      if (!task) return;
      box.disabled = true;
      try {
        await ctx.store.save("tasks", { ...task, done: box.checked }, (r) => taskToThing(r));
        if (box.checked) toast("Done.", { undo: () => void ctx.store.save("tasks", { ...task, done: false }, (r) => taskToThing(r)).then(() => ctx.refresh()) });
        await ctx.refresh();
      } catch (err) {
        box.disabled = false;
        box.checked = !box.checked;
        toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });
  ctx.app.querySelectorAll<HTMLButtonElement>(".crm-task-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.closest<HTMLElement>("[data-id]")!.dataset.id!;
      busy(button, async () => {
        await ctx.store.remove("tasks", id);
        await ctx.refresh();
      });
    });
  });
}

/** A search box plus tag filter, keeping both in the hash so Back works. */
export function renderFilterBar(ctx: Ctx, base: string, tags: [string, number][]): string {
  const q = ctx.query.get("q") ?? "";
  const tag = ctx.query.get("tag") ?? "";
  return `
    <form class="crm-filter" data-base="${esc(base)}" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search" aria-label="Search" />
      ${
        tags.length
          ? `<select name="tag" aria-label="Filter by tag">
              <option value="">All tags</option>
              ${tags.map(([t, n]) => `<option value="${esc(t)}"${t === tag ? " selected" : ""}>${esc(t)} (${n})</option>`).join("")}
            </select>`
          : ""
      }
    </form>`;
}

export function wireFilterBar(ctx: Ctx): void {
  const form = ctx.app.querySelector<HTMLFormElement>(".crm-filter");
  if (!form) return;
  const apply = () => {
    const f = new FormData(form);
    const params = new URLSearchParams();
    const q = formValue(f, "q");
    const tag = formValue(f, "tag");
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    const qs = params.toString();
    // replaceState: typing must not fill the history with one entry per key.
    history.replaceState(null, "", `#${form.dataset.base}${qs ? `?${qs}` : ""}`);
    ctx.query = params;
    form.dispatchEvent(new CustomEvent("crm-filter", { bubbles: true }));
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    apply();
  });
  form.querySelector("input")?.addEventListener("input", apply);
  form.querySelector("select")?.addEventListener("change", apply);
}
