---
name: publish-post
description: Publish a finished article from the Sauron archives drafts folder (C:\sauron-archives\Dotlet\writing\drafts\<slug>\final.md) as a blog post in this dotlet-cms repo. Use when asked to publish, import, or add a draft post to the blog.
---

# Publish a draft as a Dotlet blog post

## Inputs

- Source: a Windows path like `C:\sauron-archives\Dotlet\writing\drafts\<slug>\final.md`.
  In WSL this is `/mnt/c/sauron-archives/Dotlet/writing/drafts/<slug>/final.md`.
- **The source directory is READ-ONLY.** Never write, move, or delete anything there.

## Steps

1. Read the source folder (read only):
   - `final.md` – the article body.
   - `brief.md` – goal, persona, central argument (use for `description` and `tags`).
   - `workflow.json` – check `state`. If it is not an approved/final state
     (e.g. `awaiting_human_approval`), tell the user in your final summary, but still publish if they asked.
2. Determine the slug: the drafts folder name (must match `^[a-z0-9]+(-[a-z0-9]+)*$`).
3. Create `content/blog/<slug>.md`:
   - Replace the source frontmatter (`status`, `revision`, `primary_persona`, ...) with the repo frontmatter:
     ```md
     ---
     title: "<from the H1>"
     slug: "<slug>"
     description: "<one sentence, ~150-200 chars, derived from brief.md goal/argument>"
     published: "<today, YYYY-MM-DD>"
     author: "Odafe"
     tags:
       - <2-5 lowercase tags>
     cover: ""
     draft: false
     ---
     ```
   - Remove the first `# H1` (the site renders `title`), and leading blank lines.
   - Keep the rest of the body verbatim. Helper:
     ```sh
     awk 'NR==1&&/^---$/{fm=1;next} fm&&/^---$/{fm=0;next} fm{next} !h&&/^# /{h=1;next} {print}' "$SRC" | sed '/./,$!d'
     ```
   - If the body references local images, copy them into `content/blog/images/` and rewrite links to `images/<file>`.
4. If asked to remove a post, `git rm content/blog/<slug>.md`.
5. Run `npm run build:index` – must pass and list the new post in `content/blog/index.json`.
6. Show `git status` and summarize. Only commit/push if the user asks (pushing to `main` publishes
   via the "Build blog index" Action and jsDelivr purge).
