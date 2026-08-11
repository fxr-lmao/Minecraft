import SwiftUI
import UIKit

@main
struct MinecraftApp: App {
    var body: some Scene {
        WindowGroup {
            GameLauncher()
                .ignoresSafeArea()
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
        }
    }
}

/// Bridges into UIKit. Pointer lock and `GCMouse` have no SwiftUI equivalent,
/// so the game itself lives in a plain view controller.
struct GameLauncher: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> LauncherViewController {
        LauncherViewController()
    }

    func updateUIViewController(_ controller: LauncherViewController, context: Context) {}
}

/// Presents the game full screen rather than embedding it.
///
/// This indirection earns its keep: UIKit resolves `prefersPointerLocked` by
/// asking the frontmost full-screen view controller, walking down through
/// `childViewControllerForPointerLock`. A controller embedded inside a SwiftUI
/// hosting controller is not guaranteed to be on that path and can simply
/// never be asked — the pointer then never captures, with no error anywhere.
/// A presented full-screen controller is always the one asked.
final class LauncherViewController: UIViewController {
    private var launched = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !launched else { return }
        launched = true

        let game = GameViewController()
        game.modalPresentationStyle = .fullScreen
        game.isModalInPresentation = true // no swipe-to-dismiss mid-game
        present(game, animated: false)
    }
}
