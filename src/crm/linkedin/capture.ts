/**
 * Getting a LinkedIn profile into the CRM from wherever Jason is looking at it.
 *
 * LinkedIn offers no API for personal profiles or connections, and scraping
 * gets accounts restricted, so every way in here is something the person does
 * by hand on a page they are already viewing:
 *
 * - **Android**: the CRM is installed from the browser and appears in the
 *   share menu (`share_target` in `public/manifest.webmanifest`). Sharing a
 *   profile from the LinkedIn app opens `/share-target?title=…&text=…&url=…`.
 * - **iPhone**: iOS does not let web apps join the share menu, so a Shortcut
 *   does it, opening the URL from `shortcutUrlPrefix` with the shared text.
 * - **Computer**: a bookmarklet reads the profile page and opens the form.
 *
 * All three end on the core's prefill route, `#/contacts/new?…`, which pulls
 * the profile URL out of free text, dedups on it and opens an existing
 * contact instead of making a second one.
 */

/** Query parameters every capture adds, so captured people land in "To connect". */
export const CAPTURE_DEFAULTS = { source: "linkedin", status: "interesting" } as const;

/**
 * The person's name from what the LinkedIn app shares. Best effort: the app
 * shares "Check out Jane Doe’s profile on LinkedIn https://…" in English and a
 * translated sentence otherwise, so an unrecognised text gives "" and the
 * form simply asks for the name.
 */
export function nameFromShare(text: string, title = ""): string {
  const patterns = [
    /check out (.+?)[’'`]s? profile/i,
    /découvrez le profil de (.+?) sur linkedin/i,
    /bekijk het profiel van (.+?) op linkedin/i,
    /^(.+?)\s*[|–-]\s*linkedin\s*$/i,
  ];
  for (const source of [text, title]) {
    for (const re of patterns) {
      const m = source.trim().match(re);
      if (m && m[1].trim() && !/https?:/i.test(m[1])) return m[1].trim();
    }
  }
  return "";
}

/** The prefill route for a shared text/URL/title, with the capture defaults. */
export function captureRoute(input: { text?: string; url?: string; title?: string }): string {
  const params = new URLSearchParams();
  const name = nameFromShare(input.text ?? "", input.title ?? "");
  if (name) params.set("name", name);
  const text = [input.text, input.url].filter(Boolean).join(" ").trim();
  if (text) params.set("text", text);
  params.set("source", CAPTURE_DEFAULTS.source);
  params.set("status", CAPTURE_DEFAULTS.status);
  return `/contacts/new?${params}`;
}

/** The manifest's `share_target.action`. nginx and Vite both serve index.html for it. */
export const SHARE_TARGET_PATH = "/share-target";

/**
 * The hash route for an Android share-target launch, or null when the address
 * is not one. A path of its own rather than a flag on `/`: a browser builds
 * the launch URL by replacing the action's query string, and sign-in returns
 * to `/?code=&state=`, which must never be taken for a share.
 */
export function shareTargetRoute(pathname: string, search: string): string | null {
  if (pathname !== SHARE_TARGET_PATH) return null;
  const q = new URLSearchParams(search);
  const text = q.get("text") ?? "";
  const url = q.get("url") ?? "";
  const title = q.get("title") ?? "";
  if (!text && !url && !title) return null;
  return captureRoute({ text, url, title });
}

/**
 * What the iPhone Shortcut opens, followed by the shared text, URL-encoded.
 * `origin` is where the CRM is served, e.g. `https://crm.mapsofmaking.org`.
 */
export function shortcutUrlPrefix(origin: string): string {
  return `${origin.replace(/\/$/, "")}/#/contacts/new?source=${CAPTURE_DEFAULTS.source}&status=${CAPTURE_DEFAULTS.status}&text=`;
}

/**
 * A `javascript:` bookmark for a computer. Reads the name, headline and
 * address of the LinkedIn profile on screen and opens the CRM's form in a new
 * tab. LinkedIn's markup changes often, so each read falls back: the headline
 * is optional, and the name falls back to the page title ("Jane Doe | LinkedIn").
 */
export function bookmarkletSource(origin: string): string {
  const target = `${origin.replace(/\/$/, "")}/#/contacts/new?source=${CAPTURE_DEFAULTS.source}&status=${CAPTURE_DEFAULTS.status}`;
  const body = `(function(){
var d=document,e=encodeURIComponent,t=function(s){var n=d.querySelector(s);return n?n.textContent.trim():""};
var name=t("main h1")||d.title.replace(/^\\(\\d+\\)\\s*/,"").replace(/\\s*\\|\\s*LinkedIn.*$/i,"");
var role=t("main .text-body-medium.break-words");
if(!/linkedin\\.com\\/in\\//.test(location.href)){alert("Open someone's LinkedIn profile first.");return}
window.open(${JSON.stringify(target)}+"&name="+e(name)+"&role="+e(role)+"&linkedin="+e(location.href),"_blank")
})()`;
  return `javascript:${body.replace(/\n/g, "")}`;
}
