-- ============================================================
-- Пометить мёртвые колонки users как deprecated — 28.08.2026
--
-- users.has_active_subscription и users.subscription_expires_at нигде в
-- коде (app/, lib/, src/, scripts/) не читаются и не пишутся — реальный
-- источник правды это subscriptions.access_status/current_period_end
-- (см. RIVANT-audit-3-preLaunch.md, п.4). Сами колонки НЕ удаляем DROP'ом
-- — это безопаснее (вдруг где-то есть внешняя интеграция/BI-отчёт,
-- который их читает напрямую из БД в обход кода репозитория), но явно
-- помечаем их как deprecated прямо в схеме, чтобы следующий человек
-- (или ты сам через полгода) не начал по ошибке на них полагаться.
-- ============================================================

comment on column "public"."users"."has_active_subscription" is
  'DEPRECATED — не используется нигде в коде. Реальный источник правды: subscriptions.access_status. См. RIVANT-audit-3-preLaunch.md п.4.';

comment on column "public"."users"."subscription_expires_at" is
  'DEPRECATED — не используется нигде в коде. Реальный источник правды: subscriptions.current_period_end. См. RIVANT-audit-3-preLaunch.md п.4.';