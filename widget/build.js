const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/index.js"],
  bundle: true,
  minify: !watch,
  outfile: "../backend/static/widget.js",
};

if (watch) {
  esbuild.context(config).then((ctx) => {
    ctx.watch();
    console.log("Watching for changes...");
  });
} else {
  esbuild.buildSync(config);
  console.log("Widget built → backend/static/widget.js");
}
