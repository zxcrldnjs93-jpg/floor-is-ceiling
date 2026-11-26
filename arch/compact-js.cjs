const fs = require("node:fs");
const vm = require("node:vm");

// Node includes Acorn. Using it here keeps the offline build free of npm installs.
const bundled = process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"];
if (!bundled) throw new Error("JS 압축에는 Acorn을 포함한 Node.js 22가 필요합니다.");
const acornModule = { exports: {} };
vm.runInNewContext(bundled, { module: acornModule, exports: acornModule.exports });
const acorn = acornModule.exports;

const options = { ecmaVersion: "latest", sourceType: "module" };
const word = /[\p{ID_Continue}$]/u;
const mergedPunctuation = new Set([
  "++", "--", "//", "/*", "**", "&&", "||", "??", "?.", "=>", "==", "!=",
  "<=", ">=", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "..",
]);
const motionDemos = new Map([
  ["modules/engines/motion.js", {
    global: "LandingMotion", exports: ["createMotion", "splitText", "drawPath", "morphPath", "counter"],
    helpers: ["transformDefaults", "transform", "trackValues", "restoreStyle", "nextTrackId", "attachNativeTrack", "pathPoses", "pathArguments", "parsePath"],
  }],
  ["modules/engines/motion-building.js", {
    global: "LandingBuilding", exports: ["createFloorDisplay", "createFloorDescent"], helpers: ["ledSegments", "ledCodes"],
  }],
]);

function syntax(code, onInsertedSemicolon) {
  return JSON.stringify(acorn.parse(code, { ...options, onInsertedSemicolon }), (name, value) => {
    if (name === "start" || name === "end") return undefined;
    if (typeof value === "bigint") return value.toString();
    return value;
  });
}

function sitePrototype(name, source) {
  if (name === "modules/engines/fx-card.js") {
    // The site draws through LandingArt.drawCard. Keep the prototype's PNG encoder and sharing.
    const statements = acorn.parse(source, options).body;
    const imports = statements.slice(0, 2);
    const omitted = new Set(["CARD_WIDTH", "CARD_HEIGHT", "renderedCards", "markupText", "renderCard", "rasterizeCard"]);
    const exportPng = statements.find((node) => node.declaration?.id?.name === "exportCardPng").declaration;
    const beforeEncode = exportPng.body.body.slice(0, 2);
    const edits = statements.filter((node) => {
      const declaration = node.declaration ?? node;
      return omitted.has(declaration.id?.name) || declaration.declarations?.some((item) => omitted.has(item.id.name));
    }).concat(beforeEncode, imports);
    for (const { start, end } of edits.sort((a, b) => b.start - a.start)) {
      const replacement = start === imports[1].start ? 'import { displayedPeak } from "@landing/engines/fx-type.js";' : "";
      source = source.slice(0, start) + replacement + source.slice(end);
    }
    return source;
  }
  const browserHelpers = name === "modules/engines/physics.js";
  const replayHelpers = name === "modules/engines/physics-replay.js";
  const motionDemo = motionDemos.get(name);
  if (motionDemo) {
    const demoTools = new Set([...motionDemo.exports, ...motionDemo.helpers]);
    const statements = acorn.parse(source, options).body[0].expression.callee.body.body;
    const publication = statements.find((node) => node.expression?.left?.property?.name === motionDemo.global);
    const api = publication.expression.right.arguments[0];
    const props = api.properties.filter((node) => !demoTools.has(node.key.name));
    source = source.slice(0, api.start + 1) + props.map((node) => source.slice(node.start, node.end)).join(", ")
      + source.slice(api.end - 1);
    const removable = statements.filter((node) => demoTools.has(node.id?.name)
      || node.declarations?.every((entry) => demoTools.has(entry.id.name)));
    for (const { start, end } of removable.reverse()) {
      source = source.slice(0, start) + source.slice(end);
    }
    return source;
  }
  if (!browserHelpers && !replayHelpers) return source;

  const demoExports = new Set(["recordImpacts", "recordRun", "replayRun"]);
  const removable = acorn.parse(source, options).body.filter((node) => {
    if (node.type !== "ExportNamedDeclaration") return false;
    if (browserHelpers) return node.source?.value === "@landing/engines/physics-browser.js";
    return demoExports.has(node.declaration?.id?.name);
  });
  for (const { start, end } of removable.reverse()) source = source.slice(0, start) + source.slice(end);
  return source;
}

function compact(source) {
  try {
    const statementEnds = new Set();
    const before = syntax(source, (position) => statementEnds.add(position));
    const notices = [];
    const tokens = acorn.tokenizer(source, {
      ...options,
      onComment: (_block, value, start, end) => {
        if (/[@!](?:license|preserve)|copyright/i.test(value)) notices.push(source.slice(start, end));
      },
    });
    let previous;
    let tight = "", withLineBreaks = "";
    for (const token of tokens) {
      const value = source.slice(token.start, token.end);
      const gap = source.slice(previous?.end ?? 0, token.start);
      if (previous && gap && value) {
        const left = source[previous.end - 1];
        const right = value[0];
        const newline = /[\r\n\u2028\u2029]/.test(gap);
        const needsSpace = ((word.test(left) || previous.type.label === "regexp") && word.test(right))
          || mergedPunctuation.has(left + right) || (/\d/.test(left) && right === ".");
        const space = needsSpace ? " " : "";
        withLineBreaks += newline ? "\n" : space;
        // Keep line breaks that trigger automatic semicolon insertion in the source.
        tight += newline && statementEnds.has(previous.end) ? "\n" : space;
      }
      tight += value;
      withLineBreaks += value;
      previous = token;
    }
    const prefix = notices.length ? notices.join("\n") + "\n" : "";
    for (const candidate of [tight, withLineBreaks]) {
      try {
        if (syntax(prefix + candidate) === before) return prefix + candidate;
      } catch {
        // Retry with the original line breaks if removing one changed parsing.
      }
    }
    return source;
  } catch {
    // Preserve input if the tokenizer or the semantic comparison cannot validate it.
    return source;
  }
}

const files = JSON.parse(fs.readFileSync(0, "utf8"));
const output = Object.entries(files)
  .filter(([name]) => !["modules/engines/physics-browser.js", "modules/engines/fx-card-design.js"].includes(name))
  .map(([name, source]) => [name, compact(sitePrototype(name, source))]);
process.stdout.write(JSON.stringify(Object.fromEntries(output)));
