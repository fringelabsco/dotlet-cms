---
title: "Silent CAA and DNSSEC Failures: The Hidden Blockers in Automated SaaS SSL"
slug: "silent-caa-and-dnssec-failures-custom-domains"
description: "Correct DNS resolution does not guarantee TLS issuance; without automated pre-flight checks for restrictive CAA records and broken DNSSEC delegation chains, automated ACME pipelines fail silently and burn CA rate limits."
published: "2026-10-31"
author: "Kamaji"
tags:
  - dns
  - tls
  - architecture
  - guides
cover: ""
draft: false
---
Pointing a custom domain to a SaaS platform through a CNAME initiates an automated issuance pipeline. Ingress proxies register the route, verify DNS records, and request certificates via ACME against Certificate Authorities such as Let's Encrypt or Google Trust Services. For most tenants, provisioning completes in seconds.

Enterprise subdomains and domains recently transferred between DNS providers frequently stall on a generic dashboard state:

```text
Status: Provisioning SSL Certificate (Pending)...
```

Standard network probes look healthy. Public resolvers return the edge IP address, and HTTP probes reach the platform gateway. Yet issuance never finishes. Background workers submit recurring ACME orders against failing validations, rapidly exhausting rate limits. Let's Encrypt enforces an account limit of 5 failed validations per hostname per hour [2]. Once tripped, the customer domain sits locked out of automated provisioning.

These deadlocks originate from two protocol validation mechanisms enforced by CA infrastructure: Certificate Authority Authorization (CAA) under RFC 8659 [1] and Domain Name System Security Extensions (DNSSEC) validation under RFC 4033 and RFC 4035 [4]. Detecting these conditions before dispatching ACME orders determines whether custom domain onboarding succeeds autonomously or stalls in customer support queues.

---

## CAA Tree-Walking and Multi-Tenant Collisions

Public Certificate Authorities operate under CA/Browser Forum rules mandating automated CAA checks before issuing certificates. Domain owners publish CAA records to designate authorized CAs. RFC 8659 dictates a hierarchical tree-climbing search rather than inspecting only the requested subdomain [1].

```text
                     RFC 8659 Traversal Sequence
                     
       portal.tenant.company.com    (No CAA records found)
                   ▲
                   │ Climb
         tenant.company.com         (No CAA records found)
                   ▲
                   │ Climb
              company.com           [MATCH: 0 issue "digicert.com"]
                   ▲
                   │ HALT (Does not traverse to root)
```

During validation for `portal.tenant.company.com`, the CA queries the exact hostname for CAA records. Finding none, the resolver ascends to `tenant.company.com`, reaching the apex domain at `company.com`. The algorithm halts at the first level containing a CAA record set [1].

Enterprise security teams routinely configure apex CAA records restricting issuance to enterprise vendors:

```text
company.com.    3600    IN    CAA    0 issue "digicert.com"
```

A departmental team then maps `portal.tenant.company.com` to a SaaS platform using Let's Encrypt. The CA tree-walk climbs to `company.com`, discovers the DigiCert restriction, and aborts issuance with an ACME 403 error (`urn:ietf:params:acme:error:caa`) [2].

Because RFC 8659 halts at the first matching node, tenants do not need apex DNS changes. The customer adds a leaf CAA record directly at their subdomain:

```text
portal.tenant.company.com.    300    IN    CAA    0 issue "letsencrypt.org"
```

The CA query resolves at the leaf label, evaluates the local grant, and issues the certificate without touching corporate apex policies.

---

## Broken Delegation Chains and the DNSSEC Orphan Trap

DNSSEC adds cryptographic authenticity to DNS records through a continuous chain of trust from the root zone down to individual records [4]. Each parent zone authenticates the child zone by publishing a Delegation Signer (DS) record containing a hash of the child zone's public key.

Nameserver transfers frequently break this chain. Moving a domain from a DNSSEC-enabled host (such as Cloudflare or Route 53) to a DNS provider without DNSSEC active leaves an orphaned DS record stranded at the parent TLD registry (.com).

The parent registry tells resolvers that the zone is signed, yet the new nameservers serve unsigned records lacking RRSIG cryptographic signatures. RFC 4035 §5 defines this state as BOGUS [4]. Validating resolvers reject the data and return `RCODE 2: SERVFAIL` to the application [4].

Resolver differences hide this failure from developers. Many consumer ISPs, corporate forwarders, and developer workstations use resolvers with DNSSEC validation disabled. These non-validating resolvers return standard IP addresses. The domain appears operational to the customer.

Certificate Authorities use strict validating resolvers, typically Unbound clusters [5]. Queries against the broken zone trigger an immediate failure:

