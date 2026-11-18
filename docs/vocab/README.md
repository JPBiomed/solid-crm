# Vocabulary

[`vocab.ttl`](vocab.ttl) is the vocabulary of Solid collectives,
`https://w3id.org/solid-collective/vocab#` (prefix label `sc:`). Why it
exists, its address and how documents move to it: ADR 006 §7, amended
2026-11-17.

- **Published in stages.** The protocol and the backoffice's data are in it;
  the pipeline's terms join once running it has settled them.
- **Terms are only ever added.** Documents on pods nobody here can rewrite
  carry these IRIs: a rename would strand them.
- **The redirect.** [`w3id/`](w3id/) holds what goes into a pull request to
  [`perma-id/w3id.org`](https://github.com/perma-id/w3id.org), as
  `ids/solid-collective/`, checked with that repository's own `w3id-check`:
  a browser gets this page, anything else the raw Turtle. GitHub serves that as `text/plain`, which RDF tools that
  dereference may refuse; serving it with `text/turtle` from an instance is
  a later step, and only the redirect changes then, never the namespace.
- **Nothing dereferences it today.** The backoffice, the connector and
  mom-home compare IRIs; none of them fetches the namespace. So the code
  moves first and the redirect may come later.
