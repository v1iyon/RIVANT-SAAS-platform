// lib/faq-content.ts
//
// Контент раздела "FAQ / Довідка" в самом дашборде (todo п.9) — не
// отдельный сайт/статьи, а встроенная база знаний, чтобы люди сами
// находили ответы и меньше писали лично в поддержку.
//
// Вынесено отдельным файлом, а не в lib/translations.tsx — там уже 1000+
// строк UI-лейблов, а здесь длинные многоабзацные ответы; смешивать было
// бы неудобно поддерживать. Тот же принцип, что и с lib/timezones.ts.
//
// Каждая статья имеет свой `slug` — по нему на неё можно сослаться из
// других мест интерфейса (например, из карточки риска с category
// "integration" — см. components/dashboard/faq-panel.tsx и
// app/dashboard/page.tsx, где ссылка "Как это исправить?" открывает FAQ
// сразу на статье "sync-errors").
//
// Про линковку ИЗ ai_explanation (текст, который генерит AI в скриптах
// синка — scripts/*-sync.mjs): текст там каждый раз разный и свободной
// формы, надёжно распарсить его на "какая это статья" нельзя. Вместо
// этого ссылка вешается не на текст объяснения, а на СТРУКТУРНОЕ поле
// риска — category === "integration" (см. alertTypeToCategory в
// app/dashboard/page.tsx) — это уже надёжно определяет нужную статью.

import type { Language } from "./translations";

export type FaqCategoryId = "start" | "integrations" | "sync" | "billing" | "notifications" | "privacy";

export interface FaqCategory {
  id: FaqCategoryId;
  label: Record<Language, string>;
}

export interface FaqArticle {
  slug: string;
  category: FaqCategoryId;
  question: Record<Language, string>;
  // \n\n между абзацами — рендерится как отдельные <p>, см. FaqPanel.
  answer: Record<Language, string>;
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  { id: "start", label: { EN: "Getting started", UA: "Початок роботи", DE: "Erste Schritte" } },
  { id: "integrations", label: { EN: "Integrations", UA: "Інтеграції", DE: "Integrationen" } },
  { id: "sync", label: { EN: "Data & sync", UA: "Дані та синхронізація", DE: "Daten & Sync" } },
  { id: "billing", label: { EN: "Plans & billing", UA: "Тарифи та оплата", DE: "Tarife & Zahlung" } },
  { id: "notifications", label: { EN: "Alerts & risks", UA: "Сповіщення та ризики", DE: "Warnungen & Risiken" } },
  { id: "privacy", label: { EN: "Privacy & data", UA: "Приватність і дані", DE: "Datenschutz & Daten" } },
];

