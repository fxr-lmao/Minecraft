import Foundation

enum Config {
    /// Where the game is loaded from.
    ///
    /// The app deliberately contains no copy of the game: it is a shell around
    /// the live GitHub Pages build, so every `git push` updates it with no
    /// rebuild and nothing to copy onto the iPad.
    ///
    /// Point this at a dev server (`http://192.168.x.x:5173`) to try
    /// uncommitted changes — but note that plain HTTP needs an App Transport
    /// Security exception, which Swift Playgrounds cannot add, so only
    /// `https://` URLs work as-is.
    static let gameURL = URL(string: "https://fxr-lmao.github.io/Minecraft/")!
}
