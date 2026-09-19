# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences of equal weight, confirmed by the owner:

- **Small-business owners.** Non-technical, short on time. They sign up themselves, point the bot
  at their own website or documents, and paste one script tag into their site. Their job: stop
  losing visitors who leave with an unanswered question, and hear about the ones who wanted a call.
- **Agencies and freelancers** who build websites for clients. They run several bots for several
  client sites from one account. Their job: add a chat assistant to a client's site quickly, and
  hand the client something that produces leads.

A third role exists but is not a marketing audience: the **platform operator** (Zehnox), who
manages customer workspaces, plans and limits from a super admin console.

## Product Purpose

ZehnBot is an AI chat assistant for a business's own website. It answers visitors from that
business's own content and captures their contact details, so questions turn into leads instead
of bounces. Success for a customer means: visitors get correct answers at any hour, the owner
receives leads with a name and a way to reach them, and the owner can see which questions the
bot could not answer so the content can be improved.

## Positioning

Four claims, all confirmed by the owner as true of the product:

1. **It answers from your own content.** Website pages, PDFs and documents. When the answer is
   not in that content it says so and offers a follow-up, rather than inventing one.
2. **Leads, not just chat.** Name, email and phone are captured inside the conversation (typed
   or through a contact form the bot opens at the right moment), and the owner gets a list of
   the questions the bot could not answer.
3. **Low cost, your choice of AI.** It runs on low-cost models (DeepSeek by default) or on the
   customer's own key from any major provider. There is no per-seat pricing.
4. **Done-for-you is available.** Zehnox, a real team, can set up and tune the bot for a
   customer instead of leaving them alone with a tool.

## Operating Context

- A customer's first session: sign up, create a bot, give it a website address, add knowledge
  (crawl the site, import URLs, upload PDF/DOCX/TXT, or paste text), try it in the dashboard's
  test chat or the stand-in preview page, then paste the embed script into their site.
- Day to day: read Leads, read Conversations, check Insights for unanswered questions, add the
  missing knowledge.
- Visitors meet the product as a chat bubble on someone else's website, on phones as much as
  desktops. They never see the ZehnBot brand as a destination.
- The operator's routine: create or approve workspaces, set plan and monthly message quota,
  suspend abusers, reset logins, watch usage.

## Capabilities and Constraints

Confirmed functionality (all implemented in this repository):

- Multi-tenant workspaces; roles: super admin (operator) and tenant admin (customer).
- Plans: Free, Starter, Pro, Business, each with a monthly message quota and a bot limit.
  Landing-page prices chosen by the owner as editable placeholders: $0, $19, $49, $149 per month.
- Knowledge from site crawl, URL import, file upload and pasted text. Hybrid retrieval
  (keyword plus embeddings when an embeddings key is configured).
- Streaming replies; rich text in replies; multi-line input; optional message sound.
- Lead capture from chat text and from an in-widget form; one lead per conversation; CSV export.
- Insights per bot: conversations, leads, conversion, answer rate, unanswered questions.
- AI providers: DeepSeek as platform default, plus OpenRouter, OpenAI, Anthropic, Gemini, Groq,
  Mistral and others, and any OpenAI-compatible endpoint. A bot with its own key is not limited
  by the plan's message quota.
- The widget only runs on the websites listed for the bot (plus localhost and the platform's
  own preview page).

Constraints and undecided facts:

- **No payment integration yet.** Paid plans cannot be bought online; upgrades are arranged by
  contacting Zehnox. Marketing must not imply self-serve checkout.
- **No email is sent by the system yet.** No sign-up verification, no password reset by email,
  no lead notification emails. Marketing must not promise email alerts.
- Public sign-up exists behind a switch the operator controls.
- Terminology: the product says **bot**, **workspace**, **lead**, **knowledge**. The code still
  says `client` for a bot and `tenant` for a workspace; those words are not user-facing.
- Stack is fixed by the existing codebase: FastAPI and Postgres backend, React + Vite dashboard
  served by nginx, a framework-free embeddable widget. Deployed with Docker Compose.

## Brand Commitments

- Product name: **ZehnBot** (owner's choice). Made by **Zehnox**.
- Light and dark themes with a user toggle are required across the landing page and dashboards.
- The owner adopted the Taste Skill v2 rule set as the design authority for the landing page.
  That includes its copy rules: no em-dashes, no invented statistics, no filler verbs.

## Evidence on Hand

- **No customers, testimonials, case studies, press or usage numbers exist yet (pre-launch).**
  None may be invented: no fake logos, quotes, names or metrics.
- **zehnox.com runs ZehnBot in production** and may be shown or linked as a real deployment.
- **A live demo bot on the landing page is approved** as the main proof. Visitors may talk to
  a real ZehnBot before signing up (`LANDING_DEMO_BOT` setting).
- Real product screenshots can be produced from the running product (widget, dashboard,
  insights, leads). These are the honest visual material.

## Product Principles

1. **Honest over impressive.** The bot admits what it does not know; the marketing admits what
   the product does not do yet.
2. **A lead is the unit of value.** Features are judged by whether they turn a visitor's
   question into someone the owner can call.
3. **Ten minutes to a working bot.** A non-technical owner must get from sign-up to a bot
   answering from their own site without help.
4. **The customer's site comes first.** The widget must never break, slow or restyle the page
   it lives on.
5. **The owner keeps control.** Their content, their choice of AI, their data visible to them
   and to no other workspace.

## Accessibility & Inclusion

WCAG 2.2 AA as the working standard for the landing page, dashboards and the widget: text
contrast 4.5:1, visible keyboard focus, full keyboard operation, labelled controls, and
`prefers-reduced-motion` honoured everywhere. The widget is used by the general public on
third-party sites, so it carries the strictest duty.
