# Deposit Processing — Process & Control Narrative

**Audience.** Compliance Officers, MLRO, Senior Management, Operations, and Internal Audit. This is not a specification for engineers — it explains how deposit processing actually works, where the decision points sit, who owns each decision, and what you are expected to do when a deposit lands in your queue.

**How to use this.** Sections 1–4 are the mental model; read them once. Section 5 is your day-to-day playbook by role. Section 6 tells you what a customer can see and what you may say to them. Section 8 walks through real scenarios end to end.

**Environment note.** Threshold figures in this document reflect the current demo configuration. Production values are set by Compliance and may differ; the mechanics do not.

---

## 1 The one thing to understand first

**When a deposit arrives, the money is already ours to hold — we only decide whether to release it.**

A crypto deposit lands on-chain in our custody address. A fiat deposit lands in our bank account. Neither can be "declined at the door". By the time a deposit record exists, the funds are physically in our custody and sitting in a **holding account** — not in the customer's balance.

Everything that follows is therefore a decision about **release**, never about acceptance:

- Release to the customer, or
- Send it back where it came from, or
- Keep it, or
- Hand it to law enforcement.

There is no fifth option, and there is no "undo". This is why every ending of a deposit must answer one question: **where did the money go?**

---

## 2 The normal path

Most deposits never require a decision from anyone:

1. Customer sends funds to their deposit address (or makes a bank transfer).
2. We detect the arrival and hold the funds in the holding account.
3. We submit the transaction to **Sumsub**, our transaction-monitoring provider, which screens it against sanctions lists, risk rules and — where required — Travel Rule obligations.
4. Sumsub returns a verdict. If it is clean and the amount meets the minimum, the funds move from the holding account into the customer's available balance.

Elapsed time when nothing is flagged: seconds to minutes. No human touches it.

Everything in the rest of this document is about the cases where step 4 does not go straight through.

---

## 3 Where a deposit can end up

There are exactly **five endings**. Each one states plainly where the money went.

| Ending | What it means | Where the money is | Customer sees |
|---|---|---|---|
| **Success** | Released to the customer | Customer's available balance | Success |
| **Failed** | The transfer never actually completed | Never left the sender | Failed |
| **Returned** | Sent back to the originating account | Back with the sender | Returned |
| **Confiscated** | Kept by the firm | Company account | *(deposit is invisible to them)* |
| **Seized** | Handed to law enforcement under an order | Out of our custody, with authorities | Processing |

There is deliberately **no "Rejected" and no "Expired" ending**. Both were removed because neither could answer "where did the money go" — the funds have already arrived, so a deposit cannot legitimately be "rejected" or allowed to "expire" into nothing. If we are not releasing it, we must return it, keep it, or hand it over. That is a design rule, not a limitation.

---

## 4 The five decision points

Between arrival and an ending, a deposit passes up to five gates. Understanding these five is understanding the whole process.

### 4.1 Is the customer in good standing?

Before anything else, we check the customer's own compliance status. A customer who is suspended or under investigation does not get deposits processed. This is automatic and rarely blocks anything.

### 4.2 Does this transaction require Travel Rule treatment?

Under VARA rules, a virtual-asset transfer must carry Travel Rule information when it crosses a threshold **and** the counterparty is another regulated virtual-asset service provider (a "VASP").

We apply three conditions, and **all three must be true**:

| Condition | |
|---|---|
| The asset is a virtual asset (not fiat) | AND |
| The counterparty is a VASP | AND |
| The amount is **at or above** the threshold for that currency | |

Current thresholds: **1,000 USDT** · **3,500 AED**. A deposit exactly at the threshold **does** require Travel Rule treatment.

If all three hold, we submit the transaction to Sumsub as a Travel Rule transaction; otherwise as an ordinary monitored transaction. The reason for the decision is recorded on every deposit, so you can always see why a given deposit was treated one way or the other.

