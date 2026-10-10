// Builds content/blog/index.json from the frontmatter of every content/blog/*.md file.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const BLOG_DIR = path.resolve('content/blog')
const REQUIRED = ['title', 'slug', 'description', 'published', 'author']
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function toDateString(value) {
  // YAML parses unquoted dates into Date objects
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith('.md')).sort()
const errors = []
const slugs = new Map()
const posts = []

for (const file of files) {
  const raw = await readFile(path.join(BLOG_DIR, file), 'utf8')
  const { data, content } = matter(raw)

  for (const key of REQUIRED) {
    if (data[key] === undefined || data[key] === '') errors.push(`${file}: missing "${key}"`)
  }
  if (data.slug && !SLUG_RE.test(data.slug)) errors.push(`${file}: invalid slug "${data.slug}"`)
  if (data.slug && `${data.slug}.md` !== file) errors.push(`${file}: filename must be "${data.slug}.md"`)
  if (data.slug && slugs.has(data.slug)) errors.push(`${file}: duplicate slug (also in ${slugs.get(data.slug)})`)
  if (data.slug) slugs.set(data.slug, file)

  const published = toDateString(data.published)
  if (data.published && !/^\d{4}-\d{2}-\d{2}$/.test(published)) {
    errors.push(`${file}: "published" must be YYYY-MM-DD`)
  }

  if (data.draft === true) continue

  const words = content.trim().split(/\s+/).filter(Boolean).length
  posts.push({
    title: String(data.title),
    slug: String(data.slug),
    description: String(data.description),
    published,
    author: String(data.author),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    cover: data.cover ? String(data.cover) : null,
    readingTime: Math.max(1, Math.round(words / 220)),
  })
}

if (errors.length) {
  console.error('Content validation failed:\n' + errors.map((e) => `  - ${e}`).join('\n'))
  process.exit(1)
}

posts.sort((a, b) => b.published.localeCompare(a.published))
await writeFile(path.join(BLOG_DIR, 'index.json'), JSON.stringify(posts, null, 2) + '\n')
console.log(`Wrote ${posts.length} post(s) to content/blog/index.json`)
