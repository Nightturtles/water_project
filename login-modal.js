// Login modal — shared across all pages that load ui-shared.js.
//
// Anonymous users hitting a gated "Save" affordance see this modal instead
// of being redirected to login.html.  On successful sign-in, the modal
// closes and sync.js's onAuthStateChange SIGNED_IN handler takes over
// (pulls cloud data, dispatches cw:data-refreshed) so the page can
// re-render with the user's account state.  We do not auto-replay the
// click the user made before signing in — that keeps the interaction
// predictable: log in, see your stuff, then click again.
//
// The form HTML duplicates login.html for now.  Refactor into a shared
// component later (track as a follow-up; not load-bearing).

(function () {
  "use strict";

  var REASON_HEADINGS = {
    save: "Sign in to save",
    "save-recipe": "Sign in to save this recipe",
    "save-profile": "Sign in to save this profile",
    "save-stock": "Sign in to create a stock",
    publish: "Sign in to publish",
    bookmark: "Sign in to bookmark",
    default: "Sign in to Cafelytic",
  };

  var modalEl = null;
  var formMode = "signin"; // "signin" | "signup" | "forgot"

  function ensureModal() {
    if (modalEl && document.body.contains(modalEl)) return modalEl;

    modalEl = document.createElement("div");
    modalEl.className = "login-modal-overlay";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-labelledby", "login-modal-heading");
    modalEl.style.display = "none";
    modalEl.innerHTML = [
      '<div class="login-modal-card">',
      '  <button type="button" class="login-modal-close" aria-label="Close">&times;</button>',
      '  <h2 id="login-modal-heading" class="login-modal-heading">Sign in to Cafelytic</h2>',
      '  <div class="login-mode-toggle" role="group" aria-label="Authentication mode">',
      '    <button type="button" class="login-mode-btn active" data-mode="signin" aria-pressed="true">Sign in</button>',
      '    <button type="button" class="login-mode-btn" data-mode="signup" aria-pressed="false">Create account</button>',
      "  </div>",
      '  <form class="login-form" novalidate>',
      '    <div class="input-group">',
      '      <label for="login-modal-email">Email</label>',
      '      <input type="email" id="login-modal-email" autocomplete="email" placeholder="you@example.com" required>',
      "    </div>",
      '    <div class="input-group login-modal-password-group">',
      '      <label for="login-modal-password">Password</label>',
      '      <input type="password" id="login-modal-password" autocomplete="current-password" placeholder="Password" required>',
      "    </div>",
      '    <div class="login-error" role="alert" aria-live="polite"></div>',
      '    <div class="login-success" role="status" aria-live="polite" style="display:none;"></div>',
      '    <button type="submit" class="login-submit-btn">Sign in</button>',
      '    <button type="button" class="login-text-link login-modal-forgot"',
      '            style="background:none;border:none;color:var(--blue-600);cursor:pointer;font-size:0.85rem;margin-top:0.5rem;padding:0;">',
      "      Forgot password?",
      "    </button>",
      '    <button type="button" class="login-text-link login-modal-back" style="display:none;background:none;border:none;color:var(--blue-600);cursor:pointer;font-size:0.85rem;margin-top:0.5rem;padding:0;">',
      "      Back to sign in",
      "    </button>",
      "  </form>",
      '  <div class="login-divider login-modal-divider">or</div>',
      '  <button type="button" class="login-google-btn login-modal-google">',
      '    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">',
      '      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>',
      '      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>',
      '      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>',
      '      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>',
      "    </svg>",
      "    Continue with Google",
      "  </button>",
      "</div>",
    ].join("\n");

    document.body.appendChild(modalEl);

    bindModalHandlers(modalEl);
    return modalEl;
  }

  function $(root, selector) {
    return root.querySelector(selector);
  }

  function bindModalHandlers(root) {
    var headingEl = $(root, "#login-modal-heading");
    var modeBtns = root.querySelectorAll(".login-mode-btn");
    var form = $(root, ".login-form");
    var emailInput = $(root, "#login-modal-email");
    var passwordInput = $(root, "#login-modal-password");
    var passwordGroup = $(root, ".login-modal-password-group");
    var errorEl = $(root, ".login-error");
    var successEl = $(root, ".login-success");
    var submitBtn = $(root, ".login-submit-btn");
    var forgotBtn = $(root, ".login-modal-forgot");
    var backBtn = $(root, ".login-modal-back");
    var modeToggle = $(root, ".login-mode-toggle");
    var divider = $(root, ".login-modal-divider");
    var googleBtn = $(root, ".login-modal-google");
    var closeBtn = $(root, ".login-modal-close");

    function clearMessages() {
      errorEl.textContent = "";
      successEl.style.display = "none";
      successEl.textContent = "";
    }
    function showError(msg) {
      errorEl.textContent = msg;
      successEl.style.display = "none";
    }
    function showSuccess(msg) {
      successEl.textContent = msg;
      successEl.style.display = "";
      errorEl.textContent = "";
    }
    function setMode(newMode) {
      formMode = newMode;
      var isForgot = newMode === "forgot";
      var isSignin = newMode === "signin";
      if (isForgot) {
        passwordGroup.style.display = "none";
        modeToggle.style.display = "none";
        divider.style.display = "none";
        googleBtn.style.display = "none";
        forgotBtn.style.display = "none";
        backBtn.style.display = "";
        submitBtn.textContent = "Send reset link";
        passwordInput.value = "";
      } else {
        passwordGroup.style.display = "";
        modeToggle.style.display = "";
        divider.style.display = "";
        googleBtn.style.display = "";
        forgotBtn.style.display = "";
        backBtn.style.display = "none";
        modeBtns.forEach(function (btn) {
          var active = btn.getAttribute("data-mode") === newMode;
          btn.classList.toggle("active", active);
          btn.setAttribute("aria-pressed", String(active));
        });
        submitBtn.textContent = isSignin ? "Sign in" : "Create account";
        passwordInput.autocomplete = isSignin ? "current-password" : "new-password";
      }
      clearMessages();
    }

    modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-mode"));
      });
    });
    forgotBtn.addEventListener("click", function () {
      setMode("forgot");
    });
    backBtn.addEventListener("click", function () {
      setMode("signin");
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = (emailInput.value || "").trim();
      var password = passwordInput.value || "";
      if (!email || (formMode !== "forgot" && !password)) {
        showError(
          formMode === "forgot"
            ? "Please enter your email."
            : "Please enter your email and password.",
        );
        return;
      }
      submitBtn.disabled = true;
      clearMessages();
      try {
        if (formMode === "signin") {
          var signinRes = await window.signInWithEmail(email, password);
          if (signinRes && signinRes.error) {
            showError(signinRes.error.message);
            return;
          }
          // sync.js's onAuthStateChange SIGNED_IN handler takes it from here
          // (pulls cloud data, dispatches cw:data-refreshed).  Close immediately.
          closeModal();
        } else if (formMode === "signup") {
          var signupRes = await window.signUpWithEmail(email, password);
          if (signupRes && signupRes.error) {
            showError(signupRes.error.message);
            return;
          }
          setMode("signin");
          showSuccess("Check your email to confirm your account, then sign in.");
        } else {
          await window.resetPasswordForEmail(email);
          showSuccess("If an account exists for that email, we've sent a reset link.");
        }
      } catch (err) {
        showError((err && err.message) || "Something went wrong. Please try again.");
      } finally {
        submitBtn.disabled = false;
      }
    });

    googleBtn.addEventListener("click", async function () {
      googleBtn.disabled = true;
      clearMessages();
      try {
        var res = await window.signInWithGoogle();
        if (res && res.error) {
          showError(res.error.message);
          googleBtn.disabled = false;
        }
        // Otherwise OAuth redirect takes over.
      } catch (err) {
        showError("Something went wrong. Please try again.");
        googleBtn.disabled = false;
      }
    });

    closeBtn.addEventListener("click", closeModal);
    root.addEventListener("click", function (e) {
      if (e.target === root) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.style.display !== "none") closeModal();
    });

    // Expose a helper so openLoginModal can update the heading per "reason".
    root._setHeading = function (reasonOrText) {
      var text = REASON_HEADINGS[reasonOrText] || reasonOrText || REASON_HEADINGS["default"];
      headingEl.textContent = text;
    };
    root._reset = function () {
      clearMessages();
      setMode("signin");
      emailInput.value = "";
      passwordInput.value = "";
    };
  }

  function openModal(opts) {
    opts = opts || {};
    var root = ensureModal();
    if (root._setHeading) root._setHeading(opts.reason);
    if (root._reset) root._reset();
    root.style.display = "flex";
    document.body.classList.add("login-modal-open");
    var emailInput = $(root, "#login-modal-email");
    if (emailInput) {
      setTimeout(function () {
        emailInput.focus();
      }, 50);
    }
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.style.display = "none";
    document.body.classList.remove("login-modal-open");
  }

  window.openLoginModal = openModal;
  window.closeLoginModal = closeModal;

  // Auto-close after successful sign-in from any path (login.html redirect,
  // OAuth, the modal's own submit handler).  No-op if the modal isn't open.
  document.addEventListener("cw:auth-changed", function (e) {
    var ev = e && e.detail && e.detail.event;
    if (ev === "SIGNED_IN") closeModal();
  });
})();
