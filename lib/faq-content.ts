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
  {
    slug: "currency",
    category: "start",
    question: {
      EN: "Can I switch the dashboard from USD to EUR (or back)?",
      UA: "Чи можна перемкнути дашборд з USD на EUR (і назад)?",
      DE: "Kann ich das Dashboard von USD auf EUR umstellen (und zurück)?",
    },
    answer: {
      EN: "Yes — RIVANT currently supports two display currencies, USD and EUR, switchable from the currency selector in the top navigation (next to the language switcher). This only changes how numbers are displayed: everything is converted from its underlying USD value at a fixed rate, it does not re-fetch or re-price anything from your connected providers.\n\nBecause this is a display conversion rather than your business's actual accounting currency, don't rely on it for tax or bookkeeping purposes if your real transactions are in a currency other than USD or EUR — use the export (Settings → Account → Export data) and convert precisely in your own accounting software instead.",
      UA: "Так — RIVANT наразі підтримує дві валюти відображення, USD і EUR, які можна перемкнути в селекторі валюти у верхній навігації (поруч із перемикачем мови). Це змінює лише те, як показуються цифри: все конвертується з базового значення в USD за фіксованим курсом, жодних нових запитів чи перерахунків цін у ваших підключених провайдерів при цьому не відбувається.\n\nОскільки це конвертація відображення, а не реальна облікова валюта вашого бізнесу, не покладайтесь на неї для податкових чи бухгалтерських цілей, якщо ваші реальні транзакції ведуться в іншій валюті, ніж USD чи EUR, — скористайтесь експортом (Налаштування → Акаунт → Експортувати дані) і конвертуйте точно у власному бухгалтерському софті.",
      DE: "Ja — RIVANT unterstützt derzeit zwei Anzeigewährungen, USD und EUR, umschaltbar über den Währungswähler in der oberen Navigation (neben dem Sprachumschalter). Dies ändert nur die Darstellung der Zahlen: Alles wird aus dem zugrunde liegenden USD-Wert zu einem festen Kurs umgerechnet, es werden dabei keine Preise bei Ihren verbundenen Anbietern neu abgefragt oder neu berechnet.\n\nDa dies eine Anzeigeumrechnung und nicht die tatsächliche Buchhaltungswährung Ihres Unternehmens ist, verlassen Sie sich für Steuer- oder Buchhaltungszwecke nicht darauf, falls Ihre echten Transaktionen in einer anderen Währung als USD oder EUR erfolgen — nutzen Sie stattdessen den Export (Einstellungen → Konto → Daten exportieren) und rechnen Sie präzise in Ihrer eigenen Buchhaltungssoftware um.",
    },
  },
  {
    slug: "alert-sensitivity",
    category: "start",
    question: {
      EN: "What does the Low / Normal / High alert sensitivity setting actually change?",
      UA: "Що саме змінює налаштування чутливості сповіщень Low / Normal / High?",
      DE: "Was ändert die Einstellung der Warnempfindlichkeit Low / Normal / High genau?",
    },
    answer: {
      EN: "It controls how big a swing in your numbers has to be before RIVANT raises a risk alert about it — things like a revenue drop, a CAC spike, or a jump in ad spend. Low means only large, unambiguous swings trigger an alert, which is useful if your numbers are naturally noisy day to day and you don't want to be alerted on ordinary fluctuation. High means smaller deviations are flagged too, which surfaces problems earlier but also produces more alerts overall, including some that turn out to be normal variance. Normal is a balanced default in between.\n\nThis setting only affects which NEW risks get created going forward — it doesn't retroactively hide or resolve alerts you've already received, and it applies to all risk categories at once, not per category (use the category filter on the Risks tab for that instead).",
      UA: "Воно керує тим, наскільки великим має бути коливання у ваших цифрах, перш ніж RIVANT підніме сповіщення про ризик — падіння виручки, сплеск CAC, стрибок рекламних витрат тощо. Low означає, що спрацьовують лише великі, однозначні коливання — це корисно, якщо ваші цифри природно \"шумні\" день у день і ви не хочете отримувати сповіщення про звичайні коливання. High означає, що позначаються навіть менші відхилення — це виявляє проблеми раніше, але й генерує більше сповіщень загалом, частина з яких виявиться звичайним варіюванням. Normal — збалансоване значення за замовчуванням між ними.\n\nЦе налаштування впливає лише на НОВІ ризики, створені надалі, — воно не приховує і не закриває заднім числом уже отримані сповіщення, і застосовується одразу до всіх категорій ризиків, а не окремо для кожної (для цього використовуйте фільтр категорій на вкладці Ризики).",
      DE: "Sie steuert, wie groß eine Schwankung in Ihren Zahlen sein muss, bevor RIVANT eine Risikowarnung dazu auslöst — etwa ein Umsatzrückgang, ein CAC-Anstieg oder ein Sprung bei den Werbeausgaben. Low bedeutet, dass nur große, eindeutige Schwankungen eine Warnung auslösen — nützlich, wenn Ihre Zahlen von Natur aus tagesweise schwanken und Sie nicht bei gewöhnlichen Schwankungen benachrichtigt werden möchten. High bedeutet, dass auch kleinere Abweichungen markiert werden — das deckt Probleme früher auf, erzeugt aber insgesamt mehr Warnungen, von denen sich manche als normale Schwankung herausstellen. Normal ist ein ausgewogener Standardwert dazwischen.\n\nDiese Einstellung wirkt sich nur auf NEUE, künftig erstellte Risiken aus — sie verbirgt oder schließt bereits erhaltene Warnungen nicht rückwirkend, und sie gilt gleichzeitig für alle Risikokategorien, nicht pro Kategorie einzeln (dafür den Kategoriefilter im Tab Risiken verwenden).",
    },
  },
  {
    slug: "digest-frequency",
    category: "start",
    question: {
      EN: "What is Digest Frequency and how is it different from real-time alerts?",
      UA: "Що таке Digest Frequency і чим це відрізняється від сповіщень у реальному часі?",
      DE: "Was ist die Digest-Frequenz und wie unterscheidet sie sich von Echtzeit-Warnungen?",
    },
    answer: {
      EN: "Digest Frequency (Settings → Notifications) controls a separate summary report — a rollup of your key metrics for the period, sent on top of, not instead of, any real-time risk alerts. Real-time alerts fire the moment a risk is detected, at any hour; the digest is a scheduled recap (daily or weekly, depending on what you pick) so you have a single summary to glance at even on days nothing went wrong.\n\nTurning this frequency down (or choosing a less frequent option) does not reduce how quickly you're warned about an actual problem — that's governed by Alert Sensitivity and the Push/Email/Telegram toggles, not by the digest setting.",
      UA: "Digest Frequency (Налаштування → Сповіщення) керує окремим підсумковим звітом — зведенням ваших ключових метрик за період, яке надсилається ДОДАТКОВО до сповіщень про ризики в реальному часі, а не замість них. Сповіщення в реальному часі спрацьовують одразу, як тільки виявлено ризик, у будь-яку годину; дайджест — це запланований підсумок (щоденний чи щотижневий, залежно від вибору), щоб мати єдине зведення для перегляду навіть у дні, коли нічого поганого не сталося.\n\nЗниження частоти цього дайджесту (чи вибір рідшого варіанту) не сповільнює те, наскільки швидко ви дізнаєтесь про реальну проблему — за це відповідає Alert Sensitivity і перемикачі Push/Email/Telegram, а не налаштування дайджесту.",
      DE: "Die Digest-Frequenz (Einstellungen → Benachrichtigungen) steuert einen separaten Zusammenfassungsbericht — eine Übersicht Ihrer wichtigsten Kennzahlen für den Zeitraum, die ZUSÄTZLICH zu Echtzeit-Risikowarnungen gesendet wird, nicht anstelle davon. Echtzeit-Warnungen lösen in dem Moment aus, in dem ein Risiko erkannt wird, zu jeder Uhrzeit; der Digest ist eine geplante Zusammenfassung (täglich oder wöchentlich, je nach Auswahl), damit Sie auch an Tagen ohne Probleme eine einzige Übersicht haben.\n\nEine geringere Digest-Frequenz verlangsamt nicht, wie schnell Sie über ein tatsächliches Problem informiert werden — das wird von der Alarmempfindlichkeit und den Push-/E-Mail-/Telegram-Schaltern gesteuert, nicht von der Digest-Einstellung.",
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
  {
    slug: "disconnect-integration",
    category: "integrations",
    question: {
      EN: "What happens to my data if I disconnect an integration?",
      UA: "Що станеться з моїми даними, якщо я відключу інтеграцію?",
      DE: "Was passiert mit meinen Daten, wenn ich eine Integration trenne?",
    },
    answer: {
      EN: "Disconnecting stops future syncing only — it does not delete the metrics, expenses, or revenue rows that provider already contributed to your dashboard. Historical charts and totals keep showing that data. What stops is new data coming in: no more hourly syncs, no more updates to margin/CAC/forecasts from that source.\n\nReconnecting the same provider later (same account, fresh key or OAuth approval) resumes syncing going forward; it does not automatically re-backfill whatever period passed while it was disconnected — see \"Does RIVANT pull historical data or only from the moment I connect?\" for how backfilling works on first connection.\n\nDisconnecting also frees up the integration slot for your plan immediately, so you can connect a different provider in its place without upgrading.",
      UA: "Відключення зупиняє лише подальшу синхронізацію — воно не видаляє метрики, витрати чи рядки виручки, які цей провайдер уже додав до вашого дашборду. Історичні графіки й підсумки продовжують показувати ці дані. Зупиняється лише надходження нових: більше не буде щогодинних синхронізацій, більше не оновлюватимуться маржа/CAC/прогнози з цього джерела.\n\nПовторне підключення того самого провайдера пізніше (той самий акаунт, новий ключ чи нове підтвердження OAuth) відновлює синхронізацію надалі; воно автоматично НЕ дозаповнює період, поки інтеграція була відключена, — див. \"Чи підтягує RIVANT історичні дані, чи лише з моменту підключення?\" про те, як працює заповнення історії при першому підключенні.\n\nВідключення також одразу звільняє слот інтеграції у вашому тарифі, тож можна підключити іншого провайдера на його місце без підвищення тарифу.",
      DE: "Das Trennen stoppt nur die zukünftige Synchronisierung — es löscht nicht die Kennzahlen, Ausgaben oder Umsatzzeilen, die dieser Anbieter bereits zu Ihrem Dashboard beigetragen hat. Historische Diagramme und Summen zeigen diese Daten weiterhin an. Was stoppt, ist das Eintreffen neuer Daten: keine stündlichen Synchronisierungen mehr, keine Aktualisierungen von Marge/CAC/Prognosen aus dieser Quelle mehr.\n\nWird derselbe Anbieter später erneut verbunden (gleiches Konto, neuer Schlüssel oder neue OAuth-Bestätigung), wird die Synchronisierung ab diesem Zeitpunkt fortgesetzt; der Zeitraum, in dem die Verbindung getrennt war, wird nicht automatisch nachgeladen — siehe \"Ruft RIVANT historische Daten ab oder nur ab dem Zeitpunkt der Verbindung?\" für die Funktionsweise der Nachladung bei der ersten Verbindung.\n\nDas Trennen gibt außerdem sofort den Integrationsplatz Ihres Tarifs frei, sodass Sie ohne Upgrade einen anderen Anbieter an dessen Stelle verbinden können.",
    },
  },
  {
    slug: "revenue-source-explained",
    category: "integrations",
    question: {
      EN: "Why am I forced to pick at least one payment/accounting integration?",
      UA: "Чому мене змушують обрати хоча б одну платіжну/облікову інтеграцію?",
      DE: "Warum muss ich mindestens eine Zahlungs-/Buchhaltungsintegration auswählen?",
    },
    answer: {
      EN: "Every number RIVANT shows — margin, profit, CAC, revenue drop alerts, daily and weekly reports — is calculated FROM revenue data. That revenue data only ever comes from six providers: Stripe, Shopify, WooCommerce, PayPal, Mollie, or QuickBooks. Meta Ads and Google Ads only supply ad-spend numbers, which are meaningless on their own without revenue to compare them against (that's exactly what CAC is — ad spend divided by customers acquired, from revenue).\n\nIf you try to save an integration selection that has zero revenue sources in it, the save is rejected with a message asking you to include at least one. An empty selection (nothing connected at all) is allowed — the restriction only applies once you've chosen at least one integration.",
      UA: "Кожна цифра, яку показує RIVANT, — маржа, прибуток, CAC, сповіщення про падіння виручки, щоденні й щотижневі звіти — рахується З даних про виручку. Ці дані про виручку надходять лише від шести провайдерів: Stripe, Shopify, WooCommerce, PayPal, Mollie або QuickBooks. Meta Ads і Google Ads дають лише цифри рекламних витрат, які самі по собі безглузді без виручки, з якою їх порівнювати (саме це і є CAC — рекламні витрати поділені на залучених клієнтів, з виручки).\n\nЯкщо ви спробуєте зберегти вибір інтеграцій, у якому немає жодного джерела виручки, збереження буде відхилено з повідомленням про необхідність додати хоча б одне. Порожній вибір (нічого не підключено взагалі) дозволений — обмеження діє лише після того, як ви обрали хоча б одну інтеграцію.",
      DE: "Jede Zahl, die RIVANT anzeigt — Marge, Gewinn, CAC, Umsatzrückgangs-Warnungen, tägliche und wöchentliche Berichte — wird AUS Umsatzdaten berechnet. Diese Umsatzdaten stammen ausschließlich von sechs Anbietern: Stripe, Shopify, WooCommerce, PayPal, Mollie oder QuickBooks. Meta Ads und Google Ads liefern nur Werbeausgaben-Zahlen, die allein ohne Umsatz zum Vergleich bedeutungslos sind (genau das ist CAC — Werbeausgaben geteilt durch gewonnene Kunden, aus dem Umsatz).\n\nWenn Sie versuchen, eine Integrationsauswahl zu speichern, die keine einzige Umsatzquelle enthält, wird das Speichern mit der Aufforderung abgelehnt, mindestens eine hinzuzufügen. Eine leere Auswahl (gar nichts verbunden) ist erlaubt — die Einschränkung gilt erst, sobald Sie mindestens eine Integration ausgewählt haben.",
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
  {
    slug: "manual-sync",
    category: "sync",
    question: {
      EN: "Is there a way to force a sync right now instead of waiting?",
      UA: "Чи можна примусово запустити синхронізацію зараз, не чекаючи?",
      DE: "Kann ich eine Synchronisierung sofort erzwingen, statt zu warten?",
    },
    answer: {
      EN: "Yes. On the Integrations tab, each connected provider's card has a \"Sync now\" button, and there's also a sync-all button for every connected integration at once. There's no cooldown timer on this — you can trigger it as often as you like, though there's rarely a reason to run it more than once right after making a change on the provider's side (a new order, a refund, an updated ad campaign) that you want reflected immediately.\n\nA manual sync runs the exact same logic as the automatic hourly one; it doesn't skip validation or fetch anything different, it just runs it on demand instead of waiting for the next scheduled cycle.",
      UA: "Так. На вкладці Інтеграції в картці кожного підключеного провайдера є кнопка \"Синхронізувати зараз\", а також є кнопка синхронізувати всі — одразу для всіх підключених інтеграцій. Таймера очікування (cooldown) тут немає — можна запускати так часто, як завгодно, хоча зазвичай сенс є лише запустити її одразу після того, як щось змінилось на боці провайдера (нове замовлення, повернення, оновлена рекламна кампанія), і ви хочете побачити це негайно.\n\nРучна синхронізація виконує ту саму логіку, що й автоматична щогодинна; вона не пропускає перевірки і не забирає щось інше — просто запускається за запитом, а не чекає наступного запланованого циклу.",
      DE: "Ja. Im Tab Integrationen hat die Karte jedes verbundenen Anbieters eine Schaltfläche \"Jetzt synchronisieren\", und es gibt auch eine Schaltfläche zum gleichzeitigen Synchronisieren aller verbundenen Integrationen. Es gibt dabei keine Abklingzeit — Sie können es so oft auslösen, wie Sie möchten, auch wenn es selten einen Grund gibt, es öfter als einmal direkt nach einer Änderung auf Seiten des Anbieters (eine neue Bestellung, eine Rückerstattung, eine aktualisierte Werbekampagne) auszuführen, die sofort widergespiegelt werden soll.\n\nEine manuelle Synchronisierung führt genau dieselbe Logik aus wie die automatische stündliche; sie überspringt keine Prüfungen und ruft nichts anderes ab — sie läuft nur auf Anfrage, statt auf den nächsten geplanten Zyklus zu warten.",
    },
  },
  {
    slug: "historical-backfill",
    category: "sync",
    question: {
      EN: "Does RIVANT pull in my historical data, or only data from the moment I connect?",
      UA: "Чи підтягує RIVANT мої історичні дані, чи лише дані з моменту підключення?",
      DE: "Ruft RIVANT meine historischen Daten ab oder nur Daten ab dem Zeitpunkt der Verbindung?",
    },
    answer: {
      EN: "When you connect a provider for the first time, its sync script pulls in past orders/transactions available through that provider's API (subject to whatever history that provider itself retains and exposes — this varies by provider and isn't something RIVANT controls). This gives your Overview and Forecast tabs meaningful charts from day one instead of starting at zero.\n\nAfter that initial backfill, every following sync only looks for new data since the last successful sync — it doesn't re-scan your entire history every hour. If you disconnect and later reconnect the same provider, whether the gap in between gets backfilled again depends on that provider's API and how far back it still exposes data by that point — it's not guaranteed.",
      UA: "Коли ви підключаєте провайдера вперше, його скрипт синхронізації підтягує минулі замовлення/транзакції, доступні через API цього провайдера (у межах того, скільки історії сам провайдер зберігає і надає — це залежить від провайдера і RIVANT це не контролює). Це дає вкладкам Огляд і Прогноз змістовні графіки з першого дня, а не з нуля.\n\nПісля цього початкового заповнення кожна наступна синхронізація шукає лише нові дані з моменту останньої успішної синхронізації — вона не пересканує всю історію щогодини заново. Якщо ви відключите і пізніше знову підключите того самого провайдера, чи заповниться прогалина між ними, залежить від API цього провайдера і того, наскільки глибоко він на той момент ще надає дані, — це не гарантовано.",
      DE: "Wenn Sie einen Anbieter zum ersten Mal verbinden, ruft dessen Sync-Skript vergangene Bestellungen/Transaktionen ab, die über die API dieses Anbieters verfügbar sind (abhängig davon, wie viel Historie der Anbieter selbst vorhält und offenlegt — das variiert je nach Anbieter und wird nicht von RIVANT gesteuert). Das gibt Ihren Tabs Übersicht und Prognose von Anfang an aussagekräftige Diagramme, statt bei null zu starten.\n\nNach dieser anfänglichen Nachladung sucht jede folgende Synchronisierung nur nach neuen Daten seit der letzten erfolgreichen Synchronisierung — sie durchsucht nicht jede Stunde erneut Ihre gesamte Historie. Wenn Sie einen Anbieter trennen und später erneut verbinden, hängt es von dessen API und davon ab, wie weit sie zu diesem Zeitpunkt noch zurückreicht, ob die Lücke dazwischen nachgeladen wird — das ist nicht garantiert.",
    },
  },
  {
    slug: "margin-calculation",
    category: "sync",
    question: {
      EN: "How exactly is margin/profit calculated — where do the costs come from?",
      UA: "Як саме рахується маржа/прибуток — звідки беруться витрати?",
      DE: "Wie genau wird Marge/Gewinn berechnet — woher stammen die Kosten?",
    },
    answer: {
      EN: "Profit and margin are revenue minus expenses for the same period. Revenue comes from your connected payment/accounting integrations (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks). Expenses come from two places: costs your connected storefront integrations write automatically on every sync (shipping costs and cost-of-goods-sold, when that provider exposes them — Shopify and WooCommerce do this), and anything you or a manual process has added directly to the expenses record.\n\nThis is exactly why a brand-new test account with only a couple of manually entered expense rows against real revenue can show an unrealistically high margin — the automatic cost data only starts flowing in once a real storefront integration is connected and syncing normally, and accumulates the more it syncs, not instantly.",
      UA: "Прибуток і маржа — це виручка мінус витрати за той самий період. Виручка надходить із ваших підключених платіжних/облікових інтеграцій (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks). Витрати надходять із двох джерел: витрати, які ваші підключені інтеграції-магазини автоматично записують під час кожної синхронізації (вартість доставки і собівартість товарів, коли провайдер це надає — Shopify і WooCommerce це роблять), і все, що ви чи ручний процес додали безпосередньо до запису витрат.\n\nСаме тому новий тестовий акаунт лише з кількома вручну доданими рядками витрат проти реальної виручки може показувати нереалістично високу маржу — автоматичні дані про витрати починають надходити лише коли реально підключена інтеграція-магазин синхронізується у звичайному режимі, і накопичуються поступово, а не миттєво.",
      DE: "Gewinn und Marge sind Umsatz minus Ausgaben für denselben Zeitraum. Der Umsatz stammt aus Ihren verbundenen Zahlungs-/Buchhaltungsintegrationen (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks). Die Ausgaben stammen aus zwei Quellen: Kosten, die Ihre verbundenen Shop-Integrationen bei jeder Synchronisierung automatisch schreiben (Versandkosten und Wareneinsatz, sofern der Anbieter diese offenlegt — Shopify und WooCommerce tun dies), und alles, was Sie oder ein manueller Prozess direkt zum Ausgabendatensatz hinzugefügt haben.\n\nGenau deshalb kann ein brandneues Testkonto mit nur ein paar manuell eingetragenen Ausgabenzeilen gegenüber echtem Umsatz eine unrealistisch hohe Marge zeigen — die automatischen Kostendaten fließen erst, sobald eine echte Shop-Integration verbunden ist und normal synchronisiert, und sammeln sich mit der Zeit an, nicht sofort.",
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
  {
    slug: "payment-methods",
    category: "billing",
    question: {
      EN: "What payment methods can I use, and how does each one work?",
      UA: "Якими способами оплати можна скористатись і як кожен з них працює?",
      DE: "Welche Zahlungsmethoden kann ich nutzen, und wie funktioniert jede davon?",
    },
    answer: {
      EN: "Two options are offered when you subscribe: Card / PayPal, and Crypto. Card / PayPal is processed through Ko-fi — choosing it opens a short confirmation screen explaining you're about to be redirected to Ko-fi's checkout, then opens Ko-fi in a new tab to complete the payment with a card or PayPal balance; your plan activates once that payment confirms on Ko-fi's side. Crypto generates a one-time invoice for a specific amount of USDC on the Polygon network — you send exactly that amount from your own wallet to the address shown, and the plan activates automatically once the payment is detected on-chain and matched to your order (usually within a few minutes, depending on network confirmation time).\n\nThe two methods are independent — you're not locked into one for renewals, and add-ons (see the next question) support the same two options.",
      UA: "Під час оформлення підписки пропонуються два варіанти: Картка / PayPal і Крипто. Картка / PayPal обробляється через Ko-fi — обравши цей варіант, ви побачите коротке підтвердження про те, що вас зараз перенаправить на оплату в Ko-fi, а тоді відкриється Ko-fi в новій вкладці для завершення оплати карткою чи балансом PayPal; ваш тариф активується, щойно ця оплата підтвердиться на боці Ko-fi. Крипто генерує одноразовий інвойс на конкретну суму USDC у мережі Polygon — ви надсилаєте саме цю суму зі свого гаманця на показану адресу, і тариф активується автоматично, щойно платіж виявлено в блокчейні й зіставлено з вашим замовленням (зазвичай протягом кількох хвилин, залежно від часу підтвердження мережі).\n\nЦі два способи незалежні — ви не прив'язані до одного для подальших оплат, і додатки (див. наступне питання) підтримують ті самі два варіанти.",
      DE: "Beim Abonnieren werden zwei Optionen angeboten: Karte / PayPal und Krypto. Karte / PayPal wird über Ko-fi abgewickelt — bei dieser Wahl sehen Sie einen kurzen Bestätigungsbildschirm, der erklärt, dass Sie gleich zur Ko-fi-Kasse weitergeleitet werden, und Ko-fi öffnet sich dann in einem neuen Tab, um die Zahlung per Karte oder PayPal-Guthaben abzuschließen; Ihr Tarif wird aktiviert, sobald diese Zahlung auf Ko-fi-Seite bestätigt ist. Krypto erzeugt eine einmalige Rechnung über einen bestimmten USDC-Betrag im Polygon-Netzwerk — Sie senden genau diesen Betrag von Ihrer eigenen Wallet an die angezeigte Adresse, und der Tarif wird automatisch aktiviert, sobald die Zahlung on-chain erkannt und Ihrer Bestellung zugeordnet wurde (meist innerhalb weniger Minuten, abhängig von der Bestätigungszeit des Netzwerks).\n\nDie beiden Methoden sind unabhängig voneinander — Sie sind für Folgezahlungen nicht an eine gebunden, und Add-ons (siehe nächste Frage) unterstützen dieselben zwei Optionen.",
    },
  },
  {
    slug: "addons",
    category: "billing",
    question: {
      EN: "What are the paid add-ons, and how are they different from a plan upgrade?",
      UA: "Що таке платні додатки і чим вони відрізняються від підвищення тарифу?",
      DE: "Was sind die kostenpflichtigen Add-ons, und wie unterscheiden sie sich von einem Tarif-Upgrade?",
    },
    answer: {
      EN: "There are three add-ons, purchasable on top of any plan, independent of which tier you're on: AI Historical Analysis ($199, one-time) runs a deep retrospective look across your full connected history; AI Performance Digest ($49/month) sends a more detailed, AI-written summary report in addition to the regular digest; Team Alert Access ($29/month) lets invited team members receive risk alerts themselves rather than only the account owner seeing them.\n\nUnlike a plan upgrade, add-ons don't change your integration slot count — they add a specific capability on top of whatever plan you're already on. The one-time add-on activates as soon as payment confirms and doesn't renew; the two subscription add-ons renew on a rolling monthly period from the date purchased and can be cancelled from Settings without affecting your main plan.",
      UA: "Є три додатки, які можна придбати поверх будь-якого тарифу, незалежно від того, на якому рівні ви перебуваєте: AI Historical Analysis ($199, одноразово) — робить глибокий ретроспективний аналіз усієї вашої підключеної історії; AI Performance Digest ($49/місяць) — надсилає детальніший, написаний ШІ підсумковий звіт на додачу до звичайного дайджесту; Team Alert Access ($29/місяць) — дозволяє запрошеним учасникам команди самим отримувати сповіщення про ризики, а не лише власнику акаунта.\n\nНа відміну від підвищення тарифу, додатки не змінюють кількість слотів інтеграцій — вони додають конкретну можливість поверх того тарифу, який у вас уже є. Одноразовий додаток активується одразу після підтвердження оплати і не поновлюється; два додатки-підписки поновлюються щомісяця з дати покупки і можуть бути скасовані в Налаштуваннях, не впливаючи на ваш основний тариф.",
      DE: "Es gibt drei Add-ons, die zusätzlich zu jedem Tarif erworben werden können, unabhängig davon, auf welcher Stufe Sie sich befinden: AI Historical Analysis (199 $, einmalig) führt eine tiefgehende retrospektive Analyse über Ihre gesamte verbundene Historie durch; AI Performance Digest (49 $/Monat) sendet zusätzlich zum regulären Digest einen detaillierteren, von KI verfassten Zusammenfassungsbericht; Team Alert Access (29 $/Monat) ermöglicht es eingeladenen Teammitgliedern, Risikowarnungen selbst zu erhalten, statt dass nur der Kontoinhaber sie sieht.\n\nAnders als ein Tarif-Upgrade ändern Add-ons nicht die Anzahl Ihrer Integrationsplätze — sie fügen eine bestimmte Fähigkeit zu Ihrem bestehenden Tarif hinzu. Das einmalige Add-on wird sofort nach Zahlungsbestätigung aktiviert und erneuert sich nicht; die beiden Abonnement-Add-ons erneuern sich monatlich ab dem Kaufdatum und können in den Einstellungen gekündigt werden, ohne Ihren Haupttarif zu beeinflussen.",
    },
  },
  {
    slug: "team-access",
    category: "billing",
    question: {
      EN: "Can I invite team members, and what can they see?",
      UA: "Чи можна запросити учасників команди і що вони можуть бачити?",
      DE: "Kann ich Teammitglieder einladen, und was können sie sehen?",
    },
    answer: {
      EN: "Yes — from Settings, you can generate an invite link and send it to teammates; up to 10 members can be connected per account through that link. By default, inviting someone gives them visibility into the dashboard, not the ability to receive risk alerts directly — that requires the Team Alert Access add-on (see the previous question), which turns on real alert delivery to invited members instead of only the account owner.\n\nRemoving a team member's access is done from the same Settings screen at any time and takes effect immediately.",
      UA: "Так — у Налаштуваннях можна згенерувати посилання-запрошення й надіслати колегам; за цим посиланням до одного акаунта можна підключити до 10 учасників. За замовчуванням запрошення дає видимість дашборду, але не можливість самим отримувати сповіщення про ризики — для цього потрібен додаток Team Alert Access (див. попереднє питання), який вмикає реальну доставку сповіщень запрошеним учасникам, а не лише власнику акаунта.\n\nПрибрати доступ учасника команди можна будь-коли з того самого екрана Налаштувань, це набуває чинності негайно.",
      DE: "Ja — in den Einstellungen können Sie einen Einladungslink generieren und ihn an Teamkollegen senden; über diesen Link können bis zu 10 Mitglieder pro Konto verbunden werden. Standardmäßig gibt eine Einladung Einsicht ins Dashboard, aber nicht die Möglichkeit, selbst Risikowarnungen zu erhalten — dafür ist das Add-on Team Alert Access nötig (siehe vorherige Frage), das die tatsächliche Zustellung von Warnungen an eingeladene Mitglieder statt nur an den Kontoinhaber aktiviert.\n\nDer Zugriff eines Teammitglieds kann jederzeit im selben Einstellungsbildschirm entfernt werden und wirkt sich sofort aus.",
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
  {
    slug: "resolve-risk",
    category: "notifications",
    question: {
      EN: "What happens when I dismiss a risk with the X button — does it come back?",
      UA: "Що відбувається, коли я закриваю ризик кнопкою X — чи повернеться він?",
      DE: "Was passiert, wenn ich ein Risiko mit der X-Schaltfläche schließe — kommt es zurück?",
    },
    answer: {
      EN: "Dismissing a risk marks it resolved and moves it from the Active list to History on the Risks tab — it's not deleted, just archived where you can still review it later. It does not fix the underlying issue by itself: if the cause is still there (an integration still has bad credentials, revenue is still down), the same condition can trigger a new alert on a future sync, since each alert is generated from the current state of your data, not remembered as \"already told them.\"\n\nThere's no undo for dismissing — if you want to keep an eye on something a bit longer, it's safer to leave it active and use the category filter to declutter your view instead.",
      UA: "Закриття ризику позначає його вирішеним і переносить зі списку Активні в Історію на вкладці Ризики — він не видаляється, а лише архівується, і ви все ще можете переглянути його пізніше. Це саме по собі НЕ виправляє причину: якщо проблема все ще існує (в інтеграції досі неправильні облікові дані, виручка досі знижена), та сама умова може викликати нове сповіщення при наступній синхронізації, бо кожне сповіщення генерується з поточного стану ваших даних, а не запам'ятовується як \"вже повідомили\".\n\nСкасувати закриття неможливо — якщо хочете ще трохи поспостерігати за чимось, безпечніше лишити його активним і скористатись фільтром категорій, щоб розвантажити перегляд.",
      DE: "Das Schließen eines Risikos markiert es als gelöst und verschiebt es von der Liste Aktiv in den Verlauf im Tab Risiken — es wird nicht gelöscht, sondern nur archiviert, sodass Sie es später noch einsehen können. Dies behebt die zugrunde liegende Ursache nicht von selbst: Wenn die Ursache noch besteht (eine Integration hat immer noch falsche Zugangsdaten, der Umsatz ist immer noch gesunken), kann derselbe Zustand bei einer künftigen Synchronisierung eine neue Warnung auslösen, da jede Warnung aus dem aktuellen Zustand Ihrer Daten erzeugt wird, nicht als \"bereits mitgeteilt\" gemerkt wird.\n\nEs gibt kein Rückgängigmachen beim Schließen — wenn Sie etwas noch etwas länger im Blick behalten möchten, ist es sicherer, es aktiv zu lassen und stattdessen den Kategoriefilter zu nutzen, um die Ansicht zu entrümpeln.",
    },
  },
  {
    slug: "severity-levels",
    category: "notifications",
    question: {
      EN: "What do the Critical / High / Medium / Low labels on a risk mean?",
      UA: "Що означають мітки Critical / High / Medium / Low на ризику?",
      DE: "Was bedeuten die Kennzeichnungen Critical / High / Medium / Low bei einem Risiko?",
    },
    answer: {
      EN: "It's how significant the underlying change is estimated to be, based on the size of the swing and, for revenue/margin risks, roughly how much it could be costing you. Critical and High both render with a red badge and are worth checking the same day — the distinction between them is mostly about magnitude. Medium (yellow) is worth a look but rarely urgent on its own. Low (blue) is informational — a change worth being aware of, without it necessarily indicating a problem.\n\nThe Alert Sensitivity setting (see Getting started) changes how easily an alert gets created in the first place, but doesn't change how severity is labeled once one exists.",
      UA: "Це оцінка того, наскільки значуща зміна лежить в основі — залежно від розміру коливання і, для ризиків виручки/маржі, приблизно того, скільки це може вам коштувати. Critical і High обидва позначаються червоним і варті перегляду того ж дня — різниця між ними здебільшого в масштабі. Medium (жовтий) варто переглянути, але сам по собі рідко терміновий. Low (синій) — інформаційний, зміна, про яку варто знати, не обов'язково проблема.\n\nНалаштування Alert Sensitivity (див. Початок роботи) змінює, наскільки легко сповіщення взагалі створюється, але не змінює, як позначається серйозність уже створеного.",
      DE: "Es zeigt, wie bedeutend die zugrunde liegende Änderung eingeschätzt wird — basierend auf der Größe der Schwankung und, bei Umsatz-/Margenrisiken, ungefähr, wie viel es Sie kosten könnte. Critical und High werden beide rot dargestellt und sind noch am selben Tag einen Blick wert — der Unterschied zwischen ihnen liegt vor allem im Ausmaß. Medium (gelb) lohnt einen Blick, ist aber allein selten dringend. Low (blau) ist informativ — eine Änderung, über die man Bescheid wissen sollte, aber nicht zwingend ein Problem.\n\nDie Einstellung Alarmempfindlichkeit (siehe Erste Schritte) ändert, wie leicht überhaupt eine Warnung erstellt wird, ändert aber nicht, wie der Schweregrad einer bereits erstellten Warnung gekennzeichnet wird.",
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
  {
    slug: "2fa",
    category: "privacy",
    question: {
      EN: "How does two-factor authentication work, and is it required?",
      UA: "Як працює двофакторна автентифікація і чи вона обов'язкова?",
      DE: "Wie funktioniert die Zwei-Faktor-Authentifizierung, und ist sie verpflichtend?",
    },
    answer: {
      EN: "It's optional and off by default. Turning it on from Settings → Security shows a QR code to scan with any standard authenticator app (Google Authenticator, Authy, etc.) and asks you to confirm with a generated code before it's actually enabled — this confirms the app is correctly synced before you rely on it. Once on, logging in requires that current code in addition to your password.\n\nYou can disable it again from the same screen at any time. If you lose access to your authenticator app while 2FA is enabled, that's a case for contacting support directly — there isn't a self-serve backup-code flow in the product at this time, so it's worth keeping your authenticator app's own backup/recovery method set up on your side.",
      UA: "Вона необов'язкова і вимкнена за замовчуванням. Увімкнення в Налаштування → Безпека показує QR-код для сканування будь-яким стандартним застосунком-автентифікатором (Google Authenticator, Authy тощо) і просить підтвердити згенерованим кодом, перш ніж вона реально увімкнеться, — це підтверджує, що застосунок правильно синхронізовано, перш ніж на нього покладатись. Після увімкнення вхід вимагає цей поточний код на додачу до пароля.\n\nВимкнути можна будь-коли з того самого екрана. Якщо ви втратили доступ до застосунку-автентифікатора, поки 2FA увімкнена, — це випадок для звернення напряму в підтримку: наразі в продукті немає самообслуговуваного потоку резервних кодів, тож варто мати налаштований власний механізм резервного відновлення самого застосунку-автентифікатора.",
      DE: "Sie ist optional und standardmäßig deaktiviert. Das Aktivieren unter Einstellungen → Sicherheit zeigt einen QR-Code zum Scannen mit einer beliebigen Standard-Authenticator-App (Google Authenticator, Authy usw.) und bittet um Bestätigung mit einem generierten Code, bevor sie tatsächlich aktiviert wird — das bestätigt, dass die App korrekt synchronisiert ist, bevor Sie sich darauf verlassen. Nach der Aktivierung erfordert die Anmeldung diesen aktuellen Code zusätzlich zu Ihrem Passwort.\n\nSie können sie jederzeit im selben Bildschirm wieder deaktivieren. Wenn Sie bei aktivierter 2FA den Zugriff auf Ihre Authenticator-App verlieren, ist das ein Fall für die direkte Kontaktaufnahme mit dem Support — derzeit gibt es im Produkt keinen Selbstbedienungs-Ablauf für Backup-Codes, daher lohnt es sich, die eigene Backup-/Wiederherstellungsmethode der Authenticator-App eingerichtet zu haben.",
    },
  },
  {
    slug: "read-only-access",
    category: "privacy",
    question: {
      EN: "Can RIVANT move money, change my store, or edit my accounting records?",
      UA: "Чи може RIVANT переказувати гроші, змінювати мій магазин чи редагувати бухгалтерські записи?",
      DE: "Kann RIVANT Geld bewegen, meinen Shop ändern oder meine Buchhaltungsdaten bearbeiten?",
    },
    answer: {
      EN: "No. Every integration — whether connected with an API key or through OAuth — is requested with read-only permissions only. RIVANT pulls in orders, transactions, and account data to calculate your metrics; it has no code path that issues refunds, charges customers, edits product listings, changes prices, or writes anything back to Stripe, Shopify, PayPal, QuickBooks, or any other connected provider.\n\nIf you ever see something in your own provider account you didn't do, it wasn't RIVANT — check that provider's own access log for what app or key made the change, since your credentials could be shared with something else entirely.",
      UA: "Ні. Кожна інтеграція — чи то підключена через API-ключ, чи через OAuth — запитується лише з правами на читання. RIVANT підтягує замовлення, транзакції й дані акаунта, щоб рахувати ваші метрики; у ньому немає жодного коду, який робить повернення коштів, списує з клієнтів, редагує картки товарів, змінює ціни чи записує щось назад у Stripe, Shopify, PayPal, QuickBooks чи будь-якого іншого підключеного провайдера.\n\nЯкщо колись побачите у власному кабінеті провайдера щось, чого ви не робили, — це не RIVANT: перевірте власний лог доступу цього провайдера, який застосунок чи ключ зробив зміну, бо ваші облікові дані могли бути використані десь ще.",
      DE: "Nein. Jede Integration — ob mit API-Schlüssel oder über OAuth verbunden — wird nur mit Lesezugriff angefragt. RIVANT ruft Bestellungen, Transaktionen und Kontodaten ab, um Ihre Kennzahlen zu berechnen; es gibt keinen Codepfad, der Rückerstattungen ausstellt, Kunden belastet, Produktlisten bearbeitet, Preise ändert oder irgendetwas an Stripe, Shopify, PayPal, QuickBooks oder einen anderen verbundenen Anbieter zurückschreibt.\n\nWenn Sie jemals in Ihrem eigenen Anbieterkonto etwas sehen, das Sie nicht getan haben, war das nicht RIVANT — prüfen Sie das eigene Zugriffsprotokoll dieses Anbieters, welche App oder welcher Schlüssel die Änderung vorgenommen hat, da Ihre Zugangsdaten möglicherweise mit etwas ganz anderem geteilt wurden.",
    },
  },
];

export function getFaqArticle(slug: string): FaqArticle | undefined {
  return FAQ_ARTICLES.find((a) => a.slug === slug);
}