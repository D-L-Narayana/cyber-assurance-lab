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
| Syne (Bonjour Monde) via `@fontsource-variable/syne` | OFL-1.1 | https://gitlab.com/bonjour-monde/fonderie/syne-typeface · https://fontsource.org/fonts/syne |
| Archivo (Omnibus-Type) via `@fontsource-variable/archivo`; JetBrains Mono (JetBrains) via `@fontsource-variable/jetbrains-mono` | OFL-1.1 | https://github.com/Omnibus-Type/Archivo · https://github.com/JetBrains/JetBrainsMono · https://fontsource.org |

No UI component libraries, icons, trackers or external CDNs are used. The 21st.dev component catalog was not used (sign-in required at build time).
