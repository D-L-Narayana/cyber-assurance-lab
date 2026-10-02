# Third-party notices

Runtime and build dependencies (see `package-lock.json` for exact versions; licenses are preserved inside `node_modules/*/LICENSE`):

| Package | License | Source |
|---|---|---|
| react, react-dom | MIT | https://github.com/facebook/react |
| vite | MIT | https://github.com/vitejs/vite |
| @vitejs/plugin-react | MIT | https://github.com/vitejs/vite-plugin-react |
| vitest | MIT | https://github.com/vitest-dev/vitest |
| typescript | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/react, @types/react-dom | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

Self-hosted fonts (bundled as woff2 by Vite from Fontsource packages; package wrappers MIT, font files SIL Open Font License 1.1):

| Font | License | Source |
|---|---|---|
| Big Shoulders Display (Patric King) via `@fontsource-variable/big-shoulders-display` | OFL-1.1 | https://github.com/xotypeco/big_shoulders · https://fontsource.org/fonts/big-shoulders-display |
| IBM Plex Sans, IBM Plex Mono (IBM) via `@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | OFL-1.1 | https://github.com/IBM/plex · https://fontsource.org/fonts/ibm-plex-sans |

No UI component libraries, icons, trackers or external CDNs are used. The 21st.dev component catalog was not used (sign-in required at build time).
