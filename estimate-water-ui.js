// ============================================
// Estimate Water UI — "Estimate from my ZIP" feature
// Calls Supabase Edge Function `estimate-water` which proxies to the
// Claude API (web_search + forced report_water_profile tool). Populates
// the existing #src-* inputs so the rest of the source-water pipeline
// (debouncedSave + cloud sync + onChanged) takes over.
//
// Auth model: feature is GA. The card renders for every page that hosts
// it; applyAuthGate (ui-shared.js) visually locks the open button for
// anonymous users and opens the login modal on click. The Edge Function
// enforces JWT auth and a per-user daily quota of 5 actual Anthropic
// calls via the increment_estimate_water_quota RPC. Cache hits stay
// client-side (localStorage, 30-day TTL) and never count against quota.
// ============================================

(function () {
  const CACHE_KEY_PREFIX = "cw_estimate_cache_v1:";
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const REQUEST_TIMEOUT_MS = 30000;

  // Module-scope reference to the in-flight estimate AbortController.
  // closeForm() aborts this so canceling the form actually stops the
  // network call (otherwise the request keeps running and burns quota).
  // Preflight ({check: true}) calls do NOT register here — they're short
  // and self-contained, and we don't want a form cancel to also kill an
  // unrelated allowlist ping in progress.
  let activeEstimateController = null;

  function providerSlug(provider) {
    // Lossless: encodeURIComponent preserves every distinct input after a
    // simple lower-case + trim. "A+B Water" and "A B Water" stay separate
    // cache keys instead of colliding under a punctuation-stripping pass.
    return encodeURIComponent(
      String(provider || "")
        .trim()
        .toLowerCase(),
    );
  }

  function cacheKey(zip, provider) {
    return CACHE_KEY_PREFIX + String(zip) + ":" + providerSlug(provider);
  }

  function readCache(zip, provider) {
    try {
      const raw = localStorage.getItem(cacheKey(zip, provider));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.timestamp !== "number") return null;
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeCache(zip, provider, payload) {
    try {
      localStorage.setItem(cacheKey(zip, provider), JSON.stringify(payload));
    } catch (_) {
      // Quota or privacy mode — silent; cache is a perf optimization only.
    }
  }

  function relativeTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + " min ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    const days = Math.floor(hours / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function reportToSentry(error, extra) {
    try {
      if (window.Sentry && typeof window.Sentry.captureException === "function") {
        window.Sentry.captureException(error, { extra: extra || {} });
      }
    } catch (_) {
      // Sentry loader hasn't initialized — drop the report.
    }
  }

  function applyProfileToInputs(profile) {
    // Switch to the "custom" preset first. activateSourcePreset("custom")
    // returns early without touching #src-* inputs, so our values stick.
    // After that, dispatching input events fires the existing
    // source-water-ui handler (debouncedSave + sync + onChanged).
    const customBtn = document.querySelector('#source-presets [data-preset="custom"]');
    if (customBtn) customBtn.click();

    if (typeof ION_FIELDS === "undefined" || !Array.isArray(ION_FIELDS)) return;
    ION_FIELDS.forEach(function (ion) {
      const el = document.getElementById("src-" + ion);
      if (!el) return;
      const value = Number(profile[ion]);
      el.value = Number.isFinite(value) ? Math.max(0, value) : 0;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function invokeEstimateFunction(body, timeoutMs, options) {
    options = options || {};
    if (!window.supabaseClient || !window.supabaseClient.functions) {
      throw Object.assign(new Error("supabase client not ready"), { code: "client_init" });
    }
    const controller = new AbortController();
    // Register only the actual estimate call (not the preflight) so
    // closeForm() can abort it. Distinguishing user-cancel from timeout
    // happens by tracking the trigger separately below.
    let userCanceled = false;
    if (options.trackAsActive) {
      activeEstimateController = controller;
    }
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    // When closeForm aborts the controller it also clears
    // activeEstimateController; that asymmetry is our signal that the
    // user canceled rather than the timeout firing.
    controller.signal.addEventListener(
      "abort",
      function () {
        if (options.trackAsActive && activeEstimateController !== controller) {
          userCanceled = true;
        }
      },
      { once: true },
    );
    try {
      const { data, error } = await window.supabaseClient.functions.invoke("estimate-water", {
        body: body,
        // supabase-js v2.45+ forwards `signal` to the underlying fetch so
        // our REQUEST_TIMEOUT_MS actually cancels the request.
        signal: controller.signal,
      });
      if (error) {
        if (controller.signal.aborted) {
          throw Object.assign(new Error(userCanceled ? "canceled" : "request timed out"), {
            code: userCanceled ? "canceled" : "timeout",
          });
        }
        // FunctionsHttpError carries the response — try to parse the JSON body.
        let parsedBody = null;
        if (error.context && typeof error.context.json === "function") {
          try {
            parsedBody = await error.context.json();
          } catch (_) {
            /* ignore */
          }
        }
        const code =
          (parsedBody && parsedBody.error) ||
          (error.name === "FunctionsHttpError" ? "model_error" : "network");
        const message = (parsedBody && parsedBody.message) || error.message || "request failed";
        throw Object.assign(new Error(message), { code: code });
      }
      if (!data || data.ok !== true) {
        const code = (data && data.error) || "parse_error";
        throw Object.assign(new Error((data && data.message) || code), { code: code });
      }
      return data;
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw Object.assign(new Error(userCanceled ? "canceled" : "request timed out"), {
          code: userCanceled ? "canceled" : "timeout",
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (options.trackAsActive && activeEstimateController === controller) {
        activeEstimateController = null;
      }
    }
  }

  function callEstimate(zip, provider) {
    return invokeEstimateFunction({ zip: zip, provider: provider }, REQUEST_TIMEOUT_MS, {
      trackAsActive: true,
    });
  }

  function friendlyError(code) {
    switch (code) {
      case "unauthorized":
        return "Please log in again.";
      case "forbidden":
        return "This feature is not enabled for your account.";
      case "bad_request":
        return "Check your zip and provider, then try again.";
      case "rate_limit":
        return "Too many requests. Try again in a minute.";
      case "daily_limit":
        // Server returns a friendlier message with the limit value; submitEstimate
        // prefers err.message over the canned text for this code.
        return "You've hit today's daily limit. Cached lookups still work; try again tomorrow.";
      case "quota_unavailable":
        return "Couldn't check today's usage. Try again in a moment.";
      case "parse_error":
        return "Couldn't estimate this address. Try entering ions manually.";
      case "model_error":
        return "The estimator is unavailable right now. Try again later.";
      case "network":
        return "Network problem. Check your connection.";
      case "timeout":
        return "The estimator took too long. Try again in a moment.";
      case "canceled":
        return "";
      case "client_init":
        return "Page is still loading. Try again in a moment.";
      default:
        return "Something went wrong. Try entering ions manually.";
    }
  }

  function initEstimateWaterUI() {
    const card = document.getElementById("estimate-water-card");
    if (!card) return; // page doesn't host the feature
    const openBtn = document.getElementById("estimate-open-btn");
    const form = document.getElementById("estimate-form");
    const zipInput = document.getElementById("estimate-zip");
    const providerInput = document.getElementById("estimate-provider");
    const submitBtn = document.getElementById("estimate-submit-btn");
    const cancelBtn = document.getElementById("estimate-cancel-btn");
    const statusEl = document.getElementById("estimate-status");
    const lastResultEl = document.getElementById("estimate-last-result");

    if (!openBtn || !form || !zipInput || !providerInput || !submitBtn || !cancelBtn) return;

    function setStatus(message, severity) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.classList.toggle("error", severity === "error");
      statusEl.classList.toggle("hint", severity !== "error");
    }

    function showLastResult(result, zip, provider) {
      if (!lastResultEl) return;
      lastResultEl.hidden = false;
      lastResultEl.innerHTML = "";
      const meta = document.createElement("span");
      const confidence = result.confidence ? " (" + result.confidence + " confidence)" : "";
      const source = result.source ? " - " + result.source : "";
      meta.textContent = "Estimated " + relativeTime(result.timestamp) + confidence + source;
      const reEstimate = document.createElement("button");
      reEstimate.type = "button";
      reEstimate.className = "estimate-reestimate-link";
      reEstimate.textContent = "Re-estimate";
      reEstimate.addEventListener("click", function () {
        zipInput.value = zip;
        providerInput.value = provider;
        form.hidden = false;
        openBtn.hidden = true;
        submitEstimate({ bypassCache: true });
      });
      lastResultEl.appendChild(meta);
      lastResultEl.appendChild(document.createTextNode(" "));
      lastResultEl.appendChild(reEstimate);
    }

    function openForm() {
      form.hidden = false;
      openBtn.hidden = true;
      setStatus("");
      zipInput.focus();
    }

    function closeForm() {
      // Abort any in-flight estimate so cancel actually stops the network
      // call. Clearing activeEstimateController before .abort() signals to
      // invokeEstimateFunction that this was a user cancel, not a timeout —
      // its catch arm then throws code: "canceled" which maps to no error UI.
      if (activeEstimateController) {
        const controller = activeEstimateController;
        activeEstimateController = null;
        controller.abort();
      }
      form.hidden = true;
      openBtn.hidden = false;
      // Intentionally do NOT clear status here — submitEstimate sets a
      // success message right before closing the form and the user needs
      // to see it. Explicit clears live with the caller (cancel button,
      // openForm) so they don't conflict.
      submitBtn.disabled = false;
      submitBtn.textContent = "Estimate";
    }

    async function submitEstimate(opts) {
      opts = opts || {};
      const zip = (zipInput.value || "").trim();
      const provider = (providerInput.value || "").trim();
      if (!/^\d{5}$/.test(zip)) {
        setStatus("ZIP must be 5 digits.", "error");
        zipInput.focus();
        return;
      }
      if (provider.length === 0) {
        setStatus("Enter your water provider.", "error");
        providerInput.focus();
        return;
      }
      if (provider.length > 120) {
        setStatus("Provider name is too long (max 120 chars).", "error");
        providerInput.focus();
        return;
      }

      if (!opts.bypassCache) {
        const cached = readCache(zip, provider);
        if (cached) {
          applyProfileToInputs(cached.profile);
          showLastResult(cached, zip, provider);
          setStatus("Loaded cached estimate.", "info");
          closeForm();
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Estimating... (5-15s)";
      setStatus("Contacting estimator...", "info");

      try {
        const result = await callEstimate(zip, provider);
        const payload = {
          profile: result.profile,
          confidence: result.confidence,
          source: result.source,
          model: result.model,
          timestamp: Date.now(),
        };
        writeCache(zip, provider, payload);
        applyProfileToInputs(result.profile);
        showLastResult(payload, zip, provider);
        setStatus("Estimate applied. Tweak any value, then save as a profile.", "info");
        closeForm();
      } catch (err) {
        const code = err && err.code ? err.code : "model_error";
        // User cancel: no error UI, closeForm has already reset the form.
        if (code === "canceled") return;
        // Server-provided message wins for codes where it adds context
        // (e.g. daily_limit mentions the limit value). Otherwise fall back
        // to the canned friendly text.
        const useServerMessage = code === "daily_limit" && err && err.message;
        setStatus(useServerMessage ? err.message : friendlyError(code), "error");
        // Report only unexpected failures. Expected user/auth states are noise.
        const expected = new Set([
          "unauthorized",
          "forbidden",
          "rate_limit",
          "bad_request",
          "client_init",
          "network",
          "timeout",
          "canceled",
          "daily_limit",
          "quota_unavailable",
        ]);
        if (!expected.has(code)) {
          // Don't pair zip+provider in one field — mild PII pairing.
          reportToSentry(err, { feature: "estimate-water", code: code });
        }
        submitBtn.disabled = false;
        submitBtn.textContent = "Estimate";
      }
    }

    openBtn.addEventListener("click", openForm);
    cancelBtn.addEventListener("click", function () {
      // closeForm() no longer wipes status (so submit-success messages
      // survive); the cancel button explicitly clears it because pressing
      // Cancel is a "start over" intent.
      setStatus("");
      closeForm();
    });
    submitBtn.addEventListener("click", function () {
      submitEstimate({ bypassCache: false });
    });
    zipInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        providerInput.focus();
      }
    });
    providerInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    });

    // Show the card to everyone (the feature is GA). applyAuthGate visually
    // locks the open button for anonymous users and opens the login modal on
    // click, matching how the rest of the site gates auth-required actions
    // (see ui-shared.js). The server is the real boundary — even if a user
    // bypasses the gate, the function 401s without a valid JWT and enforces
    // the per-user daily cap via the increment_estimate_water_quota RPC.
    card.hidden = false;
    openBtn.hidden = false;
    if (typeof window.applyAuthGate === "function") {
      window.applyAuthGate(openBtn, { reason: "estimate-water" });
    }
  }

  window.initEstimateWaterUI = initEstimateWaterUI;
})();
