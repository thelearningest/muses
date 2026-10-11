# Playable Books design reference

Approved direction, 11 October 2026: Apple Books' serif headings and emphasis on covers, combined with Literal's restrained desktop layout. This folder records the direction for a future home and library redesign. The application still uses its existing interface.

## Files

| File | Purpose |
| --- | --- |
| [Design language](DESIGN_LANGUAGE.md) | Palette, typography, spacing, layout, and interaction rules |
| [Components](COMPONENTS.md) | Proposed components, states, and connections to the existing application |
| [Visual component board](components.html) | Original visual samples and a gallery of the selected references |
| [Design tokens](tokens.css) | Proposed CSS variables, scoped to the reference board |
| [Reference manifest](references.json) | Source links, platforms, download date, file sizes, and checksums |
| `images/` | Four full-resolution images downloaded from Mobbin's returned image URLs |

Open `components.html` in a browser to review the samples. It has no external dependencies. Its buttons and progress values illustrate states; it does not upload books or run games.

## Selected references

| App | Platform | Visible pattern | Role in this direction |
| --- | --- | --- | --- |
| [Apple Books](https://mobbin.com/screens/fa54930d-72ec-44e1-b65d-f8b50aa6e173) | iOS | Serif section headings, a compact Continue card, and large book covers | Main reference for typography and book emphasis |
| [Literal](https://mobbin.com/screens/dd0731b7-2410-4bd2-9623-b0cc0c60ee89) | Web | Light navigation, thin separators, small covers, and restrained text | Main reference for desktop spacing and navigation |
| [Headway](https://mobbin.com/screens/b1782664-c1ad-4ea0-a4f6-204cabb222e7) | iOS | Warm background and a two-column cover grid | Supporting reference for the shelf layout |
| [Speechify](https://mobbin.com/screens/1e0a8afe-8e6d-4655-abfb-a9528eafc47f) | iOS | Compact document rows, thumbnails, and progress metadata | Supporting reference for dense libraries and PDF metadata |

The Literal screenshot includes an open account menu. Its navigation and reading list remain visible; the menu is not a proposed component for Playable Books. The mobile references inform typography and components, not the desktop navigation structure.

The saved images retain their original content and Mobbin attribution. They are design references, not application artwork. Keep source links with the images. The board's text-only book cover is an original placeholder rather than an extracted cover.

## Scope

The first implementation target is the home and library screen in `app/BookRpgApp.tsx`. Its stylesheet is `app/globals.css`. Shared global styles also affect `app/Game.tsx`, so a later implementation needs scoped home styles or a deliberate review of shared selectors.

Generation, browser storage, upload limits, rights confirmation, verification, job recovery, and game behavior remain existing product requirements. This folder does not introduce accounts, cloud sync, cover extraction, or chapter-generation features.