> **Why this matters to you.** Travel Rule transactions are, by definition, the largest counterparty-facing transfers we handle. If screening rules are not configured to cover both transaction types, the highest-value transfers would pass unscreened. Confirming that coverage with Sumsub is a standing Compliance responsibility.

### 4.3 What did the screening return?

Sumsub returns one of four outcomes. This is the branch point that generates almost all human work.

| Sumsub outcome | What it means | What happens |
|---|---|---|
| **Clean** | No risk indicators | Proceeds to the amount gate (4.4) |
| **More information needed** | The customer must supply documents | Deposit waits; customer is asked to provide information |
| **On hold** | Sumsub's own officer is reviewing it | Deposit waits; our clock starts |
| **Not clean** | Risk threshold exceeded | Routed by disposition (4.5) |

**Two things about this step are worth internalising.**

First, **Sumsub can change its mind.** A transaction marked "not clean" can later be reopened by their officer as "more information needed". Our system accepts these reversals and re-routes the deposit accordingly. A deposit that was in your review queue yesterday may legitimately have moved back to waiting-on-customer today.

Second, **"not clean" is not automatically a rejection.** What we do next depends on the disposition tag attached to it — see 4.5.

### 4.4 Is the amount above the minimum?

This check runs **after** compliance clears the deposit, not before. If the amount is below the configured minimum (currently 100), the deposit does not go to the customer. It goes into an **Operations disposition queue** instead.

The reason for the ordering: compliance judgement should never be skipped because an amount looked small. We clear compliance first, then ask the commercial question.

Why a minimum exists at all: returning a very small deposit can cost more in network or bank fees than the deposit is worth. Operations decides case by case whether to release it anyway or keep it.

### 4.5 What is the disposition instruction?

When screening returns "not clean", the tag attached to the result determines the route:

| Tag from Sumsub | Route | Who owns it next |
|---|---|---|
| Sanctions hit | **Frozen** — no accounting movement at all | MLRO |
| MLRO freeze instruction | **Frozen** | MLRO |
| Return to sender | Return approval opened; deposit waits in manual review | MLRO approves |
| Any other tag, or no tag | **Manual review** | Compliance Officer |

A **frozen** deposit is a hard stop. No single person can release it — not an operator, not a late "clean" verdict arriving afterwards. The only ways out are an MLRO unfreeze approval, or a seizure under a law-enforcement order.

---

## 5 Your playbook

### 5.1 Compliance Officer

**What lands in your queue:** deposits in **Manual review**. They arrive one of three ways — screening returned "not clean" with no specific instruction; a hold or a customer-information request ran past its deadline; or a deposit was escalated to you.

**What you can see:** the full Sumsub report — risk score, which rules fired, all tags, and the raw report itself.

**What you can do:**

| Decision | Effect | When |
|---|---|---|
| Release | Funds go to the customer (or to the Operations queue if below minimum) | You judge the risk acceptable and documented |
| Escalate to freeze | Deposit is frozen; only MLRO can unfreeze | You see sanctions exposure or need MLRO judgement |
| Request return | Opens a return approval for MLRO | Funds should go back to the sender |

**What you cannot do:** release a frozen deposit, or decide a seizure. Both are above your level by design.

**Judgement note.** A deposit reaches you because a rule fired, not because wrongdoing is established. Record your reasoning — for a regulator, an undocumented release and an unjustified freeze are equally hard to defend.

### 5.2 MLRO

**What lands in your queue:** approval requests, and every frozen deposit.

| Approval | Signatures required |
|---|---|
| Unfreeze | You alone |
| Return to sender | You alone |
| Seizure | **Senior Management Officer first, then you** |

All approval requests expire after **48 hours** if not actioned.

**On unfreezing.** Unfreezing does not release the money. It sends the deposit back through compliance review from the start. If you believe the funds should be released, unfreeze and let the process re-run; do not look for a direct release path — there deliberately isn't one.

**On seizure.** Seizure requires two signatures and, in practice, a written law-enforcement order. The order reference is captured with the approval and stays on the record permanently.

### 5.3 Operations

