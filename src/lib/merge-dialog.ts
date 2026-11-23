// The first-sign-in merge prompt: shown when this device holds its own data
// and the account already has saved data too (see handleFirstLoginMerge in
// sync.ts). The two halves here are kept apart so the wording can be unit
// tested without a DOM: summarizeMerge / describeMergeOptions are pure, and
// showMergeDialog only renders what they return.
//
// The bullets must keep describing what sync.ts really does for each choice:
//   "local" (Keep both): fold the account's concentrates into this device,
//     push everything (whole-row settings + selections, per-item upserts for
//     recipes and starting waters, deletes for locally tombstoned ones), then
//     pull so the account-only items land here.
//   "cloud" (Use account only): pull, which replaces this device's recipes,
//     starting waters, concentrates and settings with the account's.
// If either branch changes, change the wording with it.

export interface MergeItem {
  /** Stable identity: profile slug or concentrate id. */
  key: string;
  /** What the user called it. */
  name: string;
  /** Content hash; two items with the same key and fingerprint are identical. */
  fingerprint: string;
}

export interface MergeSide {
  recipes: MergeItem[];
  waters: MergeItem[];
  concentrates: MergeItem[];
}

export interface MergeLocalSide extends MergeSide {
  /** Slugs deleted on this device; a Keep-both push deletes them from the account. */
  deletedRecipeKeys: string[];
  deletedWaterKeys: string[];
}

export interface MergeGroup {
  localOnly: string[];
  cloudOnly: string[];
  /** Saved on both sides under the same key with different contents. */
  differing: string[];
  /** In the account, but deleted on this device. */
  deletedHere: string[];
}

export interface MergeSummary {
  recipes: MergeGroup;
  waters: MergeGroup;
  concentrates: MergeGroup;
}

function diffGroup(local: MergeItem[], cloud: MergeItem[], deletedKeys: string[]): MergeGroup {
  const deleted = new Set(deletedKeys);
  const cloudByKey = new Map<string, MergeItem>();
  cloud.forEach(function (item) {
    cloudByKey.set(item.key, item);
  });
  const group: MergeGroup = { localOnly: [], cloudOnly: [], differing: [], deletedHere: [] };
  const localKeys = new Set<string>();
  local.forEach(function (item) {
    // A tombstoned local entry is stale: the push skips it and the delete wins.
    if (deleted.has(item.key)) return;
    localKeys.add(item.key);
    const match = cloudByKey.get(item.key);
    if (!match) group.localOnly.push(item.name);
    else if (match.fingerprint !== item.fingerprint) group.differing.push(item.name);
  });
  cloud.forEach(function (item) {
    if (deleted.has(item.key)) group.deletedHere.push(item.name);
    else if (!localKeys.has(item.key)) group.cloudOnly.push(item.name);
  });
  return group;
}

export function summarizeMerge(local: MergeLocalSide, cloud: MergeSide): MergeSummary {
  return {
    recipes: diffGroup(local.recipes, cloud.recipes, local.deletedRecipeKeys),
    waters: diffGroup(local.waters, cloud.waters, local.deletedWaterKeys),
    // Concentrates have no tombstones: Keep both always unions them.
    concentrates: diffGroup(local.concentrates, cloud.concentrates, []),
  };
}

const MAX_NAMES = 4;

function countPhrase(names: string[], singular: string, plural: string): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, MAX_NAMES).join(", ");
  const rest = names.length - MAX_NAMES;
  const list = rest > 0 ? shown + ", and " + rest + " more" : shown;
  return names.length + " " + (names.length === 1 ? singular : plural) + " (" + list + ")";
}

// "2 recipes (A, B); 1 starting water (Tap)" for one bucket across all kinds,
// or "" when the bucket is empty everywhere.
function bucketPhrase(summary: MergeSummary, bucket: keyof MergeGroup): string {
  return [
    countPhrase(summary.recipes[bucket], "recipe", "recipes"),
    countPhrase(summary.waters[bucket], "starting water", "starting waters"),
    countPhrase(summary.concentrates[bucket], "concentrate", "concentrates"),
  ]
    .filter(Boolean)
    .join("; ");
}

export interface MergeOptionCopy {
  keepBoth: string[];
  accountOnly: string[];
}

const SETTINGS_LIST =
  "selected minerals, current starting water and recipe, Recipe Library picks, and unsaved drafts";

/**
 * The bullet points under each choice. With a summary they name the exact
 * items each choice adds, replaces or removes; with null (the account's
 * contents couldn't be read) they describe the same rules in general terms.
 */
