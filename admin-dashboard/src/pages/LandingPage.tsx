import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import "../styles/landing.css";
import { api } from "../api/client";
import ContactDialog, { type ContactRequest } from "../components/ContactDialog";
import LiveDemo, { BIKE_DEMO_BOT } from "../components/LiveDemo";
import ThemeToggle from "../components/ThemeToggle";
import { BrandMark, IconArrowRight, IconCaret, IconCheck, ZehnoxWordmark } from "../components/icons";
import { useAuthStore } from "../store/authStore";
import { useTheme } from "../theme";

const ZEHNOX_URL = "https://www.zehnox.com";
const EASE = [0.16, 1, 0.3, 1] as const;

// Fallback only: the real prices come from /api/public/plans (the operator edits them under Settings).
const FALLBACK_PLANS = [
  { name: "Free", price: 0, blurb: "Try it on one site.", bots: "1 bot", messages: "200 messages a month" },
  { name: "Starter", price: 19, blurb: "A small business with one or two sites.", bots: "3 bots", messages: "2,000 messages a month", pick: true },
  { name: "Pro", price: 49, blurb: "Busy sites, or an agency with several clients.", bots: "10 bots", messages: "10,000 messages a month" },
  { name: "Business", price: 149, blurb: "Agencies running many client sites.", bots: "50 bots", messages: "50,000 messages a month" },
];

const FAQ = [
  ["Does it make things up?", "It answers from the content you give it. When the answer is not there, it says so and offers to have someone follow up, instead of guessing at prices or policies."],
  ["What can it learn from?", "Your website (it can crawl it for you), individual pages, PDF and Word files, plain text files, and anything you paste in. You can add, replace or remove each source at any time."],
  ["Which AI does it use?", "By default it runs on a low-cost model chosen by the platform. You can also connect your own key from DeepSeek, OpenRouter, OpenAI, Anthropic, Google and others, and messages on your own key are not capped."],
  ["Will it slow my website down?", "The widget is one small script that loads after your page. It lives in its own isolated container, so it cannot change how your site looks, and your site's styles cannot break it."],
  ["Can I run bots for several clients?", "Yes. One account holds several bots, each locked to its own website, with its own content, leads and insights."],
  ["How do I pay for a paid plan?", "There is no online checkout yet. Start on Free. When you need more, leave your details under Talk to Zehnox and the team moves you to a paid plan and arranges billing with you directly."],
];

/** A bento cell that rises into place when its grid scrolls into view (the parent staggers them). */
function Cell({ className, children }: { className: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className}
      variants={reduce ? undefined : { hidden: { opacity: 0, y: 22 }, shown: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}>
      {children}
    </motion.div>
  );
}

/** Theme-matched real screenshots. Both themes were captured from the running product. */
function Shot({ name, alt, width, height, eager, themed = true }: { name: string; alt: string; width: number; height: number; eager?: boolean; themed?: boolean }) {
  const [theme] = useTheme();
  // The widget lives on the customer's website, which is not ours to theme: those captures have one version
  return (
    <img className="lp-shot" src={themed ? `/shots/${name}-${theme}.webp` : `/shots/${name}.webp`} alt={alt} width={width} height={height}
      loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchPriority: "high" as const } : {})} />
  );
}

