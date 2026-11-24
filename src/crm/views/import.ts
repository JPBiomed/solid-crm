/**
 * Import: bring people in from Google accounts and contact files.
 *
 * Every source (a dropped .vcf/.csv, a connected Google account) lands in one
 * list where the same person seen in several places is already joined, and
 * each row says what the import would do: add a new person, add details to
 * someone already in the CRM, or nothing. Everyone is ticked by default
 * (Jason's choice: bring everyone in); unticking leaves someone out.
 *
 * What was loaded lives in this module, not in the screen: the screen is
 * re-rendered on every change and after each save, and must not drop a
 * Google account the person just signed in to.
 */
import { toast } from "../../ui/patterns";
import { contactToThing, organizationToThing, parseTags } from "../model";
import { registerRoute, shortId, type Ctx } from "../routes";
import { busy, esc, renderScreen, tagChips } from "../ui";
import { GOOGLE_CLIENT_ID } from "../../config";
import { groupPeople, type Candidate, type ImportOptions } from "../google/merge";
import { parseContactsFile, type ImportPerson } from "../google/parse";
import { planRows, planWrites, type PlanRow, type RowStatus } from "../google/plan";
import { readGoogleAccount, requestToken } from "../google/people";

interface Source {
  id: string;
  label: string;
  kind: "file" | "google";
  people: ImportPerson[];
  /** Tags given to everyone from this source, e.g. the workspace of a work account. */
  tags: string[];
}

const state = {
  sources: new Map<string, Source>(),
  labelsAsTags: true,
  includeOther: true,
  /** Candidate keys left out. Everyone else is imported. */
  excluded: new Set<string>(),
  /** Name-only matches the person chose to merge. The others are added as new people. */
  mergeByName: new Set<string>(),
  filter: { q: "", status: "" as "" | RowStatus, label: "", source: "" },
};

/** The Google accounts connected before, so "Check for changes" is one click. Per browser, a convenience only. */
const ACCOUNTS_KEY = "crm:google-accounts";

function rememberedAccounts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function rememberAccount(account: string): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...new Set([...rememberedAccounts(), account])]));
  } catch {
    // Storage blocked: the account just isn't offered next time.
  }
}

function forgetAccount(account: string): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rememberedAccounts().filter((a) => a !== account)));
  } catch {
    // See rememberAccount.
  }
}

/** A personal Gmail is "personal"; a work account is tagged with its domain's name. */
export function defaultAccountTags(account: string): string[] {
  const domain = account.split("@")[1] ?? "";
  if (!domain || /^(gmail|googlemail)\.com$/.test(domain)) return ["personal"];
  return [domain.split(".").slice(0, -1).join(".") || domain];
}

function options(): ImportOptions {
  return {
    labelsAsTags: state.labelsAsTags,
    sourceTags: Object.fromEntries([...state.sources.values()].map((s) => [s.id, s.tags])),
  };
}

function candidates(): Candidate[] {
  const people = [...state.sources.values()].flatMap((s) => s.people);
  return groupPeople(people).filter((c) => state.includeOther || !c.otherOnly);
}

const STATUS_TEXT: Record<RowStatus, string> = {
  new: "New",
  update: "Adds to someone in the CRM",
  same: "Already in the CRM",
  name: "Same name as someone in the CRM",
};

function isChosen(row: PlanRow): boolean {
  return row.status !== "same" && !state.excluded.has(row.candidate.key);
}

