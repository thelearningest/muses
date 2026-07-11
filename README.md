# The City of Misfit Things

A six-quest educational browser RPG about human-centered design. Players enter
an after-hours object museum, inspect confusing artifacts, diagnose the design
burden, apply a repair, and add each learned principle to a field journal.

## Experience

- six original quests covering discoverability, mapping and feedback, knowledge
  in the world, constraints, error recovery, and human-centered design
- immediate explanatory feedback with no score penalty for experimentation
- a responsive editorial museum interface with keyboard and reduced-motion support
- device-local progress saved under `design-warden-progress:v1`

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm test
```

The site runs on vinext and is packaged for OpenAI Sites. The game itself uses
no database, authentication, uploads, or external data service.
