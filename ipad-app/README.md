# Minecraft as an iPad app

A ~250-line Swift Playgrounds app that puts the game on the Home Screen **with a
real mouse lock**.

## Why this exists

The game plays fine in Safari except for one thing: iPadOS Safari refuses
`requestPointerLock()`, and refuses it *silently* — no error, no event, the
trackpad simply never drives the view. The browser build works around it with
free look (move the cursor, screen edges keep turning), which is usable but is
not the same as mouse look.

A native app has two APIs Safari will not hand over:

- `UIViewController.prefersPointerLocked` — a real pointer capture
- `GCMouse` — raw trackpad deltas, no cursor involved

So this wrapper renders the game in a `WKWebView` and handles only the pointer
natively, pushing deltas into the page. Everything else — rendering, keyboard,
touch, saves — is the same code that runs in the browser.

## It does not contain the game

There is no copy of the game in here. The app loads
`https://fxr-lmao.github.io/Minecraft/` (see `Config.swift`), which means:

- **nothing to copy onto the iPad** — the whole project is 4 Swift files
- **every `git push` updates the app**, with no rebuild and no reinstall

The trade is that it needs a network connection to start.

## Installing it, entirely on the iPad

1. Install **Swift Playgrounds** from the App Store (free).
2. In Safari, open the repo → **Code → Download ZIP**.
3. In the **Files** app, tap the ZIP to unzip it, then open `ipad-app/`.
4. Tap **`Minecraft.swiftpm`** — it opens in Swift Playgrounds. (If it opens as
   a folder instead, use **Share → Open in Swift Playgrounds**.)
5. Press **Run**, and turn the iPad to landscape.
6. To keep it: the project's **•••** / More menu has **Add to Home Screen**.

No Mac, no developer account, no seven-day expiry — a Swift Playgrounds app
stays installed.

Swift Playgrounds has no Git integration for your own project, so updating the
*wrapper* means repeating steps 2–4. Updating the *game* needs none of this:
it reloads from Pages every launch.

## How the two halves talk

The contract is deliberately tiny, because the Swift side gets edited on an
iPad and can't be refactored in step with the JavaScript. It lives in
`src/native.js` on the web side and `GameViewController.swift` here.

At document start the wrapper injects `window.__MC_NATIVE_HOST__ = true`.
`src/native.js` sees it, and the input layer switches off the browser
pointer-lock path entirely — including the free-look fallback, which exists
only to survive Safari and would otherwise fight the native lock.

```
JS  -> Swift    postMessage({ type })      'ready' | 'lock' | 'unlock'
Swift -> JS     MCN.look(dx, dy)           mouse delta, browser sign convention
                MCN.button(i, down)        0 left, 1 middle, 2 right
                MCN.lockChanged(on)        the capture state changed
                MCN.escape()               pause (the app went to background)
```

Two decisions worth knowing:

**The page owns the lock state.** Swift never decides to capture the pointer on
its own — it captures when the game asks and releases when the game asks. Esc
pauses the game, the game requests an unlock, the pointer comes back. One
source of truth instead of two halves disagreeing about whether the mouse is
captured.

**Deltas are batched to one message per frame.** `GCMouse` reports movement
faster than the display refreshes and every hop into the web view is an IPC
round trip, so movement is summed and flushed on a `CADisplayLink` — which is
also exactly how the game consumes it.

## Known gaps

- **Pointer lock needs full screen.** In Stage Manager, Split View or Slide
  Over, iPadOS will not capture the pointer. Run the app full screen.
- **Scroll is not bridged.** Two-finger scroll for hotbar slots goes to the web
  view as usual; if it stops working while the pointer is captured, use `1`–`9`.
- **Saves are separate from Safari's.** A `WKWebView` has its own localStorage,
  so the app starts with a fresh world rather than inheriting the one from your
  Safari tab.
- **The Swift is unverified.** It was written on Linux, where UIKit does not
  exist, so it has never been compiled or run. The JavaScript half is covered
  by `scripts/native-test.mjs` and by a headless browser test that drives the
  real game through a stand-in for this wrapper — but if something here does
  not build, that is why.

If the pointer never captures, the first thing to suspect is
`LauncherViewController` in `MinecraftApp.swift`. UIKit resolves
`prefersPointerLocked` by asking the frontmost full-screen view controller, and
a controller embedded inside a SwiftUI hosting controller may never be on that
path. Presenting the game full screen is what puts it there.
