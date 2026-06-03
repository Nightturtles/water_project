import UIKit
import WebKit
import Capacitor

// Kills the flash between full-page navigations in the native iOS shell.
//
// Two parts:
// 1) Color of the blank frame. Capacitor's WebViewDelegationHandler sets the
//    WKWebView isOpaque = false only for the *initial* load, then restores the
//    prior value (true) on didFinish; an opaque WKWebView paints BLACK in the
//    no-content moment regardless of backgroundColor. We seed isOpaque = false
//    BEFORE super.viewDidLoad() so the save/restore keeps it false for every
//    navigation, and theme every surface that can show (WebView, its scroll
//    view, the VC view, and the host UIWindow in AppDelegate).
//
// 2) Light/dark mismatch. The in-app theme (cw_theme in localStorage) is
//    independent of the iOS *system* appearance. With "app = light, phone =
//    dark", dynamic colors and the WebView's prefers-color-scheme follow the
//    system (dark) and the blank frame flashes dark inside a light app. The web
//    layer posts cw_theme over a WKScriptMessageHandler; we mirror it onto
//    overrideUserInterfaceStyle (persisted so it's correct on the next launch's
//    first navigation, before the page reposts), which makes the WebView and all
//    dynamic colors resolve to the app theme instead of the system one.
class CafelyticViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func viewDidLoad() {
        // Both must run before super (which starts the initial load): seed the
        // non-opaque state, and register the theme bridge before the page's
        // theme-init.js can post.
        webView?.isOpaque = false
        webView?.configuration.userContentController.add(self, name: "cwTheme")
        super.viewDidLoad()
        applyThemedBackground()
        applyInterfaceStyle(UserDefaults.standard.string(forKey: cafelyticThemeKey))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // The window only exists once the view is in the hierarchy.
        view.window?.backgroundColor = .cafelyticBackground
        applyInterfaceStyle(UserDefaults.standard.string(forKey: cafelyticThemeKey))
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previous) {
            applyThemedBackground()
        }
    }

    // Receives the in-app theme ("system" | "light" | "dark") from theme-init.js
    // / applyTheme() so the native appearance follows the app, not the system.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "cwTheme", let pref = message.body as? String else { return }
        UserDefaults.standard.set(pref, forKey: cafelyticThemeKey)
        applyInterfaceStyle(pref)
    }

    private func applyInterfaceStyle(_ pref: String?) {
        let style = cafelyticInterfaceStyle(for: pref)
        overrideUserInterfaceStyle = style
        view.window?.overrideUserInterfaceStyle = style
    }

    private func applyThemedBackground() {
        let bg = UIColor.cafelyticBackground
        webView?.isOpaque = false
        webView?.backgroundColor = bg
        webView?.scrollView.backgroundColor = bg
        view.backgroundColor = bg
        view.window?.backgroundColor = bg
        if #available(iOS 15.0, *) {
            webView?.underPageBackgroundColor = bg
        }
    }
}

// UserDefaults key for the persisted in-app theme preference.
let cafelyticThemeKey = "cwThemePref"

// Maps the in-app theme preference to a UIKit interface style.
// "system" (or unknown/nil) -> .unspecified so the app keeps following the OS.
func cafelyticInterfaceStyle(for pref: String?) -> UIUserInterfaceStyle {
    switch pref {
    case "light": return .light
    case "dark": return .dark
    default: return .unspecified
    }
}

extension UIColor {
    // App background, theme-aware. Mirrors --gray-50 in style.css. Resolves
    // against the (possibly overridden) trait collection, so it follows the
    // in-app theme once overrideUserInterfaceStyle is set.
    static let cafelyticBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x0f / 255, green: 0x17 / 255, blue: 0x2a / 255, alpha: 1) // #0f172a
            : UIColor(red: 0xf8 / 255, green: 0xfa / 255, blue: 0xfc / 255, alpha: 1) // #f8fafc
    }
}
