# The City of Misfit Things

A browser RPG studio for learning human-centered design. Play the bundled
six-quest museum apprenticeship or upload a design-book PDF and generate a new,
source-grounded field study using the same interaction system.

## Experience

- six original quests covering discoverability, mapping and feedback, knowledge
  in the world, constraints, error recovery, and human-centered design
- immediate explanatory feedback with no score penalty for experimentation
- a WebGL gate inspector with orbit, zoom, focused views, and a static fallback
- optional browser-voice narration that lowers the ambient soundtrack while speaking
- a responsive editorial museum interface with keyboard and reduced-motion support
- device-local progress saved under `design-warden-progress:v1`
- one-shot PDF-to-RPG generation with 4–9 source-anchored quests
- book-specific procedural visuals for every quest, including at least one interactive 3D design exercise
- a device-local library of generated games

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

PDF generation requires an OpenAI API key on the server:

```bash
OPENAI_API_KEY=your_key_here
```

The default generation profile is `gpt-5.6-sol` with high reasoning and Fast
mode. Override it with `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, or
`OPENAI_SERVICE_TIER`. The upload route
accepts text-based PDFs up to 50 MB. Generated games and player progress stay in
the browser's local storage; the application does not retain uploaded PDFs.

Run the production build and rendered-output tests before you commit:

```bash
npm test
npm run lint
```

The default scripts use vinext and package the site for OpenAI Sites. The MVP
uses no database or application accounts. OpenAI API usage is billed separately.

## Vercel deployment

Use the native Next.js scripts to test the Vercel build locally:

```bash
npm run dev:vercel
npm run build:vercel
npm run start:vercel
```

`vercel.json` selects `npm run build:vercel` during deployment. The Vercel
TypeScript configuration checks the application code without loading the
OpenAI Sites and Cloudflare build files.
