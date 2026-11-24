# Importing contacts from Google

The import screen (`#/import`, linked from Contacts and Settings) brings in
people from contact files and from any number of Google accounts, personal and
work, into one reviewed list. Everyone is ticked by default.

## Files (no setup)

On contacts.google.com, pick the account, then **Export**, and choose
**vCard** or **Google CSV**. Drop the file on the import screen. Outlook CSV
and phone vCard exports work too. Files give no stable id, so re-importing a
file matches people by email, phone and LinkedIn only.

## Google accounts (once, about 10 minutes)

The CRM is a static app, so it signs in to Google from the browser with a
client ID you create once:

1. In Google Cloud, create a project (e.g. "Maps of Making CRM").
2. Enable the **People API**.
3. In **Google Auth Platform**: audience **External**, publishing status
   **Testing**, and add every Google account you will connect as a **test
   user**. Testing mode is fine for your own accounts: no Google review needed.
4. Under **Clients**, create an OAuth client of type **Web application** and add
   the CRM's address (e.g. `https://crm.mapsofmaking.org`, and
   `http://localhost:5173` for development) to **Authorized JavaScript origins**.
5. Paste the client ID on the import screen. It is saved in the pod, in
   `crm/settings.ttl#google`. To bake it into a build instead, set
   `GOOGLE_CLIENT_ID` in `src/config.ts`.

Scopes asked for, all read-only: `contacts.readonly`,
`contacts.other.readonly` and `userinfo.email` (to name the source after the
account). The token lives in the tab's memory for an hour and is never stored.

**Work accounts on Google Workspace** may show "access blocked" until the
domain's admin allows the client ID (Admin console, Security, API controls,
App access control, then trust the app by its client ID).

## Keeping up to date

Accounts connected before are offered as **Check … again** on the import
screen (remembered per browser). The list then shows only what changed:
people imported before are recognised by their Google id even if their email
changed, and only new details are added.
