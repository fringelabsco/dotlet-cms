---
title: "Introducing the Dotlet blog"
slug: "hello-world"
description: "Product updates, announcements, and technical deep-dives on custom domain infrastructure."
published: "2026-10-10"
author: "Odafe"
tags:
  - announcements
  - dotlet
cover: ""
draft: false
---

Welcome to the Dotlet blog. This is where we'll share product updates, guides, and deep-dives on **white-label domain infrastructure**.

## What to expect

- Guides on custom domains, DNS, and SSL
- Product announcements and changelogs
- Engineering notes from building Dotlet

## A quick example

Connecting a customer domain is a single API call:

```ts
const res = await fetch('https://api.dotlet.net/v1/domains', {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ hostname: 'app.customer.com' }),
})
```

| Record | Name  | Value              |
| ------ | ----- | ------------------ |
| CNAME  | app   | edge.dotlet.net    |

> Questions? [Book a demo](/demo) and we'll walk you through it.
