---
title: "Architecting Custom-Domain DNS Verification and TLS Automation"
slug: "architecting-custom-domain-dns-verification-and-tls-automation"
description: "A lifecycle model for multi-tenant SaaS custom domains: ownership and routing proofs, TLS provisioning, renewal, safe deprovisioning, and build-versus-buy boundaries."
published: "2026-10-10"
author: "Odafe"
tags:
  - dns
  - tls
  - architecture
  - guides
cover: ""
draft: false
---
Adding a `domain` column to a tenant table is easy. Operating that domain safely is not.

A production custom-domain feature has to establish several facts that change independently: the customer controls the hostname, DNS sends traffic to the intended edge, a certificate has been issued and deployed, the hostname is bound to the correct tenant, and those conditions remain true after launch. Treating all of that as one `is_active` boolean turns partial failures into outages—and, in the worst case, a security boundary failure.

This guide presents a lifecycle model for CTOs and lead architects designing custom-domain support for a multi-tenant platform. The goal is not to prescribe one provider. It is to show the states, gates, and responsibilities that stay relevant whether you build the system yourself or delegate parts of it.

## Start with trust boundaries, not API calls

A custom-domain workflow crosses at least four control planes:

1. The customer controls the domain or its DNS zone.
2. Your platform controls tenant identity, authorization, and application routing.
3. An edge provider or reverse proxy controls where traffic terminates.
4. A certificate authority controls whether a trusted certificate is issued.

Those boundaries imply two different proofs:

- Ownership proof: the customer who requested the hostname can modify an agreed location, commonly a TXT record.
- Routing proof: the hostname currently resolves or connects to infrastructure that can serve the tenant.

Do not collapse the two. A CNAME pointing at your platform proves where DNS sends traffic; it does not prove that the authenticated user should be allowed to claim that hostname. Conversely, a valid ownership TXT record does not prove that production traffic is reaching your edge.

A practical platform-level pattern is to issue a random, single-use challenge bound to the tenant ID, hostname, and expiry time. Store the challenge server-side, compare it safely, and invalidate it after verification or timeout. This is a design recommendation for your product authorization layer, not a requirement of ACME.

DNS also constrains the routing options you can offer. RFC 1034 states that when a CNAME exists at a node, no other data should be present.[1] A zone apex must carry records such as SOA and NS, so an ordinary apex CNAME is not a portable answer. Depending on the DNS provider and your edge architecture, the alternative may be ALIAS/ANAME behavior, CNAME flattening, A/AAAA targets, HTTPS records, or an apex-to-`www` redirect. Present those as provider-dependent choices, not interchangeable DNS standards.

## Store independent state dimensions

Cloudflare's custom-hostname model is a useful example of why one status is insufficient: it tracks hostname activation separately from certificate status, and considers production readiness to require active hostname state, active certificate state, and DNS pointing at the SaaS target.[3]

Your own data model should be provider-neutral. One workable starting point is:

| Dimension | Example states | Question answered |
|---|---|---|
| Ownership | `unverified`, `pending`, `verified`, `expired` | May this tenant claim the hostname? |
| Routing | `unknown`, `pending`, `ready`, `misdirected` | Does DNS lead to the intended edge? |
| TLS | `not_requested`, `pending`, `active`, `expiring`, `failed` | Can the edge serve trusted HTTPS? |
| Serving | `disabled`, `staging`, `active`, `suspended` | May application traffic reach the tenant? |
| Lifecycle | `active`, `deleting`, `deleted` | Is the platform still responsible for this binding? |

This is a recommended platform model, not a standard. Adapt the names to your providers, but preserve the separation.

Define activation as an invariant rather than another loosely updated flag:

```text
may_serve_traffic =
  ownership == verified
  AND routing == ready
  AND tls == active
  AND tenant_binding == enabled
  AND lifecycle == active
```

The invariant gives every team the same answer. Engineering knows what to enforce. Product knows what to display. Support knows which failed condition to investigate. Security can audit why traffic was enabled.

Store both normalized state and raw provider state. Normalized state keeps product behavior stable when providers differ; raw responses, timestamps, and correlation IDs preserve diagnostic detail.

## Make DNS validation bounded and observable

DNS is distributed and cached by design. RFC 1034 describes a system where cached information is refreshed according to timeouts rather than updated everywhere at once.[1] Your validator should therefore collect evidence, not return only `true` or `false`.

For each check, retain:

- the record type and answer observed;
- whether the query went to a recursive resolver or an authoritative server;
- the resolver or nameserver queried;
- the check time and relevant TTLs;
- the expected value;
- a normalized failure class such as `NXDOMAIN`, timeout, mismatch, or delegation failure.

