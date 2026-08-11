// Bridge to the native iPad wrapper (see ipad-app/).
//
// The wrapper is a Swift Playgrounds app that shows this game in a WKWebView.
// It exists for one reason: iPadOS Safari refuses pointer lock, but a native
// app can call UIViewController.prefersPointerLocked and get a real one, then
// read raw trackpad deltas from GCMouse. So in native mode the whole
// verify-the-lock-and-fall-back-to-free-look dance in input.js is bypassed —
// the host owns the lock and feeds deltas straight in.
//
// The contract is deliberately tiny, because it is an ABI shared with Swift
// code that is edited on an iPad and cannot be refactored in step with this
// file. Only add to it; never repurpose an existing call.
//
//   JS -> Swift   webkit.messageHandlers.mcnative.postMessage({ type })
//                   'ready'   the bridge is installed and listening
//                   'lock'    please capture the pointer
//                   'unlock'  please release it
//
//   Swift -> JS   window.MCN.look(dx, dy)       raw mouse delta, browser sign
//                 window.MCN.button(i, down)    0 left, 1 middle, 2 right
//                 window.MCN.lockChanged(on)    the capture state changed
//                 window.MCN.escape()           pause (app went to background)

/** Set by the wrapper at document start, before any module runs. */
const HOST_FLAG = '__MC_NATIVE_HOST__';

/** Name of the WKScriptMessageHandler the wrapper registers. */
const HANDLER = 'mcnative';

export function nativeHandler() {
  if (typeof window === 'undefined') return null;
  if (window[HOST_FLAG] !== true) return null;
  return window.webkit?.messageHandlers?.[HANDLER] ?? null;
}

/**
 * Wire the input layer to the native host, if we are running inside it.
 * Returns the object exposed to Swift, or null in a normal browser.
 */
export function installNativeBridge(input, target = typeof window !== 'undefined' ? window : null) {
  const handler = nativeHandler();
  if (!handler || !target) return null;

  const post = (type) => {
    try {
      handler.postMessage({ type });
    } catch {
      /* the host went away; the game keeps running unlocked */
    }
  };

  input.attachNativeHost({
    lock: () => post('lock'),
    unlock: () => post('unlock'),
  });

  const api = {
    version: 1,
    look: (dx, dy) => input.nativeLook(dx, dy),
    button: (index, down) => input.nativeButton(index, down),
    lockChanged: (on) => input.setNativeLocked(on),
    escape: () => input.onAction('escape'),
  };

  target.MCN = api;
  post('ready');
  return api;
}
