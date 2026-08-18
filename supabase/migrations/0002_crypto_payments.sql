-- ============================================================
-- Дедуп Telegram-алертов для участников команды — ОТДЕЛЬНО от
-- дедупа владельца в alerts_log.
--
-- Раньше (см. lib/alerts.mjs, sendAlertToBusiness) фан-аут команде вообще
-- не выполнялся, если владельцу sendAlert() не отправил сообщение из-за
-- собственного дедупа (тот же type за последние cooldownHours). Это верно
-- защищало владельца от спама, но полностью блокировало доставку команде,
-- в том числе когда участник физически ещё не видел это сообщение —
-- например, его пригласили в команду (или подключили допуслугу "Сповіщення
-- для команди") уже ПОСЛЕ того, как алерт ушёл владельцу в текущем окне.
--
-- Дедуп должен защищать конкретного получателя от повторной отправки, а не
-- одного получателя (владельца) от всех остальных. Поэтому у команды теперь
-- свой собственный дедуп — по паре (business_id, telegram_id, type) — не
-- зависящий от того, получил ли уже это сообщение владелец.
create table if not exists public.team_alert_deliveries (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  telegram_id  text not null,
  type         text not null,
  sent_at      timestamptz not null default now()
);

-- Основной паттерн запроса: "отправляли ли ЭТОМУ получателю ЭТОТ type
-- за последние N часов" — business_id + telegram_id + type, отсортировано
-- по sent_at.
create index if not exists team_alert_deliveries_lookup_idx
  on public.team_alert_deliveries (business_id, telegram_id, type, sent_at desc);

alter table public.team_alert_deliveries enable row level security;
-- Никаких публичных policy — таблица служебная, пишется/читается только
-- из крон-скриптов через service_role (как sendAlertToBusiness в lib/alerts.mjs).
