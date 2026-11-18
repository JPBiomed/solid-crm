/**
 * The shell: login → pod discovery → your app.
 *
 * No framework, no router. Screens are functions that replace the contents of
 * `#app`. That is enough for an app of this size, and it is what the three apps
 * this kit was extracted from all converged on independently.
 *
 * `startCrm` is the app; everything above it is the kit's shell, unchanged.
 */
import "./styles/fonts.css";
import "./styles/core.css";
import "./styles/theme.css";
import "./styles/patterns.css";
import "./styles/editorial.css";
import { completeLogin, loginWithIdentifier, logout } from "./lib/auth";
import { describePodError, getPrimaryPodUrl, isAuthError } from "./lib/pod";
import { APP_NAME, DEFAULT_IDENTIFIER } from "./config";
import { focusView, trackInputModality } from "./ui/a11y";
import { renderError, renderPending } from "./ui/patterns";
import { renderThemeButton, wireThemeButton } from "./ui/theme";
import "./styles/crm.css";
import { CrmStore, DemoStore } from "./crm/store";
import { parseHash, resolve, type Ctx } from "./crm/routes";
import { seedDemo } from "./crm/demo";
// Screens register their routes on import. Plugins add theirs the same way.
import "./crm/views/home";
import "./crm/views/contacts";
import "./crm/views/organizations";
import "./crm/views/projects";
// Plugins.
import "./crm/views/linkedin";
import { SHARE_TARGET_PATH, shareTargetRoute } from "./crm/linkedin/capture";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Escapes text before it goes into innerHTML — WebIDs and errors are inputs. */
function esc(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/**
 * The theme button, at the foot of every screen a person can stop at — Light
 * by default, then Dark, then the device's own setting (ADR 008). Part of the shell,
 * not of a screen, so every screen keeps it.
 */
function themeFooter(): string {
  return `
    <footer class="stack">
      <hr />
      <div>${renderThemeButton()}</div>
    </footer>`;
}

/**
 * Deep links — the phone's share menu, the bookmarklet, an iPhone Shortcut —
 * open the app on a hash route such as `#/contacts/new?…`. Sign-in cannot
 * keep it: OIDC refuses a redirect URL with a fragment, so both a fresh login
 * and the silent session restore on every page load come back to the bare
 * address. The route is put aside in this tab before sign-in and taken back
 * after it.
 */
const PENDING_ROUTE = "crm:pending-route";

function rememberRoute(): void {
  // Android's share target launches `/share-target?text=…`: turn it into the
  // prefill route on `/`, which is also the only address sign-in redirects to.
  if (location.pathname === SHARE_TARGET_PATH) {
    const route = shareTargetRoute(location.pathname, location.search);
    history.replaceState(null, "", `/${route ? `#${route}` : ""}`);
  }
  try {
    if (location.hash.length > 2) sessionStorage.setItem(PENDING_ROUTE, location.hash);
    // A plain visit (no hash, not a return from the provider) clears a leftover.
    else if (!/[?&](code|state)=/.test(location.search)) sessionStorage.removeItem(PENDING_ROUTE);
  } catch {
    // Storage blocked: deep links then only work when already signed in.
  }
}

function restoreRoute(): void {
  try {
    const pending = sessionStorage.getItem(PENDING_ROUTE);
    sessionStorage.removeItem(PENDING_ROUTE);
    if (pending && location.hash.length <= 2) history.replaceState(null, "", `${location.pathname}${pending}`);
  } catch {
    // See rememberRoute.
  }
}

async function main(): Promise<void> {
  const state = await completeLogin();
  if (state.loggedIn) restoreRoute();

  if (!state.loggedIn) {
    renderLoginView(
      state.offline
        ? "Could not reach the identity layer from here — check the connection, or try again from the app's own address."
        : undefined
    );
    return;
  }

  const webId = state.webId!;
  renderLoadingView(webId);

  try {
    const podUrl = await getPrimaryPodUrl(webId);
    await startCrm(new CrmStore(podUrl), webId, podUrl);
  } catch (err) {
    renderErrorView(webId, err);
  }
}

function renderLoginView(message?: string): void {
  app.innerHTML = `
    <main class="screen stack">
      <h1>${esc(APP_NAME)}</h1>
      <p class="lead">
        Sign in with your pod's address, or with your WebID if you don't know
        which provider hosts it — it will be discovered from your profile.
      </p>
      <form id="login-form" class="stack">
        <div class="field">
          <label for="identifier">Pod or WebID</label>
          <input id="identifier" name="identifier" type="url"
                 value="${esc(DEFAULT_IDENTIFIER)}" required />
        </div>
        <div><button type="submit">Sign in</button></div>
      </form>
      ${message ? `<p class="error">${esc(message)}</p>` : ""}
      ${themeFooter()}
    </main>
  `;

  const form = document.querySelector<HTMLFormElement>("#login-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#identifier")!;
    const button = form.querySelector("button")!;
    button.disabled = true;
    button.textContent = "Redirecting…";
    try {
      await loginWithIdentifier(input.value.trim());
    } catch (err) {
      renderLoginView(err instanceof Error ? err.message : String(err));
    }
  });

  focusView(app);
}

