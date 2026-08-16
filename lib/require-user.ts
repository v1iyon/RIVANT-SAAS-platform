// lib/require-user.ts
//
// Единая точка проверки, что запрос к API делает реально залогиненный
// пользователь, а не кто угодно, кто просто прислал чужой email/userId в
// теле запроса или query-параметре.
//
// Раньше почти каждый роут делал вид, что email/userId из body/query — это
// и есть личность вызывающего, и шёл с ним прямо в service_role-клиент
// (в обход RLS). Это значит, что зная (или подобрав) чужой email, можно
// было curl'ом получить/изменить/удалить чужие данные без какого-либо
// входа в аккаунт. См. п. 1.1 аудита.
//
// getSessionUser() читает реальную сессию Supabase Auth из cookies запроса
// (их пишет lib/supabase-browser.ts через @supabase/ssr на клиенте) и
// возвращает email/id ТОЛЬКО того, кто сейчас аутентифицирован в браузере,
// делавшем запрос. Роуты обязаны использовать email/id отсюда вместо
// значений из body/query.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export type SessionUser = {
  id: string;
  email: string;
};

// Возвращает текущего пользователя сессии или null, если сессии нет /
// она невалидна. Ничего не выбрасывает — удобно там, где нужна мягкая
// проверка (например, роут сам решает, что ответить).
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // Роуты ниже только читают сессию, ничего в неё не пишут —
        // обновлять/ротировать cookies отсюда не нужно.
        setAll() {},
      },
    }
  );

  // auth.getUser() (в отличие от getSession()) ходит в Supabase Auth и
  // проверяет токен на сервере, а не просто читает то, что лежит в
  // cookie — это важно именно тут, где cookie теоретически можно
  // подделать/переиграть.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    return null;
  }

  return { id: user.id, email: user.email };
}

// То же самое, но бросает UnauthorizedError, если сессии нет — удобно
// для роутов, где без пользователя делать вообще нечего (почти все).
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export function unauthorizedResponse() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}