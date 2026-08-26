# WebKit User-Plugin Sandbox Validation

Status: **fail-closed on Safari and iOS WebKit**. The Worker capability lockdown from this investigation is on `main`; user-installed plugins still do not run on WebKit.

This note records the real-device findings from 2026-08-26. It is a security-acceptance record, not a decision to ship user plugins on WebKit.

## Summary

Chrome already isolated user plugins in an opaque-origin iframe Worker. Safari and iOS WebKit were left fail-closed because CSP inheritance and storage isolation had not been verified on real devices.

The validation confirmed most of the intended boundary:

- The plugin Worker origin is `null`.
- `document`, `window`, `parent`, and `localStorage` are unavailable.
- Direct IndexedDB is denied.
- Direct `fetch`, `WebSocket`, and `importScripts` do not leave the Worker.
- Host services honor the installation permission snapshot.

It also found a WebKit-specific hole that Chrome did not show:

- `Cache Storage` is available inside the opaque Worker.
- That cache persists across Worker restarts.
- Distinct user plugins share the same cache and can read or write each other's entries.

A Worker bootstrap lockdown now removes `Cache Storage` and other host-sensitive APIs before plugin source is imported. After that change, macOS Safari, iPhone Safari, and the iPhone home-screen PWA no longer exposed the shared cache. Safari and iOS remain fail-closed anyway.

## Current product behavior

Bundled, reviewed plugins continue to run on every supported browser. They never enter the user-plugin sandbox.

User-installed npm, JSR, and local plugins:

| Runtime | Behavior |
|---|---|
| Desktop Chromium | Sandbox executes the plugin |
| macOS Safari | Fail-closed before iframe/Worker creation |
| iPhone / iPad Safari | Fail-closed |
| iOS Chrome / Firefox / Edge | Fail-closed (WebKit) |
| iOS home-screen PWA | Fail-closed |

The user-visible error is:

```text
Safari/WebKit sandbox network isolation has not been verified
```

Chinese UI:

```text
Safari/WebKit 的插件网络隔离尚未完成真机验证，当前已安全禁用用户插件
```

Fail-closed means the host does not create the iframe, does not start a Worker, does not execute user source, and does not persist a failed installation.

## Why Chrome was not enough

The sandbox depends on this chain:

```text
sandboxed iframe
→ opaque origin
→ Blob Worker created inside the iframe
→ Worker inherits iframe CSP
   connect-src 'none'
```

WebKit has historically differed from Chromium on:

- `sandbox` iframes
- `blob:` Workers
- Worker CSP inheritance
- `srcdoc` / opaque-origin storage
- standalone PWA lifetime

A Chrome pass therefore cannot certify Safari, iOS Safari, or an iOS PWA.

## Method

Validation used a temporary branch that disabled the WebKit fail-closed check only in Vite `DEV`. Production builds and the committed `main` branch never used that bypass. The branch was deleted after the tests.

