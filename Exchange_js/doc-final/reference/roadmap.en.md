# Product Roadmap

> ⚠️ **2026-08-27 时点注**：Phase 4 代码回收七站已全部合 main（词表封册收官）。其间**一期客户流程（入驻/风评/升级案）整体拆除待接真 Sumsub 重做**（业主方案2，BACKLOG 在案）——本文涉及这三块的实现状态行已过时，实现现状以 doc-final/CHANGELOG.md 与 modules/ 为准；本文其余部分为产品应然层，不随代码回收改写。
Last Updated: 2026-07-06

> **Translation note**: This is the English rendering of [`roadmap.md`](roadmap.md). **The Chinese version remains the single source of truth** — when the two diverge, the Chinese file wins. Regulatory clause references, code identifiers, file paths and status markers are kept verbatim.

**Three-tier classification** (by demand origin):
- **MVP** — Leadership-defined baselines (very basic, not necessarily industry standard, but leadership wants them)
- **ADVANCED** — VARA gap closure (things the rulebook says should exist) + low-frequency reverse operations (MVP ships the forward action, ADVANCED the reverse). `⚖️` = a specific clause number exists; re-check item by item whenever the rulebook is revised
- **OPTIMIZED** — Not mandated by VARA; most of the industry does it anyway; future optimization

**Every entry carries**: `Source:` (leadership / VARA clause / industry) | `Pairs with:` (forward and reverse operations cross-linked, so the reverse is never forgotten) | status `[x]` delivered `[~]` partial `[ ]` to do + date.
**Implementation detail and current truth** → `modules/` (sync there when you change code, not here) | **Tech debt / dead code / open decisions** → `../BACKLOG.md`.
> ⚠️ The three-tier classification + externalised truth has been applied to **V1–V6**; the deep-research-grade P0/P1/P2 plus the `⚖️P0` re-ranking and the `superpowers/specs/` research records now cover **all nine versions V1–V9** (closed out 2026-07-06; per-version specs in `superpowers/specs/2026-07-0*-v*-research.md`).

---

## Dependency chain overview

```
V1 (audit foundation)
  └→ V2 (customer approval depends on the approval engine)
       └→ V4 / V5 / V6 (trading depends on customer compliance eligibility)
V3 (financial configuration)
  └→ V4 / V5 / V6 / V7 (all accounting depends on the account model)
V4 / V5 / V6 / V7
  └→ V8 (reconciliation depends on existing transaction data)
V1–V8
  └→ V9 (regulatory reporting depends on all business data)
V7 (treasury ops) has detached from the transaction chain — the old EOD settlement / internal transfer machinery was replaced and deleted by real-time 1:1; it now manages the firm's own funds and liquidity, all ADVANCED and none of it built
```

---

## V1 — Audit foundation (approvals / audit / RBAC / admin lifecycle)

> Platform governance foundation: approval engine + audit log + RBAC + admin lifecycle + credential security. The trustworthiness of every later version's operations depends on it.
> 📖 **Implementation truth** → [`modules/v1-governance.md`](../modules/v1-governance.md)
> ⚠️ SUPER_ADMIN is a demo role (hardcoded bypass); it must be removed before go-live.

### MVP (leadership-defined baselines — all 10 workflows ✅)