**What lands in your queue:** deposits in the **Operations disposition** state — compliance has already cleared them, but the amount is below the minimum.

| Decision | Effect | Signatures |
|---|---|---|
| Release | Clears the hold; funds go to the customer and the deposit becomes visible to them | Yourself |
| Confiscate | Opens a confiscation approval; on approval the funds move to the firm | Ops Officer signs |

**The judgement is commercial, not compliance.** Compliance has already passed. You are deciding whether releasing a sub-minimum amount is worth the operational overhead, versus keeping it.

**Be aware:** while a deposit sits in your queue, the customer **cannot see it at all**. There is no "pending" entry in their history. They may well contact support saying they sent funds that never arrived — and from their side, that is accurate. Do not let these age silently.

### 5.4 Senior Management Officer

You are the **first** signature on a seizure. Your signature attests that a valid law-enforcement order exists. MLRO countersigns. Neither of you can complete a seizure alone.

---

## 6 What the customer sees — and what you may say

### 6.1 The display

| Deposit is actually… | Customer's screen shows |
|---|---|
| Waiting for arrival / in compliance review | Processing |
| **Frozen (sanctions or MLRO)** | **Processing** |
| **In manual review** | **Processing** |
| **Being seized / seized** | **Processing** |
| Waiting on customer documents | Action required — "Please provide additional information" |
| Being returned / returned | Returning / Returned |
| Released | Success |
| Below minimum, awaiting Operations | *Nothing — the deposit does not appear at all* |

### 6.2 Why enforcement states look identical to normal processing

This is deliberate and non-negotiable. Under anti-money-laundering rules we may not tip off a person that they are under investigation. A distinct colour, a different label, or a "please contact support" prompt would each be enough to signal to a subject that their deposit is being treated differently.

So the four enforcement states are displayed **exactly** as ordinary processing — same wording, same styling, no additional note. It is not an oversight that the customer gets no guidance here; it is the control.

**The trade-off we accepted:** a customer whose deposit is frozen has no in-product route to ask about it. That is intended. Directing that customer to contact support would defeat the purpose.

### 6.3 If a customer contacts you about a deposit

| Situation | What you may say |
|---|---|
| Still in normal processing | "It's being processed. We'll confirm once it completes." |
| Awaiting their documents | Confirm what is needed and how to submit it. |
| **Frozen / under review / being seized** | **"It's being processed."** Nothing further. Do not confirm or deny any review, freeze, or investigation. Escalate internally to MLRO; never improvise. |
| Below minimum, awaiting Operations | Escalate to Operations for a decision. Do not tell the customer the deposit is being held pending a decision to keep it. |
| Returned | Confirm the funds went back to the originating account and when. |

> **The rule of thumb:** you may always describe what the customer can already see on their own screen. You may never describe anything they cannot.

---

## 7 Timelines

| Clock | Duration | Starts when | On expiry |
|---|---|---|---|
| Sumsub hold | 7 days | Sumsub puts the transaction on hold | Moves to our Manual review queue |
| Customer information request | 7 days | We ask the customer for documents | Moves to our Manual review queue |
| Approval request | 48 hours | The request is raised | Approval expires and must be re-raised |

**No clock runs on Manual review or Operations disposition.** Once a deposit is in a human queue, it stays there until that human decides. Ageing items in those queues are a management responsibility, not a system one.

---

## 8 Worked scenarios

**A — Ordinary deposit, nothing flagged**
Customer sends 500 USDT. Funds arrive and go to holding. Screening returns clean. 500 is above the 100 minimum. Funds move to the customer's balance. No human involved. The customer sees Processing, then Success.

**B — Large transfer from another exchange**
Customer sends 3,000 USDT from an account at another regulated exchange. All three Travel Rule conditions hold (virtual asset, counterparty is a VASP, 3,000 ≥ 1,000), so it is submitted as a Travel Rule transaction. Screening returns clean. Funds are released. The Travel Rule treatment is recorded on the deposit and visible in the Sumsub report.

