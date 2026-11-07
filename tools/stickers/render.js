// SVG → PNG 512×512 с прозрачным фоном (нужен Playwright: npm i -g playwright).
//   node tools/stickers/render.js
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const SVG = path.join(__dirname, "svg");
const OUT = [path.join(ROOT, "server", "pb_public", "stickers", "bee"), path.join(ROOT, "android", "app", "src", "main", "assets", "stickers", "bee")];

(async () => {
  OUT.forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  for (const f of fs.readdirSync(SVG).filter((x) => x.endsWith(".svg")).sort()) {
    await p.setContent(`<html><body style="margin:0;background:transparent">${fs.readFileSync(path.join(SVG, f), "utf8")}</body></html>`);
    const png = await p.locator("svg").screenshot({ omitBackground: true });
    OUT.forEach((d) => fs.writeFileSync(path.join(d, f.replace(/\.svg$/, ".png")), png));
    console.log(f, png.length);
  }
  await b.close();
})();
