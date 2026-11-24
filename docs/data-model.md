# CRM data model

Everything lives in your pod under `<pod root>/crm/`, one Turtle document per
collection. A record is a Thing at `<document>#<id>`; links between records
are plain IRIs.

| Document | Holds | Type |
|---|---|---|
| `contacts.ttl` | people | `vcard:Individual`, `schema:Person` |
| `organizations.ttl` | makerspaces, fablabs, partners, funders | `vcard:Organization`, `schema:Organization` |
| `projects.ttl` | projects and partnerships in the pipeline | `schema:Project` |
| `interactions.ttl` | the timeline: notes, emails, meetings, calls, chats | `crm:Interaction`, `schema:CommunicateAction` |
| `tasks.ttl` | follow-ups | `ical:Vtodo` |
| `settings.ttl` | pipeline stages | `crm:Stage` |

Prefixes: `vcard:` http://www.w3.org/2006/vcard/ns#, `schema:` https://schema.org/,
`ical:` http://www.w3.org/2002/12/cal/ical#, `dct:` http://purl.org/dc/terms/,
`crm:` https://w3id.org/solid-crm/vocab# (this app's own terms, only for what
no standard vocabulary says; terms are only ever added, never renamed).

Every record carries `dct:created` and `dct:modified` (xsd:dateTime).

**Calendar days** (a due date, a start date, connected-on) are stored as
xsd:dateTime at local noon, not xsd:date: solid-client writes xsd:date with
the UTC offset of the instant, which moves the day for anyone not on UTC.

## Contact

| Field | Predicate | Notes |
|---|---|---|
| name | `vcard:fn` | |
| emails | `vcard:hasEmail` | `<mailto:…>`. Used to match Gmail threads. |
| phones | `vcard:hasTelephone` | `<tel:…>` |
| role / headline | `vcard:title` | |
| organizations | `schema:worksFor` | org IRIs |
| LinkedIn | `schema:sameAs` | normalized to `https://www.linkedin.com/in/<slug>/`; the dedup key |
| LinkedIn status | `crm:linkedinStatus` | `interesting`, `request-sent`, `connected`, `met` |
| connected on | `crm:connectedOn` | day |
| Matrix ID | `crm:matrixId` | `@user:server`. Used to match Matrix chats. |
| other links | `vcard:url` | |
| tags | `schema:keywords` | lower case |
| note | `vcard:note` | |
| source | `dct:source` | `manual`, `linkedin`, `gmail`, `matrix`… |

## Organization

`vcard:fn` name, `schema:url` website, `schema:location` (text),
`schema:keywords` tags, `vcard:note`.

## Project

`schema:name`, `crm:stage` (a stage *key*, so renaming a stage moves nothing),
`schema:description`, `schema:member` (contact and organization IRIs),
`schema:startDate` / `schema:endDate` (days), `schema:keywords`.

## Interaction

`crm:channel` (`note`, `email`, `meeting`, `call`, `chat`, `linkedin`,
`event`), `schema:startTime`, `schema:name` (summary), `schema:description`
(details), `schema:about` (every contact, organization and project it
concerns), `schema:identifier` (the id in the source system — a Gmail message
id, a Matrix event id — so an import never logs the same thing twice).

Logging on a contact also links their organizations; logging on a project
also links its members. So each timeline shows everything relevant without a
query across documents.

## Task

`ical:summary`, `ical:due` (day), `ical:status` (`NEEDS-ACTION` /
`COMPLETED`) mirrored by `crm:done` (boolean), `schema:about`,
`ical:description`.

## Stage

`crm:key` (stable), `schema:name` (label), `schema:position`. With no stage in
`settings.ttl`, the app uses Idea, Discussing, Proposal, Active, Done, Paused
without writing them.

## Links into the app

Routes are hash-based. `#/contacts/new` takes query parameters to prefill the
form, for the LinkedIn bookmarklet and the phone's share menu: `name`, `role`
(or `headline`), `linkedin`, `text` / `url` (any text containing a LinkedIn
URL), `email`, `org` (matched by name, created if new), `tags`, `note`,
`status`, `matrix`, `source`. A LinkedIn URL already in the contacts opens that
contact instead of making a duplicate.

Plugins add screens with `registerRoute` from `src/crm/routes.ts`; see the
comment there.

### LinkedIn plugin

`#/linkedin` (`src/crm/views/linkedin.ts`) shows contacts that have a
`crm:linkedinStatus`, by status. It writes nothing new to the pod. Moving
someone saves the contact's status. Moving them to Connected or Met also sets
`crm:connectedOn` to today if it is empty. Each move past Interesting logs a
`crm:Interaction` with `crm:channel "linkedin"` on the contact and their
organizations.

Capture (`src/crm/linkedin/capture.ts`) ends on the prefill route above, with
`source=linkedin&status=interesting`. Android's share menu opens
`/share-target?title=&text=&url=` (the `share_target` in
`public/manifest.webmanifest`), which `main.ts` turns into that route. A deep
link survives sign-in because `main.ts` keeps the hash in `sessionStorage`
while the browser goes to the provider and back.
