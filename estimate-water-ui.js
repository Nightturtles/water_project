// ============================================
// Estimate Water UI — "Estimate from my address" feature
// Calls Supabase Edge Function `estimate-water` which proxies to the
// Claude API (web_search + forced report_water_profile tool). Populates
// the existing #src-* inputs so the rest of the source-water pipeline
// (debouncedSave + cloud sync + onChanged) takes over.
//
// Allowlisted by ALLOWED_ESTIMATE_EMAILS during initial rollout. The
// Supabase Edge Function enforces the same gate via ESTIMATE_WATER_ALLOWLIST.
// ============================================

(function () {
  const CACHE_KEY_PREFIX = "cw_estimate_cache_v1:";
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const REQUEST_TIMEOUT_MS = 30000;

  function providerSlug(provider) {
    return String(provider || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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

  function isAllowlisted(user) {
    if (!user || !user.email) return false;
    if (typeof ALLOWED_ESTIMATE_EMAILS === "undefined") return false;
    const email = String(user.email).toLowerCase();
    return ALLOWED_ESTIMATE_EMAILS.some(function (e) {
      return String(e).toLowerCase() === email;
    });
  }

  async function callEstimate(zip, provider) {
    if (!window.supabaseClient || !window.supabaseClient.functions) {
      throw Object.assign(new Error("supabase client not ready"), { code: "client_init" });
    }
    const controller = new AbortController();
    const timeout = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const { data, error } = await window.supabaseClient.functions.invoke("estimate-water", {
        body: { zip: zip, provider: provider },
      });
      if (error) {
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
    } finally {
      clearTimeout(timeout);
    }
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
      case "parse_error":
        return "Couldn't estimate this address. Try entering ions manually.";
      case "model_error":
        return "The estimator is unavailable right now. Try again later.";
      case "network":
        return "Network problem. Check your connection.";
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
      form.hidden = true;
      openBtn.hidden = false;
      setStatus("");
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
        setStatus(friendlyError(code), "error");
        // Report only unexpected failures. Expected user/auth states are noise.
        const expected = new Set([
          "unauthorized",
          "forbidden",
          "rate_limit",
          "bad_request",
          "client_init",
          "network",
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
    cancelBtn.addEventListener("click", closeForm);
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

    // Allowlist gate: only show the card for allowlisted accounts. The server
    // function also checks; this is just UX so non-allowlisted users don't see
    // a button that always errors out.
    if (typeof window.getUser !== "function") return;
    window
      .getUser()
      .then(function (res) {
        const user = res && res.data && res.data.user;
        if (!isAllowlisted(user)) return;
        card.hidden = false;
      })
      .catch(function () {
        // Network error reading session — leave hidden.
      });
  }

  window.initEstimateWaterUI = initEstimateWaterUI;
})();