export default function LandingPage() {
  // Only a customer's session counts here: the landing page never leads into the operator console
  const signedIn = useAuthStore((s) => !!s.token && s.kind === "tenant");
  const reduce = useReducedMotion();
  const [demoBot, setDemoBot] = useState<string | null>(null);
  const [signupOpen, setSignupOpen] = useState(true);
  const [stuck, setStuck] = useState(false);
  const [contact, setContact] = useState<ContactRequest | null>(null);
  const [plans, setPlans] = useState(FALLBACK_PLANS.map((p) => ({ ...p, currency: "$" })));
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "ZehnBot - Turn website questions into leads";
    api.get("/auth/config").then((r) => {
      setDemoBot(r.data.demo_client_id ?? null);
      setSignupOpen(!!r.data.allow_signup || !!r.data.google_signup);
    }).catch(() => undefined);
    api.get("/public/plans").then((r) => setPlans(r.data.map((p: { name: string; price: number; currency: string; blurb: string; max_bots: number; monthly_message_quota: number; recommended: boolean }) => ({
      name: p.name, price: p.price, currency: p.currency, blurb: p.blurb, pick: p.recommended,
      bots: `${p.max_bots} ${p.max_bots === 1 ? "bot" : "bots"}`, messages: `${p.monthly_message_quota.toLocaleString()} messages a month`,
    })))).catch(() => undefined);
  }, []);

  // The nav gains its hairline once the page has moved. An observer, never a scroll listener.
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, []);

  // One label per intent, everywhere on the page
  const start = signedIn ? { to: "/overview", label: "Open dashboard" } : { to: "/signup", label: signupOpen ? "Start free" : "Request access" };
  const rise = (delay: number) => (reduce ? {} : {
    initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: EASE },
  });

  return (
    <div className="lp">
      <div ref={sentinel} aria-hidden="true" style={{ position: "absolute", top: 0, height: 1, width: 1 }} />

      <header className={`lp-nav${stuck ? " is-stuck" : ""}`}>
        <div className="lp-wrap lp-nav-inner">
          <Link to="/" className="zb-brand"><BrandMark /> ZehnBot</Link>
          <nav className="lp-nav-links" aria-label="Page sections">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            {!signedIn && <Link to="/login" className="zb-btn zb-btn--ghost lp-hide-sm">Log in</Link>}
            <Link to={start.to} className="zb-btn zb-btn--primary">{start.label}</Link>
          </div>
        </div>
      </header>

      <main>
        {/* 1. Hero: asymmetric split. Headline, one sentence, two actions. Nothing else. */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <motion.h1 {...rise(0)}>Turn questions into leads.</motion.h1>
              <motion.p className="lp-hero-sub" {...rise(0.08)}>
                ZehnBot answers visitors from your own pages and documents, then hands you their name and number. No developer needed.
              </motion.p>
              <motion.div className="lp-hero-cta" {...rise(0.16)}>
                <Link to={start.to} className="zb-btn zb-btn--primary zb-btn--lg">{start.label} <IconArrowRight size={16} /></Link>
                <a href="#demo" className="zb-btn zb-btn--secondary zb-btn--lg">Try the live demo</a>
              </motion.div>
            </div>
            <motion.div className="lp-hero-visual"
              {...(reduce ? {} : { initial: { opacity: 0, y: 28, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.9, delay: 0.12, ease: EASE } })}>
              <Shot name="overview" eager width={1440} height={820}
                alt="The ZehnBot dashboard for a bike workshop: conversations, leads captured, questions answered and daily charts." />
              <img className="lp-hero-widget" src="/shots/hero.webp" width={856} height={1360} decoding="async"
                alt="The ZehnBot chat widget answering a question about e-bike servicing, then asking for a name and number to confirm a booking." />
            </motion.div>
          </div>
        </section>

        {/* 2. How it works: a sticky heading beside a vertical run of three moves */}
        <section id="how">
          <div className="lp-wrap lp-how-grid">
            <div className="lp-how-head">
              <h2>On your site in three moves.</h2>
              <p className="lp-lede">No training sessions and no flow charts to draw. It works from what you have already written.</p>
            </div>
            <ol className="lp-moves">
              <li className="lp-move">
                <h3>Point it at your website</h3>
                <p>Give it your address and it reads your pages. Add PDFs, Word files or pasted text for anything the site does not say.</p>
                <Shot name="knowledge" width={1440} height={900} alt="The Knowledge page: crawl a website, upload files, import pages, and a list of the sources already loaded." />
              </li>
              <li className="lp-move">
                <h3>Ask it what your customers ask</h3>
                <p>Talk to it on a preview page before anyone else does. A wrong answer is fixed in your content, not in a prompt.</p>
                <Shot name="preview" themed={false} width={1440} height={900} alt="The preview page showing the real widget answering a question about opening hours." />
              </li>
              <li className="lp-move">
                <h3>Paste one line of code</h3>
                <p>Copy the snippet into your site. The chat bubble appears in your colour, on desktop and on phones, and only on the sites you list.</p>
                <Shot name="embed" width={1440} height={900} alt="A bot's settings page with its embed code, website address and widget colour." />
              </li>
            </ol>
          </div>
        </section>

        {/* 3. Live demo: one centred stage. This is the page's authored motion moment: a real reply, streaming. */}
        <section id="demo" className="lp-demo">
          <div className="lp-wrap">
            <div className="lp-demo-head">
              <h2>Ask it something.</h2>
              <p className="lp-lede">
                {demoBot === BIKE_DEMO_BOT
                  ? "This is a real ZehnBot, set up for a bike workshop. Ask about servicing, opening hours, or booking a fitting."
                  : demoBot
                    ? "This is a real ZehnBot, answering from real content. Nothing here is scripted."
                    : "A real conversation with a ZehnBot set up for a bike workshop."}
              </p>
            </div>
            {demoBot
              ? <LiveDemo clientId={demoBot} />
              : <div style={{ maxWidth: 760, margin: "44px auto 0" }}><Shot name="preview" themed={false} width={1440} height={900} alt="A ZehnBot conversation on a bike workshop's website." /></div>}
          </div>
        </section>

        {/* 4. Features: a bento with exactly five cells; three carry real screenshots, two carry colour */}
        <section id="features">
          <div className="lp-wrap">
            <h2>Built to hand you customers, not transcripts.</h2>
            <motion.div className="lp-bento"
              {...(reduce ? {} : { initial: "hidden", whileInView: "shown", viewport: { once: true, amount: 0.15 }, variants: { shown: { transition: { staggerChildren: 0.07 } } } })}>
              {[
                <Cell className="lp-cell lp-cell--a" key="a">
                  <div className="lp-cell-text"><h3>Leads with a name attached</h3><p>Visitors leave an email or a phone number in the chat, typed or through a short form. You get a list, and a CSV export.</p></div>
                  <div className="lp-cell-img"><Shot name="leads" width={1440} height={760} alt="The Leads page listing names, emails, phone numbers and how each lead was captured." /></div>
                </Cell>,
                <Cell className="lp-cell lp-cell--b" key="b">
                  <blockquote>
                    I don't have that to hand. Shall I ask the workshop to call you?
                    <span>The demo bot, asked something its content does not cover</span>
                  </blockquote>
                  <div className="lp-cell-text"><h3>It says when it does not know</h3><p>No invented prices or policies. It offers a follow-up instead, and you keep your visitor's trust.</p></div>
                </Cell>,
                <Cell className="lp-cell lp-cell--c" key="c">
                  <div className="lp-cell-text"><h3>See what it could not answer</h3><p>Every unanswered question is listed, so you always know what to add next.</p></div>
                  <div className="lp-cell-img"><Shot name="insights" width={1200} height={760} alt="The Insights page with conversations per day and a list of questions the bot could not answer." /></div>
                </Cell>,
                <Cell className="lp-cell lp-cell--d" key="d">
                  <div className="lp-cell-text"><h3>Your choice of AI</h3><p>A low-cost model by default. Or connect your own key, and your messages are not capped.</p></div>
                  <div className="lp-providers" aria-label="Supported AI providers">
                    {["DeepSeek", "OpenRouter", "OpenAI", "Anthropic", "Google Gemini", "Mistral", "Groq", "Any OpenAI-compatible endpoint"].map((p) => <span key={p}>{p}</span>)}
                  </div>
                </Cell>,
                <Cell className="lp-cell lp-cell--e" key="e">
                  <div className="lp-cell-text"><h3>Every site in one place</h3><p>See conversations, leads and open questions across all your bots the moment you log in.</p></div>
                  <div className="lp-cell-img"><Shot name="overview-lower" width={1440} height={820} alt="An agency workspace with three client bots, each with its own conversations and leads, beside the most recent leads and the questions still open." /></div>
                </Cell>,
              ]}
            </motion.div>
          </div>
        </section>

        {/* 5. Two ways to run it: a pair of facing panels, no imagery */}
        <section style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <h2>Set it up yourself, or have it done.</h2>
            <div className="lp-ways">
              <div className="lp-way">
                <h3>Do it yourself</h3>
                <p>For owners who want it running today, and for agencies adding it to client sites.</p>
                <ul>
                  <li><IconCheck size={17} /> Sign up and create your first bot</li>
                  <li><IconCheck size={17} /> Load your content and test it on a preview page</li>
                  <li><IconCheck size={17} /> Several bots under one login, each locked to its own site</li>
                </ul>
                <Link to={start.to} className="zb-btn zb-btn--primary">{start.label}</Link>
              </div>
              <div className="lp-way">
                <h3>Done for you by Zehnox</h3>
                <p>The team behind ZehnBot loads your content, tunes the answers and installs it on your website.</p>
                <ul>
                  <li><IconCheck size={17} /> Your content gathered and loaded for you</li>
                  <li><IconCheck size={17} /> Answers checked against the questions your customers really ask</li>
                  <li><IconCheck size={17} /> Installed on your site, in your colours</li>
                </ul>
                <button type="button" className="zb-btn zb-btn--secondary" onClick={() => setContact({ source: "landing-done-for-you" })}>Talk to Zehnox</button>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Pricing: four plans in one ruled grid */}
        <section id="pricing" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <h2>Plain monthly plans.</h2>
            <p className="lp-lede">Priced by messages and bots, never by seat. Start on Free. Paid plans are arranged with the Zehnox team. There is no online checkout yet.</p>
            <div className="lp-plans">
              {plans.map((plan) => (
                <div key={plan.name} className={`lp-plan${plan.pick ? " lp-plan--pick" : ""}`}>
                  <div className="lp-plan-name">{plan.name}{plan.pick && <span className="zb-badge zb-badge--primary">Recommended</span>}</div>
                  <div className="lp-price">{plan.currency}{plan.price.toLocaleString()}<small>/ month</small></div>
                  <div className="lp-plan-for">{plan.blurb}</div>
                  <ul>
                    <li><IconCheck size={16} /> {plan.bots}</li>
                    <li><IconCheck size={16} /> {plan.messages}</li>
                    <li><IconCheck size={16} /> Leads, insights and CSV export</li>
                  </ul>
                  {plan.price === 0
                    ? <Link to={start.to} className="zb-btn zb-btn--primary zb-btn--block">{start.label}</Link>
                    : <button type="button" className="zb-btn zb-btn--secondary zb-btn--block" onClick={() => setContact({ source: "landing-pricing", plan: plan.name })}>Talk to Zehnox</button>}
                </div>
              ))}
            </div>
            <p className="lp-plan-note">Message limits apply to the platform's AI. A bot that runs on your own AI key is not capped, on any plan.</p>
          </div>
        </section>

        {/* 7. Questions: one narrow column */}
        <section id="questions" style={{ paddingTop: 0 }}>
          <div className="lp-wrap">
            <div className="lp-faq">
              <h2>Questions people ask first.</h2>
              <div className="lp-faq-list">
                {FAQ.map(([q, a]) => (
                  <details key={q}>
                    <summary>{q} <IconCaret size={18} /></summary>
                    <p>{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 8. Closing: a full field of the accent */}
        <section className="lp-close">
          <div className="lp-wrap">
            <h2>Your next visitor has a question.</h2>
            <p>Have an answer ready, and a way to reach them afterwards.</p>
            <Link to={start.to} className="zb-btn zb-btn--lg">{start.label} <IconArrowRight size={16} /></Link>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-inner">
          <Link to="/" className="zb-brand" style={{ padding: 0 }}><BrandMark size={28} /> ZehnBot</Link>
          <div className="lp-foot-links">
            <a href="#pricing">Pricing</a>
            <Link to="/login">Log in</Link>
            <button type="button" className="lp-foot-link" onClick={() => setContact({ source: "landing-footer" })}>Contact</button>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
          <a href={ZEHNOX_URL} target="_blank" rel="noopener noreferrer" className="zb-zehnox" aria-label="Made by Zehnox (opens zehnox.com)">
            <span aria-hidden="true">Made by</span> <ZehnoxWordmark />
          </a>
        </div>
      </footer>

      <ContactDialog request={contact} onClose={() => setContact(null)} />
    </div>
  );
}