export const FAQ_ARTICLES: FaqArticle[] = [
  // ── Getting started ──────────────────────────────────────────────
  {
    slug: "timezone",
    category: "start",
    question: {
      EN: "Why does my daily digest arrive at the wrong time?",
      UA: "Чому щоденний звіт приходить не в той час?",
      DE: "Warum kommt meine tägliche Zusammenfassung zur falschen Zeit an?",
    },
    answer: {
      EN: "RIVANT can't reliably detect your timezone automatically, so it's set manually — you chose it during onboarding, right where you entered your business name. Everything (\"today\", daily digests, morning reports) is calculated against that timezone, not your browser's.\n\nTo change it: Settings → Business profile → Timezone. The change applies from the next calculation cycle, not retroactively to past reports.",
      UA: "RIVANT не може надійно визначити ваш часовий пояс автоматично, тому він виставляється вручну — ви обирали його під час онбордингу, там само, де вводили назву бізнесу. Все (\"сьогодні\", щоденні звіти, ранкові дайджести) рахується саме за цим поясом, а не за поясом вашого браузера.\n\nЗмінити: Налаштування → Профіль бізнесу → Часовий пояс. Зміна застосовується з наступного циклу розрахунку, а не заднім числом до вже сформованих звітів.",
      DE: "RIVANT kann Ihre Zeitzone nicht zuverlässig automatisch erkennen, deshalb wird sie manuell festgelegt — Sie haben sie beim Onboarding ausgewählt, direkt bei der Eingabe Ihres Firmennamens. Alles (\"heute\", tägliche Zusammenfassungen, Morgenberichte) wird nach dieser Zeitzone berechnet, nicht nach der Ihres Browsers.\n\nÄndern: Einstellungen → Unternehmensprofil → Zeitzone. Die Änderung gilt ab dem nächsten Berechnungszyklus, nicht rückwirkend für bereits erstellte Berichte.",
    },
  },
  {
    slug: "trial",
    category: "start",
    question: {
      EN: "How long is the free trial and what happens when it ends?",
      UA: "Скільки триває безкоштовний період і що буде, коли він закінчиться?",
      DE: "Wie lange dauert die kostenlose Testphase und was passiert danach?",
    },
    answer: {
      EN: "The trial lasts 14 days from your first login and gives access to all integrations and features, no card required.\n\nWhen it ends, access is paused (not deleted) — your data stays in place, but the dashboard shows a \"choose a plan\" screen until you subscribe to Starter, Growth, or Scale. Deleting and recreating an account does not restart the trial for the same email.",
      UA: "Триал триває 14 днів з моменту першого входу і дає доступ до всіх інтеграцій та функцій, без прив'язки картки.\n\nКоли він закінчується, доступ призупиняється (не видаляється) — ваші дані лишаються на місці, але дашборд показує екран \"оберіть план\", доки ви не оформите Starter, Growth або Scale. Видалення й повторна реєстрація акаунта не перезапускає триал для того самого email.",
      DE: "Die Testphase dauert 14 Tage ab der ersten Anmeldung und bietet Zugriff auf alle Integrationen und Funktionen, ohne Kreditkarte.\n\nNach Ablauf wird der Zugriff pausiert (nicht gelöscht) — Ihre Daten bleiben erhalten, aber das Dashboard zeigt einen \"Tarif wählen\"-Bildschirm, bis Sie Starter, Growth oder Scale abonnieren. Das Löschen und Neuanlegen eines Kontos startet die Testphase für dieselbe E-Mail nicht neu.",
    },
  },
  {
    slug: "widgets",
    category: "start",
    question: {
      EN: "Can I choose which metrics show up on the Overview page?",
      UA: "Чи можна обрати, які метрики показувати на сторінці Огляду?",
      DE: "Kann ich auswählen, welche Kennzahlen auf der Übersichtsseite erscheinen?",
    },
    answer: {
      EN: "Yes. Click the gear icon above the metric cards on the Overview tab — you can pick up to 4 out of 7 available widgets (revenue, profit, margin, CAC, orders, average order value, expenses). The choice is saved per account and applies immediately.",
      UA: "Так. Натисніть на іконку шестерні над картками метрик на вкладці Огляд — можна обрати до 4 з 7 доступних віджетів (виручка, прибуток, маржа, CAC, замовлення, середній чек, витрати). Вибір зберігається для акаунта й застосовується миттєво.",
      DE: "Ja. Klicken Sie auf das Zahnradsymbol über den Kennzahlkarten im Tab Übersicht — Sie können bis zu 4 von 7 verfügbaren Widgets auswählen (Umsatz, Gewinn, Marge, CAC, Bestellungen, durchschnittlicher Bestellwert, Ausgaben). Die Auswahl wird pro Konto gespeichert und gilt sofort.",
    },
  },

  // ── Integrations ─────────────────────────────────────────────────
  {
    slug: "how-to-connect",
    category: "integrations",
    question: {
      EN: "How do I connect an integration?",
      UA: "Як підключити інтеграцію?",
      DE: "Wie verbinde ich eine Integration?",
    },
    answer: {
      EN: "Go to the Integrations tab and pick a provider — most (Stripe, WooCommerce, PayPal, Mollie) ask for an API key or credentials you generate in that provider's own dashboard, with a short hint on where to find them right on the card. Shopify, Google Ads, and QuickBooks use OAuth instead: you'll be redirected to that provider's login, you approve read-only access, and you land back in RIVANT automatically — no key to copy.\n\nWe only ever request read-only access. RIVANT cannot move money, change your store, or modify your accounting records through any integration.",
      UA: "Перейдіть на вкладку Інтеграції та оберіть провайдера — більшість (Stripe, WooCommerce, PayPal, Mollie) просять API-ключ або облікові дані, які ви створюєте у власному кабінеті цього провайдера, з короткою підказкою прямо на картці, де їх шукати. Shopify, Google Ads і QuickBooks натомість використовують OAuth: вас перенаправить на сторінку входу цього провайдера, ви підтверджуєте доступ лише для читання, і повертаєтесь у RIVANT автоматично — жодного ключа копіювати не треба.\n\nМи завжди запитуємо доступ лише для читання. RIVANT не може переказувати гроші, змінювати ваш магазин чи бухгалтерські записи через жодну інтеграцію.",
      DE: "Gehen Sie zum Tab Integrationen und wählen Sie einen Anbieter — die meisten (Stripe, WooCommerce, PayPal, Mollie) verlangen einen API-Schlüssel oder Zugangsdaten, die Sie im eigenen Dashboard dieses Anbieters erstellen, mit einem kurzen Hinweis direkt auf der Karte, wo Sie diese finden. Shopify, Google Ads und QuickBooks nutzen stattdessen OAuth: Sie werden zur Anmeldeseite des Anbieters weitergeleitet, bestätigen den reinen Lesezugriff und landen automatisch wieder in RIVANT — kein Schlüssel zum Kopieren.\n\nWir fordern immer nur Lesezugriff an. RIVANT kann über keine Integration Geld bewegen, Ihren Shop ändern oder Buchhaltungsdaten bearbeiten.",
    },
  },
  {
    slug: "how-many-integrations",
    category: "integrations",
    question: {
      EN: "How many integrations can I connect, and which ones count as a \"revenue source\"?",
      UA: "Скільки інтеграцій можна підключити і які з них рахуються \"джерелом виручки\"?",
      DE: "Wie viele Integrationen kann ich verbinden, und welche zählen als \"Umsatzquelle\"?",
    },
    answer: {
      EN: "It depends on your plan: Starter gives 2 integration slots, Growth gives 4, Scale gives all 8 with no limit. Whichever plan you're on, at least one of your chosen integrations must be a payment or accounting source — Stripe, Shopify, WooCommerce, PayPal, Mollie, or QuickBooks — because margin, CAC, and daily reports are all calculated from revenue data, and there's nothing to calculate without one.\n\nMeta Ads and Google Ads don't count toward that requirement on their own — they add ad-spend data on top of a revenue source, not instead of it.",
      UA: "Залежить від тарифу: Starter дає 2 слоти інтеграцій, Growth — 4, Scale — усі 8 без обмежень. На будь-якому тарифі принаймні одна з обраних інтеграцій має бути платіжним або обліковим джерелом — Stripe, Shopify, WooCommerce, PayPal, Mollie або QuickBooks — бо маржа, CAC і щоденні звіти рахуються саме від даних про виручку, і без неї рахувати нічого.\n\nMeta Ads і Google Ads самі по собі під цю вимогу не підходять — вони додають дані про рекламні витрати поверх джерела виручки, а не замість нього.",
      DE: "Das hängt vom Tarif ab: Starter bietet 2 Integrationsplätze, Growth 4, Scale alle 8 ohne Limit. Bei jedem Tarif muss mindestens eine der gewählten Integrationen eine Zahlungs- oder Buchhaltungsquelle sein — Stripe, Shopify, WooCommerce, PayPal, Mollie oder QuickBooks —, da Marge, CAC und tägliche Berichte alle aus Umsatzdaten berechnet werden und es ohne diese nichts zu berechnen gibt.\n\nMeta Ads und Google Ads erfüllen diese Anforderung allein nicht — sie fügen Werbeausgaben-Daten zu einer Umsatzquelle hinzu, ersetzen sie aber nicht.",
    },
  },
  {
    slug: "sync-errors",
    category: "integrations",
    question: {
      EN: "One of my integrations shows an error status — what do I do?",
      UA: "Одна з моїх інтеграцій показує статус помилки — що робити?",
      DE: "Eine meiner Integrationen zeigt einen Fehlerstatus — was tun?",
    },
    answer: {
      EN: "An error status almost always means the credentials stopped working on the provider's side — a revoked API key, an expired OAuth token, or permissions that were changed in that provider's own dashboard. RIVANT doesn't lose or corrupt keys on its own.\n\nThe risk card for that alert includes a plain-language explanation of what specifically failed. The fix is usually: open the Integrations tab, disconnect that provider, and reconnect it with a fresh key or a new OAuth approval. Historical data already synced is not affected — only new data stops coming in until it's reconnected.",
      UA: "Статус помилки майже завжди означає, що облікові дані перестали працювати на боці провайдера — відкликаний API-ключ, протермінований OAuth-токен або змінені права доступу у власному кабінеті цього провайдера. RIVANT сам по собі ключі не губить і не пошкоджує.\n\nКартка ризику для цього сповіщення містить пояснення простою мовою, що саме не спрацювало. Зазвичай виправлення таке: відкрийте вкладку Інтеграції, відключіть цього провайдера і підключіть заново з новим ключем або новим підтвердженням OAuth. Історичні дані, які вже синхронізувались, не постраждають — просто нові дані перестають надходити, доки не перепідключите.",
      DE: "Ein Fehlerstatus bedeutet fast immer, dass die Zugangsdaten auf Seiten des Anbieters nicht mehr funktionieren — ein widerrufener API-Schlüssel, ein abgelaufenes OAuth-Token oder geänderte Berechtigungen im eigenen Dashboard dieses Anbieters. RIVANT verliert oder beschädigt Schlüssel nicht von sich aus.\n\nDie Risikokarte zu dieser Warnung enthält eine verständliche Erklärung, was genau fehlgeschlagen ist. Die Lösung ist meist: Tab Integrationen öffnen, den Anbieter trennen und mit einem neuen Schlüssel oder einer neuen OAuth-Bestätigung neu verbinden. Bereits synchronisierte historische Daten sind nicht betroffen — es kommen nur keine neuen Daten mehr an, bis die Verbindung wiederhergestellt ist.",
    },
  },
  {
    slug: "quickbooks-oauth",
    category: "integrations",
    question: {
      EN: "Why does QuickBooks work differently from the others?",
      UA: "Чому QuickBooks підключається інакше, ніж інші?",
      DE: "Warum funktioniert QuickBooks anders als die anderen?",
    },
    answer: {
      EN: "QuickBooks connects through Intuit's own OAuth login, not a manually typed API key — you sign in to Intuit, pick your company, and approve read-only access on Intuit's consent screen. You can revoke that access at any time from your Intuit account settings or from RIVANT's Integrations tab, and either way stops the sync immediately.",
      UA: "QuickBooks підключається через власний OAuth-вхід Intuit, а не через вручну введений API-ключ — ви входите в Intuit, обираєте свою компанію і підтверджуєте доступ лише для читання на екрані згоди Intuit. Відкликати цей доступ можна будь-коли з налаштувань свого акаунта Intuit або з вкладки Інтеграції в RIVANT — обидва способи одразу зупиняють синхронізацію.",
      DE: "QuickBooks wird über den eigenen OAuth-Login von Intuit verbunden, nicht über einen manuell eingegebenen API-Schlüssel — Sie melden sich bei Intuit an, wählen Ihr Unternehmen aus und bestätigen den reinen Lesezugriff auf dem Zustimmungsbildschirm von Intuit. Sie können diesen Zugriff jederzeit über Ihre Intuit-Kontoeinstellungen oder den Tab Integrationen in RIVANT widerrufen — beides stoppt die Synchronisierung sofort.",
    },
  },

  // ── Data & sync ──────────────────────────────────────────────────
  {
    slug: "how-sync-works",
    category: "sync",
    question: {
      EN: "How often does RIVANT pull in new data?",
      UA: "Як часто RIVANT підтягує нові дані?",
      DE: "Wie oft ruft RIVANT neue Daten ab?",
    },
    answer: {
      EN: "Every connected integration syncs on an hourly schedule automatically — there's nothing to click. You can also trigger an immediate manual sync from the Integrations tab if you just made a change on the provider's side and don't want to wait for the next hourly cycle.\n\nEvery metric on the dashboard (revenue, margin, CAC, forecasts) is recalculated right after each sync, so numbers can shift slightly within the hour as fresher data comes in.",
      UA: "Кожна підключена інтеграція синхронізується автоматично щогодини — нічого клікати не потрібно. Також можна запустити негайну ручну синхронізацію на вкладці Інтеграції, якщо ви щойно щось змінили на боці провайдера і не хочете чекати наступного циклу.\n\nКожна метрика на дашборді (виручка, маржа, CAC, прогнози) перераховується одразу після кожної синхронізації, тож цифри можуть трохи змінюватись протягом години у міру надходження свіжіших даних.",
      DE: "Jede verbundene Integration synchronisiert automatisch stündlich — nichts muss angeklickt werden. Sie können auch eine sofortige manuelle Synchronisierung im Tab Integrationen auslösen, wenn Sie gerade etwas auf Seiten des Anbieters geändert haben und nicht auf den nächsten stündlichen Zyklus warten möchten.\n\nJede Kennzahl im Dashboard (Umsatz, Marge, CAC, Prognosen) wird direkt nach jeder Synchronisierung neu berechnet, sodass sich Zahlen innerhalb der Stunde leicht ändern können, sobald aktuellere Daten eintreffen.",
    },
  },
  {
    slug: "numbers-dont-match",
    category: "sync",
    question: {
      EN: "The numbers in RIVANT don't match what I see in Stripe/Shopify directly — why?",
      UA: "Цифри в RIVANT не збігаються з тим, що я бачу напряму в Stripe/Shopify — чому?",
      DE: "Die Zahlen in RIVANT stimmen nicht mit dem überein, was ich direkt in Stripe/Shopify sehe — warum?",
    },
    answer: {
      EN: "A few common reasons: RIVANT shows figures in your dashboard's timezone, while the provider's own dashboard may use UTC or a different one, which shifts \"today\"'s totals near midnight. Refunds, chargebacks, and partial captures are netted against revenue as they happen, which can lag the provider's raw transaction count by up to an hour (until the next sync). And margin/profit figures subtract COGS and expenses you've entered in RIVANT — the provider's dashboard has no concept of that and only ever shows gross revenue.\n\nIf a gap persists well beyond a sync cycle and isn't explained by timezone or refunds, that's worth reporting to support with the specific numbers you're comparing.",
      UA: "Кілька поширених причин: RIVANT показує цифри за часовим поясом вашого дашборду, тоді як власний кабінет провайдера може використовувати UTC чи інший пояс, що зсуває підсумки \"сьогодні\" навколо півночі. Повернення, чарджбеки й часткові списання враховуються у виручці одразу, як стаються, тож можуть відставати від сирого лічильника транзакцій провайдера аж до години (до наступної синхронізації). А цифри маржі/прибутку віднімають собівартість і витрати, які ви внесли в RIVANT, — у кабінеті провайдера такого поняття немає, там завжди лише брутто-виручка.\n\nЯкщо розбіжність зберігається значно довше циклу синхронізації і не пояснюється часовим поясом чи поверненнями — варто написати в підтримку з конкретними цифрами, які ви порівнюєте.",
      DE: "Ein paar häufige Gründe: RIVANT zeigt Zahlen in der Zeitzone Ihres Dashboards, während das eigene Dashboard des Anbieters UTC oder eine andere Zeitzone verwenden kann, was die \"heutigen\" Summen rund um Mitternacht verschiebt. Rückerstattungen, Rückbuchungen und Teilbuchungen werden sofort mit dem Umsatz verrechnet, was bis zu einer Stunde hinter dem rohen Transaktionszähler des Anbieters zurückliegen kann (bis zur nächsten Synchronisierung). Und Marge/Gewinn ziehen die in RIVANT eingetragenen Kosten und Ausgaben ab — im Dashboard des Anbieters gibt es dieses Konzept nicht, dort wird immer nur der Bruttoumsatz angezeigt.\n\nWenn eine Abweichung deutlich länger als ein Sync-Zyklus bestehen bleibt und nicht durch Zeitzone oder Rückerstattungen erklärt wird, lohnt es sich, das mit den konkreten Vergleichszahlen dem Support zu melden.",
    },
  },

  // ── Billing ──────────────────────────────────────────────────────
  {
    slug: "change-plan",
    category: "billing",
    question: {
      EN: "How do I upgrade, downgrade, or cancel my plan?",
      UA: "Як підвищити, знизити тариф чи скасувати підписку?",
      DE: "Wie kann ich meinen Tarif upgraden, downgraden oder kündigen?",
    },
    answer: {
      EN: "Go to Settings → Subscription. Upgrades apply immediately and unlock the new integration slots right away. On Starter and Growth, your chosen integrations are locked in for the current billing period once you've picked them — upgrading to a higher plan is the way to change that selection before the period ends. Cancelling stops future billing but keeps access until the end of the period you already paid for.",
      UA: "Перейдіть до Налаштування → Підписка. Підвищення тарифу застосовується миттєво й одразу відкриває нові слоти інтеграцій. На Starter і Growth обрані інтеграції фіксуються на поточний billing-період, щойно ви їх обрали, — перехід на вищий тариф є способом змінити цей вибір до завершення періоду. Скасування зупиняє майбутні списання, але доступ лишається до кінця вже оплаченого періоду.",
      DE: "Gehen Sie zu Einstellungen → Abonnement. Upgrades gelten sofort und schalten die neuen Integrationsplätze direkt frei. Bei Starter und Growth werden die gewählten Integrationen für den aktuellen Abrechnungszeitraum fixiert, sobald Sie sie ausgewählt haben — ein Upgrade auf einen höheren Tarif ist die Möglichkeit, diese Auswahl vor Ablauf des Zeitraums zu ändern. Eine Kündigung stoppt künftige Abrechnungen, der Zugriff bleibt jedoch bis zum Ende des bereits bezahlten Zeitraums bestehen.",
    },
  },

  // ── Alerts & risks ───────────────────────────────────────────────
  {
    slug: "telegram-alerts",
    category: "notifications",
    question: {
      EN: "How do I get instant alerts on Telegram instead of checking the dashboard?",
      UA: "Як отримувати миттєві сповіщення в Telegram замість того, щоб заходити в дашборд?",
      DE: "Wie erhalte ich sofortige Benachrichtigungen über Telegram, statt das Dashboard zu prüfen?",
    },
    answer: {
      EN: "Go to Settings → Notifications and click Connect Telegram — it opens a one-time link to a Telegram bot, and once you press Start there, alerts are sent to you the moment they're detected, even with the dashboard closed. This is a Growth and Scale feature; Starter shows risks in the dashboard only.\n\nYou can disconnect Telegram at any time from the same settings screen without affecting anything else in your account.",
      UA: "Перейдіть до Налаштування → Сповіщення і натисніть Підключити Telegram — відкриється одноразове посилання на Telegram-бота, і щойно ви натиснете там Start, сповіщення надсилатимуться вам одразу, як тільки їх виявлено, навіть коли дашборд закрито. Це функція тарифів Growth і Scale; на Starter ризики показуються лише в дашборді.\n\nВідключити Telegram можна будь-коли з того самого екрана налаштувань, це не вплине на решту акаунта.",
      DE: "Gehen Sie zu Einstellungen → Benachrichtigungen und klicken Sie auf Telegram verbinden — es öffnet sich ein einmaliger Link zu einem Telegram-Bot, und sobald Sie dort Start drücken, werden Ihnen Warnungen in dem Moment gesendet, in dem sie erkannt werden, selbst bei geschlossenem Dashboard. Dies ist eine Funktion von Growth und Scale; Starter zeigt Risiken nur im Dashboard.\n\nSie können Telegram jederzeit im selben Einstellungsbildschirm trennen, ohne dass dies den Rest Ihres Kontos beeinflusst.",
    },
  },
  {
    slug: "risk-filter",
    category: "notifications",
    question: {
      EN: "Can I filter which types of risks I see?",
      UA: "Чи можна фільтрувати, які саме типи ризиків показувати?",
      DE: "Kann ich filtern, welche Arten von Risiken ich sehe?",
    },
    answer: {
      EN: "Yes — on the Risks tab, click the Filter button next to Active/History and check any categories you care about (revenue, margin, ads, CAC, conversion, product, shipping, sync). Only matching risks show while the filter is active; untick everything to see all of them again. The filter resets when you close and reopen the dashboard.",
      UA: "Так — на вкладці Ризики натисніть кнопку Фільтр поряд з Активні/Історія та відзначте потрібні категорії (виручка, маржа, реклама, CAC, конверсія, товар, доставка, синхронізація). Поки фільтр активний, показуються лише відповідні ризики; зніміть усі позначки, щоб побачити всі знову. Фільтр скидається при закритті й повторному відкритті дашборду.",
      DE: "Ja — klicken Sie im Tab Risiken auf die Schaltfläche Filter neben Aktiv/Verlauf und wählen Sie die gewünschten Kategorien aus (Umsatz, Marge, Werbung, CAC, Konversion, Produkt, Versand, Sync). Solange der Filter aktiv ist, werden nur passende Risiken angezeigt; entfernen Sie alle Häkchen, um wieder alle zu sehen. Der Filter wird beim Schließen und erneuten Öffnen des Dashboards zurückgesetzt.",
    },
  },

  // ── Privacy & data ───────────────────────────────────────────────
  {
    slug: "delete-account",
    category: "privacy",
    question: {
      EN: "How do I delete my account, and what exactly gets removed?",
      UA: "Як видалити свій акаунт і що саме при цьому видаляється?",
      DE: "Wie lösche ich mein Konto, und was genau wird dabei entfernt?",
    },
    answer: {
      EN: "Go to Settings → Account → Delete account. This is immediate and cannot be undone: it removes your businesses, connected integrations, synced metrics, expenses, team members, alerts, and your login itself. There's no recovery window — export anything you need first (see the next question).\n\nOne thing is intentionally not treated as personal data and isn't affected: a fraud-prevention record tied to your email is kept so the same email can't be used to claim an unlimited number of free trials by deleting and recreating an account. It only stores an irreversible hash of the email, nothing else, and can't be used to identify you or restore any of your deleted data.",
      UA: "Перейдіть до Налаштування → Акаунт → Видалити акаунт. Це відбувається одразу і не має відкату: видаляються ваші бізнеси, підключені інтеграції, синхронізовані метрики, витрати, учасники команди, сповіщення й сам логін. Часу на відновлення немає — спершу експортуйте все потрібне (див. наступне питання).\n\nОдна річ навмисно не вважається персональними даними і не видаляється: антифрод-запис, прив'язаний до email, лишається, щоб той самий email не можна було використати для нескінченної кількості безкоштовних триалів через видалення й повторну реєстрацію акаунта. Він зберігає лише незворотний хеш email, більше нічого, і не може бути використаний для вашої ідентифікації чи відновлення видалених даних.",
      DE: "Gehen Sie zu Einstellungen → Konto → Konto löschen. Dies geschieht sofort und ist nicht rückgängig zu machen: Es entfernt Ihre Unternehmen, verbundenen Integrationen, synchronisierten Kennzahlen, Ausgaben, Teammitglieder, Warnungen und Ihren Login selbst. Es gibt kein Zeitfenster zur Wiederherstellung — exportieren Sie zuerst alles, was Sie brauchen (siehe nächste Frage).\n\nEine Sache wird bewusst nicht als personenbezogene Daten behandelt und bleibt unberührt: Ein Betrugspräventions-Datensatz, der mit Ihrer E-Mail verknüpft ist, wird beibehalten, damit dieselbe E-Mail nicht durch Löschen und Neuanlegen eines Kontos für unbegrenzt viele kostenlose Testphasen genutzt werden kann. Er speichert nur einen nicht umkehrbaren Hash der E-Mail, sonst nichts, und kann nicht zur Identifizierung oder Wiederherstellung Ihrer gelöschten Daten verwendet werden.",
    },
  },
  {
    slug: "export-data",
    category: "privacy",
    question: {
      EN: "How do I export my data?",
      UA: "Як експортувати свої дані?",
      DE: "Wie exportiere ich meine Daten?",
    },
    answer: {
      EN: "Go to Settings → Account → Export data. You'll get a file with your synced metrics, expenses, and business profile in a spreadsheet-friendly format, sent to your account email. Do this before deleting your account if you want to keep a copy — deletion is immediate and can't be reversed.",
      UA: "Перейдіть до Налаштування → Акаунт → Експортувати дані. Ви отримаєте файл із синхронізованими метриками, витратами і профілем бізнесу у форматі, зручному для таблиць, надісланий на email вашого акаунта. Зробіть це до видалення акаунта, якщо хочете зберегти копію, — видалення відбувається одразу і не скасовується.",
      DE: "Gehen Sie zu Einstellungen → Konto → Daten exportieren. Sie erhalten eine Datei mit Ihren synchronisierten Kennzahlen, Ausgaben und Ihrem Unternehmensprofil in einem tabellenfreundlichen Format, gesendet an die E-Mail Ihres Kontos. Tun Sie dies vor dem Löschen Ihres Kontos, wenn Sie eine Kopie behalten möchten — die Löschung erfolgt sofort und ist nicht rückgängig zu machen.",
    },
  },
  {
    slug: "who-sees-my-data",
    category: "privacy",
    question: {
      EN: "Who has access to the data I connect?",
      UA: "Хто має доступ до даних, які я підключаю?",
      DE: "Wer hat Zugriff auf die Daten, die ich verbinde?",
    },
    answer: {
      EN: "RIVANT never sells your data. It's shared only with the infrastructure needed to run the product — Supabase for database hosting and Paddle for payment processing — and with the providers you yourself connect (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Meta Ads, Google Ads), and only for read-only access to pull the data you asked RIVANT to show you. Full details are in the Privacy Policy, linked in the footer.",
      UA: "RIVANT ніколи не продає ваші дані. Вони передаються лише інфраструктурі, необхідній для роботи продукту, — Supabase для хостингу бази даних і Paddle для обробки платежів — а також провайдерам, яких ви самі підключаєте (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Meta Ads, Google Ads), і лише для доступу на читання даних, які ви попросили RIVANT показати. Повні деталі — у Політиці конфіденційності, посилання внизу сторінки.",
      DE: "RIVANT verkauft Ihre Daten niemals. Sie werden nur mit der Infrastruktur geteilt, die für den Betrieb des Produkts nötig ist — Supabase für das Datenbank-Hosting und Paddle für die Zahlungsabwicklung — sowie mit den Anbietern, die Sie selbst verbinden (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Meta Ads, Google Ads), und nur für den Lesezugriff, um die Daten abzurufen, die RIVANT Ihnen anzeigen soll. Vollständige Details finden Sie in der Datenschutzerklärung, verlinkt im Footer.",
    },
  },
];

export function getFaqArticle(slug: string): FaqArticle | undefined {
  return FAQ_ARTICLES.find((a) => a.slug === slug);
}