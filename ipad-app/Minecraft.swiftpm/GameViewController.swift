import UIKit
import WebKit
import GameController

/// The game, in a web view, with a real pointer lock in front of it.
///
/// Everything here exists to solve one problem: iPadOS Safari refuses
/// `requestPointerLock()` — silently — so the trackpad cannot drive mouse
/// look in a browser tab. A native app has two APIs Safari will not give up:
///
///   * `prefersPointerLocked` captures the pointer for real, and
///   * `GCMouse` reports raw trackpad deltas with no cursor involved.
///
/// So the web view renders the game and handles the keyboard exactly as
/// Safari does, while the pointer is handled natively and pushed into the
/// page through `window.MCN` (see src/native.js for the other half).
///
/// The page owns the lock *state* — Esc pauses the game, the game asks to
/// unlock, we obey — so there is one source of truth rather than two halves
/// disagreeing about whether the mouse is captured.
final class GameViewController: UIViewController {
    private var webView: WKWebView!
    private var displayLink: CADisplayLink?
    private var errorView: UIView?

    /// Mouse movement accumulated since the last flush into the page.
    private var pendingDX = 0.0
    private var pendingDY = 0.0

    /// True once the page has loaded and called back with `ready`.
    private var bridgeReady = false

    private var wantsPointerLock = false {
        didSet {
            guard wantsPointerLock != oldValue else { return }
            setNeedsUpdateOfPrefersPointerLocked()
        }
    }

    override var prefersPointerLocked: Bool { wantsPointerLock }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildWebView()
        observeMice()
        observeAppState()
        webView.load(URLRequest(url: Config.gameURL))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Hardware key events only reach the page while the web view is first
        // responder; without this, WASD does nothing.
        webView.becomeFirstResponder()
        startDisplayLink()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopDisplayLink()
        setLocked(false)
    }

    deinit {
        displayLink?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Web view

    private func buildWebView() {
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(
            // Injected before any module runs, so the game's input layer can
            // choose the native path instead of the Safari workarounds.
            source: "window.__MC_NATIVE_HOST__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        content.add(ScriptMessageProxy(self), name: "mcnative")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        // The default (persistent) data store is what keeps the saved world:
        // localStorage here is the app's own, separate from Safari's.

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        view.addSubview(webView)
    }

    // MARK: - Pointer lock

    private func setLocked(_ on: Bool) {
        wantsPointerLock = on
        if !on {
            pendingDX = 0
            pendingDY = 0
        }
        guard bridgeReady else { return }
        evaluate("MCN.lockChanged(\(on))")
    }

    /// Called from the page: `{ type: 'ready' | 'lock' | 'unlock' }`.
    fileprivate func handleMessage(_ body: Any) {
        guard let dict = body as? [String: Any],
              let type = dict["type"] as? String else { return }
        switch type {
        case "ready":
            bridgeReady = true
            evaluate("MCN.lockChanged(\(wantsPointerLock))")
        case "lock":
            setLocked(true)
        case "unlock":
            setLocked(false)
        default:
            break
        }
    }

    // MARK: - Mouse

    private func observeMice() {
        NotificationCenter.default.addObserver(
            forName: .GCMouseDidConnect,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let mouse = note.object as? GCMouse else { return }
            self?.attach(mouse)
        }
        GCMouse.mice().forEach(attach)
    }

    private func attach(_ mouse: GCMouse) {
        mouse.handlerQueue = .main
        guard let input = mouse.mouseInput else { return }

        input.mouseMovedHandler = { [weak self] _, deltaX, deltaY in
            guard let self, self.wantsPointerLock else { return }
            // GameController reports Y pointing up; the browser's movementY
            // points down. Flipping here keeps the page's own sign convention
            // (and its invert-Y setting) meaningful.
            self.pendingDX += Double(deltaX)
            self.pendingDY -= Double(deltaY)
        }
        input.leftButton.pressedChangedHandler = { [weak self] _, _, pressed in
            self?.sendButton(0, pressed)
        }
        input.middleButton?.pressedChangedHandler = { [weak self] _, _, pressed in
            self?.sendButton(1, pressed)
        }
        input.rightButton?.pressedChangedHandler = { [weak self] _, _, pressed in
            self?.sendButton(2, pressed)
        }
    }

    private func sendButton(_ index: Int, _ down: Bool) {
        guard bridgeReady, wantsPointerLock else { return }
        evaluate("MCN.button(\(index),\(down))")
    }

    // MARK: - Delta pump

    /// Mouse deltas arrive far faster than frames and each hop into the page
    /// costs an IPC round trip, so they are summed and flushed once a frame —
    /// which is also exactly how the game consumes them.
    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(flush))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func flush() {
        guard bridgeReady, pendingDX != 0 || pendingDY != 0 else { return }
        let dx = pendingDX
        let dy = pendingDY
        pendingDX = 0
        pendingDY = 0
        evaluate("MCN.look(\(dx),\(dy))")
    }

    private func evaluate(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - App state

    private func observeAppState() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // The system drops the lock when the app loses focus anyway.
            // Pausing keeps the game from running on with a dead mouse.
            guard let self else { return }
            self.setLocked(false)
            if self.bridgeReady { self.evaluate("MCN.escape()") }
        }
    }

    // MARK: - Load failures

    fileprivate func showError(_ message: String) {
        errorView?.removeFromSuperview()

        let panel = UIView(frame: view.bounds)
        panel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        panel.backgroundColor = .black

        let label = UILabel()
        label.text = "Could not load the game.\n\(message)\n\n\(Config.gameURL.absoluteString)"
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 15, weight: .regular)
        label.translatesAutoresizingMaskIntoConstraints = false

        let retry = UIButton(type: .system)
        retry.setTitle("Retry", for: .normal)
        retry.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)
        retry.translatesAutoresizingMaskIntoConstraints = false

        panel.addSubview(label)
        panel.addSubview(retry)
        view.addSubview(panel)
        errorView = panel

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: panel.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: panel.widthAnchor, multiplier: 0.8),
            retry.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 24),
            retry.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
        ])
    }

    @objc private func retryLoad() {
        errorView?.removeFromSuperview()
        errorView = nil
        webView.load(URLRequest(url: Config.gameURL))
    }
}

// MARK: - Navigation

extension GameViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        errorView?.removeFromSuperview()
        errorView = nil
        webView.becomeFirstResponder()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showError(error.localizedDescription)
    }
}

// MARK: - Message plumbing

/// `WKUserContentController` retains its message handlers, and the handler
/// here is the view controller that owns the web view — a retain cycle unless
/// something in the middle holds the reference weakly.
private final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var target: GameViewController?

    init(_ target: GameViewController) {
        self.target = target
    }

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        target?.handleMessage(message.body)
    }
}
