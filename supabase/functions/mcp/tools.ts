// The MCP tools. Every query runs through the caller's own Supabase client, so
// row-level security decides what is visible and writable; nothing here uses
// the service role.
//
// Phase 1 scope: read recipes, source waters, minerals and concentrates;
// analyse a water; work out doses (the Calculator page's own math); create
// and adjust PRIVATE recipes and saved source waters.
// Phase 2 adds concentrates: derive a formula from a recipe, and create or
// change a Recipe Concentrate or Mineral Concentrate, one at a time, through
// the database function public.mcp_save_concentrate.
// There is no tool that publishes, deletes, or changes a published recipe,
// and supabase/migrations/20261122200921_restrict_oauth_client_access.sql
// refuses those at the database for any AI-app login, tool or no tool.

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  BRAND_CONCENTRATES,
  computeDoses,
  MINERAL_DB,
  RESERVED_TARGET_KEYS,
  slugify,
  SOURCE_PRESETS,
} from "./app-core.gen.js";
import {
  analyze,
  asStringArray,
  BOTTLE_ML_MAX,
  BOTTLE_ML_MIN,
  buildDiySpec,
  buildRecipeInsert,
  buildRecipePatch,
  buildSourcePatch,
  buildSourceValues,
  buildStockSpec,
  calciumChlorideFormFor,
  cleanDescription,
  cleanName,
  DESCRIPTION_MAX,
  deriveFormula,
  type DiySpec,
  diyView,
  DOSE_ML_PER_L_MAX,
  DOSE_ML_PER_L_MIN,
  doseLines,
  DROP_ML_MAX,
  DROP_ML_MIN,
  type DosingResult,
  HCO3_TO_CACO3_FACTOR,
  isBuiltinSourceKey,
  kitFromSettings,
  kitSummary,
  likeLiteral,
  mergeSourceWaters,
  MINERAL_GRAMS_MAX,
  NAME_MAX,
  pickDefaultSource,
  pickProfileKey,
  pickStockKey,
  pickVerifiedProfileKey,
  recipeDetail,
  recipeReadOnlyReason,
  recipeSummary,
  resolveIons,
  rowIons,
  saveConcentrateError,
  type SourceRow,
  sourceWaterView,
  STOCK_MINERALS_MAX,
  stockKeyFromId,
  type StockSpec,
  stockView,
  type TargetRow,
  ToolError,
  VOLUME_MAX_LITERS,
} from "./logic.ts";

// The user-scoped client from withSupabase({ auth: "user" }). Typed loosely:
// generated database types would be one more file to keep in step with the
// migrations, and the row shapes this file relies on are declared in logic.ts.
// deno-lint-ignore no-explicit-any
type Db = any;

const TARGET_COLUMNS =
  "id, user_id, slug, label, brew_method, calcium, magnesium, alkalinity, potassium, sodium, sulfate, chloride, bicarbonate, description, is_public, creator_display_name, creator_user_id, tags, roast, tray, stock_formula, created_at, updated_at";
const SOURCE_COLUMNS =
  "id, user_id, slug, label, calcium, magnesium, potassium, sodium, sulfate, chloride, bicarbonate, updated_at";

// Community recipes returned by list_recipes at most, AFTER the brew-method
// and name filters have been applied in the query. The canonical library is
// always returned whole.
const COMMUNITY_LIMIT = 100;

const INSTRUCTIONS = [
  "Cafelytic is a coffee water calculator. These tools read and save the signed-in user's own data.",
  "All ion values are mg/L (ppm) in the finished water. Alkalinity, GH and KH are mg/L as CaCO3.",
  "A recipe is a target water profile. A source water is the water the user starts from.",
  "Recipes saved here are always private. Publishing a recipe to the public Recipe Library, and deleting anything, can only be done by the user in the Cafelytic app.",
  "Published and library recipes are read-only here: to change one, save a new private recipe with create_recipe.",
  "Every write returns the app's own range findings for the saved water; relay any warn or danger finding to the user.",
  "A concentrate saved here is added to the user's Settings but is NOT switched on: the user enables it in the Cafelytic app. After saving one, tell the user to check that it appears in the app; if the app had unsynced changes on another device it can be missing, and saving it again fixes that. Concentrates cannot be deleted from here.",
  "To tell the user how much of each mineral or concentrate to add, use calculate_doses: it runs the Cafelytic calculator's own math with the minerals and concentrates they enabled in the app. Do not work doses out yourself.",
].join(" ");

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/** Run a tool body, turning expected failures into tool errors the model can read. */
async function run(body: () => Promise<unknown>) {
  try {
    return ok(await body());
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    console.error("mcp tool failed", err);
    return fail("Cafelytic could not complete that request. Try again in a moment.");
  }
}

/** Throw on a Supabase error; a permission error means a database rule said no. */
function check<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error) {
    if (result.error.code === "42501") {
      throw new ToolError("Cafelytic does not allow that change from an AI app.");
    }
    throw new Error(result.error.message);
  }
  return result.data;
}