function renderLoadingView(webId: string): void {
  app.innerHTML = `
    <main class="screen stack">
      <h1 class="visually-hidden" data-view-title>Connecting</h1>
      <p class="lead">Signed in as <code>${esc(webId)}</code>.</p>
      ${renderPending("Looking for your pod…")}
    </main>
  `;
  focusView(app);
}

/**
 * Pod discovery failed — which, on a pod app, is a routine outcome rather than
 * an exceptional one, and never the user's mistake.
 *
 * Rendered by `renderError` rather than by hand so it cannot become a dead end:
 * the component refuses an error state that offers no way forward. An expired
 * session is the common case here and it has a real answer — sign in again —
 * so the copy says that rather than leaving someone staring at a status code.
 */
function renderErrorView(webId: string, err: unknown): void {
  app.innerHTML = `
    <main class="screen stack">
      ${renderError({
        title: isAuthError(err) ? "Your session ended" : "Could not reach your pod",
        detail: describePodError(err),
        recovery: isAuthError(err)
          ? "Nothing was lost — your work is in the pod, not in this tab. Signing in again brings it back."
          : "Your pod is unaffected. This is about reaching it from here, not about what is in it.",
        action: { label: "Sign in again", id: "logout" },
        technical: err instanceof Error ? err.message : String(err),
      })}
      <p class="meta">Signed in as <code>${esc(webId)}</code>.</p>
      ${themeFooter()}
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    await logout();
    renderLoginView();
  });

  focusView(app);
}

/**
 * The CRM. Each navigation reloads the collections (revalidated reads, so a
 * screen never shows something older than the pod) and renders the route.
 */
async function startCrm(store: CrmStore, webId: string, podUrl: string): Promise<void> {
  let data = await store.load();
  let generation = 0;

  const render = async (reload: boolean) => {
    const mine = ++generation;
    if (reload) {
      try {
        data = await store.load();
      } catch (err) {
        renderErrorView(webId, err);
        return;
      }
    }
    // A slower load from an earlier navigation must not paint over a newer one.
    if (mine !== generation) return;
    const { path, query } = parseHash(location.hash);
    const match = resolve(path) ?? resolve("/")!;
    const ctx: Ctx = {
      app, store, data, webId, podUrl, query,
      params: match.params,
      go: (to) => {
        if (location.hash === `#${to}`) void render(true);
        else location.hash = to;
      },
      refresh: () => render(true),
    };
    await match.route.render(ctx);
  };

  window.addEventListener("hashchange", () => void render(true));
  await render(false);
}

async function startDemo(): Promise<void> {
  const store = new DemoStore();
  await seedDemo(store);
  await startCrm(store, "https://demo.invalid/profile/card#me", store.root);
}

rememberRoute();
trackInputModality();
// Once, on the container: every screen replaces its contents, switch included.
wireThemeButton(app);
// `?demo`: the whole app on sample data, nothing read from or written to a pod.
if (new URLSearchParams(location.search).has("demo")) void startDemo();
else void main();