**C — Sanctions hit**
Customer sends 3,900 USDT. Screening returns not clean with a sanctions tag. The deposit freezes immediately. **No accounting entries are made** — the funds stay exactly where they are, in holding. It appears in the MLRO's queue. The customer's screen still says Processing, identical to a normal deposit in flight. Later, a law-enforcement order arrives: Senior Management signs, MLRO countersigns, and the funds are transferred out under seizure. The customer's screen still says Processing throughout.

**D — Customer stops responding**
Customer sends 2,000 USDT. Screening asks for source-of-funds documentation; the customer's screen shows Action required. Seven days pass with no response. The deposit moves into the Compliance Officer's Manual review queue.

At this point the correct outcome is to **return the funds to the sender** — we asked for information to verify the source, the customer did not provide it, and unverified funds should not be accepted. The customer is not accused of anything; the money simply goes back.

⚠ **Current limitation:** an officer cannot initiate a return directly today. The return route can only be triggered when Sumsub itself attaches a return instruction. Until this is addressed, deposits in this situation must be escalated to MLRO and handled outside the standard flow. See Section 9.

**E — Small deposit**
Customer sends 60 USDT against a 100 minimum. Screening returns clean, but the amount is below the minimum, so the deposit lands in the Operations queue. **The customer cannot see this deposit at all.** Operations weighs the return cost against the amount and either releases it — at which point it appears in the customer's history as Success — or confiscates it, in which case it never becomes visible.

**F — Sumsub reverses itself**
A deposit is marked not clean with no specific instruction and sits in Manual review. Before an officer acts, Sumsub's own officer reopens it as "more information needed". The deposit automatically moves back to waiting-on-customer and disappears from the Manual review queue. This is expected behaviour, not an error.

---

## 9 Current limitations you should know about

These are known gaps in the current build. They affect what you can actually do today.

| # | Limitation | Practical impact |
|---|---|---|
| 1 | **An officer cannot initiate a return.** Returns are only triggered by a Sumsub disposition instruction. | Scenario D has no in-system route. Escalate to MLRO and handle manually. **This is the most operationally significant gap.** |
| 2 | **A deposit awaiting Operations disposition cannot receive a late compliance verdict.** | If Sumsub reverses on a below-minimum deposit already in the Operations queue, the reversal will not land. Rare, but check the Sumsub console before releasing anything that was previously flagged. |
| 3 | **A frozen deposit cannot receive any further Sumsub verdict.** | If Sumsub changes its assessment of a frozen deposit, we will not be notified. MLRO should check the Sumsub console directly rather than relying on our queue. |
| 4 | **No reminder is sent before a customer-information deadline expires.** | A customer may miss the 7-day window without ever seeing a follow-up. Consider a manual reminder for material amounts. |

Open questions currently with Compliance:

- Is 7 days a reasonable window for a customer to gather source-of-funds evidence? Many institutions allow 14–30 days with reminders.
- Where should funds go when a return cannot be completed — for example the originating address is retired, or the bank account is closed?
- Should confiscation of very small deposits require a second signature, given it results in the firm keeping customer funds?

---

## 10 Glossary

| Term | Meaning |
|---|---|
| **Holding account** | Where deposited funds sit before release. Not the customer's balance. |
| **Sumsub** | Our transaction-monitoring and screening provider. |
| **VASP** | Virtual Asset Service Provider — a regulated crypto business, such as another exchange. |
| **Travel Rule** | The obligation to transmit originator and beneficiary information alongside qualifying virtual-asset transfers. |
| **Disposition tag** | The instruction attached to a screening result telling us what to do — freeze, return, or refer to manual review. |
| **Tipping off** | Alerting a person that they are the subject of a compliance investigation. Prohibited. |
| **Confiscation** | The firm keeps a below-minimum deposit rather than returning it. A commercial decision. |
| **Seizure** | Funds are handed to law enforcement under an order. Requires two signatures. |
| **Freeze** | A hard stop on a deposit. Only MLRO can lift it. |

---

*Prepared by Product. Questions on process to Product; questions on obligations to Compliance.*