Network exfiltration was checked with a dedicated [webhook.site](https://webhook.site) URL. A request appearing there means the Worker actually sent traffic. A thrown `fetch` error alone is not enough, because the request may already have left the process.

Direct isolation was reported by probe plugins during module evaluation. Host-permission checks used the same `loadPluginRuntime()` / tool RPC path as the Agent.

iPhone testing used a temporary Cloudflare Quick Tunnel in front of the local Vite server. That origin was separate from desktop `localhost` IndexedDB. The tunnel was closed after the session.

## Environments

| Surface | Version |
|---|---|
| macOS | 26.5.2 (25F84) |
| macOS Safari | 26.5.2 (21624.2.5.11.8) |
| iPhone OS | 18.7 |
| iPhone Safari / PWA | 26.6, WebKit/605.1.15 |
| Local app | `test/webkit-sandbox-validation` over Vite DEV |

iPad was not tested.

## Findings before lockdown

On macOS Safari, the first probe reported:

```text
o:null,d:1,w:1,p:1,ls:1,idb:1,cache:0,fetch:1,ws:1,imports:1
```

Meaning:

| Check | Result |
|---|---|
| Worker origin | `null` |
| `document` / `window` / `parent` | Unavailable |
| `localStorage` | Unavailable |
| IndexedDB | Denied |
| Direct `fetch` | Denied, webhook count `0` |
| `WebSocket` | Denied |
| `importScripts` | Denied |
| `Cache Storage` | **Available** |

The host-visible Cache Storage still only contained the marker created by the Kalo page:

```text
["kalo-host-isolation-marker"]
```

The plugin Worker could not see that host marker (`hostcache:0`). So this was not same-origin access to the Kalo origin.

It was still a sandbox failure:

1. Installing probe `1.0.2` created `kalo-webkit-plugin-persistence-marker` and left it in place.
2. Enabling the same plugin started a new Worker.
3. The new Worker saw the previous Worker's cache (`plugincache:1`).
4. The probe description therefore changed, the persisted descriptor hash no longer matched, and Kalo correctly refused to load the plugin.
5. A second plugin with a different id, `webkit_cross_plugin_probe`, could see that cache (`other:1`) and write into it (`write:1`).
6. After cleanup, the Kalo page still could not see the plugin cache.

So WebKit gave opaque Workers a persistent Cache Storage that is isolated from the Kalo origin but shared across user plugins. That bypasses scoped plugin storage and the 512 KiB quota.

Host services were already correct on this surface:

```text
declared storage     allowed
undeclared profile   denied
undeclared logs      denied
undeclared network   denied
webhook requests     0
```

## Lockdown

`apps/web/src/lib/plugins/sandbox.ts` now freezes native `Object` / `Reflect` helpers, then removes or fails closed on host-sensitive capabilities **before** `import()` of plugin source.

Blocked `WorkerGlobalScope` names include:

```text
caches
fetch
importScripts
WebSocket
WebSocketStream
WebTransport
EventSource
XMLHttpRequest
Worker
SharedWorker
BroadcastChannel
RTCPeerConnection
indexedDB
cookieStore
postMessage
```

Blocked `WorkerNavigator` names include:

```text
storage
locks
serviceWorker
clipboard
credentials
geolocation
permissions
mediaDevices
gpu
bluetooth
hid
serial
usb
wakeLock
keyboard
```

If a named capability remains reachable after the lock attempt, initialization fails instead of starting the plugin.

This is defense in depth. It does not replace CSP, permission snapshots, schema checks, or the WebKit fail-closed gate.

## Findings after lockdown

The same first probe then reported:

```text
o:null,d:1,w:1,p:1,ls:1,idb:1,cache:1,hostcache:0,plugincache:0,cachekeys:0,fetch:1,ws:1,imports:1
```

Enabling the plugin no longer produced a descriptor mismatch, because the new Worker could not see a leftover cache.

A second probe walked prototype chains and constructors, used `Function("return import(url)")`, and tried to assign `location.href`. After a full page reload it reported:

```json
{
  "exposedGlobals": [],
  "exposedNavigator": [],
  "dynamicImportDenied": true,
  "locationNavigationDenied": true,
  "cacheStorageConstructorDenied": true,
  "idbFactoryConstructorDenied": true,
  "storageManagerConstructorDenied": true
}
```

Webhook request count remained `0`.

## Surface results after lockdown

All of the following were exercised on the temporary DEV bypass. They describe WebKit sandbox behavior, not the shipped fail-closed product.

### macOS Safari 26.5.2

Passed:

- Opaque origin and missing DOM globals
- IndexedDB denied
- Cache Storage removed before import
- Direct network APIs blocked, no webhook traffic
- Prototype / constructor recovery failed
- Declared scoped storage worked
- Undeclared profile, logs, and network services were denied
- Unsafe `pattern` schemas were rejected before install
- Synchronous infinite-loop init timed out in 10s; the page stayed responsive
- Permanently pending init timed out in 10s; the page stayed responsive
- Failed installs left no `pluginInstallations` / `pluginModules` records

### iPhone Safari 26.6

The same isolation, permission, schema, and timeout checks passed. Webhook count remained `0`.

One flake: after enabling the recovery probe and reloading, the first re-init hit `初始化插件沙箱超时`. A later `getPluginStates()` / tool call succeeded and still reported a full lockdown. The likely cause is a slow CSP rejection of the probe's top-level dynamic `import()`, not a recovered network API. No request reached the webhook.

### iPhone home-screen PWA

`navigator.standalone === true`. Isolation and host-permission results matched iPhone Safari. After backgrounding the app for at least 10 seconds and reopening it, the enabled probe remained `ready` and scoped storage still worked.

## What this does not prove

- Production WebKit builds were not opened. The probes ran only after a DEV fail-closed bypass.
- iPad was not tested.
- Only one macOS Safari version and one iPhone Safari/PWA version were used.
- Browser-side URL policy still cannot stop DNS rebinding.
- There is still no CI job that drives a real WebKit iframe / Worker / CSP matrix.
- The sandbox still cannot judge whether tool text or System Prompt content is malicious.

Until those gaps are closed, user plugins stay disabled on WebKit.

## Decision

| Item | Outcome |
|---|---|
| Keep WebKit fail-closed | Yes |
| Land Worker capability lockdown on `main` | Yes, `362c0b9` |
| Ship a DEV fail-closed bypass | No |
| Open Safari / iOS user plugins | No |
| iPad follow-up | Not planned |

Related commits:

```text
0844e5d  feat: sandbox user-installed plugins
9ef2e6f  fix: harden user plugin sandbox
362c0b9  fix: lock down sandbox worker capabilities
```

## Re-validation

Do not disable fail-closed on `main`. If WebKit is re-tested, use a disposable branch, Vite DEV only, a fresh webhook sink, and no real health data or API keys.

Minimum passing bar before considering a WebKit lift of fail-closed:

1. Production build, not only Vite DEV.
2. macOS Safari, iPhone Safari, and iPhone PWA on current shipping versions.
3. Shared Cache Storage still absent after lockdown.
4. Direct and dynamic network probes produce zero sink requests.
5. Host permission snapshot still wins over a runtime manifest.
6. Init / tool timeouts keep the page responsive and leave no partial installs.
7. Repeat the checks after a full reload and after PWA background resume.
