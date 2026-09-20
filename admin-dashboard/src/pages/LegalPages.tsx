import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle";
import { BrandMark } from "../components/icons";

/**
 * The privacy policy and terms, kept honest: every claim here matches what the code actually does.
 * The few details only the operator knows are marked so they cannot be missed before going public.
 */
const UPDATED = "20 September 2026";
const COMPANY = "Zehnox";
const PRODUCT = "ZehnBot";
const CONTACT = "[privacy@zehnox.com]";          // set a real address before this page is public
const ENTITY = "[registered company name and address]";
const LAW = "[country or state whose law applies]";

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", maxWidth: 820, margin: "0 auto" }}>
        <Link to="/" className="zb-brand" style={{ padding: 0 }}><BrandMark /> {PRODUCT}</Link>
        <ThemeToggle />
      </header>
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "8px 24px 72px" }}>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 38px)", lineHeight: 1.15, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>{title}</h1>
        <p style={{ color: "var(--muted-fg)", margin: "0 0 32px" }}>Last updated {UPDATED}</p>
        <div className="zb-legal" style={{ fontSize: 15.5, lineHeight: 1.7 }}>{children}</div>
        <p style={{ marginTop: 40, fontSize: 14 }}>
          <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/">Home</Link>
        </p>
      </main>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 19, margin: "0 0 10px", letterSpacing: "-0.01em" }}>{heading}</h2>
      {children}
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy policy">
      <Section heading="Who this is about">
        <p>
          {PRODUCT} is a chat assistant that businesses add to their own websites. It is run by {COMPANY} ({ENTITY}).
          This policy covers two different groups of people, and our role is different for each.
        </p>
        <ul>
          <li><strong>Our customers:</strong> the businesses who sign in to {PRODUCT} and set up bots. For their account data we decide what is collected, so we are the data controller.</li>
          <li><strong>Visitors to our customers' websites:</strong> the people who chat with a bot. That conversation belongs to the business running the bot. They decide what is collected and why; we only store and process it for them.</li>
        </ul>
        <p>So if you chatted with a bot on some company's website and want your data removed, ask that company. They can delete it themselves, and we help them if they ask.</p>
      </Section>

      <Section heading="What we hold about customers">
        <ul>
          <li>The email address used to sign in, and a password that is stored only as a hash, never as text we can read.</li>
          <li>The workspace name, plan, and how many messages the workspace used this month.</li>
          <li>Each bot's settings: its name, website, welcome message, colours, instructions, and the knowledge loaded into it.</li>
          <li>If a workspace adds its own AI provider key, that key is encrypted before it is stored, and is never shown again or sent back to the browser.</li>
          <li>If someone uses the contact form, what they wrote in it.</li>
        </ul>
      </Section>

      <Section heading="What a bot holds about website visitors">
        <ul>
          <li>The messages typed into the chat and the replies given, so the conversation continues sensibly and the business can read it later.</li>
          <li>A random session id kept in the visitor's own browser, so a chat survives moving between pages. It is not an advertising identifier and it is not shared.</li>
          <li>Name, email and phone, when the visitor gives them in the chat or its contact form. This is the lead the business receives.</li>
          <li>Visitors' IP addresses are used to count requests and stop abuse. They are held only in short-lived counters, for a day at most, and are never stored next to a conversation or a lead.</li>
        </ul>
      </Section>

      <Section heading="Who else sees the data">
        <p>We keep the list of companies involved as short as we can. Chat messages are sent to an AI provider to produce a reply. Which provider depends on the bot: either the platform's provider, or the provider whose key that workspace entered. Beyond that:</p>
        <ul>
          <li>Our hosting provider, where the servers and database run.</li>
          <li>Cloudflare, which sits in front of the site to serve it and absorb attacks.</li>
          <li>Our own mail server, which sends account emails such as confirmation and password reset.</li>
          <li>Google, only if a customer chooses to sign in with Google.</li>
        </ul>
        <p>We do not sell data, we do not share it for advertising, and we do not use conversations to train our own models.</p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Account and bot data is kept while the workspace exists. Conversations and leads are kept until the business
          deletes them, because they are that business's records. Deleting a bot deletes its knowledge, conversations and
          leads with it. Closing a workspace deletes everything in it. Backups may hold a copy for a short period after
          deletion before they are rotated out.
        </p>
      </Section>

      <Section heading="Deleting data">
        <p>Inside the dashboard, a business can delete a single person's details, a single conversation, both at once, a whole bot, or the entire workspace. If you are a visitor and want to be forgotten, contact the business whose website you used. If you cannot reach them, write to us at {CONTACT} and we will help.</p>
      </Section>

      <Section heading="Cookies and browser storage">
        <p>
          The chat widget sets no advertising or tracking cookies. It keeps the conversation and a sound preference in the
          visitor's own browser storage, which never leaves that browser. The dashboard keeps your sign-in token in browser
          storage so you stay signed in. One short-lived cookie is set only while signing in with Google, to make sure the
          sign-in that comes back is the one that started.
        </p>
      </Section>

      <Section heading="How it is protected">
        <ul>
          <li>Traffic is encrypted in transit.</li>
          <li>AI provider keys are encrypted before they are stored.</li>
          <li>Passwords are hashed, and changing a password signs out every other device.</li>
          <li>Each workspace can only reach its own data, and a bot only answers on the websites its owner listed.</li>
        </ul>
      </Section>

      <Section heading="Your rights">
        <p>
          Depending on where you live, you may have the right to ask for a copy of your data, to have it corrected or
          deleted, or to object to how it is used. Write to {CONTACT} and we will answer. If we hold the data on behalf of
          one of our customers, we will point you to them, or pass your request on.
        </p>
      </Section>

      <Section heading="Changes and contact">
        <p>If this policy changes in a way that matters, we will say so on this page and update the date at the top. Questions go to {CONTACT}.</p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of service">
      <Section heading="The agreement">
        <p>These terms are between you, the business using {PRODUCT}, and {COMPANY} ({ENTITY}). Using the service means you accept them.</p>
      </Section>

      <Section heading="Your account">
        <p>
          You need an account to use {PRODUCT}. Keep your sign-in details to yourself, and tell us if you think someone else
          has them. You are responsible for what happens in your workspace. Accounts are for businesses; do not create one
          on behalf of someone who has not asked you to.
        </p>
      </Section>

      <Section heading="Plans, limits and payment">
        <p>
          Each plan comes with a monthly message allowance and a maximum number of bots, shown on the pricing section and in
          your settings. If you connect your own AI provider key, that bot's messages are billed by that provider directly to
          you, not by us. There is no online checkout yet: plans are arranged with us directly, and prices may change with
          notice before a renewal.
        </p>
      </Section>

      <Section heading="What you put into it">
        <p>
          The content you load into a bot stays yours. You give us permission to store and process it so the service can work.
          You promise that you are allowed to use that content, and that your bot and website follow the law where your
          visitors are, including telling visitors that the chat is recorded and getting any consent that requires.
        </p>
      </Section>

      <Section heading="Fair use">
        <p>Do not use {PRODUCT} to send spam, to break into anything, to mislead people about who they are talking to, to handle payment card details or health records through a chat, or to publish content that is illegal where you or your visitors are. We may suspend a workspace that does, and will tell you why.</p>
      </Section>

      <Section heading="Availability">
        <p>
          We work to keep the service up and deploy carefully, but this is a young product and we do not promise a particular
          uptime. Replies come from AI providers whose availability we do not control, and a bot can be wrong. Check anything
          that matters before relying on it, and do not let a bot make promises on your behalf that you cannot keep.
        </p>
      </Section>

      <Section heading="Ending it">
        <p>
          You can stop using {PRODUCT} whenever you like and ask us to close your workspace, which deletes its bots,
          conversations and leads. We may close an account that breaks these terms, or with reasonable notice if we stop
          offering the service. Export your leads before you go: the dashboard can download them as a spreadsheet.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          The service is provided as it is. To the extent the law allows, we are not liable for lost profits, lost business or
          indirect losses, and our total liability is limited to what you paid us in the twelve months before the claim.
          Nothing here removes rights that cannot be removed by an agreement.
        </p>
      </Section>

      <Section heading="Changes and law">
        <p>
          If these terms change, we will update this page and the date at the top, and tell customers when the change matters.
          These terms are governed by the law of {LAW}. Questions go to {CONTACT}.
        </p>
      </Section>
    </LegalShell>
  );
}
