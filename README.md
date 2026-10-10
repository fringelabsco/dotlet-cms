# dotlet-cms

Markdown content for the Dotlet website, served via [jsDelivr](https://www.jsdelivr.com/).
The webapp fetches `content/blog/index.json` (post list) and `content/blog/<slug>.md` (post body) at runtime.

## Writing a post

1. Create `content/blog/<slug>.md` — the filename **must** match the `slug`.
2. Add frontmatter:

   ```md
   ---
   title: "Custom domains, explained"
   slug: "custom-domains-explained"
   description: "One-line summary shown in lists and link previews."
   published: "2026-10-10"   # YYYY-MM-DD
   author: "Odafe"
   tags:
     - dns
     - guides
   cover: "images/custom-domains.png"   # optional; relative to content/blog/ or absolute URL
   draft: false                        # true = hidden from the site
   ---
   ```

3. Write Markdown (GitHub-flavored: tables, task lists, fenced code with language for highlighting).
4. Commit and push to `main`. The **Build blog index** Action validates frontmatter, regenerates
   `content/blog/index.json`, and purges the jsDelivr cache. The post appears within a few minutes.

Images: put them in `content/blog/images/` and reference them relatively (`images/foo.png`).

## Local check

```sh
npm install
npm run build:index
```

## Repo settings

- Must stay **public** (jsDelivr only serves public repos).
- Settings → Actions → General → Workflow permissions → **Read and write**.
