import { useCallback, useEffect, useState } from "react";
import {
  getAppNotifications,
  markAppNotificationRead,
} from "./api";
import type { AppNotification } from "./api";
import { useTranslation } from "./i18n";

export default function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setNotifications(await getAppNotifications());
      setError("");
    } catch (cause) {
      setError(
        "Could not load notifications: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const markRead = async (notification: AppNotification) => {
    if (notification.read_at) return;
    try {
      await markAppNotificationRead(notification.id);
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      );
    } catch (cause) {
      setError(
        "Could not mark notification read: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const unreadCount = notifications.filter(
    (notification) => !notification.read_at,
  ).length;

  return (
    <div className="notification-center">
      <button
        className="notification-toggle"
        type="button"
        aria-label={`${t("Notifications")}${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg
          className="notification-icon"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        <span className="notification-label">{t("Notifications")}</span>
        {unreadCount > 0 && (
          <span className="notification-count">{unreadCount}</span>
        )}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Notifications">
          <div className="notification-panel-heading">
            <b>{t("Notifications")}</b>
            <button
              type="button"
              className="whatsapp-close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {error && <p className="notice error">{error}</p>}
          {!error && notifications.length === 0 && (
            <p className="mut">{t("You’re all caught up.")}</p>
          )}
          {notifications.map((notification) => (
            <button
              type="button"
              className={`notification-item${notification.read_at ? "" : " unread"}`}
              key={notification.id}
              onClick={() => {
                void markRead(notification);
                if (notification.category === "offtake") {
                  window.location.hash = "offtake";
                  setOpen(false);
                }
              }}
            >
              <b>{notification.title}</b>
              <span>{notification.body}</span>
              <small className="mut">
                {new Date(notification.created_at).toLocaleString()}
              </small>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