Recursive and authoritative views answer different operational questions. Recursive resolvers approximate what users may currently observe through caches. Authoritative servers expose the zone's current source data. Querying authoritative servers can help diagnose a stale recursive answer, but it does not prove every user has received the new data. Keep both observations when the distinction matters.

Run validation through a queue with exponential backoff and jitter. Bound the workflow by attempt count or elapsed time, then move it to a state that requires a user change or explicit retry. An infinite poller hides broken configurations and creates unnecessary load. A terminal state with the last observed answer makes the problem actionable.

Provider APIs need the same discipline. Cloudflare documents `Pending`, `Active`, `Blocked`, `Moved`, and `Deleted` hostname states, with certificate state tracked separately.[3] Persist those transitions and map them deliberately. Do not turn every non-active response into a generic retry.

Turn the policy into an operating table before implementation:

| Trigger | State effect | Retry boundary | Terminal or customer action | Operational owner |
|---|---|---|---|---|
| Ownership TXT missing | Ownership stays `pending` | Backoff until the verification window closes | Replace or correct the TXT record | Customer success / product |
| Routing target mismatched | Routing becomes `misdirected` | Retry after a recorded DNS change | Correct the routing record | Customer / support |
| CA authorization fails | TLS becomes `failed` or remains `pending` | Respect CA retry guidance and platform attempt limits | Fix the challenge path or escalate | Platform engineering |
| Provider reports blocked state | Serving remains `disabled` | Do not blind-retry | Provider escalation or alternate path | Platform operations |
| Renewal approaches expiry | TLS becomes `expiring` | Escalating retries before the platform deadline | Incident response or controlled suspension | Platform operations |

The exact ownership labels will vary, but every failure needs a retry boundary, a terminal condition, and a named next actor.

## Certificate prerequisites depend on the challenge

“DNS must point at us before certificate issuance” is not universally true. The prerequisite depends on the validation method.

- HTTP-01 places a challenge response under `/.well-known/acme-challenge/` and requires it to be reachable on port 80.[9]
- TLS-ALPN-01 validates through a specialized TLS exchange on port 443 and is mainly suited to TLS-terminating infrastructure.[9]
- DNS-01 proves control by publishing a TXT value under `_acme-challenge`; it can validate a hostname whose application web server is not publicly exposed.[9]

That distinction should appear in the workflow engine. For HTTP-01 and TLS-ALPN-01, routing to challenge-capable infrastructure is part of issuance readiness. For DNS-01, the TXT record and its visibility are the relevant gate. Your stricter traffic-activation invariant still requires production routing and deployed TLS afterward.

Protect dynamic issuance as an authorization boundary. Caddy's on-demand TLS documentation requires restrictions to prevent abuse and describes an “ask” endpoint that decides whether a certificate may be managed for a requested hostname.[4] The exact mechanism may differ in your stack, but the principle is portable: an inbound SNI value must not be enough to authorize certificate issuance.

Treat CA limits as workflow state. As retrieved for this article, Let's Encrypt documents limits including 50 certificates per registered domain every seven days and five authorization failures per identifier per account every hour.[2] Those values can change, so do not bury them as constants in business logic. Parse rate-limit responses, honor retry guidance, expose the blocked-until time, and use the CA's staging environment during development.[2]

## Operate renewal and degradation explicitly

Issuance is the beginning of certificate operations, not the end. Record at least:

- provider and issuer;
- covered identifiers;
- certificate or provider resource ID;
- issue and expiry times;
- last successful renewal;
- last failed attempt and reason;
- next scheduled action.

Then define degradation policies. A hostname can remain routable while renewal is failing. A certificate can be active while DNS has drifted away. A provider can validate ownership while certificate deployment is still pending. Your health model should surface those combinations before they become an expired-certificate page.

Use escalating windows appropriate to your issuer and platform rather than hard-coding one universal schedule. Start automated renewal with enough margin for retries and provider incidents; escalate as expiry approaches; suspend new activation if the platform cannot establish a safe certificate path. Caddy, for example, performs certificate management in the background and uses retries, issuer fallback, and exponential backoff when management fails.[4]

Customer-facing states should describe an action, not leak provider jargon:

- “Add this TXT record to prove ownership.”
- “DNS is verified, but HTTPS is still being provisioned.”
- “Your domain no longer points to the required target.”
- “Certificate renewal needs attention; existing traffic is still active.”

## Deprovision in the safe order

Deletion is a security workflow.

