// ============================================
// Sync — Cloud sync layer (localStorage-first)
// ============================================
// Strategy: localStorage is always the source of truth for reads.
// On write: localStorage is updated immediately, then a debounced push
// to Supabase fires 2 seconds later if the user is logged in.
// On login: merge local and cloud data (see handleFirstLoginMerge).
// On page load: if logged in, pull latest cloud data in the background.

(function () {
  'use strict';

  var syncTimer = null;
  var SYNC_DEBOUNCE_MS = 2000;

  // --- Debounced sync trigger (called from storage.js save functions) ---
  function scheduleSyncToCloud() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      pushAllToCloud().catch(function (err) {
        console.warn('[sync] push failed:', err);
      });
    }, SYNC_DEBOUNCE_MS);
  }

  // --- Immediate sync (no debounce) ---
  function syncNow() {
    clearTimeout(syncTimer);
    syncTimer = null;
    return pushAllToCloud().catch(function (err) {
      console.warn('[sync] immediate push failed:', err);
    });
  }

  // --- Get currently logged-in user ID, or null ---
  async function getLoggedInUserId() {
    try {
      var result = await window.supabaseClient.auth.getUser();
      return result.data && result.data.user ? result.data.user.id : null;
    } catch (_) {
      return null;
    }
  }

  // --- Collect all cw_volume_* entries from localStorage into one object ---
  function collectVolumePreferences() {
    var volumes = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.startsWith('cw_volume_')) {
          var pageKey = key.slice('cw_volume_'.length);
          var val = safeParse(safeGetItem(key), null);
          if (val !== null) volumes[pageKey] = val;
        }
      }
    } catch (_) {}
    return volumes;
  }

  // --- Push all localStorage data to Supabase ---
  async function pushAllToCloud() {
    var userId = await getLoggedInUserId();
    if (!userId) return;

    var now = new Date().toISOString();

    var settingsPayload = {
      user_id: userId,
      theme: loadThemePreference(),
      mineral_display_mode: loadMineralDisplayMode(),
      brew_method: loadBrewMethod(),
      lotus_dropper_type: loadLotusDropperType(),
      selected_minerals: loadSelectedMinerals(),
      selected_concentrates: loadSelectedConcentrates(),
      diy_concentrate_specs: loadDiyConcentrateSpecs(),
      lotus_concentrate_units: loadLotusConcentrateUnits(),
      volume_preferences: collectVolumePreferences(),
      creator_display_name: loadCreatorDisplayName(),
      updated_at: now
    };

    var selectionsPayload = {
      user_id: userId,
      source_preset: loadSourcePresetName(),
      source_water: loadSourceWater(),
      target_preset: loadTargetPresetName(),
      deleted_source_presets: loadDeletedPresets(),
      updated_at: now
    };

    var results = await Promise.all([
      window.supabaseClient.from('user_settings').upsert(settingsPayload, { onConflict: 'user_id' }),
      window.supabaseClient.from('user_selections').upsert(selectionsPayload, { onConflict: 'user_id' })
    ]);

    if (results[0].error) console.warn('[sync] user_settings upsert failed:', results[0].error);
    if (results[1].error) console.warn('[sync] user_selections upsert failed:', results[1].error);

    await syncCustomProfiles(userId, now);
  }

  // --- Sync custom source and target profiles (upsert new/changed, delete removed) ---
  async function syncCustomProfiles(userId, now) {
    now = now || new Date().toISOString();
    var localSource = loadCustomProfiles();
    var localTarget = loadCustomTargetProfiles();

    // Fetch current cloud slugs to detect deletions
    var cloudResults = await Promise.all([
      window.supabaseClient.from('source_profiles').select('slug').eq('user_id', userId),
      window.supabaseClient.from('target_profiles').select('slug').eq('user_id', userId)
    ]);

    // Source profiles — delete cloud rows that no longer exist locally
    if (cloudResults[0].data && cloudResults[0].data.length > 0) {
      var localSourceSlugs = Object.keys(localSource);
      var toDeleteSource = cloudResults[0].data
        .map(function (r) { return r.slug; })
        .filter(function (slug) { return !localSourceSlugs.includes(slug); });
      if (toDeleteSource.length > 0) {
        await window.supabaseClient.from('source_profiles').delete()
          .eq('user_id', userId).in('slug', toDeleteSource);
      }
    }

    // Upsert local source profiles
    var sourceEntries = Object.entries(localSource);
    if (sourceEntries.length > 0) {
      var sourceRows = sourceEntries.map(function (entry) {
        var slug = entry[0], p = entry[1];
        return {
          user_id: userId,
          slug: slug,
          label: p.label || slug,
          calcium: Number(p.calcium) || 0,
          magnesium: Number(p.magnesium) || 0,
          potassium: Number(p.potassium) || 0,
          sodium: Number(p.sodium) || 0,
          sulfate: Number(p.sulfate) || 0,
          chloride: Number(p.chloride) || 0,
          bicarbonate: Number(p.bicarbonate) || 0,
          updated_at: now
        };
      });
      var srcResult = await window.supabaseClient.from('source_profiles')
        .upsert(sourceRows, { onConflict: 'user_id,slug' });
      if (srcResult.error) console.warn('[sync] source_profiles upsert failed:', srcResult.error);
    }

    // Target profiles — delete cloud rows that no longer exist locally
    if (cloudResults[1].data && cloudResults[1].data.length > 0) {
      var localTargetSlugs = Object.keys(localTarget);
      var toDeleteTarget = cloudResults[1].data
        .map(function (r) { return r.slug; })
        .filter(function (slug) { return !localTargetSlugs.includes(slug); });
      if (toDeleteTarget.length > 0) {
        await window.supabaseClient.from('target_profiles').delete()
          .eq('user_id', userId).in('slug', toDeleteTarget);
      }
    }

    // Upsert local target profiles
    var targetEntries = Object.entries(localTarget);
    if (targetEntries.length > 0) {
      var targetRows = targetEntries.map(function (entry) {
        var slug = entry[0], p = entry[1];
        return {
          user_id: userId,
          slug: slug,
          label: p.label || slug,
          brew_method: p.brewMethod || 'filter',
          calcium: Number(p.calcium) || 0,
          magnesium: Number(p.magnesium) || 0,
          alkalinity: Number(p.alkalinity) || 0,
          potassium: Number(p.potassium) || 0,
          sodium: Number(p.sodium) || 0,
          sulfate: Number(p.sulfate) || 0,
          chloride: Number(p.chloride) || 0,
          bicarbonate: Number(p.bicarbonate) || 0,
          description: p.description || '',
          is_public: !!p.isPublic,
          creator_display_name: p.creatorDisplayName || '',
          tags: Array.isArray(p.tags) ? p.tags : [],
          updated_at: now
        };
      });
      var tgtResult = await window.supabaseClient.from('target_profiles')
        .upsert(targetRows, { onConflict: 'user_id,slug' });
      if (tgtResult.error) console.warn('[sync] target_profiles upsert failed:', tgtResult.error);
    }
  }

  // --- Pull all cloud data into localStorage and invalidate caches ---
  async function pullFromCloud() {
    var userId = await getLoggedInUserId();
    if (!userId) return;

    var results = await Promise.all([
      window.supabaseClient.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      window.supabaseClient.from('user_selections').select('*').eq('user_id', userId).maybeSingle(),
      window.supabaseClient.from('source_profiles').select('*').eq('user_id', userId),
      window.supabaseClient.from('target_profiles').select('*').eq('user_id', userId)
    ]);

    var settings = results[0].data;
    var selections = results[1].data;
    var sourceRows = results[2].data;
    var targetRows = results[3].data;

    // Apply user_settings
    if (settings) {
      if (settings.theme) safeSetItem(THEME_KEY, settings.theme);
      if (settings.mineral_display_mode) safeSetItem('cw_mineral_display_mode', settings.mineral_display_mode);
      if (settings.brew_method) safeSetItem('cw_brew_method', settings.brew_method);
      if (settings.lotus_dropper_type) safeSetItem('cw_lotus_dropper_type', settings.lotus_dropper_type);
      if (settings.selected_minerals) safeSetItem('cw_selected_minerals', JSON.stringify(settings.selected_minerals));
      if (settings.selected_concentrates) safeSetItem('cw_selected_concentrates', JSON.stringify(settings.selected_concentrates));
      if (settings.diy_concentrate_specs) safeSetItem('cw_diy_concentrate_specs', JSON.stringify(settings.diy_concentrate_specs));
      if (settings.lotus_concentrate_units) safeSetItem('cw_lotus_concentrate_units', JSON.stringify(settings.lotus_concentrate_units));
      if (settings.volume_preferences && typeof settings.volume_preferences === 'object') {
        Object.entries(settings.volume_preferences).forEach(function (entry) {
          safeSetItem('cw_volume_' + entry[0], JSON.stringify(entry[1]));
        });
      }
      if (settings.creator_display_name) safeSetItem('cw_creator_display_name', settings.creator_display_name);
    }

    // Apply user_selections
    if (selections) {
      if (selections.source_preset) safeSetItem('cw_source_preset', selections.source_preset);
      if (selections.source_water) safeSetItem('cw_source_water', JSON.stringify(selections.source_water));
      if (selections.target_preset) safeSetItem('cw_target_preset', selections.target_preset);
      if (selections.deleted_source_presets) safeSetItem('cw_deleted_presets', JSON.stringify(selections.deleted_source_presets));
    }

    // Apply source profiles
    if (sourceRows && sourceRows.length > 0) {
      var srcProfiles = {};
      sourceRows.forEach(function (row) {
        srcProfiles[row.slug] = {
          label: row.label,
          calcium: row.calcium,
          magnesium: row.magnesium,
          potassium: row.potassium,
          sodium: row.sodium,
          sulfate: row.sulfate,
          chloride: row.chloride,
          bicarbonate: row.bicarbonate
        };
      });
      safeSetItem('cw_custom_profiles', JSON.stringify(srcProfiles));
    }

    // Apply target profiles
    if (targetRows && targetRows.length > 0) {
      var tgtProfiles = {};
      targetRows.forEach(function (row) {
        tgtProfiles[row.slug] = {
          label: row.label,
          brewMethod: row.brew_method,
          calcium: row.calcium,
          magnesium: row.magnesium,
          alkalinity: row.alkalinity,
          potassium: row.potassium,
          sodium: row.sodium,
          sulfate: row.sulfate,
          chloride: row.chloride,
          bicarbonate: row.bicarbonate,
          description: row.description,
          isPublic: !!row.is_public,
          creatorDisplayName: row.creator_display_name || '',
          tags: Array.isArray(row.tags) ? row.tags : []
        };
      });
      safeSetItem('cw_custom_target_profiles', JSON.stringify(tgtProfiles));
    }

    // Invalidate all storage caches so next read picks up the new data
    if (typeof invalidateAllCaches === 'function') invalidateAllCaches();
  }

  // --- Returns true if local data is entirely default (no user customization) ---
  function isDefaultData() {
    var sourceWater = loadSourceWater();
    var allZeroSource = Object.values(sourceWater).every(function (v) { return Number(v) === 0; });
    var noCustomSource = Object.keys(loadCustomProfiles()).length === 0;
    var noCustomTarget = Object.keys(loadCustomTargetProfiles()).length === 0;
    var noDeletedSource = loadDeletedPresets().length === 0;

    var defaultMinerals = ['calcium-chloride', 'epsom-salt', 'baking-soda', 'potassium-bicarbonate'];
    var minerals = loadSelectedMinerals();
    var mineralsAreDefault = minerals.length === defaultMinerals.length &&
      defaultMinerals.every(function (m) { return minerals.includes(m); });

    return allZeroSource && noCustomSource && noCustomTarget &&
      noDeletedSource && mineralsAreDefault;
  }

  // --- Returns true if Supabase has any stored data for this user ---
  async function hasCloudData(userId) {
    var results = await Promise.all([
      window.supabaseClient.from('user_settings').select('user_id').eq('user_id', userId).maybeSingle(),
      window.supabaseClient.from('user_selections').select('user_id').eq('user_id', userId).maybeSingle(),
      window.supabaseClient.from('source_profiles').select('slug').eq('user_id', userId).limit(1),
      window.supabaseClient.from('target_profiles').select('slug').eq('user_id', userId).limit(1)
    ]);
    return !!(results[0].data || results[1].data ||
      (results[2].data && results[2].data.length > 0) ||
      (results[3].data && results[3].data.length > 0));
  }

  // --- Show merge conflict dialog, returns promise resolving to 'local' or 'cloud' ---
  function showMergeDialog() {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.display = 'flex';

      var dialog = document.createElement('div');
      dialog.className = 'confirm-dialog';

      var msg = document.createElement('p');
      msg.id = 'confirm-message';
      msg.textContent = 'You have local data on this device and saved data in the cloud. Which would you like to keep?';

      var actions = document.createElement('div');
      actions.className = 'confirm-actions';

      var localBtn = document.createElement('button');
      localBtn.className = 'preset-btn';
      localBtn.textContent = 'Keep local data';

      var cloudBtn = document.createElement('button');
      cloudBtn.className = 'preset-btn';
      cloudBtn.textContent = 'Use cloud data';

      actions.appendChild(localBtn);
      actions.appendChild(cloudBtn);
      dialog.appendChild(msg);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      localBtn.addEventListener('click', function () { overlay.remove(); resolve('local'); });
      cloudBtn.addEventListener('click', function () { overlay.remove(); resolve('cloud'); });
    });
  }

  // --- First-login merge: call this right after a successful sign-in ---
  // Determines what to do based on whether cloud data exists and whether
  // local data has been customized. Skips the prompt on repeat logins
  // from the same device (tracked via cw_synced_user_id).
  async function handleFirstLoginMerge() {
    var userId = await getLoggedInUserId();
    if (!userId) return;

    // Already set up for this user on this device — just pull latest
    var syncedUserId = safeGetItem('cw_synced_user_id');
    if (syncedUserId === userId) {
      pullFromCloud().catch(function (err) {
        console.warn('[sync] background pull on re-login failed:', err);
      });
      return;
    }

    var cloudExists = await hasCloudData(userId);

    if (!cloudExists) {
      // Brand new user: push local data to initialize cloud
      await pushAllToCloud();
    } else if (isDefaultData()) {
      // Returning user on a fresh device: pull cloud data down
      await pullFromCloud();
    } else {
      // Both local and cloud have non-default data: ask the user
      var choice = await showMergeDialog();
      if (choice === 'local') {
        await pushAllToCloud();
      } else {
        await pullFromCloud();
      }
    }

    safeSetItem('cw_synced_user_id', userId);
  }

  // --- Background sync on page load (if already logged in) ---
  // Pull first so data created on other devices is merged into localStorage
  // before we push.  This prevents syncCustomProfiles from deleting cloud
  // rows that only exist on another device.  The small risk of overwriting
  // a very-recent local save is mitigated by flushPendingSync on
  // beforeunload / visibilitychange, which pushes before the page unloads.
  async function initSync() {
    try {
      var result = await window.supabaseClient.auth.getSession();
      if (result.data && result.data.session) {
        await pullFromCloud().catch(function (err) {
          console.warn('[sync] pull on page load failed:', err);
        });
        pushAllToCloud().catch(function (err) {
          console.warn('[sync] push on page load failed:', err);
        });
      }
    } catch (_) {}
  }

  // --- Flush pending sync when navigating away ---
  function flushPendingSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
      pushAllToCloud().catch(function (err) {
        console.warn('[sync] flush on leave failed:', err);
      });
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushPendingSync();
  });

  window.addEventListener('beforeunload', flushPendingSync);

  // Expose public API
  window.scheduleSyncToCloud = scheduleSyncToCloud;
  window.syncNow = syncNow;
  window.pushAllToCloud = pushAllToCloud;
  window.pullFromCloud = pullFromCloud;
  window.handleFirstLoginMerge = handleFirstLoginMerge;

  // Kick off background sync
  initSync();
})();