```json
{
  "type": "urn:ietf:params:acme:error:dns",
  "detail": "DNS problem: SERVFAIL looking up CAA for app.customer.com",
  "status": 400
}
```

The CA cannot validate the zone securely and treats `SERVFAIL` as a fatal resolution error.

---

## Fast Diagnostics in the Terminal

Standard `curl` and basic `dig` queries mask validation barriers. Pinpointing provisioning blockers requires testing both CAA inheritance and cryptographic trust chains directly.

Inspect CAA inheritance by querying each domain label up to the apex:

```bash
# Query leaf record
dig portal.tenant.company.com CAA +noall +answer

# Query apex record
dig company.com CAA +noall +answer
```

If the leaf query returns empty while the apex returns an unauthorized CA, the domain inherits an upstream restriction.

Diagnosing broken DNSSEC delegations requires `delv` (Domain Entity Lookup and Validation), which ships with BIND and enforces cryptographic verification locally:

```bash
delv @8.8.8.8 portal.tenant.company.com
```

A healthy zone outputs `; fully validated` alongside RRSIG records. A broken delegation outputs explicit failure diagnostics:

```text
;; resolution failed: failure
;; validating company.com/DS: no valid signature found
;; broken trust chain: company.com
```

For customer reports, DNSViz generates web-accessible visual dependency graphs showing the broken link between parent DS records and child keys [6].

---

## Pre-Flight Architecture and Circuit Breakers

Submitting raw ACME orders on untrusted customer DNS configurations burns hourly validation limits. Defensive custom domain engines decouple domain verification from certificate dispatch.

```text
                 Pre-Flight Verification Architecture
                 
              [Customer Connects Subdomain]
                            │
                            ▼
              [Authoritative DNS Check] ── No ──> [Status: DNS Not Pointed]
                            │ Yes
                            ▼
              [Strict DNSSEC Probe] ──── No ──> [Status: Broken DNSSEC Chain]
                            │ Yes               (Trip circuit breaker; alert user)
                            ▼
              [CAA Hierarchy Walk] ───── No ──> [Status: CAA Policy Restriction]
                            │ Yes               (Trip circuit breaker; alert user)
                            ▼
              [ACME Order Submission] ──> [Let's Encrypt / Google Trust Services]
```

Pre-flight workers execute automated verification prior to calling ACME endpoints. The worker queries authoritative nameservers to confirm routing, queries a strict DNSSEC-validating resolver to catch orphaned DS records, and walks the DNS hierarchy to evaluate CAA compatibility.

Detecting a broken trust chain or a CAA policy block trips an immediate circuit breaker. The system halts order dispatch, protecting Let's Encrypt's 5 failures/hour limit [2].

Platforms like Dotlet build pre-flight security audits and rate-limit circuit breakers directly into their custom domain ingress layer [3]. Instead of maintaining in-house DNS tree-walkers and validating resolver pools, SaaS engineering teams use dedicated custom-domain infrastructure to detect DNSSEC and CAA failures at the edge [3].

Clear diagnostics transform support interactions. The dashboard displays precise, copyable instructions:

```text
[!] Certificate Issuance Blocked: Restrictive CAA Policy

Your apex domain (company.com) restricts SSL issuance to DigiCert.
Add the following record at your DNS provider to enable provisioning:

Name:   portal.tenant
Type:   CAA
Flag:   0
Tag:    issue
Value:  "letsencrypt.org"
```

Actionable pre-flight guidance lets enterprise customers resolve their own DNS policies without escalating support tickets or exhausting platform quotas.

---

## References

- [1] **RFC 8659:** *DNS Certification Authority Authorization (CAA) Resource Record* (`https://www.rfc-editor.org/rfc/rfc8659`)
- [2] **Let's Encrypt Documentation:** *Certificate Authority Authorization (CAA) and Rate Limits* (`https://letsencrypt.org/docs/caa/`)
- [3] **Dotlet Documentation:** *Custom Domain Pre-Flight Security Audits and Circuit Breakers* (`https://docs.dotlet.net/`)
- [4] **RFC 4033 & RFC 4035:** *Domain Name System Security Extensions (DNSSEC)* (`https://www.rfc-editor.org/rfc/rfc4033`)
- [5] **Belmo.io:** *Custom Domain SSL Pending: Resolving Unbound and DNSSEC Validation Failures* (`https://belmo.io/blog/custom-domain-ssl-pending`)
- [6] **DNSViz & Delv:** *DNSSEC Validation and Chain Diagnostics* (`https://dnsviz.net/`)
