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
        webView?.configuration.userContentController.add(self, name: "cwNavGate")
        super.viewDidLoad()
        applyThemedBackground()
        applyInterfaceStyle(UserDefaults.standard.string(forKey: cafelyticThemeKey))
        // Restore Safari-like rubber-banding. Capacitor's prepareWebView sets
        // bounces = false once at webview creation; it is never reapplied, so
        // re-enabling here sticks for the lifetime of the webview.
        webView?.scrollView.bounces = true
        // Keep the scroll indicator above the fixed bottom tab bar. The bar is
        // 61px above the safe area (6+32+5+11+6 padding/content + 1px border,
        // see .bottom-nav in style.css); 62pt adds a 1pt buffer so the
        // indicator tip never touches the border. The safe-area portion is added
        // automatically (automaticallyAdjustsScrollIndicatorInsets defaults true).
        // Every page injects the bar on native (injectBottomNav in ui-shared.ts
        // runs unconditionally when isNativeApp()), so a static inset is correct
        // on all pages and survives cross-page navigations.
        webView?.scrollView.verticalScrollIndicatorInsets.bottom = 62
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
    // / applyTheme() so the native appearance follows the app, not the system,
    // and the navigation paint-hold gate ("hold" | "release"), also from
    // theme-init.js.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "cwTheme":
            guard let pref = message.body as? String else { return }
            UserDefaults.standard.set(pref, forKey: cafelyticThemeKey)
            applyInterfaceStyle(pref)
        case "cwNavGate":
            guard let action = message.body as? String else { return }
            if action == "hold" { beginNavHold() } else if action == "release" { endNavHold() }
        default:
            break
        }
    }

    // MARK: Navigation paint-hold

    // WKWebView does not paint-hold across full-page navigations the way
    // Safari does: between the old document's teardown and the new document's
    // first render it composites a blank (themed) frame, which reads as a
    // flash even though the cross-document view transition then crossfades
    // from the correct old pixels. The web layer (theme-init.js) posts "hold"
    // on pageswap, while the old content is still on screen; we cover the
    // WebView with a render-server snapshot of exactly those pixels. It posts
    // "release" two rAFs into the new page's reveal, once the transition's
    // first frame is up; removing the snapshot then is seamless because the
    // crossfade starts from the same image. The watchdog catches the cases
    // where the release can never arrive (navigation failed, page died).
    private var navHoldView: UIView?
    private var navHoldWatchdog: Timer?

    private func beginNavHold() {
        guard navHoldView == nil,
              let webView = webView,
              let snapshot = webView.snapshotView(afterScreenUpdates: false) else { return }
        snapshot.frame = webView.frame
        snapshot.isUserInteractionEnabled = false
        webView.superview?.addSubview(snapshot)
        navHoldView = snapshot
        navHoldWatchdog = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
            self?.endNavHold()
        }
    }

    private func endNavHold() {
        navHoldWatchdog?.invalidate()
        navHoldWatchdog = nil
        navHoldView?.removeFromSuperview()
        navHoldView = nil
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