- [x] Admin Invite — onboarding approval + SoD conflict check + invite link with password activation | Source: business | Pairs with: Admin deletion (ADV) ✅2026-05-05
- [x] Admin First Login — four-step first login (identity confirmation → mandatory MFA binding → verification → security notice), state machine + audit | VARA TIR III.A ✅2026-05-06
- [x] Admin Role Binding Change — role change approval + SoD + 3 tiers; the legacy Change Ticket has been removed | VARA TIR III.B ✅2026-05-05
- [x] Admin Account Suspension — suspension approval; JWT intercepts SUSPENDED (not instantaneous — production needs a token blacklist) | Source: business | Pairs with: reactivation ✅2026-05-05
- [x] Admin Account Reactivation — reactivation approval, 3 tiers | Source: business | Pairs with: suspension ✅2026-05-06
- [x] Admin Password Reset — self-service (email → MFA → link) + CISO-operated reset; 15-min token + SHA-256 + rate limiting + enumeration protection | VARA TIR III.A ✅2026-05-06
- [x] Admin MFA Reset — initiated by CISO/TECH_OFFICER, IAM_CREDENTIAL_RESET, first-login flow re-run | VARA TIR III.A ✅2026-05-06
- [x] Role Definition CRUD — custom roles + Action Bucket Catalog (currently 9 domains / 23 buckets) | Source: business ✅2026-05-10
- [x] Audit Evidence Export — approval-backed evidence package export + manifest + SHA-256 digest | VARA CRM III.A ✅2026-05-05
- [x] Approval Policy Management — multi-step approval chains (stepsConfig, multiple roles OR'd per step) + self-approval tamper protection | VARA CRM II.B ✅2026-05-07

> #5/6/7 share `workflowType: ADMIN_CREDENTIAL_MGMT`.

### ADVANCED (VARA governance gaps — none built)

> 📖 **Research record** → `superpowers/specs/2026-07-04-v1-governance-audit-research.md`
> ⚠️ **Upgraded per the 2026-07-04 deep research**: items marked `⚖️P0` were previously mis-filed as "can wait" — they are in fact licence-level / pre-launch mandatory (VARA hard requirements) and constitute the main compliance risk. Parking them as "advanced features" before go-live would be treated as a compliance deficiency in a VARA audit.

**P0 (VARA licence-level, mandatory before go-live — the original list had the priorities wrong):**

- [ ] ⚖️P0 8-year audit log retention + archival — cold storage + integrity verification | CRM Rule I.F.2 (≥8 years, indefinite where national security is involved); ⚠️ the current `audit-retention-job.ts` still queries dropped columns and is broken (see BACKLOG)
- [ ] ⚖️P0 Periodic access review / recertification — permission snapshot + flagging of dormant / excessive privilege / SoD violations + quarterly sign-off | Schedule 1 RC2 Std 8 + §D.2.d.ii (quarterly) + NIST AC-2/AC-6(7)
- [ ] ⚖️P0 Key lifecycle governance — API keys + encryption keys (DEK/KEK) + admin credentials: generation / rotation / revocation / access audit; **on-chain signing and custody keys are governed by HexTrust — the platform only supervises (do not implement)** | TIR §D + NIST SP 800-57 crypto period
- [ ] ⚖️P0 Audit log WORM / tamper evidence + real-time security alerting — hash chain / integrity verification + real-time security event alerts | Schedule 1 RC2 Std 13 (⚠️ the stubbed notification core is the root cause)
- [ ] ⚖️P0 Immediate session revocation / termination — suspension or role revocation must invalidate sessions immediately (revocation list / short TTL + revocation), at least for privileged accounts | NIST AC-12 (today's JWT only checks on the next request)
- [ ] ⚖️P0 SoD mutual-exclusion matrix expansion — from 3 admin pairs to the VARA-enumerated sales / dealing / accounting / settlement / safekeeping set | Company Rulebook §B.2
- [ ] ⚖️P0 Admin lifecycle notifications made real — create/modify/enable/disable/remove must auto-audit **and** notify designated people (audit exists; notification does not, because the core is stubbed) | NIST AC-2(4)
- [ ] ⚖️P0 API key emergency + periodic rotation — emergency rotation on leak + periodic rotation (NIST crypto period recursive control) | TIR Schedule 1 (was ADVANCED, upgraded)

**P1 (VARA / industry, not launch-blocking):**

- [ ] ⚖️P1 PAM privileged access closed loop — enforced privileged-account allowlist + privileged operation audit + break-glass emergency privilege | NIST AC-6(5)
- [ ] P1 Mandatory security testing gate before change — pre-release pen-test / vulnerability scan + remediation tracking gate | Schedule 1 RC2 Std 11 (depends on CI/CD)
- [ ] ⚖️ Emergency Break-Glass — emergency permission bypass + time-boxed elevation + automatic revocation + post-hoc review | TIR V.A | Priority rises once SUPER_ADMIN is gone at go-live
- [ ] Approval timeout warning / notification — notify N hours before expiry + escalate | Source: business | Depends on the notification core

**P2 (low frequency / exit paths):**

- [ ] ⚖️ Admin Account Deletion — full access revocation on departure (suspension is only temporary) | VARA TIR III.B.2 | Pairs with: Invite (MVP)
- [ ] Audit Evidence Package Deletion — controlled deletion once the retention period expires | Source: business

### Supporting features (not workflows)

- **Approval engine (maker-checker)** ✅ | **Audit write/query** ✅ | **RBAC permission checks** ✅ | **SoD mutual exclusion (3 hardcoded pairs — ⚠️ should be expanded, see P0 above)** ✅ | **Audit SubjectNo removal** ✅2026-05-19
- ⚠️ **Notification send/retry** — the roadmap originally marked this ✅; it is in fact a **STUB** (WebSocket gateway only, no email/webhook/retry). It is the shared prerequisite of three P0/P1 items ("real-time alerting", "lifecycle notifications", "timeout warnings"); see truth + BACKLOG
- **Approval delegation / Login anomaly detection** — ADVANCED, not built

> Current state and anchors: [modules/v1-governance.md](../modules/v1-governance.md); tech debt (notification stub / subjectNos drift / retention script / SUPER_ADMIN bypass): [BACKLOG.md](../BACKLOG.md).

## V2 — Customer management + compliance foundation

> Customer admission + compliance management: Onboarding + CRA + material freshness + tier upgrade + freeze. The core is the **three-axis state model** on the customer master table; `assertTradingEligibility` is the trading gate for V4–V6. **MVP covers Individual only; Corporate is explicitly disabled.**
> **Depends on**: V1 (approval engine) | **Depended on by**: the V4–V6 trading gate.
> 📖 **Implementation truth** → [`modules/v2-customer-compliance.md`](../modules/v2-customer-compliance.md)
> 📖 **Research record** → `superpowers/specs/2026-07-06-v2-customer-compliance-research.md` (first deep audit of V2)
> ⚠️ Three-axis state model ✅2026-05-09 (onboardingStatus / adminStatus / complianceStatus + restrictions JSON + investorTier / tradingTier / riskRating).

### MVP (leadership-defined baselines)

> ⚠️ **Major correction (2026-07-04 health check)**: Onboarding / CRA / material freshness below were previously marked [ ] (not built). **In reality all three are built, usable, registered in AppModule and running** — Onboarding is in fact a dependency of the V4–V6 trading gate (if it genuinely did not exist the platform could not trade at all). Hence [ ] → [~].

- [x] Sumsub webhook translation layer — signature verification → ingest → dispatch (routed by eventType) + retry/dead-letter + admin page | Source: business ✅2026-05-23
- [~] Customer onboarding — CDD via Sumsub (real integration) + state machine + FINAL_APPROVAL MLRO gate + assertTradingEligibility trading gate (V4–V6 depend on it) | VARA CRM II.A | measured ~80% usable (the original [ ] was drift)
- [~] CRA review — Sumsub AML → 6-rule policy → automatic / MLRO sign-off + EDD (HIGH → RISK_RATING_MLRO_REVIEW) + sanctions freeze + monthly re-KYC cron | VARA CRM II.C/III.B | measured ~85% usable
- [~] Material refresh — daily cron → NUDGE / URGENT / BLOCKING stages → BLOCKING freeze + unfreeze on document submission | VARA CRM II.A.3 | measured ~95% (the code names the states NUDGE_ONLY / CLEARED)
- [~] Trading tier upgrade — CRA HIGH → Sumsub Level 2 → MLRO + SMO approval → upgrade | Source: business | Backend fully built, ⛔ client-side document submission UI missing
- [~] Customer freeze / unfreeze — automatic freezes exist (material / tier / sanctions triggers), ⚠️ but there is no unified workflow, no MLRO unfreeze approval gate and no freeze API | VARA CRM IV.A | see BACKLOG

### ADVANCED (none built)

#### 🔄 2026-07-06 gap-audit addendum (fable-5 first deep audit; 69 agents / 21 candidates / adversarial verification killed 2 false gaps by reading the code)

> ⚠️ All 3 P0s sit on the **customer eligibility gate** (upstream of every V4–V6 transaction); the root cause is **over-trusting Sumsub's green light**. The Client Money / federal-law clause numbers were traced by the gap audit — **verify against primary sources before starting work** (see the spec caveat).

**P0 (VARA licence-level · holes in the eligibility gate):**

- [ ] ⚖️P0 Local retention of underlying CDD files, retrievable on demand — today we only take Sumsub's conclusions/labels; we must pull the underlying material back (ID images / verification reports / hit details), **keep a local copy and be able to produce it without delay** (a regulator's file request cannot be satisfied today) | FATF R.17 + VARA III.E.6/III.I
- [ ] ⚖️P0 High-risk-country admission gate (geographic factor) — nationality / country of residence hitting FATF / NAMLCFTC high-risk lists → mandatory EDD; blacklisted jurisdictions (Iran / DPRK call-for-action) → refuse admission; **today a Sumsub green light means automatic admission (an ordinary Iranian applicant slips through)** | Cabinet 134/2025 + FATF
- [ ] ⚖️P0 Add the statutory four CRA factors — today all 6 rules are screening-result driven; we must add **customer type / geography / product / channel** (same root cause as the item above: geography never entered the risk factors) | Cabinet 10/2019 Art.4.1 → 134/2025 + VARA III.E.2

**P1 (VARA mandatory):**

- [ ] ⚖️P1 CDD cannot be completed or maintained → mandatory exit + STR assessment — an indefinite Material Refresh freeze **breaches III.E.8 ("shall not maintain")**; we need a compliant forced-termination closed loop (hooked to account closure) plus a documented "do we file an STR?" decision | VARA III.E.8
- [ ] ⚖️P1 Trigger-based re-CDD (re-verify on doubt) — when MLRO / ops doubt existing identity information (whistleblower / transaction-monitoring escalation), one click must launch **a full CDD re-run** (not just re-scoring), blocking transactions until it completes | VARA III.E.4(c)(d)
- [ ] ⚖️P1 Establishing or continuing a PEP relationship requires MLRO + senior management dual approval — today only MLRO signs; add the second key (senior management), applicable both at account opening and when someone becomes a PEP mid-relationship | VARA III.E.6(a)(vi) + FATF R.12
- [ ] ⚖️P1 PEP identification must include family members and close associates (RCAs) — today there is only a single "PEP" label; hits on family / associates require the same full measures, and currently land on the wrong track (red_other/green) | Cabinet 134/2025 + FATF R.12
- [ ] ⚖️P1 Periodic sampling of Sumsub CDD quality — we only review customers, never the vendor; we must periodically sample and validate Sumsub's CDD output (ultimate responsibility cannot be outsourced) | VARA III.E.9
- [ ] ⚖️P1 System-level ban on anonymous / alias accounts — account ↔ legal identity uniquely bound + same-person duplicate / alias deduplication + display name ≠ real name prohibited | Cabinet 134/2025 + FATF R.10
- [ ] ⚖️P1 Minor / capacity admission threshold — refuse under-18s (the UAE age of majority **dropped to 18 on 2026-06-01**, newly effective and easy to mis-configure); CDD already collects DOB → wire it into a hard gate | Federal Decree-Law 25/2025
- [ ] P2 **Harden** the internal/external separation of freeze tipping-off — ✅**re-verified 2026-07-06 (by reading the code): the current behaviour is already neutral and is not a live leak** — auth login returns a neutral `CUSTOMER_ACCOUNT_FROZEN` + "contact support", the freeze reason (`sanctions_hit_pending_investigation` etc.) is **written only to the audit log**, and the profile banner copy is neutral. What is missing is only an **enforced** internal/external separation convention (to stop a future customer-facing surface from printing the reason), not a current leak | VARA III.F.1 + Federal 10/2025 Art.29 (supersedes 20/2018 Art.25)
- [ ] P2 Retain **investigation records** for rejected applicants for 8 years — ✅**re-verified 2026-07-06**: if the rejection triggered an investigation/analysis (sanctions / PEP hit), those records are CDD records and must be retained ≥8y; ⚠️ "retain for **all** rejected applicants" is an inference (III.I speaks only of "clients", with no mention of prospective clients) | VARA III.I.1.b/III.I.2 (the gap audit's citation of III.H — the sanctions chapter — was wrong and has been corrected)

**Individual — advanced:**
- [ ] Customer profile change — identity changes trigger re-verification (low risk takes effect directly / high risk goes back to Sumsub) | VARA CRM II.A.3
- [ ] Account closure — balance zeroing + in-flight handling + AML final review + KYC archival for 8 years + account closed | VARA CRM IV.C
- [ ] Customer agreement version management — T&C / fee schedule versions + Legal approval + customer acknowledgement records | Source: business | ⚠️2026-07-06 V6 review: the agreement includes the fee schedule, so changes require **30 calendar days' advance notice** to customers, and any unilateral amendment right must be written explicitly into the agreement (MC II.A.7/8) — the effective-date gate lives in the V6 fee workflow, the notification lives here
- [ ] ⚖️ Investor classification (Retail / Qualified / Institutional) — customer-level classification state + evidence retained ≥8y (Qualified threshold: net assets ≥ AED 3.5m or annual income ≥ AED 700k; self-declaration prohibited); upgrades go through disclosure + consent + dual review; the V4–V6 trading gates only read this field | Market Conduct IV.A.1 + VARA Circular 2026-01-08 | Source: triaged to V2 by the 2026-07-06 V6 review
- [ ] ⚖️ Monthly customer money statements — at least monthly (prepared within 25 calendar days), send each customer a Client Money statement itemising every credit/debit (including the amount, date and value of each fiat withdrawal debit); the withdrawal record fields come from V5's "withdrawal record field set" | CRM IV.D.2.a/b | Source: triaged to V2 by the 2026-07-06 V5 review

**Institutional (7 workflows once institutional clients are onboarded; Corporate is currently disabled):**
- [ ] Corporate onboarding/KYB | UBO management | Authorised representative management | Corporate structure change | Multi-user enterprise access | Corporate CRA | Re-KYB — all VARA CRM II.B/III; the CorporateProfile / UboProfile tables are stubbed

> Current state and anchors: [modules/v2-customer-compliance.md](../modules/v2-customer-compliance.md); tech debt (no unified freeze workflow / tier UI / Corporate stub): [BACKLOG.md](../BACKLOG.md).

## V3 — Financial configuration

> The foundation trading sits on: three primitives (asset / wallet / ledger account) + withdrawal addresses + amount gates.
> **Depends on**: V1 (approval engine) | **Depended on by**: all V4–V7 accounting.
> 📖 **Implementation truth** → [`modules/v3-financial-config.md`](../modules/v3-financial-config.md)
> 📖 **Research record** → `superpowers/specs/2026-07-06-v3-financial-config-research.md` (first gap audit)

### MVP (leadership-defined baselines)

- [x] Asset listing and activation — direct creation → PROVISIONING → CISO approval + readiness check → ACTIVE | Source: leadership | Pairs with: asset delisting (ADV) ✅2026-05-15
- [x] Asset suspend / resume — two independent CISO approval gates | Source: leadership + VARA TIR IV.C ✅2026-05-15
- [x] Custodian wallet creation — Crypto — dual entry points: admin system wallet / client deposit address | Source: leadership ✅2026-05-13
- [x] Custodian wallet creation — Fiat — dual entry points: admin system account / client VIBAN | Source: leadership ✅2026-05-13
- [x] Ledger account provisioning — system accounts opened in the same transaction as the asset; customer accounts lazily resolved on first transaction with a manual fallback | Source: leadership ✅2026-05-15
- [x] Withdrawal address registration — Crypto — 24h security cooling period | Source: leadership + **industry practice** (⚠️2026-07-06 audit: no statutory clause for an address cooling period exists in any rulebook — the original TIR III.A citation was wrong, that clause is about confidential information) | Pairs with: address deactivation/archival (ADV) ✅2026-05-13
- [x] Withdrawal address registration — Bank — same cooling mechanism | Source: leadership + **industry practice** (same as above, no statutory anchor) | Pairs with: address deactivation/archival (ADV) ✅2026-05-13
- [~] Amount gate system — limit configuration pipeline ✅2026-05-16; **not wired into execution** (deposit/withdraw/swap none of them consume the limit table; the sidebar entry is hidden, 84cfffb). The three amount lines (tier limits / large-value approval 200k / TR threshold 3,500) still need to be merged into a single "amount gate matrix" wired into L1 | Source: leadership (classified 2026-07-03 as MVP-incomplete, pending redesign)

### ADVANCED (VARA gaps + low-frequency reverse operations)

- [ ] ⚖️ Public asset disclosure page — a public summary per asset (symbol / issue date / market cap / circulating supply / contract audit / max drawdown) | VARA BD I.B.1(c) | Hangs off asset listing; delisting removes the summary
- [ ] ⚖️ Asset delisting — in-flight order clearance + position clearance + disclosure page removal + approval | Source: VARA (disclosure consistency) + industry (Coinbase/Kraken) | Pairs with: asset listing (MVP)
- [ ] ⚖️ Threshold parameter governance — sweeping / dust / large-value line / TR threshold go through maker-checker instead of being hardcoded | VARA Company (segregation of duties; hardcoding bypasses four-eyes) | Moved in from V7
- [ ] ⚖️P1 CBUAE licence gate for stablecoin pairs — before enabling an AED ↔ payment-token (USDT/USDC) pair, record the CBUAE authorisation / non-objection registration status; without it the pair must not be enabled — the central bank's 2024 regulation explicitly covers "VARA licensees", and the VARA licence does not cover fiat ↔ payment-token exchange | CBUAE Payment Token Services Regulation (Circular 2/2024, clause text pending verification) | Source: triaged to V3 by the 2026-07-06 V6 review
- [ ] ⚖️P1 VA Standards ongoing review + emergency pair halt — listing due diligence only covers "prior to"; the "**at all times during**" half requires listed pairs to stay compliant: falling out of standard (banned / losing regulatory recognition) → suspend quoting and execution on that pair + leave a record; the VA Standards text is published online and updated on revision; the V6 quoting engine consumes the suspension flag | Market Conduct VIII.A.2/A.3/A.4(n) | Source: triaged to V3 by the 2026-07-06 V6 review
- [ ] ⚖️P1 Withdrawal address ownership verification + hosted/unhosted classification tagging — verify at registration that the customer controls the self-hosted wallet (verify once, permanent) + classify hosted/unhosted + initial due diligence on the counterparty VASP → tag it for V5 to consume per transaction; the TravelRuleAdapter attribution groundwork exists | CRM III.G.7 + FATF (confirmed by the 2026-07-04 V5 research; the earlier "pending verification" is now settled) | **Address-level one-off control belongs to V3**; transaction-level work (sanctions re-screening, TR sending, differentiated EDD) belongs to V5
- [ ] Withdrawal address deactivation / archival — confirm no in-flight withdrawals → deactivate (retained 8 years, never physically deleted) | Source: leadership | Pairs with: address registration (MVP)
- [ ] ⚖️P1 Third-party bank customer money confirmation letter — before holding customer fiat, obtain the bank's written confirmation (funds held in an agent capacity / the bank has no right of set-off or lien / the account name is distinguishable from the firm's own funds); if no letter is issued, no further deposits are permitted and existing funds must be withdrawn (IV.C.4 has teeth) | CRM IV.C.3/C.4 (verify against primary source) | Source: triaged to V3 by the 2026-07-06 V8 audit (account configuration gate; V8 only consumes "this account has a confirmation letter on file")

#### 🔄 2026-07-06 gap-audit addendum (fable-5; 13 candidates / 9 survived / 4 rejected; all clauses verified first-hand against rulebooks.vara.ae)

**Asset listing gate:**
- [ ] ⚖️P1 AEC privacy-coin hard block — "anonymity-enhanced coins" (Monero-class) are **explicitly banned from all VA activity** in Dubai (a hard prohibition an approval cannot override); add an AEC flag to the asset primitive (including a "is there a traceability mitigation?" determination) → block at both creation and activation at system level + audit | VA&RA Regulations 2023 Part II.C (verified verbatim against the primary source)
- [ ] ⚖️P1 The statutory 14-factor initial listing due diligence set — embed MC VIII.A.4(a)-(n) as per-factor fields in the listing approval form (market cap and liquidity / whether banned / DLT security / susceptibility to manipulation / issuer fraud history etc., each factor = conclusion + evidence); pre-check that every factor is filled before CISO approval, retain 8 years; today we only check technical readiness ("TB account + wallet"), and the "ongoing review" item only covers the post-listing half | MC VIII.A.1-A.4 + VIII.B.2 / CRM I.F

**Banking channel gate (completing the trio with the confirmation letter):**
- [ ] ⚖️P1 Third-party bank eligibility gate — before opening an account, verify: ① the bank **holds a valid deposit-taking licence** in its jurisdiction ② it is **not in the same group** as the platform; re-verify before transferring customer money | CRM IV.C.1 + IV.C.2.a (verified first-hand)
- [ ] ⚖️P1 Onshore restriction for customer money — UAE customer funds must be held with a third-party bank **inside the UAE**; offshore banks may only act as intermediaries and the transfer onshore must start **within 24h** of receipt; add an "onshore/offshore + transit-only" attribute to the bank account configuration | CRM IV.B.5 (verified first-hand)

**Custody side (the platform's own bookkeeping obligations — not waived by outsourcing to HexTrust):**
- [ ] ⚖️P1 Mandatory segregation of customer VA wallets + ledger labelling — customer coin wallets must be **completely separate** from the platform's own coins, and the ledger must be labelled "Client VA Wallet" (a wallet opened at HexTrust in the platform's name still counts as the platform holding/controlling it) | CRM V.B.3 + V.A.2 (verified first-hand)
- [ ] ⚖️P1 Public disclosure of the custody arrangement — publish on the website: a statement of the customer-asset protection arrangements + the identity of the third-party custodian (HexTrust); same clause as, but a different sub-clause from, the "asset disclosure page" (I.B.1(c)) | BD I.B.1(g)/(i) (verified first-hand)
- [ ] ⚖️P2 Airdrop / staking proceeds belong to the customer + no rehypothecation — proceeds derived from customer VAs (airdrops / staking) belong **entirely to the customer** by default (unless the customer agrees in writing otherwise); customer VAs must be held 1:1 and rehypothecation is prohibited without express consent; requires an "asset-event proceeds attribution" configuration slot | CRM V.B.5 + V.B.4 (verified first-hand)

**Address book:**
- [ ] ⚖️P1 Name matching on fiat receiving accounts — when registering a bank account, verify the **account name = the KYC name** (first-party); the statutory outlet is "pay the customer themselves", so not checking the name silently opens the door to third-party collection | CRM IV.B.10.b.ii (verified first-hand)

### OPTIMIZED (not mandated by VARA; industry practice)

- [ ] Triple review matrix for asset listing — independent legal characterisation / compliance risk / technical security review slots | Source: industry (Coinbase Listing Framework)
- [ ] Jurisdiction × currency allowlist matrix — enable once there are multiple jurisdictions / fiat currencies | Source: industry + FATF

> **Supporting items** (TB account type definitions / wallet model V3 adaptation / asset state guards / code→currency rename / frontend cleanup) are all delivered; current state in [modules/v3-financial-config.md](../modules/v3-financial-config.md). **Tech debt** (no backlog retry on TB account creation failure, contractAddress leftovers, etc.) in [BACKLOG.md](../BACKLOG.md).

---

## V4 — Deposit flow

> On-chain / bank funds arrive → deposit order → two-step suspense accounting → L1 eligibility + L2 compliance screening → credit.
> **Depends on**: V2 (customer compliance eligibility) + V3 (account model).
> 📖 **Implementation truth** → [`modules/v4-deposit.md`](../modules/v4-deposit.md) (dual-track state machine, current state of the exception branches, half-built-bridge risk)
> 📖 **Research record** → `superpowers/specs/2026-07-06-v4-deposit-research.md` (first gap audit, from the beneficiary's perspective)

### MVP (leadership-defined baselines)

- [x] Crypto deposit happy path — on-chain arrival → funds order confirmed → suspense accounting (Step 1 CLIENT_ASSET → SUSPENSE) → L1 eligibility → L2 (KYT + TR both PASSED) → credit (Step 2 SUSPENSE → PAYABLE) | Source: leadership + VARA CRM II.A ✅2026-05-22
- [x] Fiat deposit happy path — VIBAN arrival (no confirmation phase) → suspense accounting → L1 → L2 (KYT; TR automatically NOT_REQUIRED) → credit | Source: leadership + VARA CRM II.A ✅2026-05-27

### ADVANCED (VARA gaps + exception branches; P0/P1/P2 in brackets = implementation priority)

**P0 (hard-clause debts + shipped buttons whose money path is not wired):**
- [ ] ⚖️ Complete sanctions freeze loop — KYT / sanctions hit → FROZEN → MLRO approval gate → release or confiscate (CONFISCATE brought under governance) | VARA CRM III.H (freeze on hit, retain records 8 years) | (P0)
- [ ] ⚖️ TB reversal for already-booked exception terminal states — REJECTED / FAILED / EXPIRED must reverse SUSPENSE → CLIENT_ASSET if Step 1 has already happened | VARA BD (improper handling of customer assets is prohibited) | (P0; temporary guard in BACKLOG task_16af8187)
- [ ] KYT FAILED resolution path — a failure must not hang forever in COMPLIANCE_PENDING | Source: business | (P0)

**P1 (clause debts with concrete numbers / fields):**
- [ ] ⚖️ TR threshold 3,500 gate + missing-data branch — per transaction, per direction, strictly greater than; missing counterparty data → wait window → disposition | VARA CRM III.G | (P1, folded into the amount gate matrix)
- [ ] ⚖️ Structuring / aggregation monitoring — linked-transaction identification to prevent threshold avoidance | VARA CRM III.G.9 + FATF red-flag indicators | (P1)
- [ ] ⚖️ Fiat name-mismatch verification — senderName field + comparison, first-party payer verification | VARA CRM III.E (SoF / first deposit via a licensed account) | (P1)
- [ ] Per-chain confirmation-count configuration + reorg rollback — confirmation counts differ by chain (not a single global constant) | Source: industry (Coinbase/Kraken) | (P1)
- [ ] ACTION_PENDING document-submission loop — wire up the Sumsub re-review webhook | Source: business | Pairs with: L2 screening | (P1)

**P2 (depends on real bank integration, or low frequency):**
- [ ] ⚖️ Stablecoin issuer freeze response — USDT blacklist event runbook + asset-suspension linkage | FATF 2025 (illicit activity increasingly involves stablecoins) | (P2)
- [ ] Fiat bank returns / reversals — bounce → FAILED; post-credit reversal → claw back / chase | Source: business | (P2)
- [ ] EXPIRED timeout rollback — document submission times out → roll back | Source: business | (P2)
- [ ] Orphan deposit handling — unattributed funds → suspense → manual attribution / MLRO; VIBAN attribution validation should be added first | VARA CRM III.A | (P2)
- [ ] Deposit channel suspend / resume — for a given chain / token / fiat channel + approval | Source: business | (P2)

#### 🔄 2026-07-06 gap-audit addendum (fable-5; 13 candidates / 8 after dedup; fills in the "beneficiary VASP" perspective; TR and record-keeping clauses verified first-hand)

**P1 (recipient-side obligations, symmetrical with V5's sender side):**
- [ ] ⚖️P1 TR beneficiary accuracy verification gate — for deposits > AED 3,500, before crediting (Step 2 = "allowing access" under G.3), compare the received TR message's beneficiary name + wallet/account **field by field** against our customer file; on mismatch, hold and escalate to MLRO, do not credit; retain the raw message with the order | CRM III.G.3 (verified first-hand; today we only check whether the data arrived, not whether it is correct)
- [ ] ⚖️P1 Differentiated handling of unhosted-source deposits — when the source is judged unhosted, **do not** enter the "wait for counterparty data" branch (there is no counterparty, so it will never arrive); use a separate policy instead: proof of ownership / enhanced monitoring / limits / return, with both acceptance and return recorded; ⚠️ the current design instead marks unhosted as NOT_REQUIRED and auto-releases (looser than hosted — backwards) | CRM III.G.7(a) (verified first-hand)
- [ ] ⚖️P1 Recipient-side counterparty VASP due diligence gate — a deposit from a hosted wallet (i.e. some external VASP) requires risk-based due diligence on that VASP before the first transaction; without it the deposit must not be credited directly (once is enough unless risk increases); V5 only implemented sender-side counterparty due diligence | CRM III.G.6 (verified first-hand)
- [ ] ⚖️P1 Fiat must reach the Client Account within 1 day — customer fiat received must be deposited into the Client Account **within 1 calendar day**; **a compliance hold does not waive segregation** (the offshore 24h repatriation rule already sits in the V3 bank configuration) | CRM IV.B.5.a (verified first-hand)
- [ ] ⚖️P1 Return-to-source for rejected deposits — a returnable rejection (KYT FAILED / compliance refusal / orphan expiry) **may only be returned to the original source** (on-chain to the original originator address, fiat to the original remitting account); returning to a third party nominated by the customer is prohibited — otherwise the platform becomes a laundering conduit | CRM III.G.4(b) + G.9 (verified first-hand) | Distinct from the P0 sanctions no-return branch
- [ ] ⚖️P1 Statutory deposit record field set + source profiling retention — every deposit must retain the I.F.1 minimum fields (amount / timestamp / payment instruction [txHash + source address / bank remittance reference] / total fees / customer + country of residence / counterparty VASP or custodian), including obtain-and-hold of the three originator elements, ≥8y, producible on regulator request | CRM I.F.1-2 + III.G.3/G.4 (verified first-hand) | Same origin as the V5/V6/V8 record field sets

**P2 (low frequency / disclosure):**
- [ ] ⚖️P2 Client Money interest attribution — interest earned in the Client Account **above what is payable to customers** must be removed within **20 calendar days**; the customer statement must disclose the interest earned | CRM IV.B.9.b.iii + IV.D.2.a.iii (verified first-hand)
- [ ] ⚖️P2 Monitoring of one source funding multiple customers — the same external source address / same remitter repeatedly funding different customers (third-party funding / money-mule red flag) must enter the suspicious-indicator library | CRM III.F.1/F.2 (verified first-hand)

### OPTIMIZED (not mandated by VARA; industry practice)

- [ ] Deposit success notification — push to the customer on arrival, reusing V1 Notification | Source: industry (UX)

> **Supporting items** (event-driven orchestration / KYT-TR simulation endpoints / admin deposit page / client three tabs / tipping-off mapping / overview reads TB) are all delivered; current state in [modules/v4-deposit.md](../modules/v4-deposit.md). **Tech debt** (txHash dedup, repair surface, emit vs emitAsync, PATCH bypass, etc.) in [BACKLOG.md](../BACKLOG.md). **TransactionComplianceService is retired** — confirmed 0 references repo-wide (fully deleted).

---
## V5 — Withdrawal flow

> Withdrawal request → L1 eligibility → large-value approval gate → L2 compliance screening (Pre-KYT + TR) → payout → on-chain / bank confirmation → accounting. Crypto and fiat share one workflow.
> **Depends on**: V2 + V3 + V4 (balances come from deposits).
> 📖 **Implementation truth** → [`modules/v5-withdraw.md`](../modules/v5-withdraw.md) (state machine / three compliance layers / large-value gate / fee governance / 2-leg funds_order)

### MVP (leadership-defined baselines)

- [x] Crypto withdrawal happy path — L1 eligibility → large-value gate → L2 (Pre-KYT + TR both PASSED) → payout → txHash confirmation → TB post (customer CLIENT_PAYABLE ↔ CLIENT_ASSET + firm FIRM_ASSET → FIRM_FEE) → L3 archival → SUCCESS | Source: leadership + VARA CRM II.A ✅2026-05-30
- [x] Fiat withdrawal happy path — same chain; TR automatically NOT_REQUIRED, no L3, bank credit confirmation (via funds_order CONFIRMED) | Source: leadership + VARA CRM II.A ✅2026-05-31
- [x] Large-value approval gate — gross ≥ AED 200,000 (fail-closed valuation) triggers a single-step SMO approval with a 48h window, placed before L2 | Source: leadership + VARA ✅2026-06-01 (**the only amount gate in service**)
- [x] Withdrawal fee level create / change / bind — 3 independent workflows; create and change go through approval (currently a single OPS_OFFICER step), change uses a request record + configHash conflict detection, binding takes effect immediately with no gate | Source: leadership + VARA CRM II.C ✅2026-05-30

### ADVANCED (VARA gaps + exception branches)

> 📖 **Research record** → `superpowers/specs/2026-07-04-v5-withdraw-compliance-research.md`
> ⚠️ **Re-ranked per the 2026-07-04 deep research** (10 findings 3:0 + code verification): ⚖️P0 = licence-level mandatory; **three earlier assumptions corrected** — ① sanctions means BLOCK (freeze in place), not "cancel and return to the customer"; ② today's L2 "Travel Rule" is only a screening status flag — the originator-side send is missing; ③ failed returns carry a hard **24h SLA** (not "as soon as possible") — ⚠️**licence correction 2026-07-06**: the platform holds BD only (no T&S activity), so the hard 24h binds the licensed party executing the transfer (HexTrust); the platform's obligation is contractual pass-through + supervision, and the two T&S anchors below have been re-anchored.

**P0 (VARA licence-level; currently almost entirely absent):**

- [ ] ⚖️P0 Travel Rule originator **send** — for a **single or aggregated linked transaction > AED 3,500** (VARA's reading, fixed by the client 2026-07-06; not "per calendar day", and linked-transaction aggregation follows III.G.9 structuring monitoring), send the beneficiary VASP an originator (name + wallet address + address) + beneficiary (name + wallet address) payload before initiating; ⚠️ today's L2 is only a screening status flag with **no send step** | CRM III.G.2/4/5
- [ ] ⚖️P0 Counterparty VASP due diligence — risk due diligence before the first transaction with a new counterparty VASP (verify it is regulated and can receive TR), gating the send; ⚠️ the 2026-02-24 VARA Circular **prohibits transfers to unregulated counterparties** | CRM III.G.6
- [ ] ⚖️P0 Sanctions hit → BLOCK/FROZEN — ⚠️ correction: a hit must **freeze in place + deny all parties access + report**, **not** cancel and return to the customer (which conflicts with the block obligation); the backend needs a FROZEN state | CRM III.H + OFAC FAQ 646
- [ ] ⚖️P0 Failed / unauthorised withdrawal handling + return — unauthorised or off-instruction transfers must be refunded or the account restored promptly; ⚠️ licence correction 2026-07-06: the platform holds BD only (no T&S), so the hard 24h in II.C.2 binds HexTrust as the executing party — the platform's side is contractual pass-through of the 24h SLA + supervision and tracking | CRM I.E.4 (customer asset protection) + BD I.A.1.c | HexTrust contract (the original T&S II.C.2 anchor withdrawn)
- [ ] ⚖️P0 KYT high-risk / suspicious → MLRO → STR — hold → MLRO gate → **immediate** goAML filing (linked to V9 STR) | CRM III.F.3.a

**P1 (VARA mandatory but secondary):**

- [ ] ⚖️P1 Stuck / failed → track, diagnose, notify — an undelivered transfer must be tracked, diagnosed and the customer notified; ⚠️ licence correction 2026-07-06: II.C.3 binds HexTrust directly; the platform's side is contractually requiring the tracking plus customer notification and record-keeping | CRM I.E.1 + HexTrust contract (the original T&S II.C.3 anchor withdrawn)
- [ ] ⚖️P1 Differentiated EDD / limits for self-hosted wallets — **consume the self-hosted flag set in V3** and apply EDD / limits by amount (ownership verification already happens at V3 registration) | FATF / VARA III.G.7
- [ ] ⚖️P1 Enhanced due diligence on large withdrawals — above the threshold, force SOF/SOW → Sumsub enhanced → MLRO gate (threshold by tradingTier) | CRM III.B
- [ ] Fiat bank bounce — return → void restore → notify → audit (bound to the 24h SLA) | Source: business | Pairs with: V4 deposit bounce

> 🔄 **2026-07-06 gap-review addendum** (fable-5; 11 survivors → after triage 9 stay in V5, statements go to V2). The Client Money (CRM Part IV) clause numbers below were traced by the gap audit — **treat them as "probably right" until verified first-hand** (see the spec caveat).
- [ ] ⚖️P1 🔄 Withdrawal debit authorisation + instruction binding evidence — every debit from a customer account must be bound to a customer withdrawal instruction (instruction ID + customer ID + receiving account/address + allowlist classification) before payment; paying a third party requires retaining the customer's original instruction | CRM IV.B.10
- [ ] ⚖️P1 🔄 Re-segregate failed payout funds within 1 day — when a fiat withdrawal is returned or cancelled and the funds come back to the platform account, they must be **returned to the segregated customer account within 1 calendar day** and the balance restored; parking them in the operating account is prohibited | CRM IV.B.5.a | Hangs off: fiat bank bounce
- [ ] ⚖️P1 🔄 Report Client Money breaches to VARA within 1 day — any of: a debit without authority / a return not re-segregated within 1 day / cross-customer subsidisation → detected in the withdrawal flow → **written report to VARA within 1 calendar day** (letters go out through the V9 channel) | CRM IV.F.1
- [ ] ⚖️P1 🔄 Licence-level narrowing of withdrawal suspension — "customers must be able to withdraw even in extreme market conditions" → any suspension must cite a statutory ground + be limited in scope and duration + **blanket suspension on market moves is prohibited** + the policy's effectiveness must be reviewed annually; breaches are reported to VARA under CRM I.2 (the P2 channel-suspension feature must inherit this guardrail) | BD I.A.1.c + I.A.2
- [ ] ⚖️P1 🔄 Dual-track tipping-off for compliance freezes — for withdrawals blocked by sanctions / KYT: internal reason codes (SANCTIONS_HIT / KYT_STR) visible only to compliance, while the client surface maps everything to neutral copy ("processing"), with customer-facing wording pre-reviewed by MLRO; **emitting the real freeze reason on any customer-visible channel is a criminal red line** | CRM III.F.1/F.3.d + Federal Law 20/2018 Art.25
- [ ] ⚖️P1 🔄 30-calendar-day effective-date gate for withdrawal fees — WithdrawalFeeLevel changes must have an effective date ≥ T+30 + customer notification (fees are part of the agreement, so changing them changes the agreement); today's "change takes effect immediately" crosses the line | MC II.A.7/8 + II.B.1(e) | Same origin as the V6 markup item
- [ ] ⚖️P1 🔄 Statutory withdrawal record field set — the withdrawal order must persist the CRM I.F.1 minimum fields (amount / timestamp / payment instruction / total fees / customer + country-of-residence snapshot / receiving account or address / HexTrust as executing party), in native format, ≥8y, producible on VARA request; feeds the V2 statements | CRM I.F.1-3 | Same origin as the V6 swap item
- [ ] ⚖️P1 🔄 Sunrise branch (counterparty is regulated but cannot receive TR) — not "refuse to transfer": try alternative secure channels → keep best-efforts evidence → make a risk-proportionate release/refuse decision with a record → repeated failures with the same counterparty trigger a relationship re-assessment (written back to the V3 due diligence file) | Circular 2026-02-24 §2.c + CRM III.G.8
- [ ] ⚖️P1 🔄 Post-KYT continuous monitoring after reporting — for withdrawals that generated an STR: after the payout confirms on chain, monitor the destination address in near real time (subscribe to on-chain analytics alerts), escalate anomalous return flows to MLRO, until the case closes | CRM III.F.5

**P2 (low frequency / governance):**

- [ ] Structuring monitoring for withdrawals — doubles as the source for the TR threshold's "linked transaction aggregation" (a single transaction < 3,500 but linked aggregate over the line → trigger the TR send) | CRM III.G.9
- [ ] Withdrawal channel suspend / resume | withdrawal channel switch / degrade | bulk withdrawals (institutional) | withdrawal-specific limit changes (folded into the amount gate matrix) | Source: business

### OPTIMIZED (not mandated by VARA; industry practice)

- [ ] Withdrawal success notification — push to the customer on SUCCESS, reusing V1 Notification (infrastructure exists, not wired) | Source: industry (UX)

> **Supporting items** (event-driven orchestration / TB pending-post-void accounting / simulation endpoints / admin + client pages / tipping-off mapping / WithdrawQuote picks the best / fee seed) are all delivered; current state in [modules/v5-withdraw.md](../modules/v5-withdraw.md). **Tech debt** (real Sumsub integration / hot-wallet balance check / notifications / repair surface) in [BACKLOG.md](../BACKLOG.md).
> ⚠️ **Wording corrections (2026-07-03 health check)**: fee approval was simplified from MLRO+SMO to a single OPS_OFFICER step (2026-06-01); void-unlock on REJECTED / large-value rejection **is implemented** (the exception branches are not entirely empty); a withdrawal funds order = a 2-leg funds_order (payout + fee); FUND_OUT pre-sweeping is retired.

---

## V6 — Swap flow

> In-platform exchange (crypto ↔ fiat balance swap; **funds never leave, no external counterparty**): quote → L1 eligibility → consume quote → 4-leg real-time accounting → SUCCESS. Currently **only the synchronous L1 gate** — ⚠️ per the 2026-07-04 research, "no L2 because funds never leave" is **over-generalised**: only the Travel Rule can be waived; the two P0 pillars of **AML transaction monitoring + best execution** cannot (see ADVANCED).
> **Depends on**: V2 + V3.
> 📖 **Implementation truth** → [`modules/v6-swap.md`](../modules/v6-swap.md) (4-leg accounts / dead FAILED-REVERSED enums / fee governance)

### MVP (leadership-defined baselines)

- [x] Quote workflow — SwapQuote (30s TTL): resolveBestLevel picks the cheapest fee + live Binance rate + PricingEngine computes amountOut / spread / fee | Source: leadership ✅2026-06-01
- [x] Swap execution happy path — L1 eligibility → consume quote → PROCESSING → 4 legs, per-leg two-phase (customer CLIENT_PAYABLE ↔ CLIENT_ASSET + firm FIRM_ASSET ↔ FIRM_OPS/SET/FEE) → leg1 automatic, legs 2-4 admin-advanced → all 4 legs CLEAR → SUCCESS | Source: leadership + VARA CRM II.A ✅2026-06-01
- [x] Swap fee level create / change / bind — 3 independent workflows; create and change are single-step OPS_OFFICER, change uses request record + configHash conflict, binding has no gate; a tier = rateMarkupBps + feeItems (spread-only supported) | Source: leadership + VARA CRM II.C ✅2026-06-01

### ADVANCED (VARA gaps + exception branches)

> 📖 **Research record** → `superpowers/specs/2026-07-04-v6-swap-compliance-research.md`
> ⚠️ **Re-ranked per the 2026-07-04 deep research** (103 agents / 32 findings / 3-perspective adversarial verification): the central correction — "funds never leave → no L2" is **over-generalised**; only the Travel Rule can be waived, while the two P0 pillars of **AML transaction monitoring + market conduct / best execution** are not waived merely because the movement is on-ledger.
> ⚠️ **Do not mistake these for compliance holes**: `dead FAILED/REVERSED enums` and `STUCK partial-fill consistency` were **rejected 3:0** by adversarial verification — they are tech debt (already in BACKLOG), not regulatory gaps.
> 🔄 **2026-07-06 gap-review addendum** (64 agents / 19 candidates / 16 survived / **0 new P0**): all three P0 pillars held up on review; after triage V6 gains **6 small in-flow items** (marked "2026-07-06 review" below), while customer-level items went to V2 (classification / agreements), asset-level to V3 (CBUAE gate / VA Standards) and company-policy items to V9 (employee PA / insider lists / rebate ban); **two T&S candidates were withdrawn because of the licence fact (BD only, no T&S)**. The record is in the spec's addendum chapter.

**P0 (VARA licence-level; currently almost entirely absent):**

- [ ] ⚖️P0 AML transaction monitoring for swaps — after execution, emit `SwapCompleted` → rules engine (swap immediately after deposit / large or structured / round-trip wash trading / inconsistent with profile / high-risk PEP) → open an MLRO case on a hit → STR candidate (linked to V9 goAML); **this is fundamentally about customer behaviour patterns, not single transactions**; start with "detect only, do not block" (R.20 is satisfied by reporting after the fact) | CRM III.F.1 / III.E.5(a) + FATF R.10 / R.20 / 2020 red flags
- [ ] ⚖️P0 Best-execution gate — a platform acting as principal must **prove its pricing is sound**: compare ≥2 price sources + deviation-threshold blocking/degradation + per-transaction best-ex evidence retained ≥8y; ⚠️ **this is not a cap on profit** — it governs transparency, consistency and evidence; how wide the spread is remains a commercial decision | BD II.A.1/A.2 (principal dealing is not exempt) / II.B.1
- [ ] ⚖️P0 Disclosure of principal capacity + conflicts of interest + pricing methodology — tell the customer "the platform is the counterparty and a spread is included" + publish the pricing methodology + conflict management | BD I.B.1.a/d + II.B.1

**P1 (VARA mandatory but secondary):**

- [ ] ⚖️P1 Dual-point disclosure of the spread as "platform retention" + trade confirmation — show the retained amount explicitly before execution + generate an immutable confirmation after SUCCESS (today not even a success notification is wired) | BD II.A.6
- [ ] ⚖️P1 Written price fairness policy + governance — spread caps / deviation tolerance / peg source go through fee-level-style maker-checker; **tiering must follow rules (same tier, same price; no manual per-customer price changes)** | BD II.A.1/A.3/A.16
- [ ] ⚖️P1 Quarterly execution-quality review of internalised order flow — with 100% self-execution, sample at least quarterly comparing our price against externally available prices and produce either an adjustment or a written explanation | BD II.A.13
- [ ] ⚖️P1 Stale price / extreme market protection — price source heartbeat + max staleness rejection + second-source circuit breaker + revalidation before execution (which also solves slippage) | BD II.A.4/A.12 + Tech I.H.1
- [ ] ⚖️P1 Market manipulation monitoring in the swap path — wash trading / self-dealing / stale-price arbitrage are possible even on-ledger; monitor and report to the FIU/VARA above the threshold | VA & Related Activities Regulations 2023 Part VIII §I/§J (⚠️2026-07-06 correction: originally mis-cited as Market Conduct) | The reporting outlet is in V9
- [ ] ⚖️P1 AED 3,500 cumulative threshold → re-CDD + large-swap approval gate — single-transaction plus rolling cumulative awareness (shares the counter with structuring) | CRM III.E
- [ ] ⚖️P1 EDD for high-risk / PEP large swaps — the L1 gate reads riskRating → sets an EDD flag → validates SOF/SOW freshness (a customer-level obligation; it need not be a hard per-transaction gate) | CRM III.E.10
- [ ] ⚖️P1 72h escalation assessment for stuck orders — STUCK severity grading → start the 72h clock at the qualifying grade + draft the VARA notification | Tech K.1 + I.H.1
- [ ] ⚖️P1 Customer fund protection SLA while stuck — leg 1 already debited and the buy leg stuck → a maximum dwell SLA, forced repair or full rollback and release on expiry + visibility to the customer | CRM I.E.4 / I.E.1
- [ ] ⚖️P1 Principal trading vs proprietary trading ban boundary — publish a "flatten immediately, no speculation" policy + an inventory exposure ledger retained ≥8y | Market Conduct VII.A.1/A.3 + BD II.B.1
- [ ] ⚖️P1 30-calendar-day effective-date gate for fee / spread changes — after approval, markup or fee changes must have an effective date ≥ T+30 and trigger notification to all customers (the notification is sent via V2 agreement management); material changes to execution policy (switching price source, adjusting the best-ex threshold, TTL) also trigger notification — ⚠️ the P0 best-ex gate above triggers this item the day it lands | MC II.A.7/8 + II.B.1(e) + BD II.A.16 | Source: 2026-07-06 review
- [ ] ⚖️P1 Employee front-running detection rule — add a rule class to the P0① monitoring engine: correlate swaps on flagged employee accounts against same-direction large customer orders / markup or price-source change events within ± time windows → compliance case (the employee PA approval regime itself lives in V9) | VA&RA Regs 2023 VIII §C/§E/§J | Source: 2026-07-06 review
- [ ] ⚖️P1 Transfer instruction evidence — the customer accepting a quote is a Client Money debit instruction: bind quoteId + operation timestamp + debit flow record and retain ≥8y; Client Money breaches must be reported to VARA within 1 calendar day | CRM IV.B.10 | Source: 2026-07-06 review
- [ ] ⚖️P1 Re-segregate stuck funds after 3 days — a STUCK order older than **3 calendar days** (customer AED taken, coins not delivered) is automatically moved back into the customer money pool and re-segregated (this runs **in parallel with**, and does not replace, the repair/rollback SLA and the 72h escalation) | CRM IV.B.6.b/B.7 | Source: 2026-07-06 review | Hangs off: stuck SLA
- [ ] ⚖️P1 Statutory execution record field set — SwapCompleted must persist an immutable original record (amount / pair / timestamp / customer + customerNo / country-of-residence snapshot / total fees and spread / payment instruction / quote snapshot), native format, ≥8y, producible on VARA request | CRM I.F.1-3 | Source: 2026-07-06 review
- [ ] Swap failure terminal-state governance — wire up a reverse endpoint (full reversal → REVERSED) + an automatic FAILED state machine; today the enums are dead and failures only self-heal → STUCK while remaining PROCESSING | Source: business / tech debt (**not a compliance hole**) | Pairs with: execution happy path

**P2 (low frequency / governance / defence):**

- [ ] Structuring aggregation monitoring for swaps (existing customers are not "occasional", hence the low ranking) | CRM III.E.4(b)
- [ ] Swap path capacity assurance — a capacity baseline for quote → L1 → 4-leg accounting + **explicit rejection** on overload (rejecting beats silently swallowing an order) | BD II.A.15 | Source: 2026-07-06 review
- [ ] ✅ **Defensible position to keep**: the Travel Rule does not apply to internal swaps (III.G requires a counterparty / transfer) — but keep the supporting evidence + a guardrail (if outbound transfers or cross-customer swaps are ever supported, this triggers immediately) | CRM III.G
- [ ] Trading suspend / resume | pair listing and delisting (linked TB account + default fee + approval) | bulk swaps (institutional CSV) | Source: business

### OPTIMIZED (not mandated by VARA; industry practice)

- [ ] Quote TTL cron sweep — expired quotes automatically marked EXPIRED (today expiry is lazy only) | Source: industry
- [ ] Swap success notification — push to the customer on SUCCESS, reusing V1 Notification | Source: industry (UX)

> **Supporting items** (SwapQuoteService split out / PricingCenterService deleted, −3500 lines / declarative 4-leg accounting / client swap page / Swap Quotes admin page / approval policies simplified to 6 types under OPS_OFFICER / legacy swap config removed) are all delivered; current state in [modules/v6-swap.md](../modules/v6-swap.md). **Tech debt** (Sumsub TM / repair surface / InternalFund naming debt) in [BACKLOG.md](../BACKLOG.md).
> ⚠️ **Wording corrections (2026-07-04 health check)**: ① full-order reversal / REVERSED / FAILED are in fact **dead enums with no reverse endpoint** (the 2026-06-26 ✅ was over-claimed; downgraded to ADVANCED, still to do); ② the orchestration classes are actually `SwapWorkflowService` + `SwapLegAccounting`, **there is no `SwapSettlementService`**; ③ a swap leg = a funds_order (the code still uses the old InternalFund name — naming debt).
> ⚠️ **Compliance boundary correction (2026-07-04 research)**: modules/v6-swap.md §11/§47's "compliance is L1 only = a design decision, not an omission" is **partly wrong** — only the Travel Rule should be waived; AML monitoring / best execution / EDD should not (see spec §4). truth + BACKLOG still to be synced (this round only touched roadmap + spec).

---

## V7 — Treasury Ops

> Manages **the firm's own funds and liquidity** (customer money is managed by V4–V6 under real-time 1:1 safeguarding).
> ⚠️ **The old V7 "internal transfers / deferred settlement" machinery is entirely retired**: with the real-time 1:1 refactor, the generic internal transfer workflow / EOD netting settlement / deposit sweeping cron / fee sweeping / fiat delivery / Outstanding / SettlementBatch / FeeAccrual / allowlists were all deleted (C5b). Every transaction now **books in place** (V4 two steps / V5 payout + fee / V6 four legs). The funds order (funds_orders) is a **cross-version shared primitive** (in use since V4) and belongs to `modules/funds-orders.md`, not to this version.
> **Depends on**: V3 (account model).
> 📖 No dedicated truth doc (no live V7 business); the shared funds primitive is in `modules/funds-orders.md`. The old "internal transfer / deferred settlement" design is deleted and survives only in historical specs (`superpowers/specs/2026-06-*-v7-*`, read-only history — do not treat as current).
> 📖 **Research record** → `superpowers/specs/2026-07-06-v7-treasury-research.md` (first gap audit — completing the statutory constraints on the deferred list)

### MVP

- None. The original MVP (generic internal transfer / deposit sweeping / EOD settlement / fiat delivery / fee sweeping) was absorbed into V4–V6 by real-time 1:1, or deleted.

### ADVANCED (none built; it starts to hurt once the platform has volume and more own-fund movement)

**Liquidity management (hurts first):**
- [ ] LP allocation governance — LP-IN top-up / LP-OUT return (maker + CFO/MLRO approval); when customers swap out heavily, inventory runs down and we must flatten with an LP | Source: business
- [ ] Firm liquidity rebalancing — inventory transfers between FIRM wallets, Main ↔ Liquidity | Source: business
- [ ] Cross-network inventory rebalancing — same asset across chains (e.g. USDT-ERC20 ↔ TRC20, possibly via OTC) | Source: business

**Reserves and revenue:**
- [ ] ⚖️ Reserve injection / shortfall remediation — firm external funds → customer pool, to top up a safeguarding shortfall | VARA (1:1 customer asset protection)
- [ ] Revenue extraction — FIRM_FEE → firm operations / bank account | Source: business

**Exceptions and configuration governance:**
- [ ] Exception fund handling — orphan / unattributed funds repatriation / segregation of frozen and sanctioned assets / error reversal | Source: business + VARA
- [ ] Internal transfer threshold configuration governance — sweeping / approval line / dust thresholds out of hardcoding (maker + checker) | Source: business | Together with the V3 amount gate matrix

#### 🔄 2026-07-06 gap-audit addendum (fable-5; all 5 are P1 — **not "do it now"**, but statutory constraints that must ship with the deferred items above whenever they land; all clauses verified first-hand)

- [ ] ⚖️P1 8-year treasury safe-harbour records — the sole exemption from the proprietary trading ban is "prudent management of NLA / treasury / balance sheet", and its **hard precondition is full records of every transaction retained 8 years**; every FIRM fund action above (LP allocation / rebalancing / revenue extraction) must record a "prudential management purpose" + full documentation — **missing records = the exemption fails = a breach of the proprietary trading ban** | MC VII.A.2 (verified first-hand, PDF p.17)
- [ ] ⚖️P1 Reserve injections must be same-currency 1:1 — reserves must be held one-for-one **in the same currency as the customer liability** (an ETH shortfall can only be topped up with ETH; an equivalent amount of USDT still leaves a shortfall in the regulator's eyes); the injection form must validate injected asset == shortfall asset, and if inventory is short, go through cross-network / OTC conversion first | Company VI.E.2 (verified first-hand) | Hangs off: reserve injection
- [ ] ⚖️P1 NLA allowlist arithmetic pre-check — the firm's net liquid assets (≥1.2× monthly expenses) may **only** take two forms: cash equivalents + VARA-approved USD/AED-pegged VAs (**BTC/ETH inventory does not count**); treasury must compute "is NLA still compliant after this move?" before every rebalance and reject the move if not | Company VI.C.1/C.2/C.4 (verified first-hand) | Hangs off: liquidity rebalancing / cross-network transfers
- [ ] ⚖️P1 Fee entitlement event + 1-day limit on firm money in customer accounts — a fee only becomes the firm's money once it is "due and payable" under the customer agreement (the agreement must state the billing point explicitly); firm money mixed into a customer account may dwell **at most 1 calendar day** (excess interest: 20 days) | CRM IV.A.1 + IV.B.9.b (verified first-hand) | Hangs off: revenue extraction
- [ ] ⚖️P1 Paid-up capital held in trust + 15% overheads review and top-up — paid-up capital (BD + licensed custody = AED 400k, or 15% of annual overheads, whichever is higher) must be locked in a **trust account (beneficiary: VARA)** at a UAE licensed bank, or an open-ended surety bond, and may not be used; if expenses rise, top it up; the treasury ledger must register this "untouchable money" + annual review | Company VI.B.1/B.3 (verified first-hand)

> **Boundary decisions (still valid)**: on-chain gas → borne by the HexTrust gas station (never enters TB, a fixed P&L item); hot/cold wallet tiering + custody sweeping → managed by HexTrust, the platform does not orchestrate it; bank fees → annual fixed OpEx.
> **Do not double-register**: reimbursement obligations and proof of reserves belong to V8 reconciliation.

---

## V8 — Reconciliation flow

> Customer / firm asset reconciliation: internal ledger (TB / AccountFlow projection) vs external data (bank / HexTrust / chain), **compared 1:1 per physical wallet** + differences classified into five buckets + break resolution.
> **Depends on**: V3–V6 (needs complete transaction and position data).
> 📖 **Implementation truth** → [`modules/v8-recon.md`](../modules/v8-recon.md) (Phase B engine / five buckets / Run-Case cockpit / effectiveDate / push disposition)
> 📖 **Research record** → `superpowers/specs/2026-07-06-v8-reconciliation-research.md` (first gap audit)
> ⚠️ History: three refactors — I1-I5 → credit-net five formulas → Phase B; the old credit-net five-formula engine was **physically deleted in Phase C** (11 files). Design archives in `superpowers/specs/2026-06-20 ~ 2026-07-03-*` (read-only history, do not treat as current).

### MVP (leadership-defined baselines)

- [x] Per-wallet 1:1 balance reconciliation — customer wallets external == PAYABLE + SUSPENSE / firm wallets compared 1:1; internal identity pre-gate (read directly from TB) | Source: leadership + VARA CRM III.A ✅Phase B
- [x] Five-bucket flow matching — three passes (same ref cross-wallet corroboration / amount+direction+window fuzzy / in-transit ↔ non-terminal funds order) + residual identity bucketing (MATCHED / IN_TRANSIT / SOFT_FLAG / BREAK) | Source: leadership ✅Round 3
- [x] Run orchestration + snapshot + audit — daily cron (02:30 Dubai) → per wallet → open case (one OPEN per wallet across days) + auto-heal + run snapshot (cures historical drift) + three audit events | Source: leadership ✅Round 3
- [x] Run/Case cockpit (admin) — Run (verdict bar + five-bucket filter + triple jump + snapshot table) / Case (bucket badge + five-cell delta + observation history + interleaved flows) | Source: leadership ✅Round 3
- [x] effectiveDate break-resolution preparation — column added to both tables + equivalence-preserving switchover (effectiveCutoffFilter) + backfill pass-through chain (advance → writeEvidence → account_flows) + recon:rerun tool | Source: leadership ✅2026-07-03
- [x] Push disposition (the 1st of 7 break-resolution actions) — sync legs (unique receipt match) + manual legs (three-piece evidence), stepwise advance rather than writing TB directly + effective-date backfill; two endpoints + audit | Source: leadership ✅2026-07-03
- [x] recon:demo nine scenarios — anchor-free pass/break + manifest answer key (9 root-cause classes) + identity self-verification | Source: leadership ✅2026-07-03

### ADVANCED (difference-handling closed loop + regulatory reporting; all deferred)

- [ ] ⚖️P1 Manual difference-handling loop + **reporting unresolved differences to VARA** — Finance manual verification / correction → RESOLVED + 24h SLA escalation to MLRO/CFO; **a material difference left uncorrected must, at the final terminal state, generate a VARA notification ticket (REPORTED_TO_VARA) + an audit event** (today it stops at an internal RESOLVED with no external outlet) | CRM IV.E.5 (Client Money) + V.D.2 (Client VAs), verified first-hand | 3:0 across three lines
- [ ] The other 6 break-resolution actions — supplementary booking / reversal / write-off / waiver / reimbursement / … (push is done) | Source: business
- [ ] Reimbursement obligation workflow — moved in from V7; OPEN → approval (CFO/MLRO) → REIMBURSED; the table is dropped but the hook remains; two trigger sources (reconciliation differences / event failures) share one outlet | Source: business + VARA
- [ ] ⚖️ Proof of Reserves (**rewritten: not merely quarterly**) — the real obligation has four parts: **daily reconciliation** of reserve assets + **independent third-party audit at least every six months** + the audit report filed with VARA **with the quarterly report** + **producible on demand whenever VARA asks**; the measure is Sum(customer VA liabilities) ≤ HexTrust reserves | CRM V.C.1 + Company Rulebook reserve-assets section Rule 3 (verified first-hand) | ⚠️2026-07-06 correction: the original "quarterly" both missed the semi-annual audit and narrowed on-demand production into a scheduled job
- [ ] Reconciliation report export — date-range summary (balance differences / match rate / open cases), input for VARA audits and the semi-annual independent audit | VARA
- [ ] LP position reconciliation — reconcile LP-IN/OUT with the LP counterparty; depends on an LP API / file feed | Source: business

#### 🔄 2026-07-06 gap-audit addendum (fable-5, condensed; the difference loop and PoR were rewritten in place, the bank confirmation letter went to V3, enum pitfalls to BACKLOG)

- [ ] ⚖️P1 Conflict-of-interest segregation in the reconciliation process — the roles that run reconciliation / re-run it, that execute break-resolution actions (push etc.) and that close a case as RESOLVED must be mutually exclusive and must not also be the fund operators who can create the differences (this is **not** V1's company-level SoD; it is a reconciliation-domain-specific clause) | CRM IV.E.4 (verified first-hand)
- [ ] ⚖️P1 8-year native retention of reconciliation working papers + external originals — run results / match details **plus the original bank and HexTrust statements** must be kept in native format ≥8y and produced on VARA request (today the originals are not kept after normalisation into the DB, and the DB lives in /tmp) | CRM I.F.1-3 (verified first-hand) | Same origin as the V5/V6 record field sets
- [ ] P2 A written reconciliation policy — five-bucket thresholds / difference grading / SLA / disposition authority / escalation path written up as a governed policy document + periodic review | CRM I.B.3/4

> **Design premises (still valid)**: ① gas is entirely borne by the firm, so customer assets never produce a difference because of gas; ② real-time 1:1 double-entry keeps customer assets and liabilities internally balanced, so reconciliation degenerates into external verification.
> **Tech debt** (reObservedCount = 0 bug / three Reimbursement leftovers / FIRM treasury historical residue / capital injection evidence to be verified) in [BACKLOG.md](../BACKLOG.md).

## V9 — Regulatory governance (top layer)

> Sitting above the V1–V8 transaction layers: the compliance governance obligations that face **regulators (VARA / UAE FIU / EOCN / UAE Data Office) and customers directly**.
> **Boundary rule**: Sumsub carries **detection** (KYT / screening / ongoing monitoring → alerts); V9 covers what Sumsub cannot and what is **legally the licensee's / MLRO's non-outsourceable** duty: filings, self-reports, adjudication and cooperation. ⚠️**Sanctions hits are listed separately** (corrected on 2026-07-06 from the old "do not list separately": CNMR/PNMR are report types that sit **alongside** the STR in goAML — an STR cannot cover them).
> **Depends on**: V1–V8.
> 📖 **Research record** → `superpowers/specs/2026-07-04-v9-regulatory-governance-research.md` (including the 2026-07-06 gap-review addendum of 17 items + a plain-language product summary). This section was re-ranked on 2026-07-04 from deep VARA Rulebook research (9 items 3:0), with the 2026-07-06 fable-5 gap review adding items (all 24 candidates confirmed 3:0).

### MVP (P0 · licence-level / mandatory before go-live — applicable to individual customers too; statutory duties cannot be deferred)

**A. AML / sanctions reporting (the goAML message family; not outsourceable from the MLRO):**

- [ ] ⚖️ **STR/SAR filing** — Sumsub alert → case created → MLRO judgement → report/no-report decision + rationale filed → goAML submission → receipt + FIU follow-up questions → post-filing handling (linked to V2 freeze / risk-rating change); **no fixed number of days (immediately)**; the MLRO is the single accountable person | CRM III.F.3(a)/III.F.4
  - [ ] ⚖️ **Tipping-off protection gate** (ships with STR) — all external and cross-role communication on an STR case must pass a confidentiality gate; tipping off is a federal criminal offence (6 months' imprisonment + AED 100k–500k) | III.F.3(d) + AML-CFT Law Art.25
  - [ ] **goAML registration** (pre-launch prerequisite) — the platform and the MLRO must be registered and active on the goAML portal, otherwise nothing AML-related can be filed at all | CBUAE Rulebook 4.3
- [ ] ⚖️ 🆕 **Confirmed sanctions hit → CNMR report** — a hit on a sanctions list (local terrorist / UN consolidated) → **freeze all assets + suspend service + no tipping off within ≤24h** → file a CNMR (formerly FFR) via goAML within **5 business days** of the freeze, **copying EOCN + VARA** (an STR only reaches the FIU and cannot cover this) → the freeze lasts indefinitely until delisting; failure to report starts at AED 50k plus criminal liability | Cabinet Decision 74/2020 Art.21/22 + EOCN TFS Guidance (2025-07 FFR→CNMR)
- [ ] ⚖️ 🆕 **Partial sanctions match → PNMR report** — a fuzzy name match that cannot be excluded → 24h suspension + a 10-business-day exclusion window → if excluded, restore; otherwise refuse the transaction + file a PNMR within 5 business days → **remain on hold until EOCN instructs via goAML**; **no "suspicion" is required to trigger it, and the STR state machine cannot absorb it** | Cabinet Decision 74/2020 Art.21/22
- [ ] ⚖️ 🆕 **EOCN list subscription (NAS) + full-book rescreening on updates** — register with the EOCN notification system (a pre-launch prerequisite alongside goAML registration) → rescreen the entire book whenever a list changes → **the 24h freeze clock starts from the UNSC / Cabinet designation**, not from when we noticed | EOCN TFS Guidance steps 1/2 + Cabinet Decision 74 Art.1

**B. Proactive reporting to VARA (incidents / changes / self-reports):**

- [ ] ⚖️ **Material change / compliance impairment reporting to VARA** — change items require **prior written approval** (obtained before the change, not notified after); general compliance impairments require **immediate** notification + receipt tracking | Company Rulebook VIII.A.1.a + Section H
- [ ] ⚖️ **Cyber security / BCDR incident reporting** — a material cyber incident or a BCDR trigger → report to VARA **within 72h of detection** (nature / scope / impact + mitigation + whether other authorities were notified) | TIR Rulebook Section K + H
- [ ] ⚖️ 🆕 **Personal data breach reporting** — a breach (including non-cyber mis-sends or vendor-side incidents) → report to the **UAE Data Office (not VARA)** + notify affected customers (four elements); processors such as Sumsub must report to us immediately, and the responsibility remains ours and cannot be outsourced | UAE PDPL (Federal Decree-Law 45/2021) Art.9 + VARA TIR II.A.1
- [ ] ⚖️ 🆕 **Re-report to VARA within 24h of a data breach** — within **24h** of notifying the Data Office / customers, file again with VARA (incident report summary + copies) — a second clock, independent of the 72h cyber line, starting later and running tighter | VARA TIR Part II Section C + CRM I.1.4
- [ ] ⚖️ 🆕 **Report prudential metric breaches immediately** — NLA (≥1.2× monthly operating expenses) must be **checked daily**; on a breach, notify VARA **immediately** (shortfall / cause / remediation / timeline) + **update daily until VARA is satisfied** | Company Rulebook VI.C/VI.F
- [ ] ⚖️ 🆕 **Report outsourcing failures immediately** — a material breach of a Material Outsourcing agreement (Sumsub screening outage / HexTrust custody default) → report to VARA **immediately** | Company Rulebook IV.H.1

**C. Responding to regulators / customers:**

- [ ] ⚖️ **Cooperation with regulatory information requests** — FIU/VARA follow-up requests carry a hard **48h response** deadline; evidence gathering spans V1 audit + V4–V8 transactions/reconciliation | CRM Rulebook III.F.3(b)
- [ ] ⚖️ **Customer complaint handling** — intake → acknowledgement (**≤1 week**) → investigation → determination (**≤4 weeks**, exceptionally **≤8 weeks** with a status update in week 4) → three-stage record-keeping (complaint / action / outcome) | Market Conduct Rulebook III.A

**D. Business-specific:**

- [ ] ⚖️ **Ongoing asset monitoring** (only if we list or distribute assets ourselves) — an asset that ceases to be compliant → suspend distribution immediately; material changes to the issuer or the asset → re-run due diligence immediately | BD Rulebook IV.E
- [ ] ⚖️ 🆕 **Pre-publication compliance approval gate for marketing** — in-app banners / push notifications / campaign pages / KOL copy must pass a compliance checklist before going out (no guaranteed returns / no FOMO / mandatory risk statement) + a compliance officer's approval on record; third-party marketing requires the licensee's written approval | Marketing Regulations 2024 I.B.3.b + I.C.2/I.C.3 (fines up to AED 10m per breach)

### ADVANCED (P1 · VARA mandatory but not launch-blocking)

- [ ] ⚖️ **Quarterly MLRO / board compliance report** — quarterly cadence; includes an AML/CFT effectiveness assessment + identification of failures + a summary of that quarter's **anonymity-enhanced transactions (AET)** | CRM Rulebook III.A.2.f/g/h
- [ ] ⚖️ 🆕 **Firm-wide AML/CFT risk assessment (EWRA/BRA)** — an enterprise-level risk assessment (VA / technology / product / channel), at least every 3 months plus on material change, whose results **feed back into the V2 CRA methodology** and resource allocation | CRM III.D.1-4 | Source: triaged to V9 by the 2026-07-06 V2 audit
- [ ] ⚖️ 🆕 **Appeals against wrongful freezes / delisting** — a customer appeal against a wrongful freeze → the statutory grievance procedure → unfreezing or delisting executed via EOCN / goAML (≠ an ordinary customer complaint) | EOCN TFS Guidance
- [ ] ⚖️ 🆕 **Dual-channel reporting of market misconduct** — suspicion of insider dealing / manipulation / conduct damaging market fairness → report on the statutory six fields to **both the UAE FIU and VARA** + retain for inspection (trigger, subject and message all differ from an AML STR) | VA & Related Activities Regulations 2023 Part VIII §J.2/J.3/J.4 | ⚠️ corrects the V6 citation (mis-labelled as Market Conduct)
- [ ] ⚖️ 🆕 **Periodic financial reporting (monthly / quarterly)** — monthly: balance sheet / P&L / cash flow / own wallet addresses / related-party transactions; quarterly: board minutes / financial compliance statement / risk exposure, filed with VARA | CRM Rulebook Section H Rule 1/2
- [ ] ⚖️ 🆕 **Annual audit filing** — audited annual report + internal control assurance + management compliance assessment + **a sample of the first 100 customers' onboarding** + group structure, filed with VARA | CRM Section H Rule 3 + Company G.1
- [ ] ⚖️ 🆕 **Prior approval for changes to key personnel (RIs)** — replacing a statutory responsible individual requires **approval before the change**; only sudden departures allow after-the-fact immediate notification + a succession plan; annual fitness reviews of RIs must be recorded | Company Rulebook I.C.2/3/4
- [ ] ⚖️ 🆕 **Prior confirmation for marketing incentives** — sign-up bonuses / referral rebates / deposit gifts and the like require **a VARA compliance confirmation before each campaign** goes live + continuing adherence to any attached conditions | Marketing Regulations 2024 I.C.2.l
- [ ] ⚖️ 🆕 **8-year retention of marketing records** — all marketing material (including in-app pushes and campaign page snapshots) + distribution details retained ≥8 years, producible on VARA request | Marketing Regulations 2024 I.C.4
- [ ] ⚖️ 🆕 **Prior notification of Material Outsourcing + an outsourcing register** — new or materially amended outsourcing agreements (Sumsub / HexTrust) must be notified to VARA first and only take effect once the objection period passes + maintain an outsourcing register | Company Rulebook IV.H.3/H.4/F.6 + IV.C.2.b
- [ ] ⚖️ 🆕 **Whistleblowing regime** — an internal reporting channel (anonymous allowed) + published prominently on the website (alongside the privacy and complaints policies) + annual effectiveness assessment | BD Services Rulebook I.B.1.b + I.A.2
- [ ] ⚖️ 🆕 **Cooperation with VARA on-site inspections** — inspection notice → open books / systems / premises within **the period stated in the notice** (not a fixed 48h) + a verification receipt; pre-launch prerequisite: the customer agreement must pre-include a "consent to reporting transaction information to VARA" clause | VA & Related Activities Regulations 2023 Part IX.B
- [ ] ⚖️ 🆕 **High-risk-country transaction reports (HRC/HRCA)** — transactions involving NAMLCFTC high-risk countries → **hold first** → file the goAML report → **execution is only permitted once 3 full business days have passed without FIU objection** (a blocking flow; the transaction engine needs a HOLD state) | UAEFIU goAML Report Types + the NAMLCFTC list

### P2 (low frequency / governance)

- [ ] ⚖️ 🆕 **Notification of external auditor appointment / change** — promptly notify VARA of the appointment or replacement of the auditor (name + contact details); VARA may compel a change (a notification regime, not an approval regime) | Company Rulebook Section G Rule 1
- [ ] ⚖️ 🆕 **Employee personal account (PA) dealing regime** — staff and directors must obtain **prior written approval** to open, change or close any VA position + mandatory position and trade-history disclosure every 6 months + mandatory conflict remediation + a notice at onboarding | Market Conduct VI.B.1-5 | Source: triaged out of the 2026-07-06 V6 review (V6 keeps only the front-running detection rule)
- [ ] ⚖️ 🆕 **Insider list register** — register everyone with access to inside information (pricing plans / price-source switches / listing and delisting decisions) + record entries and exits + written acknowledgements + 8-year retention, producible on request | Market Conduct VI.A.1-5 | Source: triaged out of the 2026-07-06 V6 review
- [ ] 🆕 **Third-party execution rebate ban policy** — prohibit introducer / affiliate rebates tied to swap volume or spread revenue; any third-party remuneration arrangement touching execution must pass compliance review and be registered | BD II.A.7 | Source: triaged out of the 2026-07-06 V6 review
- [ ] ⚖️ 🆕 **Director fit & proper approval + annual review** — every director must be approved by VARA as a fit and proper person + reviewed annually + removed and replaced on failing | Company Rulebook I.B.1
- [ ] ⚖️ 🆕 **Control / shareholding change approval** — any action that may change Control → the prospective acquirer applies to VARA → a **30-business-day** review + due diligence on the new controller / UBO + declarations of non-PEP / non-sanctioned status | Company Rulebook VIII.C + I.A.5
- [ ] 🆕 **Execution of marketing remediation / takedown orders** — on receiving a VARA cease-and-desist or remediation order regarding marketing → time-boxed takedown + execution records + report back | Marketing Regulations 2024 II.A.1

### Cross-version infrastructure (not standalone workflows; serves every P0/P1 above)

- [ ] **Unified SLA monitoring layer (the "statutory alarm wall")** — gather every statutory clock into countdowns + escalation alerts: immediately (reporting / self-reporting) / 24h (sanctions freeze, data breach report to VARA) / 48h (information requests) / 72h (cyber) / 3 business days (high-risk-country blocking) / 5 business days (sanctions CNMR/PNMR) / 10 business days (partial-match exclusion) / 1-4-8 weeks (complaints) / daily (NLA check) / monthly, quarterly, annual (periodic filings)
- [ ] **Compliance calendar** — goAML registration + EOCN NAS subscription + monthly/quarterly/annual report due dates + annual director review + a register tracking every regulatory deadline

> **⚠️ Research corrections (2026-07-04)**: ① the "72h" belongs to **cyber / BCDR incidents** (the old version wrongly attached it to "material incident reporting"); ② material changes are a **prior approval gate**, not an after-the-fact 72h notification; ③ STRs have **no fixed day count (immediately)**; ④ **an STR is filed by the MLRO via goAML — Sumsub cannot file it**.
> **⚠️ Review corrections (2026-07-06, fable-5 gap review, 24 items 3:0)**: ⑤ **sanctions hits must be listed separately** — the old "do not list separately / it is an STR intersection" was wrong; filing only an STR after a hit **misses the CNMR/PNMR** and lands squarely on the Cabinet Decision 74 penalties; ⑥ "periodic regulatory returns pending verification" **is now anchored** — the CRM Section H monthly/quarterly/annual filings are indeed hard obligations, no longer pending; ⑦ 17 further standalone obligations were added (sanctions message family / data breach dual clocks / periodic filings / prudential breaches / marketing / outsourcing / personnel governance / market misconduct / on-site inspections / high-risk countries) — the pattern is that wherever the old research said "not listed separately", "pending verification" or "worth a passing mention", there was a gap.
