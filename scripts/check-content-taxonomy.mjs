import fs from "node:fs";
import path from "node:path";

const categoriesSource = fs.readFileSync(
	path.resolve("src/constants/categories.ts"),
	"utf8",
);
const allowedCategories = new Set(
	[...categoriesSource.matchAll(/^\s*"([^"]+)",$/gm)].map((match) => match[1]),
);
const requiredCategories = [...allowedCategories];
const postsDirectory = path.resolve("src/content/posts");
const siteConfig = fs.readFileSync(path.resolve("src/config.ts"), "utf8");
const categoryCounts = new Map();
const errors = [];

if (!siteConfig.includes('subtitle: "工具作品 · 系统研究 · 工程实践"')) {
	errors.push("站点副标题未覆盖新的内容结构");
}
if (!siteConfig.includes('bio: "记录工具作品、系统研究与工程实践。"')) {
	errors.push("个人简介未覆盖新的内容结构");
}

for (const filename of fs.readdirSync(postsDirectory)) {
	if (!filename.endsWith(".md")) continue;

	const content = fs.readFileSync(path.join(postsDirectory, filename), "utf8");
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
	const category = frontmatter?.match(/^category:\s*(.+)$/m)?.[1]?.trim();

	if (!category) {
		errors.push(`${filename}: 缺少 category`);
		continue;
	}
	if (!allowedCategories.has(category)) {
		errors.push(`${filename}: 未允许的分类「${category}」`);
		continue;
	}

	categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
}

for (const category of requiredCategories) {
	if (!categoryCounts.has(category)) {
		errors.push(`缺少分类「${category}」`);
	}
}

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}

console.log(
	requiredCategories
		.map((category) => `${category}:${categoryCounts.get(category)}`)
		.join(" | "),
);
