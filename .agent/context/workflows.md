# Workflows

## Development

```bash
npm run watch
```

Use watch mode while iterating on `code.ts`, then reload the plugin in Figma.

## Verification

```bash
npm run build
npm run lint
```

There is no automated runtime test suite. The real verification loop is loading the plugin inside Figma and exercising both menu commands against real icon selections.

## Change Notes

- Changes to `manifest.json` affect command wiring and permissions.
- Changes to annotation positioning logic should be tested with icons inside frames and icons directly on the page.
- Keep `code.js` in sync with `code.ts` when the repo expects compiled output to be tracked.
