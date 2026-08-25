# Schema — the rules of this map

## Node types

| `type:` | Lives at | Carries |
|---|---|---|
| object | `objects/<slug>.md` | one durable data type/state, per `_templates/object.md` |
| process | `processes/<slug>.md` | one movement that actually runs, per `_templates/process.md` |

## Labels that make it queryable

`type`, `cluster` (library / tts / playback), `universe` (live / leftover /
ghost — see [../CONTEXT.md](../CONTEXT.md)), `status` (stub / verified —
`verified` requires a date and citations), `entity` (path to the owning
source file).

## Naming

- Slugs: kebab-case, matching the noun/verb as a developer would say it out
  loud (`tts-provider`, not `providerinterface`).
- `_meta/` and `_templates/` hold the rules and blanks — never hand-edit
  `objects/_index.md`'s stub lines out of sync with the cards; regenerate by
  re-reading the cards if it drifts.