function filtered(rows: PlanRow[]): PlanRow[] {
  const { q, status, label, source } = state.filter;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    const c = r.candidate;
    if (status && r.status !== status) return false;
    if (label && !c.labels.includes(label)) return false;
    if (source && !c.sourceIds.includes(source)) return false;
    if (words.length) {
      const text = [c.name, ...c.emails, ...c.orgs, c.role, ...c.labels].join(" ").toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- render

const SHOWN = 200;

function renderRow(r: PlanRow): string {
  const c = r.candidate;
  const sub = [c.role, c.orgs[0], c.emails[0] ?? c.phones[0]].filter(Boolean).join(" · ");
  const sources = c.sourceIds.map((id) => state.sources.get(id)?.label ?? id).join(", ");
  const link = r.match ? `<a href="#/contacts/${encodeURIComponent(shortId(r.match.contact.id))}">${esc(r.match.contact.name || "(no name)")}</a>` : "";
  let status = `<span class="import-status import-${r.status}">${esc(STATUS_TEXT[r.status])}</span>`;
  if (r.status === "update") status += ` ${link}: adds ${esc(r.changes.join(", "))}`;
  if (r.status === "same") status += ` as ${link}`;
  if (r.status === "name") {
    status += ` ${link}.
      <label class="visually-hidden" for="nm-${esc(c.key)}">What to do with ${esc(c.name)}</label>
      <select class="import-name-choice" id="nm-${esc(c.key)}">
        <option value="new"${state.mergeByName.has(c.key) ? "" : " selected"}>Add as a separate person</option>
        <option value="merge"${state.mergeByName.has(c.key) ? " selected" : ""}>Same person: merge</option>
      </select>`;
  }
  return `
    <li class="import-row" data-key="${esc(c.key)}">
      <input type="checkbox" class="import-pick" aria-label="Import ${esc(c.name)}"${isChosen(r) ? " checked" : ""}${r.status === "same" ? " disabled" : ""} />
      <div class="import-row-body">
        <span class="crm-list-name">${esc(c.name || "(no name)")}</span>
        ${sub ? `<span class="crm-list-sub">${esc(sub)}</span>` : ""}
        <span class="hint">${status}</span>
        <span class="hint">From ${esc(sources)}${c.otherOnly ? " (Other contacts)" : ""}</span>
        ${tagChips(Object.entries(c.labelsBySource).flatMap(([id, labels]) => labels.map((l) => (state.sources.size > 1 ? `${l} · ${state.sources.get(id)?.label ?? id}` : l))))}
      </div>
    </li>`;
}

function renderRows(rows: PlanRow[]): string {
  const shown = filtered(rows);
  if (rows.length === 0) return "";
  if (shown.length === 0) return `<p class="hint">Nobody matches these filters.</p>`;
  return `
    <p class="hint">${shown.length} shown${shown.length > SHOWN ? `, the first ${SHOWN} listed. Search to find someone further down` : ""}.
      <button type="button" class="link-button" data-pick="all">Tick all shown</button>
      <button type="button" class="link-button" data-pick="none">Untick all shown</button>
    </p>
    <ul class="import-list">${shown.slice(0, SHOWN).map(renderRow).join("")}</ul>`;
}

function renderSummary(rows: PlanRow[]): string {
  if (rows.length === 0) return "";
  const n = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const chosen = rows.filter(isChosen).length;
  const names = n("name");
  return `
    <p class="lead">${rows.length} people: ${n("new")} new, ${n("update")} with details to add, ${n("same")} already up to date.</p>
    ${
      names
        ? `<p class="import-check">${names} share a name with someone already in the CRM but nothing else. They are added as separate people unless you say they are the same.
            <button type="button" class="link-button" data-filter-status="name">Check them</button>
            <button type="button" class="link-button" id="merge-all-names">They're all the same people: merge</button></p>`
        : ""
    }
    <div class="crm-actions import-go">
      <button type="button" id="import-run"${chosen ? "" : " disabled"}>Import ${chosen} ${chosen === 1 ? "person" : "people"}</button>
      <span class="hint" id="import-progress" role="status"></span>
    </div>`;
}

function renderSources(clientId: string): string {
  const loaded = [...state.sources.values()];
  const loadedAccounts = new Set(loaded.filter((s) => s.kind === "google").map((s) => s.label));
  const again = rememberedAccounts().filter((a) => !loadedAccounts.has(a));
  return `
    <section class="stack crm-section" aria-labelledby="sources-h">
      <h2 id="sources-h">Sources</h2>
      ${
        loaded.length
          ? `<ul class="import-sources">${loaded
              .map(
                (s) => `
            <li data-source="${esc(s.id)}">
              <span><strong>${esc(s.label)}</strong> <span class="hint">${s.kind === "google" ? "Google account" : "file"} · ${s.people.length} entries</span></span>
              <label class="import-source-tags">Tag everyone from here
                <input type="text" class="import-source-tag" value="${esc(s.tags.join(", "))}" placeholder="e.g. fixmymedtech" />
              </label>
              <button type="button" class="link-button import-source-remove">Remove</button>
            </li>`
              )
              .join("")}</ul>`
          : ""
      }
      <div class="import-add">
        <button type="button" id="google-connect"${clientId ? "" : " disabled"}>Connect a Google account</button>
        ${again.map((a) => `<button type="button" class="ghost google-again" data-account="${esc(a)}">Check ${esc(a)} again</button>`).join("")}
      </div>
      <p class="hint">Connect each account in turn: personal and work ones all end up in the same list. The CRM only reads, it never changes anything in Google.</p>
      <label class="import-drop" id="import-drop">
        <input type="file" id="import-file" accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv" multiple />
        <span><strong>Drop contact files here</strong> or click to choose. vCard (.vcf) or CSV, as exported from contacts.google.com (Export, then vCard or Google CSV), Outlook or a phone.</span>
      </label>
      ${renderGoogleSetup(clientId)}
    </section>`;
}

function renderGoogleSetup(clientId: string): string {
  const origin = location.origin;
  return `
    <details class="import-setup"${clientId ? "" : " open"}>
      <summary>${clientId ? "Google sign-in setup" : "Set up Google sign-in (once, about 10 minutes)"}</summary>
      <ol>
        <li>Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud</a> and create a project, for example "Maps of Making CRM".</li>
        <li>Turn on the <a href="https://console.cloud.google.com/apis/library/people.googleapis.com" target="_blank" rel="noopener">People API</a> for it.</li>
        <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a>: audience <strong>External</strong>, leave it in <strong>Testing</strong>, and add every Google account you want to connect as a <strong>test user</strong>.</li>
        <li>Under <strong>Clients</strong>, create an OAuth client of type <strong>Web application</strong>. Add <code>${esc(origin)}</code> to <strong>Authorized JavaScript origins</strong>.</li>
        <li>Copy its client ID and paste it here.</li>
      </ol>
      <p class="hint">A work account on Google Workspace may refuse with "access blocked" until its admin allows this client ID (Admin console, Security, API controls, App access control).</p>
      <form id="google-client" class="crm-row">
        <div class="field">
          <label for="f-client">Google client ID</label>
          <input id="f-client" name="client" type="text" value="${esc(clientId)}" placeholder="1234567890-abc….apps.googleusercontent.com" />
        </div>
        <div class="crm-row-button"><button type="submit" class="small">Save</button></div>
      </form>
    </details>`;
}

function renderOptions(rows: PlanRow[]): string {
  if (state.sources.size === 0) return "";
  const labels = [...new Set(rows.flatMap((r) => r.candidate.labels))].sort();
  const f = state.filter;
  return `
    <section class="stack crm-section" aria-labelledby="review-h">
      <h2 id="review-h">Review</h2>
      <div class="import-options">
        <label class="crm-check"><input type="checkbox" id="opt-labels"${state.labelsAsTags ? " checked" : ""} /> Google labels become tags, marked with where they come from (a label "Partners" from a source tagged mapsofmaking becomes mapsofmaking/partners)</label>
        <label class="crm-check"><input type="checkbox" id="opt-other"${state.includeOther ? " checked" : ""} /> Include Other contacts (people Gmail saved because you emailed them)</label>
      </div>
      <div id="import-summary">${renderSummary(rows)}</div>
      <form class="crm-filter import-filter" role="search">
        <input type="search" name="q" value="${esc(f.q)}" placeholder="Search" aria-label="Search people" />
        <select name="status" aria-label="Filter by what happens">
          <option value="">Everyone</option>
          ${(Object.keys(STATUS_TEXT) as RowStatus[]).map((s) => `<option value="${s}"${f.status === s ? " selected" : ""}>${esc(STATUS_TEXT[s])}</option>`).join("")}
        </select>
        ${
          labels.length
            ? `<select name="label" aria-label="Filter by Google label"><option value="">All labels</option>${labels
                .map((l) => `<option value="${esc(l)}"${f.label === l ? " selected" : ""}>${esc(l)}</option>`)
                .join("")}</select>`
            : ""
        }
        ${
          state.sources.size > 1
            ? `<select name="source" aria-label="Filter by source"><option value="">All sources</option>${[...state.sources.values()]
                .map((s) => `<option value="${esc(s.id)}"${f.source === s.id ? " selected" : ""}>${esc(s.label)}</option>`)
                .join("")}</select>`
            : ""
        }
      </form>
      <div id="import-rows">${renderRows(rows)}</div>
    </section>`;
}

async function renderImport(ctx: Ctx): Promise<void> {
  const clientId = GOOGLE_CLIENT_ID || (await ctx.store.googleClientId().catch(() => ""));
  const rows = planRows(candidates(), ctx.data.contacts, ctx.data.organizations, options());
  renderScreen(ctx, {
    title: "Import contacts",
    eyebrow: "Google and files",
    body: `
      <p class="lead">Bring in everyone from your Google accounts and contact files. The same person in several places becomes one contact, and someone already in the CRM only gets what's missing: nothing you typed here is overwritten.</p>
      ${renderSources(clientId)}
      ${renderOptions(rows)}`,
  });
  wire(ctx, clientId, rows);
}

// ---------------------------------------------------------------- behaviour

function addSource(source: Source): void {
  state.sources.set(source.id, source);
}

async function connectGoogle(ctx: Ctx, clientId: string, account = ""): Promise<void> {
  const token = await requestToken(clientId, account);
  toast("Reading contacts from Google…");
  const data = await readGoogleAccount(token, (a) => `google:${a}`);
  const existing = state.sources.get(`google:${data.account}`);
  addSource({ id: `google:${data.account}`, label: data.account, kind: "google", people: data.people, tags: existing?.tags ?? defaultAccountTags(data.account) });
  rememberAccount(data.account);
  toast(`${data.people.length} entries from ${data.account}.`);
  await renderImport(ctx);
}

async function addFiles(ctx: Ctx, files: File[]): Promise<void> {
  let total = 0;
  for (const file of files) {
    const text = await file.text();
    const id = `file:${file.name}`;
    const people = parseContactsFile(text, id);
    if (people.length === 0) {
      toast(`No contacts found in ${file.name}. Is it a vCard (.vcf) or CSV export?`, { durationMs: 8000 });
      continue;
    }
    addSource({ id, label: file.name, kind: "file", people, tags: state.sources.get(id)?.tags ?? [] });
    total += people.length;
  }
  if (total) toast(`${total} entries read.`);
  await renderImport(ctx);
}

async function runImport(ctx: Ctx): Promise<void> {
  const progress = ctx.app.querySelector<HTMLElement>("#import-progress");
  // Plan against the pod as it is now, not as the screen loaded it: a contact
  // edited meanwhile on the phone keeps that edit.
  const fresh = await ctx.store.load();
  const rows = planRows(candidates(), fresh.contacts, fresh.organizations, options());
  const chosen = new Set(rows.filter(isChosen).map((r) => r.candidate.key));
  const writes = planWrites(rows, chosen, state.mergeByName, fresh.organizations, options(), ctx.store.docUrl("organizations"), ctx.store.docUrl("contacts"));
  if (writes.organizations.length) {
    if (progress) progress.textContent = `Saving ${writes.organizations.length} organizations…`;
    await ctx.store.saveInChunks("organizations", writes.organizations, (r) => organizationToThing(r));
  }
  const total = writes.contacts.length;
  await ctx.store.saveInChunks("contacts", writes.contacts, (r) => contactToThing(r), (done) => {
    if (progress) progress.textContent = `Saved ${done} of ${total}…`;
  });
  toast(`Imported: ${writes.created} new, ${writes.updated} updated${writes.organizations.length ? `, ${writes.organizations.length} new organizations` : ""}.`, { durationMs: 8000 });
  state.excluded.clear();
  await ctx.refresh();
}

function wire(ctx: Ctx, clientId: string, rows: PlanRow[]): void {
  const app = ctx.app;
  const rerenderRows = () => {
    const box = app.querySelector("#import-rows");
    if (box) box.innerHTML = renderRows(rows);
    const summary = app.querySelector("#import-summary");
    if (summary) summary.innerHTML = renderSummary(rows);
  };

  app.querySelector<HTMLButtonElement>("#google-connect")?.addEventListener("click", (e) => {
    void busy(e.currentTarget as HTMLButtonElement, () => connectGoogle(ctx, clientId));
  });
  app.querySelectorAll<HTMLButtonElement>(".google-again").forEach((b) =>
    b.addEventListener("click", () => {
      if (!clientId) return toast("Set up Google sign-in first.");
      void busy(b, () => connectGoogle(ctx, clientId, b.dataset.account!));
    })
  );

  const fileInput = app.querySelector<HTMLInputElement>("#import-file");
  fileInput?.addEventListener("change", () => {
    if (fileInput.files?.length) void busy(null, () => addFiles(ctx, [...fileInput.files!]));
  });
  const drop = app.querySelector<HTMLElement>("#import-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("import-drop-over");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("import-drop-over"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("import-drop-over");
    if (e.dataTransfer?.files.length) void busy(null, () => addFiles(ctx, [...e.dataTransfer!.files]));
  });

  const clientForm = app.querySelector<HTMLFormElement>("#google-client");
  clientForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = String(new FormData(clientForm).get("client") ?? "").trim();
    if (value && !/\.apps\.googleusercontent\.com$/.test(value)) {
      toast("A Google client ID ends in .apps.googleusercontent.com.");
      return;
    }
    void busy(clientForm.querySelector("button"), async () => {
      await ctx.store.setGoogleClientId(value);
      toast(value ? "Saved. You can connect your Google accounts now." : "Removed.");
      await renderImport(ctx);
    });
  });

  app.querySelectorAll<HTMLElement>("[data-source]").forEach((li) => {
    const id = li.dataset.source!;
    li.querySelector<HTMLInputElement>(".import-source-tag")?.addEventListener("change", (e) => {
      const source = state.sources.get(id);
      if (source) source.tags = parseTags((e.target as HTMLInputElement).value);
      void renderImport(ctx);
    });
    li.querySelector(".import-source-remove")?.addEventListener("click", () => {
      const source = state.sources.get(id);
      state.sources.delete(id);
      if (source?.kind === "google") forgetAccount(source.label);
      void renderImport(ctx);
    });
  });

  app.querySelector<HTMLInputElement>("#opt-labels")?.addEventListener("change", (e) => {
    state.labelsAsTags = (e.target as HTMLInputElement).checked;
    void renderImport(ctx);
  });
  app.querySelector<HTMLInputElement>("#opt-other")?.addEventListener("change", (e) => {
    state.includeOther = (e.target as HTMLInputElement).checked;
    void renderImport(ctx);
  });

  const filter = app.querySelector<HTMLFormElement>(".import-filter");
  const applyFilter = () => {
    const f = new FormData(filter!);
    state.filter = {
      q: String(f.get("q") ?? ""),
      status: String(f.get("status") ?? "") as "" | RowStatus,
      label: String(f.get("label") ?? ""),
      source: String(f.get("source") ?? ""),
    };
    rerenderRows();
  };
  filter?.addEventListener("submit", (e) => {
    e.preventDefault();
    applyFilter();
  });
  filter?.addEventListener("input", applyFilter);

  // One listener on the section for the rows, which are re-rendered on every filter.
  const review = app.querySelector<HTMLElement>("#import-rows")?.parentElement;
  review?.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-key]")?.dataset.key;
    if (!key) return;
    if (target.classList.contains("import-pick")) {
      if ((target as HTMLInputElement).checked) state.excluded.delete(key);
      else state.excluded.add(key);
      const summary = app.querySelector("#import-summary");
      if (summary) summary.innerHTML = renderSummary(rows);
    }
    if (target.classList.contains("import-name-choice")) {
      if ((target as HTMLSelectElement).value === "merge") state.mergeByName.add(key);
      else state.mergeByName.delete(key);
    }
  });
  review?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const pick = target.closest<HTMLElement>("[data-pick]")?.dataset.pick;
    if (pick) {
      for (const r of filtered(rows)) {
        if (pick === "all") state.excluded.delete(r.candidate.key);
        else state.excluded.add(r.candidate.key);
      }
      rerenderRows();
    }
    const status = target.closest<HTMLElement>("[data-filter-status]")?.dataset.filterStatus as RowStatus | undefined;
    if (status) {
      state.filter.status = status;
      const select = filter?.querySelector<HTMLSelectElement>('select[name="status"]');
      if (select) select.value = status;
      rerenderRows();
    }
    if (target.id === "merge-all-names") {
      for (const r of rows) if (r.status === "name") state.mergeByName.add(r.candidate.key);
      toast("Those people will be merged into the matching contacts.");
      rerenderRows();
    }
    if (target.id === "import-run") {
      void busy(target as HTMLButtonElement, () => runImport(ctx));
    }
  });
}

// Reached from the Contacts screen and Settings, not the top bar: it is used now and then, not daily.
registerRoute({ pattern: "/import", render: renderImport });
