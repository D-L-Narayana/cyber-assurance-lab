// Token scanning of shipped JavaScript for the browser-local contract (no network, no storage), including the
// structural recognition of the one legitimate `fetch(` that every Vite production bundle contains.
//
// Vite injects a <link rel="modulepreload"> polyfill IIFE into the entry chunk of each build. Minified (Vite 7.3.x,
// copied verbatim from a bundle in this repository; identifiers vary per build) it reads:
//
//   (function(){const o=document.createElement("link").relList;if(o&&o.supports&&o.supports("modulepreload"))return;
//   for(const d of document.querySelectorAll('link[rel="modulepreload"]'))r(d);new MutationObserver(d=>{for(const h of d)
//   if(h.type==="childList")for(const v of h.addedNodes)v.tagName==="LINK"&&v.rel==="modulepreload"&&r(v)}).observe(
//   document,{childList:!0,subtree:!0});function s(d){const h={};return d.integrity&&(h.integrity=d.integrity),
//   d.referrerPolicy&&(h.referrerPolicy=d.referrerPolicy),d.crossOrigin==="use-credentials"?h.credentials="include":
//   d.crossOrigin==="anonymous"?h.credentials="omit":h.credentials="same-origin",h}function r(d){if(d.ep)return;d.ep=!0;
//   const h=s(d);fetch(d.href,h)}})();
//
// It only ever fetches the `href` of <link rel="modulepreload"> elements that are already in the document — the app's
// own chunks on the same origin — in browsers without native modulepreload support. Rather than allow-listing every
// app, the scanner recognises this call structurally; ALL of the following must hold:
//   (1) the call has the shape `fetch(<ident>.href, <ident>)`;
//   (2) the preload marker assignment `<ident>.ep=!0` (or `=true`) occurs within the 200 characters before the call;
//   (3) both `modulepreload` and `relList` occur within the 1500 characters before the call.
// Any `fetch(` failing one of these tests is reported as a forbidden token. The cases in dist-tokens.test-data.json
// exercise the heuristic (`node tools/check-dist.mjs --self-test`).

import { DIST_FORBIDDEN_TOKENS, DIST_WARN_TOKENS } from './contracts.mjs';

export const FORBIDDEN_TOKENS = DIST_FORBIDDEN_TOKENS;
export const WARN_TOKENS = DIST_WARN_TOKENS;

/** Identifier-boundary regex for a token (so `prefetch(` does not match `fetch(` and `localStorageX` does not match). */
export function tokenRegex(token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tail = /[\w$]$/.test(token) ? '(?![\\w$])' : '';
  return new RegExp(`(?<![\\w$])${esc}${tail}`, 'g');
}

/** True when the `fetch(` at `index` is the call inside Vite's modulepreload polyfill (see header). */
export function isVitePreloadFetch(text, index) {
  const call = text.slice(index, index + 120);
  if (!/^fetch\(\s*[A-Za-z_$][\w$]*\.href\s*,\s*[A-Za-z_$][\w$]*\s*\)/.test(call)) return false;
  const near = text.slice(Math.max(0, index - 200), index);
  if (!/[A-Za-z_$][\w$]*\.ep\s*=\s*(?:!0|true)\s*[;,]/.test(near)) return false;
  const before = text.slice(Math.max(0, index - 1500), index);
  return before.includes('modulepreload') && before.includes('relList');
}

export function snippet(text, index, len, radius = 70) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  return `…${text.slice(start, end).replace(/\s+/g, ' ')}…`;
}

/**
 * Scan bundle text. Returns [{ token, index, kind, snippet }] where kind is
 * 'forbidden' | 'warn' | 'vite-modulepreload'.
 */
export function scanBundle(text, { forbidden = FORBIDDEN_TOKENS, warn = WARN_TOKENS } = {}) {
  const hits = [];
  const scan = (token, baseKind) => {
    const re = tokenRegex(token);
    let m;
    while ((m = re.exec(text))) {
      const kind = token === 'fetch(' && isVitePreloadFetch(text, m.index) ? 'vite-modulepreload' : baseKind;
      hits.push({ token, index: m.index, kind, snippet: snippet(text, m.index, token.length) });
    }
  };
  for (const t of forbidden) scan(t, 'forbidden');
  for (const t of warn) scan(t, 'warn');
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

/**
 * Run the cases in dist-tokens.test-data.json: each case has `text` and `expect` = { token: kind } for the hits that
 * must be present (and no other token may hit). Returns { ok, results: [{ name, ok, got, expect }] }.
 */
export function runSelfTest(data) {
  const results = [];
  for (const c of data.cases) {
    const hits = scanBundle(c.text);
    const got = {};
    for (const h of hits) got[h.token] = got[h.token] && got[h.token] !== h.kind ? 'mixed' : h.kind;
    const expectKeys = Object.keys(c.expect).sort();
    const gotKeys = Object.keys(got).sort();
    const ok = JSON.stringify(expectKeys) === JSON.stringify(gotKeys) && expectKeys.every((k) => got[k] === c.expect[k]);
    results.push({ name: c.name, ok, got, expect: c.expect });
  }
  return { ok: results.every((r) => r.ok), results };
}
