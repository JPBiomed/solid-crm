/**
 * Reading contacts from Google accounts, in the browser, with Google's People API.
 *
 * No server: the CRM is a static app (like the rest of the kit), so it uses
 * Google Identity Services' token flow. Each "Connect" opens Google's account
 * picker; the token it hands back lives in this tab's memory for an hour and
 * is never stored. Read-only scopes: the CRM never writes to Google.
 *
 * It needs an OAuth client ID of type "Web application" whose authorized
 * JavaScript origins include the CRM's address. The steps are in
 * docs/google-contacts.md and on the import screen.
 */
import { emptyPerson, finishPerson, isUsable, type ImportPerson } from "./parse";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  // Only to learn which account was picked, so each source is named after it.
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const API = "https://people.googleapis.com/v1";

// ---------------------------------------------------------------- the People API's shapes (the parts read)

interface GName { displayName?: string; unstructuredName?: string }
interface GValue { value?: string }
interface GOrg { name?: string; title?: string }
interface GMembership { contactGroupMembership?: { contactGroupResourceName?: string } }
export interface GPerson {
  resourceName: string;
  names?: GName[];
  emailAddresses?: GValue[];
  phoneNumbers?: (GValue & { canonicalForm?: string })[];
  organizations?: GOrg[];
  urls?: GValue[];
  biographies?: GValue[];
  memberships?: GMembership[];
}
export interface GGroup { resourceName: string; name?: string; formattedName?: string; groupType?: string }

/**
 * One People API person as an import entry. `groups` maps a contact group's
 * resource name to the label shown in Google Contacts.
 */
export function fromGooglePerson(g: GPerson, account: string, sourceId: string, groups: Map<string, string>, other = false): ImportPerson {
  const p = emptyPerson(sourceId);
  p.externalId = `google:${account}:${g.resourceName}`;
  p.other = other;
  const name = g.names?.[0];
  p.name = name?.displayName ?? name?.unstructuredName ?? "";
  p.emails = (g.emailAddresses ?? []).map((e) => e.value ?? "");
  p.phones = (g.phoneNumbers ?? []).map((t) => t.canonicalForm || t.value || "");
  p.orgs = (g.organizations ?? []).map((o) => o.name ?? "");
  p.role = g.organizations?.find((o) => o.title)?.title ?? "";
  p.links = (g.urls ?? []).map((u) => u.value ?? "");
  p.note = (g.biographies ?? []).map((b) => b.value ?? "").join("\n");
  p.labels = (g.memberships ?? [])
    .map((m) => groups.get(m.contactGroupMembership?.contactGroupResourceName ?? "") ?? "")
    .filter(Boolean);
  if (other) p.labels.push("Other contacts");
  return finishPerson(p);
}

/** User labels by their name; of Google's own groups only "Starred" says something. */
export function groupLabels(groups: GGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of groups) {
    if (g.groupType === "SYSTEM_CONTACT_GROUP" && g.resourceName !== "contactGroups/starred") continue;
    const label = g.formattedName || g.name;
    if (label) map.set(g.resourceName, label);
  }
  return map;
}

// ---------------------------------------------------------------- sign-in

interface TokenResponse { access_token?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void }
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient(config: Record<string, unknown>): TokenClient } } };
  }
}

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error("Could not load Google sign-in. Check the connection, or an ad blocker."));
    };
    document.head.append(script);
  });
  return gisLoading;
}

/**
 * Opens Google's account picker and resolves with an access token. With
 * `account`, Google goes straight to that account and asks nothing if it was
 * already allowed: that is "Check for changes".
 */
export async function requestToken(clientId: string, account = ""): Promise<string> {
  await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (r: TokenResponse) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || r.error || "Google sign-in failed."))),
      error_callback: (e: { type?: string; message?: string }) =>
        reject(new Error(e.type === "popup_closed" ? "The Google window was closed." : e.message || "Google sign-in failed.")),
    });
    client.requestAccessToken(account ? { prompt: "", login_hint: account } : { prompt: "select_account" });
  });
}

// ---------------------------------------------------------------- reading

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // Not JSON: the status says enough.
    }
    if (res.status === 403 && /has not been used|is disabled/i.test(detail)) {
      throw new Error("The People API is not turned on in the Google Cloud project. Turn it on, then try again.");
    }
    throw new Error(`Google answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

async function pages<T>(token: string, path: string, field: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await get<Record<string, unknown>>(token, `${path}${pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    out.push(...((page[field] as T[] | undefined) ?? []));
    pageToken = (page.nextPageToken as string | undefined) ?? "";
  } while (pageToken);
  return out;
}

export interface GoogleAccountData {
  account: string;
  people: ImportPerson[];
}

/** Everything in one account: saved contacts (with labels) and "Other contacts". */
export async function readGoogleAccount(token: string, sourceIdFor: (account: string) => string): Promise<GoogleAccountData> {
  const me = await get<{ emailAddresses?: GValue[] }>(token, "/people/me?personFields=emailAddresses");
  const account = (me.emailAddresses?.[0]?.value ?? "google").toLowerCase();
  const sourceId = sourceIdFor(account);
  const [groups, connections, others] = await Promise.all([
    pages<GGroup>(token, "/contactGroups?pageSize=1000", "contactGroups"),
    pages<GPerson>(token, "/people/me/connections?pageSize=1000&personFields=names,emailAddresses,phoneNumbers,organizations,urls,biographies,memberships", "connections"),
    pages<GPerson>(token, "/otherContacts?pageSize=1000&readMask=names,emailAddresses,phoneNumbers", "otherContacts"),
  ]);
  const labels = groupLabels(groups);
  const people = [
    ...connections.map((g) => fromGooglePerson(g, account, sourceId, labels)),
    ...others.map((g) => fromGooglePerson(g, account, sourceId, labels, true)),
  ].filter(isUsable);
  return { account, people };
}
