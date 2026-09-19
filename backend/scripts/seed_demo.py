"""
Fill an EMPTY installation with believable demo data: a few workspaces, bots, knowledge,
a month of conversations, leads and unanswered questions. For demos, screenshots and local
development. Everything it creates is fictional.

  docker compose exec backend python scripts/seed_demo.py --yes

It refuses to touch a database that already has workspaces, so it can never mix fiction into
real customer data. Demo logins all use the password printed at the end.
"""
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app.models  # noqa: F401
from app.config import PLANS
from app.database import SessionLocal
from app.models.client import Client
from app.models.conversation import Conversation, Message
from app.models.knowledge import KnowledgeChunk
from app.models.lead import Lead
from app.models.tenant import Tenant, UsageCounter
from app.models.user import User, ROLE_TENANT_ADMIN
from app.services.auth_service import hash_password
from app.services.usage_service import current_period

PASSWORD = "demo-password-2026"
rng = random.Random(7)   # the same data every run

WORKSPACES = [
    # name, plan, owner login, [(bot name, website, slug, theme)]
    ("Tallis Cycle Works", "starter", "owner@tallis.example", [("Tallis Cycle Works", "talliscycles.example", "tallis-cycles", "#1a52d7")]),
    ("Brightwater Dental", "pro", "reception@brightwater.example", [("Brightwater Dental", "brightwaterdental.example", "brightwater-dental", "#1d4ed8")]),
    ("Studio Meridian", "pro", "hello@studiomeridian.example", [
        ("Pine Hollow Cabins", "pinehollow.example", "pine-hollow", "#9a3412"),
        ("Okafor Reyes Law", "okaforreyes.example", "okafor-reyes", "#334155"),
        ("Saltmarsh Bakery", "saltmarshbakery.example", "saltmarsh-bakery", "#a16207"),
    ]),
    ("Halden Physio", "free", "info@haldenphysio.example", [("Halden Physio", "haldenphysio.example", "halden-physio", "#0f766e")]),
]

KNOWLEDGE = {
    "tallis-cycles": [
        ("https://talliscycles.example/servicing", "We service road, gravel, mountain and e-bikes. A standard service is 65 pounds and an e-bike service is 85 pounds. Most services take two working days. We work on Bosch, Shimano Steps and Specialized e-bike systems."),
        ("https://talliscycles.example/visit", "Tallis Cycle Works is open Tuesday to Saturday from nine until half past five. We are closed on Sunday and Monday. You will find us at 14 Tallis Yard, next to the canal towpath."),
        ("https://talliscycles.example/bike-fitting", "A bike fitting session takes ninety minutes and costs 120 pounds. Bring your own shoes and pedals. Fittings are by appointment only."),
        ("file:warranty.pdf", "Every new bike comes with a free first service within eight weeks of purchase. Frames carry the manufacturer's warranty. Keep your receipt."),
    ],
}

QUESTIONS = [
    "Do you service e-bikes?", "What time do you close on Saturday?", "How much is a standard service?", "Can I book a bike fitting?",
    "Do you sell kids bikes?", "How long does a service take?", "Where are you based?", "Do you do wheel builds?",
    "Is there parking nearby?", "Can you fix a puncture while I wait?", "Do you take trade-ins?", "Are you open on Mondays?",
]
UNANSWERED = ["Do you rent bikes for the weekend?", "Can you ship a bike to Ireland?", "Do you offer finance on new bikes?", "Do you repair electric scooters?"]
# the other businesses are not bike shops: their visitors ask the things every small business hears
GENERAL_QUESTIONS = [
    "What are your opening hours?", "Can I book online?", "Where are you based?", "Is there parking nearby?", "How much does it cost?",
    "Do you have anything free this week?", "Can I change my booking?", "Do you take card payments?", "How do I get in touch with the team?",
]
GENERAL_UNANSWERED = ["Do you sell gift vouchers?", "Is there step-free access?", "Are you open on bank holidays?", "Can I pay in instalments?"]
GENERAL_ANSWER = "Yes, we can help with that. Would you like me to pass your details to the team so they can confirm?"
GENERAL_NO_ANSWER = "I don't have that information to hand. I can ask the team to get back to you if you leave a number or an email."
ANSWER = "Yes, we can help with that. A standard service is 65 pounds and most are ready within two working days. Would you like me to pass your details to the workshop?"
NO_ANSWER = "I don't have that to hand. Shall I ask the workshop to call you? Leave a number or an email and they will get back to you."
PEOPLE = [
    ("Amara Okonkwo", "amara.okonkwo@example.com", "+44 7700 900142"), ("Tomasz Wilk", "t.wilk@example.com", None),
    ("Priya Raman", None, "+44 7700 900387"), ("Callum Frith", "callum@frith.example", "+44 7700 900215"),
    ("Ines Duarte", "ines.duarte@example.com", None), ("Joel Adeyemi", "joel.adeyemi@example.com", "+44 7700 900961"),
    ("Hana Sato", "hana.sato@example.com", None), ("Marek Novak", None, "+44 7700 900473"),
    ("Leila Haddad", "leila@haddad.example", "+44 7700 900528"), ("Rowan Pike", "rowan.pike@example.com", None),
    ("Sian Morgan", "sian.morgan@example.com", "+44 7700 900634"), ("Dmitri Volkov", None, "+44 7700 900719"),
    ("Aoife Brennan", "aoife@brennan.example", None), ("Kwame Mensah", "kwame.mensah@example.com", "+44 7700 900856"),
    ("Freya Lindqvist", "freya.lindqvist@example.com", None), ("Oscar Whitlock", None, "+44 7700 900302"),
    ("Nadia Rahimi", "nadia.rahimi@example.com", "+44 7700 900447"), ("Tobias Engel", "tobias@engel.example", None),
    ("Mei Tanaka", "mei.tanaka@example.com", None), ("Gareth Pryce", None, "+44 7700 900581"),
    ("Yusuf Demir", "yusuf.demir@example.com", "+44 7700 900693"), ("Clara Whitby", "clara.whitby@example.com", None),
]