export function describeMergeOptions(summary: MergeSummary | null): MergeOptionCopy {
  const keepSettings = "This device's settings replace your account's: " + SETTINGS_LIST + ".";
  const accountSettings = "Your account's settings replace this device's: " + SETTINGS_LIST + ".";

  if (!summary) {
    return {
      keepBoth: [
        "Recipes, starting waters and concentrates saved on this device are added to your account, and the ones in your account are added to this device.",
        "Where both have one with the same name, this device's version replaces your account's.",
        "Anything you deleted on this device is deleted from your account too.",
        keepSettings,
      ],
      accountOnly: [
        "Recipes, starting waters and concentrates saved only on this device are removed. This can't be undone.",
        "Everything in your account is loaded onto this device.",
        accountSettings,
      ],
    };
  }

  const localOnly = bucketPhrase(summary, "localOnly");
  const cloudOnly = bucketPhrase(summary, "cloudOnly");
  const differing = bucketPhrase(summary, "differing");
  const deletedHere = bucketPhrase(summary, "deletedHere");

  const keepBoth: string[] = [];
  if (localOnly) keepBoth.push("Adds to your account: " + localOnly + ".");
  if (cloudOnly) keepBoth.push("Adds to this device: " + cloudOnly + ".");
  if (differing) {
    keepBoth.push("Replaces your account's version with this device's: " + differing + ".");
  }
  if (deletedHere) {
    keepBoth.push(
      "Deletes from your account, because you deleted them on this device: " + deletedHere + ".",
    );
  }
  if (!localOnly && !cloudOnly && !differing && !deletedHere) {
    keepBoth.push("Your recipes, starting waters and concentrates already match. Nothing is lost.");
  } else if (!differing && !deletedHere) {
    keepBoth.push("Nothing saved on either side is removed.");
  }
  keepBoth.push(keepSettings);

  const accountOnly: string[] = [];
  if (localOnly) {
    accountOnly.push("Removes from this device: " + localOnly + ". This can't be undone.");
  } else {
    accountOnly.push("No recipe, starting water or concentrate is saved only on this device.");
  }
  if (differing) {
    accountOnly.push("Replaces this device's version with your account's: " + differing + ".");
  }
  if (cloudOnly || deletedHere) {
    accountOnly.push("Loads everything saved in your account onto this device.");
  }
  accountOnly.push(accountSettings);

  return { keepBoth: keepBoth, accountOnly: accountOnly };
}

function buildOption(
  title: string,
  tagline: string,
  bullets: string[],
  buttonLabel: string,
  onChoose: () => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "merge-option";

  const heading = document.createElement("h3");
  heading.className = "merge-option-title";
  heading.textContent = title;
  section.appendChild(heading);

  const lead = document.createElement("p");
  lead.className = "merge-option-tagline";
  lead.textContent = tagline;
  section.appendChild(lead);

  const list = document.createElement("ul");
  list.className = "merge-option-list";
  bullets.forEach(function (text) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  section.appendChild(list);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "preset-btn merge-option-btn";
  btn.textContent = buttonLabel;
  btn.addEventListener("click", onChoose);
  section.appendChild(btn);

  return section;
}

/** Shows the merge prompt; resolves "local" for Keep both, "cloud" for Use account only. */
export function showMergeDialog(summary: MergeSummary | null): Promise<"local" | "cloud"> {
  return new Promise(function (resolve) {
    const copy = describeMergeOptions(summary);

    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.style.display = "flex";

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog merge-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "merge-dialog-title");

    const title = document.createElement("h2");
    title.id = "merge-dialog-title";
    title.className = "merge-dialog-title";
    title.textContent = "This device and your account both have saved data";

    const intro = document.createElement("p");
    intro.className = "merge-dialog-intro";
    intro.textContent =
      "You used Cafelytic on this device before signing in, and your account already has data from another device. Choose what happens to each.";

    function choose(choice: "local" | "cloud"): void {
      overlay.remove();
      resolve(choice);
    }

    dialog.appendChild(title);
    dialog.appendChild(intro);
    dialog.appendChild(
      buildOption(
        "Keep both",
        "Combine this device with your account. This device wins where they disagree.",
        copy.keepBoth,
        "Keep both",
        function () {
          choose("local");
        },
      ),
    );
    dialog.appendChild(
      buildOption(
        "Use account only",
        "Make this device match your account and discard what is only here.",
        copy.accountOnly,
        "Use account only",
        function () {
          choose("cloud");
        },
      ),
    );
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}