Microsoft describes dangling DNS as a record that still points to a deprovisioned resource and explains how a claimable replacement resource can enable subdomain takeover.[6] Palo Alto Networks and DigiCert provide similar secondary explanations and recommend removing or repointing obsolete records.[7][8] The important qualification is that a stale record is not automatically exploitable; exploitability depends on whether the target resource or binding can be claimed.

A conservative deletion sequence is:

1. Disable serving for the tenant binding.
2. Prevent new certificate issuance or renewal for that binding.
3. Remove the hostname from the edge or managed provider.
4. Release internal routing and tenant associations.
5. Retain an audit record of the former binding and deletion result.
6. Tell the customer which DNS records they should remove.
7. Detect and warn if DNS continues to point at your platform where feasible.

Do not release a reusable provider identifier while customer DNS still targets it and another tenant could claim it. If the provider cannot reserve or tombstone that identifier, require fresh ownership verification before any future binding and document the residual risk. Make deletion idempotent so a partially failed cleanup can resume safely.

## Decide which responsibilities to own

Building in-house does not mean implementing DNS itself. It means owning the orchestration around multiple systems: authorization, state transitions, provider adapters, retries, certificate storage or edge deployment, customer diagnostics, renewal monitoring, deletion, and incident response.

Use a responsibility matrix when evaluating the boundary:

| Responsibility | Build in-house | Managed layer | Platform always retains |
|---|---|---|---|
| Tenant authorization | Implement directly | May expose binding APIs | Policy and final authorization |
| DNS and registration | Integrate providers | Can provide unified operations | Product rules and customer consent |
| Certificate issuance | Operate ACME or edge APIs | Can automate provisioning | Activation policy and monitoring |
| Certificate custody | Store and deploy, or use an edge | Often abstracted behind the provider | Risk assessment and access policy |
| Diagnostics and recovery | Build full tooling | May provide status and errors | Customer experience and escalation |
| Deletion and audit | Orchestrate every provider | May execute infrastructure cleanup | Retention policy and proof of completion |
| Incident response | Own every layer | Share provider escalation | Accountability to customers |

A managed domain-infrastructure layer can move several responsibilities behind an API. Dotlet's documentation states that it provides domain search and registration, DNS record management, SSL provisioning, and renewal automation.[5] Treat those as vendor-stated capabilities to validate against your requirements, not as independent proof of reliability or fit.

Even with a managed service, your platform still owns:

- which authenticated tenant may claim a hostname;
- how domain state maps to product access;
- customer-facing recovery paths;
- application routing and tenant isolation;
- logging, policy, and incident response;
- the decision to activate or suspend serving.

The architectural decision is therefore not “build everything or outsource everything.” It is which lifecycle responsibilities are differentiating, which are operational infrastructure, and where you need contractual versus direct technical control.

## Production-readiness checklist

Before activating custom domains, verify that:

- [ ] ownership and routing are separate states;
- [ ] one primary tenant binding exists per hostname under your policy;
- [ ] activation is enforced by an invariant, not a UI convention;
- [ ] apex behavior is explicit for every supported DNS path;
- [ ] validation stores observed answers and actionable failure classes;
- [ ] retries are bounded and rate-limit aware;
- [ ] ACME prerequisites match the selected challenge type;
- [ ] dynamic issuance has an authorization gate;
- [ ] renewal, drift, and expiry are monitored independently;
- [ ] deletion is idempotent and disables serving before releasing resources;
- [ ] managed-provider claims are mapped to your retained responsibilities.

The core design rule is simple: never let one successful check stand in for the entire domain lifecycle. Model the facts independently, define the activation invariant, and make every failure lead to an observable state and a safe next action.

## Sources

[1] [RFC 1034: Domain Names — Concepts and Facilities](https://www.rfc-editor.org/rfc/rfc1034)

[2] [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/)

[3] [Cloudflare for SaaS: Custom Hostname Validation Status](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/validation-status/)

[4] [Caddy: Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

[5] [Dotlet Documentation](https://docs.dotlet.net/)

[6] [Microsoft: Prevent dangling DNS entries and avoid subdomain takeover](https://learn.microsoft.com/en-us/azure/security/fundamentals/subdomain-takeover)

[7] [Palo Alto Networks: What Is Dangling DNS?](https://www.paloaltonetworks.com/cyberpedia/what-is-a-dangling-dns)

[8] [DigiCert: Dangling DNS Records and Domain Hijacking Risks](https://www.digicert.com/blog/dangling-dns-records-and-the-risk-of-domain-hijacking)

[9] [Let's Encrypt Challenge Types](https://letsencrypt.org/docs/challenge-types/)
