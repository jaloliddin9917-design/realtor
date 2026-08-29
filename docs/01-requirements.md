# Realtor CRM — Requirements

| | |
|---|---|
| **Status** | Draft v0.1 — 2026-08-29 |
| **Product** | Internal CRM + call automation for a small rental-brokerage team |
| **Market** | Uzbekistan (Tashkent assumed) · UI in uz / ru |
| **Source** | A working realtor's message on 2026-08-29 (Appendix A), 4-agent team |
| **Companion** | [`02-architecture.md`](02-architecture.md) |

---

## 1. Background and problem

The team is four rental agents (*rieltorlar*) who work from public listings — OLX, Telegram channels and similar. Their daily loop is: find a listing → call whoever posted it (*e'lon beruvchi*) → find out whether the flat is still available (*uy topshirilganmi yoki yo'qmi*) → offer it to tenants.

Today this runs on phones and memory. Four concrete problems came out of the conversation:

| # | Problem | Consequence |
|---|---|---|
| **P1** | No shared database — nothing records which listings exist, their status, or who already called | Work is lost between agents; the same question gets asked twice |
| **P2** | All four agents call the same address independently | Wasted calls, annoyed owners, lost time |
| **P3** | Availability is only discoverable by calling; listings go stale silently | Agents offer flats that are already rented |
| **P4** | The same flat is reposted by several agents and the owner is hidden behind them. Many owners refuse certain tenants (the team's example: Chinese nationals), so the team needs the **actual owner** to negotiate with | Time spent on intermediaries; deals lost |

The requested solution, in the realtor's own words: an admin panel / CRM; a bot that messages or calls the poster and records whether the flat is taken; a database where every call's result is written; and duplicate detection by photo or description to find the owner.

---

## 2. Users and roles

| Role | Who | Needs |
|---|---|---|
| **Admin** | Team lead (1) | Sees everything; manages agents, sources, bot templates and limits; reviews duplicate merges |
| **Agent** | Rental agents (4 today, design for ≤ 20) | A work queue, one-tap call logging, property status, "who already called this" |
| **Listing poster** *(external)* | Owner or another realtor who posted the listing | Receives the availability-check message or call. Not a system user; must be treated politely and rarely |
| **Tenant / client** *(later)* | People looking for a flat | Out of scope for v1 (see §4) |

Agents work mostly from a phone, on the move. The admin works from a laptop.

---

## 3. Goals and success metrics

| Goal | Metric | Target |
|---|---|---|
| Stop double-calling | Share of properties called by ≥ 2 agents within 24 h | < 2 % |
| Keep status fresh | Share of `available` properties with a status check older than 3 days | < 10 % |
| Less time per usable listing | Agent minutes per property confirmed `available` | −50 % vs. today (baseline to be measured in week 1) |
| Reach owners | Share of multi-posted properties with an identified probable owner | ≥ 60 % |
| Adoption | All 4 agents log calls in the CRM, not in notes, by end of week 2 | 100 % |

---

## 4. Scope

### The core loop (the product)

Decision 2026-08-29: the product is one loop, and nothing is added that does not serve it.

1. **Fetch every listing from everywhere** — OLX, Telegram channels, any other portal, plus paste-a-link — into one record per house, duplicates merged (FR-2, FR-7).
2. **Check availability automatically by message** — the bot asks the poster whether the flat is still available: reply **1 → active**, reply **2 → inactive**, no reply → retry, then an agent (FR-6, FR-3).
3. **Check again** on a schedule, or as soon as the ad disappears from its source, so the list stays fresh without anyone calling (FR-3.3, FR-3.4, FR-6.1).

The CRM screens, call log and locks (FR-1, FR-4, FR-5) exist only so the team can work from that list. Feature ideas outside the loop are parked, not scheduled.

**In v1**
- Web admin panel / CRM (mobile-friendly)
- Listings database with automatic ingestion from configured sources plus manual entry
- Property status lifecycle and immutable status history
- Call log and next-action reminders
- Call coordination — locks and "already contacted" warnings
- Automated availability check via message (Telegram / SMS), with reply parsing
- Duplicate detection (phone, photos, description, attributes) and owner discovery
- Landlord conditions (e.g. accepts foreign tenants) as structured fields

**Not in v1** (candidates for later)
- Voice-call bot (phase 2 — see FR-6.6)
- Tenant/client database and matching tenants to properties
- Public website or tenant-facing app
- Contracts, payments, commissions accounting
- Multi-team / multi-agency tenancy

---

## 5. Functional requirements

Each requirement has user stories and acceptance criteria. "Property" means one physical flat; "listing" means one advert for it on one source (a property usually has several listings).

### FR-1 Admin panel and CRM

*As an agent I want one place that shows every property we work on, its status and who is handling it.*

- FR-1.1 Web application with login per person; roles `admin` and `agent`.
- FR-1.2 Dashboard: counts by status, today's queue per agent, properties due for re-check, bot results from the last 24 h.
- FR-1.3 Admin manages users, ingestion sources, message templates, thresholds (lock duration, re-check interval, outreach limits).
- FR-1.4 Every screen is usable on a phone (≥ 360 px wide); primary actions reachable in ≤ 3 taps.
- FR-1.5 UI language switch: Uzbek (Latin) and Russian.

### FR-2 Listings database and ingestion

*As a team we want every relevant listing to appear in the CRM by itself, without copying it by hand.*

- FR-2.1 Automatic ingestion from configured sources. Initial sources: **OLX.uz** and a configurable list of **Telegram channels**. Adding a source must not require changes elsewhere.
- FR-2.2 Manual entry: paste a URL, or fill a short form (for listings seen elsewhere or heard by phone).
- FR-2.3 Stored per listing: source, external id, URL, title, description, price + currency (USD or UZS, never guessed from magnitude), rooms, area, floor / total floors, district and address text, photos, phone number(s) normalised to `+998…`, Telegram username if present, posted date, first seen, last seen.
- FR-2.4 The raw payload is kept verbatim so parsing can be improved later without re-crawling.
- FR-2.5 A listing not seen for N crawls (default 3) is marked `source_removed`; the property stays.
- FR-2.6 Crawling is rate-limited per source and never blocks the rest of the system when a source breaks.

### FR-3 Property status lifecycle

*As an agent I want to see at a glance whether a flat is still available and how fresh that information is.*

- FR-3.1 Statuses:

| Status | uz / ru label | Meaning |
|---|---|---|
| `new` | yangi / новый | Ingested, nobody has touched it |
| `in_progress` | ishlanmoqda / в работе | An agent has taken it (lock active) |
| `available` | bo'sh / свободна | Confirmed available, with `confirmed_at` |
| `rented` | topshirilgan / сдана | Confirmed taken |
| `no_answer` | javob yo'q / нет ответа | Tried, retry later |
| `callback` | qayta qo'ng'iroq / перезвонить | Poster asked to be called later (`next_action_at`) |
| `not_relevant` | mos emas / не подходит | Not a rental, spam, wrong region, do-not-contact |
| `archived` | arxiv / архив | Closed |

- FR-3.2 Every status change records actor (agent, bot, crawler, admin), timestamp, previous status and an optional note. History is append-only.
- FR-3.3 `available` older than the re-check interval (default 3 days) is flagged `recheck_due` and enters the bot queue (FR-6).
- FR-3.4 A property with all listings `source_removed` is flagged for re-check, not auto-archived (posters often delete an advert once it is taken — but not always).

### FR-4 Call log

*As an agent I want to write down the result of a call in seconds, so that the next person does not repeat it.*

- FR-4.1 From the property screen: one tap to dial, then log outcome (`available`, `rented`, `no_answer`, `callback`, `wrong_number`, `is_agent_not_owner`, `do_not_contact`), optional note, optional next action date. Target: ≤ 3 taps.
- FR-4.2 Each log entry stores agent, channel (`phone`, `telegram`, `sms`, `bot`), started at, duration if known, outcome, note, and the contact that was reached.
- FR-4.3 The property screen shows the last contact prominently: *"Aziz called 3 h ago — available"*.
- FR-4.4 A logged outcome updates the property status (FR-3) in the same action.

### FR-5 Call coordination — no double-calling

*As a team we want it impossible to call the same address twice by accident.*

- FR-5.1 **Take**: an agent takes a property before calling. It locks for a configurable time (default 4 h) and shows *"Being handled by Aziz until 15:40"* to everyone else. Locks expire automatically; the admin can release one; the holder can release early.
- FR-5.2 **Warning before calling**: if anyone contacted this property (or any contact on it) within the last 24 h, the dial button shows who, when and the result, and asks for confirmation.
- FR-5.3 **Queues**: a property sits in at most one agent's queue at a time. Assignment is manual (admin) or round-robin (setting). Agents can pull from an unassigned pool.
- FR-5.4 Contacts, not just properties, are protected: the same phone number reached through two different properties is still "contacted today".

### FR-6 Automated availability check (bot)

*As a team we want a bot to ask the poster whether the flat is still available, and to write the answer into the database, so that agents call only about flats that are actually free.*

- FR-6.1 **Triggers**: `recheck_due` (FR-3.3); a listing older than X days with no status yet (default 2 days); manual "check now" by an agent; a whole-queue check started by the admin.
- FR-6.2 **Channels**, tried in order until one is possible for that contact: Telegram → SMS → (phase 2) voice call. The channel used is recorded on the property.
- FR-6.3 **Message**: short templates in uz and ru, personalised with the listing's address/title and price, with a numeric reply scheme:
  > *Assalomu alaykum. [Chilonzor, 2-xonali, $400] e'loningiz bo'yicha: uy hali ijaraga beriladimi? Javob: 1 — ha, 2 — yo'q (topshirilgan).*
- FR-6.4 **Reply parsing**: `1`, `ha`, `да`, `свободна`, `bo'sh` → `available`; `2`, `yo'q`, `нет`, `сдана`, `topshirilgan` → `rented`; anything else → shown to an agent as "unclear reply" with the text. Replies are matched to the property that was asked about most recently from that contact.
- FR-6.5 **Politeness policy** (enforced by the sender, not by templates): quiet hours 21:00–09:00 local; at most one message per contact per 7 days across all properties; contacts marked `do_not_contact` are never messaged; any reply containing `STOP`/`тўхта`/`to'xta` sets `do_not_contact`; daily send cap per channel (default 100).
- FR-6.6 **Voice call (phase 2)**: outbound call with a recorded or synthesised prompt in uz/ru, answer by keypad (1 = available, 2 = taken), optional speech recognition, recording stored on the property. Same policy as FR-6.5.
- FR-6.7 Every bot result is a status change with actor `bot` (FR-3.2) and is visible to the assigned agent; `rented` and "unclear" results notify the agent (FR-10).

### FR-7 Duplicate detection and owner discovery

*As an agent I want to see one property with all its adverts, and to know which contact is most likely the owner.*

- FR-7.1 New listings are matched against existing properties using: identical normalised phone; photo similarity (perceptual hash); description similarity; matching attributes (district, rooms, floor, area, price). Matches above the high threshold merge automatically; between thresholds they go to a review queue; below it a new property is created.
- FR-7.2 **Review queue** for the admin (and optionally agents): side-by-side listings, *merge* / *not the same* decisions, recorded with actor. Decisions feed threshold tuning.
- FR-7.3 The property screen shows all its listings with source, price, posted date and contact, and all contacts with their classification.
- FR-7.4 **Contact classification** — `owner`, `agent`, `unknown` — derived from: how many distinct properties a phone number appears on (many → agent); self-declared markers in the text (*egasidan*, *vositachisiz*, *хозяин*, *собственник*, *без посредников* vs. *rieltor*, *агент*, *услуга 50 %*, *komissiya*); posting order within the property (owners usually post first); price (intermediaries tend to add on top). The result is shown as *"Probable owner: +998 90 … (confidence 0.8)"*.
- FR-7.5 An agent can confirm or override the classification after a call (`is_agent_not_owner` in FR-4.1); the human decision wins over the derived one and survives re-crawls.
- FR-7.6 Manual split: an incorrectly merged property can be split back into its listings.

### FR-8 Landlord conditions and notes

*As an agent I want to record what the owner will and will not accept, so that nobody wastes a call.*

- FR-8.1 Structured fields on a property: accepts foreign tenants (yes / no / unknown), specific restrictions as free tags (e.g. *"faqat oilaga"*, *"без животных"*), deposit, minimum term, commission expectations, viewing availability.
- FR-8.2 Pre-filled from listing text where the markers are clear; edited by agents after calls; each change is attributed.
- FR-8.3 Free-text notes per property, chronological, attributed.

### FR-9 Search and filters

- FR-9.1 Filters: district, rooms, price range (USD), status, freshness of last check, owner-only, source, has phone, accepts foreign tenants, assigned agent.
- FR-9.2 Sort: newest, last checked, price. Results show status, last contact, assigned agent, number of duplicate listings.
- FR-9.3 Full-text search across title, description, address and notes.

### FR-10 Notifications to agents

- FR-10.1 Channels: in-app, and a Telegram bot the agent starts once.
- FR-10.2 Events: callback due; bot reported `rented` or an unclear reply on my property; my lock is about to expire; a property was assigned to me; someone attempted to call a property I hold.

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Languages** | UI and bot templates in Uzbek (Latin) and Russian; data may contain Cyrillic Uzbek — search must handle both scripts |
| **Devices** | Mobile-first web for agents; desktop for admin. No native app in v1 |
| **Scale** | ≤ 20 users; ≤ 100 k listings; ≤ 5 k outreach messages / month; a single server is enough |
| **Availability** | Business hours matter (09:00–21:00); planned maintenance outside them. Target 99 % monthly |
| **Performance** | List and search screens < 1 s for 50 k properties; call logging < 300 ms |
| **Auditability** | All status, classification and assignment changes carry actor + timestamp and are never overwritten |
| **Data protection** | Phone numbers and names of listing posters are personal data. Store on servers located in Uzbekistan (Law "On Personal Data", ЗРУ-547, localisation requirement); access only to logged-in team members; export only by admin; delete a contact on request |
| **Outreach conduct** | The policy in FR-6.5 is a hard system rule, not a guideline; the bot must fail closed when the limit store is unavailable |
| **Backups** | Nightly database backup, retained 30 days; restore tested before go-live |
| **Source resilience** | A broken or blocking source degrades only that source; the CRM keeps working on existing data |

---

## 7. Assumptions and open questions

Assumptions taken to write this draft — each one should be confirmed with the team:

| # | Assumption | If wrong |
|---|---|---|
| A1 | City is Tashkent; districts are the Tashkent districts | Add a `city` dimension; nothing else changes |
| A2 | Rental market (*uy topshirish* = rent out), not sales | Status vocabulary and re-check interval change |
| A3 | Sources are OLX.uz and Telegram channels; the channel list comes from the team | Other portals need their own adapter |
| A4 | Prices are negotiated in USD with UZS as display | Store both anyway |
| A5 | Team size stays small (≤ 20); one team, one admin | Multi-tenancy is a later change |
| A6 | Telegram is the first outreach channel, SMS second, voice later | Order is configurable |

Open questions that need an answer before or during build:

1. **Telegram outreach mechanics.** A Telegram *bot* cannot start a conversation with someone who has not messaged it first. Messaging posters first therefore needs a regular Telegram account (a team SIM) driven by the system, paced very conservatively — or SMS as the first channel. Which does the team prefer, and is there a spare SIM for it?
2. **Receiving SMS replies.** Most local SMS gateways are send-only. Options: a provider with inbound numbers, or an Android phone with the team SIM acting as an SMS gateway. Decide before FR-6.
3. **Voice bot.** Which telephony provider/SIP trunk, what it costs per minute, and whether the team is comfortable with robocalls to owners (they can damage goodwill). Phase 2 either way.
4. **Who reviews duplicates?** Admin only, or any agent?
5. **Baseline numbers.** Calls per agent per day today, and how often they hit an already-rented flat — needed for the §3 targets.
6. **Do agents want to log calls from Telegram** (a bot command) in addition to the web app?

---

## 8. Glossary

| Term | Meaning |
|---|---|
| *e'lon* / объявление | A listing / advert |
| *e'lon beruvchi* | The person who posted the listing (owner or another realtor) |
| *uy topshirilgan* / сдана | The flat has been rented out (taken) |
| *bo'sh* / свободна | Available |
| *egasi* / хозяин, собственник | The owner |
| *rieltor* / риелтор, агент | A real-estate agent (intermediary) |
| *vositachisiz* / без посредников | "Without intermediaries" — an owner-direct marker in listing text |
| Property | One physical flat in the CRM; the unit of work |
| Listing | One advert for a property on one source; a property has one or more |
| Contact | One normalised phone number or Telegram username, with a classification |
| Take / lock | An agent reserving a property so nobody else calls it |
| Re-check | Asking the poster again whether the flat is still available |

---

## Appendix A — Source message and translation

Received 2026-08-29 from a working realtor (Uzbek, Cyrillic script, informal; typos preserved):

> Ха шу. Менга жуда курак буляпти. Реалтор ишда.
> Ваа менга админ ангел CRM керак буляпти.
> Яна автомат робот элон беручвига хат юбориб уй топширилганми еки йукми деб стаиусини билиб олса зур сервис чикарди.
> Еки робот узи телефон килсин топшираетган одамга.
> Ва одам тел килгандан соонг базага уйнинг статусини езиб коиш керак.
> Биз 4 одам ишлаяпмиз хаммамиз бир хил адрес буйча тел килямиз, куп уйлар хитойликларга сотилмиди, агент оркалий уйларни тизим дубликтка кидириш керак (расим, еки уйнинг описаниями буйча эгасини топиш учун).

Translation:

> Yes, exactly. I really need this, for my realtor work.
> And I need an admin panel / CRM.
> Also, if an automated bot messaged the person who posted the listing, asked whether the flat has been rented out or not, and found out its status — that would be a great service.
> Or let the bot itself call the person renting it out.
> And after someone calls, the property's status must be written into the database.
> There are four of us and we all call about the same address; many flats are not given to Chinese tenants; the system needs to search agent-posted listings for duplicates (by photo or by the description) in order to find the owner.

Mapping to requirements: admin panel → FR-1; bot messages/calls → FR-6; status in the database after calls → FR-3, FR-4; four people calling the same address → FR-5; duplicates by photo/description to find the owner → FR-7; owners' tenant restrictions → FR-8.
