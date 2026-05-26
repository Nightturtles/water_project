// Rasterize the source SVGs under resources/ to PNG sources at the sizes
// @capacitor/assets expects (1024x1024 for icons, 2732x2732 for splashes).
//
// Usage:
//   node scripts/generate-asset-pngs.cjs
//
// Re-run this whenever you edit one of the resources/*.svg files, then run
//   npx capacitor-assets generate --ios --android
// to fan the PNGs out to ios/App/App/Assets.xcassets and
// android/app/src/main/res/. Both commands write into the committed
// platform trees, so verify the diff before committing.
//
// Sharp is pulled in transitively via @capacitor/assets (devDep). The
// flatten step on opaque outputs removes the alpha channel, which iOS
// requires for app-icon PNGs (Apple rejects icons with transparency).

const path = require("node:path");
const sharp = require("sharp");

const resourcesDir = path.resolve(__dirname, "..", "resources");

const targets = [
  // icon-only is the iOS app-icon source: full-bleed, opaque.
  { name: "icon-only", size: 1024, flatten: "#111C2E" },
  // icon-foreground is the Android adaptive-icon foreground: must be
  // transparent so the launcher can composite it over icon-background.
  { name: "icon-foreground", size: 1024, flatten: null },
  // icon-background is the Android adaptive-icon background: opaque,
  // covers the launcher mask's full area.
  { name: "icon-background", size: 1024, flatten: "#111C2E" },
  // Splash sources are opaque and high-res so capacitor-assets can crop
  // them to every device aspect ratio without seeing through the edges.
  { name: "splash", size: 2732, flatten: "#fafaf7" },
  { name: "splash-dark", size: 2732, flatten: "#0f172a" },
];

async function main() {
  for (const t of targets) {
    const src = path.join(resourcesDir, `${t.name}.svg`);
    const dst = path.join(resourcesDir, `${t.name}.png`);
    // density=192 gives ~2.67x supersampling on a 1024 viewBox (renders at
    // ~2730 native, then resampled down to the target size for smoother
    // text edges than the default density=72 produces).
    let pipeline = sharp(src, { density: 192 }).resize(t.size, t.size, { fit: "fill" });
    if (t.flatten) pipeline = pipeline.flatten({ background: t.flatten });
    pipeline = pipeline.png({ compressionLevel: 9 });
    await pipeline.toFile(dst);
    console.log(`Wrote ${path.relative(process.cwd(), dst)} (${t.size}x${t.size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
