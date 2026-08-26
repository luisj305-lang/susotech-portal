"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { IconBell } from "@/components/ui/icons";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

export function NotificationsBell() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);
      if (!cancelled && data) setItems(data as Notification[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!userId) return null;

  const unread = items.filter((item) => !item.read_at).length;

  const markRead = async (item: Notification) => {
    if (!item.read_at) {
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, read_at: now } : entry,
        ),
      );
      await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", item.id);
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((entry) => ({ ...entry, read_at: entry.read_at ?? now })),
    );
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Notificaciones"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-full border border-line bg-white p-2.5 text-ink-soft"
      >
        <IconBell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand-900 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-line bg-white shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Notificaciones</h2>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs font-medium text-accent-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Marcar todas como leídas
            </button>
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              No tienes notificaciones
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(item)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-surface-muted",
                      item.read_at ? "bg-transparent" : "bg-brand-50",
                    )}
                  >
                    <p
                      className={cn(
                        "text-sm text-ink",
                        item.read_at ? "font-medium" : "font-semibold",
                      )}
                    >
                      {item.title}
                    </p>
                    {item.body ? (
                      <p className="mt-0.5 text-xs text-ink-soft">{item.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {relativeTime(item.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