def seed() -> None:
    db = SessionLocal()
    try:
        if db.query(Tenant).first():
            sys.exit("This database already has workspaces. The demo seeder only fills an empty installation.")

        now = datetime.now(timezone.utc)
        period = current_period()
        for ws_index, (name, plan, login, bots) in enumerate(WORKSPACES):
            tenant = Tenant(name=name, plan=plan, created_at=now - timedelta(days=26 - ws_index * 7), **PLANS[plan])
            db.add(tenant)
            db.flush()
            db.add(User(email=login, hashed_password=hash_password(PASSWORD), role=ROLE_TENANT_ADMIN, tenant_id=tenant.id,
                        created_at=tenant.created_at, email_verified_at=tenant.created_at))

            month_messages = month_tokens = 0
            for bot_name, website, slug, theme in bots:
                bot = Client(tenant_id=tenant.id, name=bot_name, domain=website, client_id=slug, bot_name="Assistant",
                             welcome_message=f"Hi! Ask me anything about {bot_name}.", theme_color=theme, created_at=tenant.created_at)
                db.add(bot)
                db.flush()
                for i, (source, text) in enumerate(KNOWLEDGE.get(slug, [(f"https://{website}/", f"{bot_name} is a small local business. Contact us through the form on our website.")])):
                    db.add(KnowledgeChunk(client_id=bot.id, chunk_text=text, chunk_index=i, source_label=source))

                # a month of traffic that grows a little, with quiet weekends
                bikes = slug == "tallis-cycles"
                busy = 1.0 if bikes else rng.uniform(0.3, 0.8)
                for day in range(29, -1, -1):
                    date = now - timedelta(days=day)
                    if date < tenant.created_at:
                        continue
                    weekday_factor = 0.45 if date.weekday() >= 5 else 1.0
                    count = int(round(rng.uniform(2, 9) * busy * weekday_factor * (1.0 + (29 - day) / 45)))
                    for _ in range(count):
                        started = date.replace(hour=rng.randint(8, 20), minute=rng.randint(0, 59), second=rng.randint(0, 59))
                        conv = Conversation(client_id=bot.id, session_id=uuid.uuid4().hex, started_at=started, last_message_at=started)
                        db.add(conv)
                        db.flush()
                        stuck = rng.random() < 0.13
                        question = rng.choice((UNANSWERED if stuck else QUESTIONS) if bikes else (GENERAL_UNANSWERED if stuck else GENERAL_QUESTIONS))
                        reply = (NO_ANSWER if stuck else ANSWER) if bikes else (GENERAL_NO_ANSWER if stuck else GENERAL_ANSWER)
                        tokens = rng.randint(380, 920)
                        db.add(Message(conversation_id=conv.id, role="user", content=question, created_at=started))
                        db.add(Message(conversation_id=conv.id, role="assistant", content=reply,
                                       tokens_used=tokens, unanswered=stuck, created_at=started + timedelta(seconds=4)))
                        if date.strftime("%Y-%m") == period:
                            month_messages += 1
                            month_tokens += tokens
                        if rng.random() < 0.16:
                            person, email, phone = rng.choice(PEOPLE)
                            db.add(Lead(client_id=bot.id, conversation_id=conv.id, name=person, email=email, phone=phone,
                                        source=rng.choice(["chat", "form", "form"]), captured_at=started + timedelta(minutes=2)))
            db.add(UsageCounter(tenant_id=tenant.id, period=period, messages=month_messages,
                                platform_messages=month_messages, tokens=month_tokens))
        db.commit()
        print("Demo data created. Workspace logins (password for all: %s):" % PASSWORD)
        for _, _, login, _ in WORKSPACES:
            print("  ", login)
    finally:
        db.close()


if __name__ == "__main__":
    if "--yes" not in sys.argv:
        sys.exit("This writes fictional workspaces into the database. Re-run with --yes to confirm.")
    seed()
