# Project Overview

`figma-icon-annotator` is a lightweight Figma plugin for placing locked annotation callouts next to icon nodes.

## Commands

```bash
npm run build
npm run watch
npm run lint
npm run lint:fix
```

## Architecture

- `code.ts` is the entire plugin backend and compiles to `code.js`.
- `manifest.json` exposes two commands: `annotate` and `realign`.
- The plugin is backend-only; there is no separate HTML UI.

## Core Behaviour

- Selected nodes must use an icon naming prefix such as `ic_`, `ig_`, `img_`, or `icon_`.
- `annotate` creates a locked annotation wrapper with a dashed connector and a label that records the target node ID and a generated UUID in plugin data.
- `realign` is expected to reposition annotations after layout changes.
- Annotation placement is based on the nearest side gap between the target node and its outer frame or page bounds.
- The plugin has `allowedDomains: ["none"]`; any change that introduces network access should be treated as a deliberate product decision.

## Key Files

- `code.ts`
- `manifest.json`
- `tsconfig.json`
- generated `code.js`
