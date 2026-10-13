// 检查每篇文章都进了某个系列。写完文章忘了改 series.ts 时，这里会拦住构建。
// 真正的单篇（不属于任何系列）加进下面的 STANDALONE 白名单。
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const POSTS_DIR = "src/content/posts";
const SERIES_FILE = "src/constants/series.ts";

// 独立单篇，不归任何系列
const STANDALONE = new Set([
	"hello-world",
	"ai-coding-workflow-2026",
	"staged-verify-pipeline",
	"skill-anti-exfiltration",
	"cycling-training-with-claude",
]);

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith(".md"));
const posts = new Set(files.map((f) => basename(f, ".md")));

const seriesSrc = await readFile(SERIES_FILE, "utf8");
// 只取 posts: [...] 块里的 slug，避免把 slug: "xxx" 字段也算进来
const inSeries = new Set();
for (const block of seriesSrc.matchAll(/posts:\s*\[([\s\S]*?)\]/g)) {
	for (const m of block[1].matchAll(/"([a-z0-9-]+)"/g)) inSeries.add(m[1]);
}

const orphans = [...posts].filter((p) => !inSeries.has(p) && !STANDALONE.has(p));
const dangling = [...inSeries].filter((s) => !posts.has(s));

let failed = false;

if (orphans.length) {
	failed = true;
	console.error(`\n✗ ${orphans.length} 篇文章没进任何系列：`);
	for (const o of orphans) console.error(`    ${o}`);
	console.error(`\n  把它们加进 ${SERIES_FILE} 的某个系列，`);
	console.error("  或者确实是独立单篇的话，加进本脚本的 STANDALONE。");
}

if (dangling.length) {
	failed = true;
	console.error(`\n✗ 系列里引用了不存在的文章：`);
	for (const d of dangling) console.error(`    ${d}`);
	console.error("\n  文章改名或删除后要同步改 series.ts。");
}

// 同一篇被多个系列收走，读者会在两处看到它
const seen = new Map();
for (const block of seriesSrc.matchAll(
	/slug:\s*"([a-z0-9-]+)"[\s\S]*?posts:\s*\[([\s\S]*?)\]/g,
)) {
	for (const m of block[2].matchAll(/"([a-z0-9-]+)"/g)) {
		if (!seen.has(m[1])) seen.set(m[1], []);
		seen.get(m[1]).push(block[1]);
	}
}
const dupes = [...seen].filter(([, v]) => v.length > 1);
if (dupes.length) {
	failed = true;
	console.error(`\n✗ 同一篇被多个系列收走：`);
	for (const [p, v] of dupes) console.error(`    ${p} → ${v.join(", ")}`);
}

if (failed) process.exit(1);

console.log(
	`✓ 系列检查通过：${posts.size} 篇，${inSeries.size} 篇在系列里，${STANDALONE.size} 篇独立`,
);