const ionShape = {
  calcium: z.number().optional().describe("Calcium, mg/L"),
  magnesium: z.number().optional().describe("Magnesium, mg/L"),
  potassium: z.number().optional().describe("Potassium, mg/L"),
  sodium: z.number().optional().describe("Sodium, mg/L"),
  sulfate: z.number().optional().describe("Sulfate, mg/L"),
  chloride: z.number().optional().describe("Chloride, mg/L"),
  bicarbonate: z.number().optional().describe(
    "Bicarbonate, mg/L. Send this or alkalinity, not both.",
  ),
  alkalinity: z.number().optional().describe(
    "Alkalinity (KH) as mg/L CaCO3. Send this or bicarbonate, not both.",
  ),
};
const brewMethod = z.enum(["filter", "espresso"]);
const uuid = z.string().uuid();

export function buildServer(supabase: Db, userId: string): McpServer {
  const server = new McpServer(
    { name: "cafelytic", title: "Cafelytic", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  async function loadSelections() {
    const row = check(
      await supabase
        .from("user_selections")
        .select(
          "source_preset, source_water, target_preset, deleted_source_presets, deleted_target_presets",
        )
        .eq("user_id", userId)
        .maybeSingle(),
    ) as Record<string, unknown> | null;
    return {
      sourcePreset: typeof row?.source_preset === "string" ? row.source_preset : null,
      // The ion values the app's Starting Water fields hold right now.
      sourceWater: row?.source_water ?? null,
      targetPreset: typeof row?.target_preset === "string" ? row.target_preset : null,
      deletedSources: asStringArray(row?.deleted_source_presets),
      deletedTargets: asStringArray(row?.deleted_target_presets),
    };
  }

  async function loadMyRecipes(): Promise<TargetRow[]> {
    return check(
      await supabase
        .from("target_profiles")
        .select(TARGET_COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
    ) as TargetRow[];
  }

  // -------------------------------------------------------------------------
  // Recipes: read
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_recipes",
    {
      title: "List recipes",
      description:
        "List water recipes (target profiles): the user's own saved recipes, the official Cafelytic Recipe Library, and community recipes. Each entry has its id, name, GH / KH / TDS and ions. Use get_recipe for the description and range findings.",
      inputSchema: z.object({
        scope: z.enum(["mine", "library", "all"]).default("all").describe(
          "mine: the user's saved recipes. library: official and community recipes. all: both.",
        ),
        brew_method: brewMethod.optional().describe("Only recipes for this brew method."),
        search: z.string().max(60).optional().describe("Only recipes whose name contains this."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ scope, brew_method, search }) =>
      run(async () => {
        const selections = await loadSelections();
        const rows: TargetRow[] = [];
        if (scope !== "library") {
          const hidden = new Set(selections.deletedTargets);
          rows.push(...(await loadMyRecipes()).filter((r) => !hidden.has(r.slug)));
        }
        const needle = (search || "").trim().toLowerCase();
        if (scope !== "mine") {
          // The community query is capped, so it filters in the database: a
          // match must not be lost because 100 newer non-matches came first.
          let community = supabase.from("target_profiles").select(TARGET_COLUMNS)
            .eq("is_public", true).not("user_id", "is", null);
          // In "all" the caller's own rows (published ones included) already
          // came from loadMyRecipes. In "library" they have not, and the
          // caller's published recipes belong in the library view.
          if (scope === "all") community = community.neq("user_id", userId);
          if (brew_method) community = community.in("brew_method", [brew_method, "all"]);
          if (needle) community = community.ilike("label", `%${likeLiteral(needle)}%`);
          const [canonical, communityRows] = await Promise.all([
            supabase.from("target_profiles").select(TARGET_COLUMNS).eq("is_public", true)
              .is("user_id", null).order("label"),
            community.order("created_at", { ascending: false }).range(0, COMMUNITY_LIMIT - 1),
          ]);
          rows.push(
            ...(check(canonical) as TargetRow[]),
            ...(check(communityRows) as TargetRow[]),
          );
        }
        const recipes = rows
          .filter((r) => !brew_method || r.brew_method === brew_method || r.brew_method === "all")
          .filter((r) => !needle || (r.label || "").toLowerCase().includes(needle))
          .map((r) => recipeSummary(r, userId, selections.targetPreset));
        return { count: recipes.length, recipes };
      }),
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get recipe",
      description:
        "Full detail for one recipe by id (from list_recipes): ions, GH / KH / TDS, sulfate to chloride ratio, description, the app's range findings, and whether it can be changed with update_recipe.",
      inputSchema: z.object({ id: uuid.describe("Recipe id from list_recipes.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      run(async () => {
        const row = check(
          await supabase.from("target_profiles").select(TARGET_COLUMNS).eq("id", id).maybeSingle(),
        ) as TargetRow | null;
        if (!row) throw new ToolError("No recipe with that id is visible to this account.");
        const selections = await loadSelections();
        return recipeDetail(row, userId, selections.targetPreset);
      }),
  );

  // -------------------------------------------------------------------------
  // Source waters, minerals, concentrates: read
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_source_waters",
    {
      title: "List source waters",
      description:
        "List the starting waters available to the user: built-in ones (distilled, tap presets, bottled waters) and the ones they saved, each with ions and GH / KH / TDS. active_in_app marks the one currently selected in the app.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const [rows, selections] = await Promise.all([
          supabase.from("source_profiles").select(SOURCE_COLUMNS).eq("user_id", userId).order(
            "label",
          ),
          loadSelections(),
        ]);
        const waters = mergeSourceWaters(
          check(rows) as SourceRow[],
          selections.deletedSources,
          selections.sourcePreset,
        );
        return { count: waters.length, source_waters: waters };
      }),
  );

  server.registerTool(
    "list_minerals",
    {
      title: "List minerals",
      description:
        "The mineral salts Cafelytic can dose (id, name, formula, and the mg/L of each ion that 1 g per liter adds), with selected: true on the ones the user has enabled in the app.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const row = check(
          await supabase.from("user_settings").select("selected_minerals").eq("user_id", userId)
            .maybeSingle(),
        ) as { selected_minerals?: unknown } | null;
        const selected = new Set(asStringArray(row?.selected_minerals));
        const minerals = Object.entries(MINERAL_DB).map(([id, m]) => {
          const mineral = m as {
            name: string;
            formula: string;
            description: string;
            ions: Record<string, number>;
          };
          const perGram: Record<string, number> = {};
          for (const [ion, fraction] of Object.entries(mineral.ions)) {
            perGram[ion] = Math.round(fraction * 1000 * 10) / 10;
          }
          return {
            id,
            name: mineral.name,
            formula: mineral.formula,
            description: mineral.description,
            mg_per_l_added_by_1_g_per_l: perGram,
            selected: row ? selected.has(id) : null,
          };
        });
        return { minerals };
      }),
  );

  server.registerTool(
    "list_concentrates",
    {
      title: "List concentrates",
      description:
        "The user's concentrates: Recipe Concentrates (a multi-mineral bottle dosed in mL per liter), Mineral Concentrates (one mineral dissolved in a bottle), and the ready-made brand concentrates Cafelytic knows. selected marks the ones switched on in the app.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const row = check(
          await supabase.from("user_settings")
            .select("stock_concentrate_specs, diy_concentrate_specs, selected_concentrates")
            .eq("user_id", userId).maybeSingle(),
        ) as Record<string, unknown> | null;
        const selected = new Set(asStringArray(row?.selected_concentrates));
        const stock = (row?.stock_concentrate_specs && typeof row.stock_concentrate_specs === "object")
          ? row.stock_concentrate_specs as Record<string, Record<string, unknown>>
          : {};
        const diy = (row?.diy_concentrate_specs && typeof row.diy_concentrate_specs === "object")
          ? row.diy_concentrate_specs as Record<string, Record<string, unknown>>
          : {};
        return {
          recipe_concentrates: Object.entries(stock).map(([key, spec]) => ({
            id: "stock:" + key,
            name: spec.label || key,
            bottle_ml: spec.bottleMl ?? null,
            dose_ml_per_liter: spec.doseGramsPerL ?? null,
            drop_ml: spec.dropMl ?? null,
            minerals: Array.isArray(spec.minerals) ? spec.minerals : [],
            made_from: spec.createdFrom ?? null,
            selected: selected.has("stock:" + key),
          })),
          mineral_concentrates: Object.entries(diy).map(([mineralId, spec]) => ({
            id: "diy:" + mineralId,
            mineral_id: mineralId,
            bottle_ml: spec.bottleMl ?? null,
            grams_per_bottle: spec.gramsPerBottle ?? null,
            drop_ml: spec.dropMl ?? null,
            selected: selected.has("diy:" + mineralId),
          })),
          brand_concentrates: Object.entries(BRAND_CONCENTRATES).map(([id, b]) => {
            const brand = b as { name: string; mineralId: string; gramsPerMl: number };
            return {
              id,
              name: brand.name,
              mineral_id: brand.mineralId,
              grams_per_ml: brand.gramsPerMl,
              selected: selected.has(id),
            };
          }),
        };
      }),
  );

  // -------------------------------------------------------------------------
  // Analysis
  // -------------------------------------------------------------------------

  server.registerTool(
    "analyze_water",
    {
      title: "Analyze water",
      description:
        "Compute GH, KH, TDS and the sulfate to chloride ratio for a set of ions, check them against Cafelytic's recommended ranges for the brew method, and check that the ions are charge-balanced (a profile that is not cannot be mixed exactly from salts). Saves nothing. Use it to check a recipe before create_recipe.",
      inputSchema: z.object({ ...ionShape, brew_method: brewMethod.default("filter") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ brew_method, ...ions }) =>
      run(() => {
        const resolved = resolveIons(ions);
        const { alkalinity, ...ionValues } = resolved;
        return Promise.resolve({
          ions: buildSourceValues(ionValues),
          alkalinity: Math.round(alkalinity * 100) / 100,
          ...analyze(ionValues, brew_method, alkalinity),
        });
      }),
  );

  // -------------------------------------------------------------------------
  // Doses
  // -------------------------------------------------------------------------

  const MINERAL_IDS = Object.keys(MINERAL_DB) as [string, ...string[]];

  server.registerTool(
    "calculate_doses",
    {
      title: "Calculate doses",
      description:
        "How much of each mineral or concentrate to add to a source water to make a recipe, for a given volume. This is the Cafelytic calculator's own math and gives the same amounts the app shows. The target is a saved or library recipe (recipe_id) or a set of ions. The source water defaults to the one active in the app. Doses use the minerals and concentrates the user has enabled in the app, unless `minerals` lists the powders to use instead. Returns each dose (grams, mL or drops), any warnings, and the finished water with its range findings. Saves nothing.",
      inputSchema: z.object({
        recipe_id: uuid.optional().describe(
          "Recipe to make, from list_recipes. Send this or target ions, not both.",
        ),
        ...ionShape,
        brew_method: brewMethod.optional().describe(
          "Brew method the finished water is judged for. Defaults to the recipe's, or filter.",
        ),
        source_water_id: uuid.optional().describe("A saved source water, from list_source_waters."),
        source_water_key: z.string().min(1).max(60).optional().describe(
          "A built-in source water by key from list_source_waters, such as distilled.",
        ),
        volume_liters: z.number().positive().max(VOLUME_MAX_LITERS).default(1).describe(
          "Liters of water to make. 1 US gallon is 3.785 liters.",
        ),
        minerals: z.array(z.enum(MINERAL_IDS)).min(1).max(MINERAL_IDS.length).optional().describe(
          "Mineral ids (from list_minerals) to dose with, as powders, INSTEAD of the user's enabled minerals and concentrates. Leave out to use what they enabled in the app.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ recipe_id, brew_method, source_water_id, source_water_key, volume_liters, minerals, ...ions }) =>
      run(async () => {
        const sentIons = Object.values(ions).some((v) => v !== undefined);
        if (recipe_id && sentIons) {
          throw new ToolError("Send recipe_id or target ions, not both.");
        }
        if (!recipe_id && !sentIons) {
          throw new ToolError("Say what to make: send recipe_id, or the target ions.");
        }
        if (source_water_id && source_water_key) {
          throw new ToolError("Send source_water_id or source_water_key, not both.");
        }

        const [recipeResult, sourceRows, selections, settingsResult] = await Promise.all([
          recipe_id
            ? supabase.from("target_profiles").select(TARGET_COLUMNS).eq("id", recipe_id)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase.from("source_profiles").select(SOURCE_COLUMNS).eq("user_id", userId),
          loadSelections(),
          minerals ? Promise.resolve({ data: null, error: null }) : supabase.from("user_settings")
            .select(
              "selected_minerals, selected_concentrates, stock_concentrate_specs, diy_concentrate_specs, lotus_dropper_type, lotus_concentrate_units",
            )
            .eq("user_id", userId).maybeSingle(),
        ]);

        // Target.
        const recipe = check(recipeResult) as TargetRow | null;
        if (recipe_id && !recipe) {
          throw new ToolError("No recipe with that id is visible to this account.");
        }
        let target: Record<string, number>;
        let brew: "filter" | "espresso";
        if (recipe) {
          const recipeIons = rowIons(recipe);
          target = {
            ...recipeIons,
            // A recipe stored without an alkalinity shows the whole-number KH
            // of its bicarbonate in the app's Alkalinity field.
            alkalinity: recipe.alkalinity == null
              ? Math.round(recipeIons.bicarbonate * HCO3_TO_CACO3_FACTOR)
              : Number(recipe.alkalinity),
          };
          brew = brew_method ?? (recipe.brew_method === "espresso" ? "espresso" : "filter");
        } else {
          target = resolveIons(ions);
          brew = brew_method ?? "filter";
        }

        // Source water.
        const waters = mergeSourceWaters(
          check(sourceRows) as SourceRow[],
          selections.deletedSources,
          selections.sourcePreset,
        );
        // A named source is the saved profile. With none named, it is the
        // water the app's calculator is using (see pickDefaultSource).
        const named = source_water_id
          ? waters.find((w) => w.id === source_water_id)
          : source_water_key
          ? waters.find((w) => w.key === source_water_key)
          : undefined;
        if ((source_water_id || source_water_key) && !named) {
          throw new ToolError(
            "No source water with that id or key is available to this account. Use list_source_waters.",
          );
        }
        const source = named
          ? { id: named.id, key: named.key, name: named.name, ions: named.ions, note: null }
          : pickDefaultSource(waters, selections.sourcePreset, selections.sourceWater);

        // Kit and doses.
        const kit = kitFromSettings(
          check(settingsResult) as Record<string, unknown> | null,
          minerals ?? null,
        );
        const result = computeDoses({
          sourceWater: source.ions,
          target,
          volumeL: volume_liters,
          kit,
          recipeSlug: recipe ? recipe.slug : null,
        }) as DosingResult;
        if (result.status === "no-alkalinity-source") {
          throw new ToolError(
            minerals
              ? "Those minerals include no alkalinity source. Add baking-soda or potassium-bicarbonate."
              : "The minerals enabled in the app include no alkalinity source, and the calculator needs one. The user can enable Baking Soda or Potassium Bicarbonate in the app's Settings, or pass `minerals` including baking-soda or potassium-bicarbonate.",
          );
        }
        if (result.status !== "ok" || !result.finalIons) {
          throw new ToolError("The volume must be more than zero.");
        }

        const { alkalinity: targetAlkalinity, ...targetIons } = target;
        return {
          target: {
            recipe_id: recipe ? recipe.id : null,
            name: recipe ? recipe.label : null,
            brew_method: brew,
            alkalinity: Math.round(Number(targetAlkalinity) * 100) / 100,
            ions: buildSourceValues(targetIons as ReturnType<typeof rowIons>),
          },
          source_water: { id: source.id, key: source.key, name: source.name, ions: source.ions },
          source_water_note: source.note,
          volume_liters,
          kit: {
            from: minerals ? "the minerals argument" : "the user's app settings",
            ...kitSummary(kit),
          },
          mode: result.mode,
          doses: doseLines(result, kit),
          missing_minerals: result.enableSuggestions.map((s) => ({
            for: s.ion === "bicarbonate" ? "alkalinity" : s.ion,
            enable_mineral_id: s.mineralId,
          })),
          warnings: result.warnings,
          result: {
            note:
              "The water these doses make. Doses are rounded the way the app shows them (grams to 0.01, whole drops), so it can differ slightly from the target.",
            ions: buildSourceValues(result.finalIons),
            ...(({ ion_balance: _balance, ...rest }) => rest)(
              analyze(result.finalIons, brew, null, result.rangeSources),
            ),
          },
        };
      }),
  );

  // -------------------------------------------------------------------------
  // Recipes: write (private only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "create_recipe",
    {
      title: "Create recipe",
      description:
        `Save a new PRIVATE recipe to the user's Cafelytic account. It appears in their app on the next sync. Ions are mg/L and are stored as whole numbers; ions left out are 0. The name must be new (max ${NAME_MAX} characters). The recipe cannot be published from here: the user publishes in the app if they want to.`,
      inputSchema: z.object({
        name: z.string().min(1).max(NAME_MAX),
        brew_method: brewMethod,
        description: z.string().max(DESCRIPTION_MAX).optional(),
        ...ionShape,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ name, brew_method, description, ...ions }) =>
      run(async () => {
        const label = cleanName(name);
        const text = cleanDescription(description);
        const resolved = resolveIons(ions);
        // Ask for the public rows that could collide (same name, or a key
        // starting with this name's key, which covers the "-2", "-3"
        // candidates) instead of reading the whole public library. The prefix
        // read is still subject to the API's row cap, so it is only a head
        // start: the key finally picked is checked on its own below.
        const baseKey = slugify(label);
        const [mine, sameLabel, sameKey, selections] = await Promise.all([
          loadMyRecipes(),
          supabase.from("target_profiles").select("label").eq("is_public", true)
            .ilike("label", likeLiteral(label)).limit(1),
          supabase.from("target_profiles").select("slug").eq("is_public", true)
            .like("slug", `${likeLiteral(baseKey)}%`),
          loadSelections(),
        ]);
        const publicLabels = (check(sameLabel) as { label: string }[]).map((r) => r.label);
        const publicKeys = (check(sameKey) as { slug: string }[]).map((r) => r.slug);
        const slug = await pickVerifiedProfileKey(label, {
          kind: "recipe",
          reservedKeys: RESERVED_TARGET_KEYS,
          existingKeys: mine.map((r) => r.slug),
          existingLabels: [...mine.map((r) => r.label), ...publicLabels],
          retiredKeys: [...selections.deletedTargets, ...publicKeys],
        }, async (key) => {
          const hit = check(
            await supabase.from("target_profiles").select("slug").eq("is_public", true)
              .eq("slug", key).limit(1),
          ) as unknown[];
          return hit.length > 0;
        });
        const row = buildRecipeInsert(
          userId,
          slug,
          label,
          brew_method,
          resolved,
          text,
          new Date().toISOString(),
        );
        const saved = check(
          await supabase.from("target_profiles").insert(row).select(TARGET_COLUMNS).single(),
        ) as TargetRow;
        return { saved: true, recipe: recipeDetail(saved, userId, selections.targetPreset) };
      }),
  );

  server.registerTool(
    "update_recipe",
    {
      title: "Update recipe",
      description:
        "Change the ions, brew method or description of one of the user's own PRIVATE recipes, by id. Only the fields sent are changed. Published recipes, library recipes, and saved copies of other people's recipes are refused: save a new recipe with create_recipe instead.",
      inputSchema: z.object({
        id: uuid.describe("Recipe id from list_recipes."),
        brew_method: brewMethod.optional(),
        description: z.string().max(DESCRIPTION_MAX).optional(),
        ...ionShape,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, brew_method, description, ...ions }) =>
      run(async () => {
        const row = check(
          await supabase.from("target_profiles").select(TARGET_COLUMNS).eq("id", id).maybeSingle(),
        ) as TargetRow | null;
        if (!row) throw new ToolError("No recipe with that id is visible to this account.");
        const blocked = recipeReadOnlyReason(row, userId);
        if (blocked) throw new ToolError(`"${row.label}" cannot be changed here. ${blocked}`);
        const selections = await loadSelections();
        if (selections.deletedTargets.includes(row.slug)) {
          throw new ToolError(`"${row.label}" was deleted in the app.`);
        }
        const current = rowIons(row);
        const currentAlk = row.alkalinity == null
          ? recipeSummary(row, userId).kh
          : Number(row.alkalinity);
        const resolved = resolveIons(ions, { ...current, alkalinity: currentAlk });
        const patch = buildRecipePatch(
          { ...ions, brew_method, description },
          resolved,
          new Date().toISOString(),
        );
        const saved = check(
          await supabase.from("target_profiles")
            .update(patch)
            .eq("id", id).eq("user_id", userId).eq("is_public", false)
            .select(TARGET_COLUMNS).maybeSingle(),
        ) as TargetRow | null;
        if (!saved) throw new ToolError(`"${row.label}" could not be changed. It may have just been published or removed.`);
        return { saved: true, recipe: recipeDetail(saved, userId, selections.targetPreset) };
      }),
  );

  // -------------------------------------------------------------------------
  // Source waters: write
  // -------------------------------------------------------------------------

  server.registerTool(
    "create_source_water",
    {
      title: "Create source water",
      description:
        `Save a new source water (the water the user starts from, such as their tap water) to their Cafelytic account. Ions are mg/L; ions left out are 0. The name must be new (max ${NAME_MAX} characters).`,
      inputSchema: z.object({ name: z.string().min(1).max(NAME_MAX), ...ionShape }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ name, ...ions }) =>
      run(async () => {
        const label = cleanName(name);
        const { alkalinity: _alkalinity, ...ionValues } = resolveIons(ions);
        const [rows, selections] = await Promise.all([
          supabase.from("source_profiles").select(SOURCE_COLUMNS).eq("user_id", userId),
          loadSelections(),
        ]);
        const mine = check(rows) as SourceRow[];
        const slug = pickProfileKey(label, {
          kind: "source water",
          reservedKeys: Object.keys(SOURCE_PRESETS),
          existingKeys: mine.map((r) => r.slug),
          existingLabels: [
            ...mine.map((r) => r.label),
            ...Object.values(SOURCE_PRESETS).map((p) => (p as { label: string }).label),
          ],
          retiredKeys: selections.deletedSources,
        });
        const saved = check(
          await supabase.from("source_profiles").insert({
            user_id: userId,
            slug,
            label,
            ...buildSourceValues(ionValues),
            updated_at: new Date().toISOString(),
          }).select(SOURCE_COLUMNS).single(),
        ) as SourceRow;
        return {
          saved: true,
          source_water: sourceWaterView(
            { id: saved.id, slug: saved.slug, label: saved.label, builtin: false, ...rowIons(saved) },
            selections.sourcePreset,
          ),
        };
      }),
  );

  server.registerTool(
    "update_source_water",
    {
      title: "Update source water",
      description:
        "Change the ions of one of the user's saved source waters, by id (from list_source_waters). Only the ions sent are changed. Built-in source waters cannot be changed here.",
      inputSchema: z.object({ id: uuid.describe("Source water id from list_source_waters."), ...ionShape }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, ...ions }) =>
      run(async () => {
        const row = check(
          await supabase.from("source_profiles").select(SOURCE_COLUMNS).eq("id", id).eq(
            "user_id",
            userId,
          ).maybeSingle(),
        ) as SourceRow | null;
        if (!row) throw new ToolError("No saved source water with that id belongs to this account.");
        if (isBuiltinSourceKey(row.slug)) {
          throw new ToolError(
            `"${row.label}" is a built-in source water. Edit it in the Cafelytic app, or save a new one with create_source_water.`,
          );
        }
        const selections = await loadSelections();
        if (selections.deletedSources.includes(row.slug)) {
          throw new ToolError(`"${row.label}" was deleted in the app.`);
        }
        // The base's alkalinity is unused for a source water (only bicarbonate
        // is stored); an untouched bicarbonate keeps its stored value exactly.
        const { alkalinity: _alkalinity, ...ionValues } = resolveIons(ions, {
          ...rowIons(row),
          alkalinity: 0,
        });
        const saved = check(
          await supabase.from("source_profiles")
            .update(buildSourcePatch(ions, ionValues, new Date().toISOString()))
            .eq("id", id).eq("user_id", userId).select(SOURCE_COLUMNS).maybeSingle(),
        ) as SourceRow | null;
        if (!saved) throw new ToolError(`"${row.label}" could not be changed. It may have been removed.`);
        return {
          saved: true,
          source_water: sourceWaterView(
            { id: saved.id, slug: saved.slug, label: saved.label, builtin: false, ...rowIons(saved) },
            selections.sourcePreset,
          ),
        };
      }),
  );

  // -------------------------------------------------------------------------
  // Concentrates: derive, create, change (phase 2)
  // -------------------------------------------------------------------------

  const obj = (v: unknown) =>
    (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;

  async function loadConcentrateSettings() {
    const row = check(
      await supabase.from("user_settings")
        .select("stock_concentrate_specs, diy_concentrate_specs, selected_concentrates, selected_minerals")
        .eq("user_id", userId).maybeSingle(),
    ) as Record<string, unknown> | null;
    return {
      stock: obj(row?.stock_concentrate_specs) as Record<string, StockSpec | undefined>,
      diy: obj(row?.diy_concentrate_specs) as Record<string, DiySpec | undefined>,
      selected: new Set(asStringArray(row?.selected_concentrates)),
      selectedMinerals: row ? row.selected_minerals : null,
    };
  }

  /** Save one concentrate through the database's merge function. */
  async function saveConcentrate(
    kind: "stock" | "diy",
    key: string,
    spec: StockSpec | DiySpec,
    mode: "create" | "update",
  ): Promise<{ spec: Record<string, unknown>; previous: Record<string, unknown> | null }> {
    const result = await supabase.rpc("mcp_save_concentrate", {
      p_kind: kind,
      p_key: key,
      p_spec: spec,
      p_mode: mode,
    });
    if (result.error) throw saveConcentrateError(result.error);
    return result.data;
  }

  const SAVED_NOTE =
    "Saved to the user's Cafelytic Settings. It is not switched on: the user enables it in the app. Ask them to check it appears there; if it is missing (the app had unsynced changes on another device), save it again.";

  const mineralEntries = z.array(z.object({
    mineral_id: z.enum(MINERAL_IDS).describe("Mineral id from list_minerals."),
    grams: z.number().positive().max(MINERAL_GRAMS_MAX).describe(
      "Grams of this mineral dissolved in the whole bottle.",
    ),
  })).min(1).max(STOCK_MINERALS_MAX);
  const bottleMl = z.number().min(BOTTLE_ML_MIN).max(BOTTLE_ML_MAX);
  const doseMlPerLiter = z.number().min(DOSE_ML_PER_L_MIN).max(DOSE_ML_PER_L_MAX);
  const dropMl = z.number().min(DROP_ML_MIN).max(DROP_ML_MAX).nullable().optional().describe(
    "Average mL per drop of the user's dropper, if they dose in drops. null removes it.",
  );

  server.registerTool(
    "derive_concentrate_formula",
    {
      title: "Derive concentrate formula",
      description:
        "Work out a Recipe Concentrate formula for a recipe: the grams of each mineral to dissolve in a bottle so that the dose per liter makes the recipe from distilled water. This is the formula the Cafelytic app derives. Saves nothing: review it with the user, then save it with create_recipe_concentrate.",
      inputSchema: z.object({
        recipe_id: uuid.optional().describe(
          "Recipe to make a concentrate for, from list_recipes. Send this or target ions, not both.",
        ),
        ...ionShape,
        bottle_ml: bottleMl.default(200).describe("Bottle size in mL."),
        dose_ml_per_liter: doseMlPerLiter.default(4).describe(
          "mL of concentrate added per liter of water.",
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ recipe_id, bottle_ml, dose_ml_per_liter, ...ions }) =>
      run(async () => {
        const sentIons = Object.values(ions).some((v) => v !== undefined);
        if (recipe_id && sentIons) throw new ToolError("Send recipe_id or target ions, not both.");
        if (!recipe_id && !sentIons) {
          throw new ToolError("Say what to make: send recipe_id, or the target ions.");
        }
        const [recipeResult, settings] = await Promise.all([
          recipe_id
            ? supabase.from("target_profiles").select(TARGET_COLUMNS).eq("id", recipe_id)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          loadConcentrateSettings(),
        ]);
        const recipe = check(recipeResult) as TargetRow | null;
        if (recipe_id && !recipe) {
          throw new ToolError("No recipe with that id is visible to this account.");
        }
        const target = recipe
          ? {
            ...rowIons(recipe),
            alkalinity: recipe.alkalinity == null
              ? Math.round(rowIons(recipe).bicarbonate * HCO3_TO_CACO3_FACTOR)
              : Number(recipe.alkalinity),
          }
          : resolveIons(ions);
        const derived = deriveFormula(target, {
          bottleMl: bottle_ml,
          doseMlPerLiter: dose_ml_per_liter,
          calciumChlorideId: calciumChlorideFormFor(settings.selectedMinerals),
        });
        if (derived.minerals.length === 0) {
          throw new ToolError("That recipe has no minerals to put in a concentrate.");
        }
        const preview = stockView("preview", {
          label: recipe ? recipe.label : "Preview",
          bottleMl: derived.bottleMl,
          doseGramsPerL: derived.doseGramsPerL,
          minerals: derived.minerals,
        });
        return {
          for_recipe: recipe ? { id: recipe.id, name: recipe.label } : null,
          bottle_ml: derived.bottleMl,
          dose_ml_per_liter: derived.doseGramsPerL,
          minerals: preview.minerals,
          adds_per_liter_at_dose: preview.adds_per_liter_at_dose,
          notes: [...derived.notes, ...preview.warnings],
          next_step:
            "To save this, call create_recipe_concentrate with these minerals, bottle_ml and dose_ml_per_liter" +
            (recipe ? `, and made_for_recipe_id "${recipe.id}".` : "."),
        };
      }),
  );

  server.registerTool(
    "create_recipe_concentrate",
    {
      title: "Create Recipe Concentrate",
      description:
        `Save a new Recipe Concentrate to the user's Cafelytic Settings: one bottle holding several minerals, dosed in mL per liter of water. It is saved but not switched on; the user enables it in the app. The name must be new (max ${NAME_MAX} characters). Use derive_concentrate_formula first to get a formula for a recipe.`,
      inputSchema: z.object({
        name: z.string().min(1).max(NAME_MAX),
        minerals: mineralEntries,
        bottle_ml: bottleMl.describe("Bottle size in mL."),
        dose_ml_per_liter: doseMlPerLiter.describe("mL of concentrate added per liter of water."),
        drop_ml: dropMl,
        made_for_recipe_id: uuid.optional().describe(
          "The recipe this concentrate was made for, if any. The calculator then recognises it as that recipe's own concentrate.",
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ made_for_recipe_id, ...input }) =>
      run(async () => {
        const spec = buildStockSpec(input);
        const [settings, recipeResult] = await Promise.all([
          loadConcentrateSettings(),
          made_for_recipe_id
            ? supabase.from("target_profiles").select("slug").eq("id", made_for_recipe_id)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        const recipe = check(recipeResult) as { slug: string } | null;
        if (made_for_recipe_id && !recipe) {
          throw new ToolError("No recipe with that made_for_recipe_id is visible to this account.");
        }
        if (recipe) spec.createdFrom = "derived:" + recipe.slug;
        const key = pickStockKey(spec.label, settings.stock);
        const saved = await saveConcentrate("stock", key, spec, "create");
        return {
          saved: true,
          note: SAVED_NOTE,
          concentrate: stockView(key, saved.spec as unknown as StockSpec, false),
        };
      }),
  );

  server.registerTool(
    "update_recipe_concentrate",
    {
      title: "Update Recipe Concentrate",
      description:
        "Change one of the user's Recipe Concentrates by id (from list_concentrates): its name, minerals, bottle size, dose, or dropper size. Only the fields sent are changed; sending minerals replaces the whole mineral list. If the concentrate is switched on in the app, the calculator's doses change with it, so confirm with the user first.",
      inputSchema: z.object({
        id: z.string().min(1).max(80).describe("Recipe Concentrate id from list_concentrates, like stock:my-bottle."),
        name: z.string().min(1).max(NAME_MAX).optional(),
        minerals: mineralEntries.optional(),
        bottle_ml: bottleMl.optional(),
        dose_ml_per_liter: doseMlPerLiter.optional(),
        drop_ml: dropMl,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, ...input }) =>
      run(async () => {
        if (Object.values(input).every((v) => v === undefined)) {
          throw new ToolError("Nothing to change: send at least one field.");
        }
        const key = stockKeyFromId(id);
        const settings = await loadConcentrateSettings();
        const existing = Object.prototype.hasOwnProperty.call(settings.stock, key)
          ? settings.stock[key]
          : undefined;
        if (!existing) {
          throw new ToolError("No Recipe Concentrate with that id. Use list_concentrates.");
        }
        const spec = buildStockSpec(input, existing);
        if (input.name !== undefined) {
          // A renamed concentrate keeps its key; refuse a name another one has.
          const others = { ...settings.stock };
          delete others[key];
          pickStockKey(spec.label, others);
        }
        const saved = await saveConcentrate("stock", key, spec, "update");
        const enabled = settings.selected.has("stock:" + key);
        return {
          saved: true,
          note: enabled
            ? "Saved. This concentrate is switched on in the app, so the calculator's doses now use the new values. Ask the user to check it in the app."
            : "Saved. Ask the user to check it in the app's Settings.",
          before: stockView(key, existing, enabled),
          concentrate: stockView(key, saved.spec as unknown as StockSpec, enabled),
        };
      }),
  );

  server.registerTool(
    "save_mineral_concentrate",
    {
      title: "Save Mineral Concentrate",
      description:
        "Create or change the user's Mineral Concentrate for one mineral: that mineral dissolved in a bottle, dosed by mL or drops. Each mineral has at most one. If one exists, only the fields sent are changed, and the reply shows the values before. A new one is saved but not switched on; the user enables it in the app. If it is already switched on, the calculator's doses change, so confirm with the user first.",
      inputSchema: z.object({
        mineral_id: z.enum(MINERAL_IDS).describe("Mineral id from list_minerals."),
        bottle_ml: bottleMl.optional().describe("Bottle size in mL. Required for a new one."),
        grams_per_bottle: z.number().positive().max(MINERAL_GRAMS_MAX).optional().describe(
          "Grams of the mineral dissolved in the whole bottle. Required for a new one.",
        ),
        drop_ml: dropMl,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ mineral_id, ...input }) =>
      run(async () => {
        if (Object.values(input).every((v) => v === undefined)) {
          throw new ToolError("Nothing to save: send bottle_ml and grams_per_bottle.");
        }
        const settings = await loadConcentrateSettings();
        const existing = Object.prototype.hasOwnProperty.call(settings.diy, mineral_id)
          ? settings.diy[mineral_id]
          : undefined;
        const spec = buildDiySpec(input, existing ?? null);
        const saved = await saveConcentrate("diy", mineral_id, spec, existing ? "update" : "create");
        const enabled = settings.selected.has("diy:" + mineral_id);
        return {
          saved: true,
          created: !existing,
          note: enabled
            ? "Saved. This concentrate is switched on in the app, so the calculator's doses now use the new values. Ask the user to check it in the app."
            : SAVED_NOTE,
          before: existing ? diyView(mineral_id, existing, enabled) : null,
          concentrate: diyView(mineral_id, saved.spec as unknown as DiySpec, enabled),
        };
      }),
  );

  return server;
}
