import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  getTransporterMessages,
  getMyTransporterProfile,
  getTransporters,
  saveMyTransporterProfile,
  sendTransporterMessage,
} from "../api";
import type {
  AuthUser,
  TransporterConversation,
  TransporterListing,
  TransporterMessage,
  TransporterProfile,
} from "../api";
import { useTranslation } from "../i18n";

const emptyProfile: TransporterProfile = {
  display_name: "",
  contact_phone: "",
  vehicle_type: "",
  capacity_kg: 0,
  service_counties: "",
  details: "",
  available: true,
  contact_consent: false,
};

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") || digits.length > 10) return digits;
  return `254${digits}`;
}

interface Props {
  user: AuthUser;
  canManage: boolean;
  onSignIn: () => void;
}

export default function Transport({ user, canManage, onSignIn }: Props) {
  const { t } = useTranslation();
  const [county, setCounty] = useState("");
  const [transporters, setTransporters] = useState<TransporterListing[]>([]);
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conversations, setConversations] = useState<TransporterConversation[]>([]);
  const [selectedChat, setSelectedChat] = useState<{
    transporterId: number;
    requesterId?: number;
    title: string;
  }>();
  const [chatMessages, setChatMessages] = useState<TransporterMessage[]>([]);
  const [chatBody, setChatBody] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const reloadTransporterConversations = (transporterId: number) =>
    getTransporterMessages(transporterId)
      .then((items) => {
        setConversations(
          items.filter(
            (item): item is TransporterConversation =>
              "requester_name" in item,
          ),
        );
      })
      .catch((cause: unknown) =>
        setError(
          "Could not load transport conversations: " +
            (cause instanceof Error ? cause.message : String(cause)),
        ),
      );

  useEffect(() => {
    setLoading(true);
    setError("");
    getTransporters(county)
      .then(setTransporters)
      .catch((cause: unknown) => {
        setError(
          "Could not load transporters: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      })
      .finally(() => setLoading(false));
  }, [county]);

  useEffect(() => {
    if (!canManage) return;
    getMyTransporterProfile()
      .then((currentProfile) => {
        if (currentProfile) {
          setProfile(currentProfile);
          if (currentProfile.id) {
            void reloadTransporterConversations(currentProfile.id);
          }
        }
      })
      .catch((cause: unknown) => {
        setError(
          "Could not load your transporter profile: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, [canManage]);

  useEffect(() => {
    if (!selectedChat) return;
    let active = true;
    const refresh = () =>
      getTransporterMessages(
        selectedChat.transporterId,
        selectedChat.requesterId,
      )
        .then((items) => {
          if (active) {
            setChatMessages(
              items.filter(
                (item): item is TransporterMessage => "sender_id" in item,
              ),
            );
            setError("");
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(
              "Could not load transport messages: " +
                (cause instanceof Error ? cause.message : String(cause)),
            );
          }
        });
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedChat]);

  const sendChatMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedChat || !chatBody.trim()) return;
    setChatBusy(true);
    setError("");
    try {
      await sendTransporterMessage(
        selectedChat.transporterId,
        chatBody,
        selectedChat.requesterId,
      );
      setChatBody("");
      const updated = await getTransporterMessages(
        selectedChat.transporterId,
        selectedChat.requesterId,
      );
      setChatMessages(
        updated.filter(
          (item): item is TransporterMessage => "sender_id" in item,
        ),
      );
      if (selectedChat.requesterId && profile.id) {
        await reloadTransporterConversations(profile.id);
      }
    } catch (cause) {
      setError(
        "Could not send transport message: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setChatBusy(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveMyTransporterProfile(profile);
      const savedProfile = await getMyTransporterProfile();
      if (savedProfile) {
        setProfile(savedProfile);
        if (savedProfile.id) {
          await reloadTransporterConversations(savedProfile.id);
        }
      }
      setMessage(
        profile.available
          ? "Your transporter profile is now listed."
          : "Your profile is saved and hidden from the directory.",
      );
      setTransporters(await getTransporters(county));
    } catch (cause) {
      setError(
        "Could not save your transporter profile: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setSaving(false);
    }
  };

  const transporterProfileId = profile.id;

  return (
    <section>
      <h2>{t("Produce transport")}</h2>
      <p className="mut">
        Find transporters by service county and contact them directly to discuss
        availability, price, and produce handling.
      </p>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}

      <label className="form-field">
        Filter by service county
        <input
          value={county}
          onChange={(event) => setCounty(event.target.value)}
          placeholder="e.g. Nakuru"
        />
      </label>

      {loading ? (
        <p className="mut">        {t("Loading transporters…")}</p>
      ) : transporters.length ? (
        <div className="grid">
          {transporters.map((transporter) => (
            <article className="card" key={transporter.id}>
              <h3>{transporter.display_name}</h3>
              <p>{transporter.vehicle_type}</p>
              <p className="mut">
                {t("Load capacity (kg)")}: {transporter.capacity_kg.toLocaleString()}
              </p>
              <p className="mut">
                {t("Service counties (comma-separated)")}: {transporter.service_counties}
              </p>
              {transporter.details && <p>{transporter.details}</p>}
              <a
                className="btn g"
                href={`https://wa.me/${whatsappNumber(transporter.contact_phone)}?text=${encodeURIComponent(
                  "Hello, I found your transport service on Mkulima Connect. Are you available to transport produce?",
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Contact on WhatsApp")}
              </a>
            </article>
          ))}
        </div>
      ) : (
        <p className="mut">
          {t("No available transporters found")}{county ? ` for ${county}` : ""}. Try
          another county or check back later.
        </p>
      )}

      {transporterProfileId && conversations.length > 0 && (
        <section className="transport-inbox">
          <h3>{t("Transport messages")}</h3>
          <div className="dashboard-actions">
            {conversations.map((conversation) => (
              <button
                className="card dashboard-action"
                key={conversation.requester_id}
                type="button"
                onClick={() =>
                  setSelectedChat({
                    transporterId: transporterProfileId,
                    requesterId: conversation.requester_id,
                    title: conversation.requester_name,
                  })
                }
              >
                <b>{conversation.requester_name}</b>
                <span className="mut">
                  {t("Last message")}: {new Date(conversation.last_message_at).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {selectedChat && (
        <section className="card transport-chat">
          <div className="row">
            <h3>{t("Conversation with")} {selectedChat.title}</h3>
            <button
              className="btn"
              type="button"
              onClick={() => setSelectedChat(undefined)}
            >
              {t("Close")}
            </button>
          </div>
          <div className="chat-log" aria-live="polite">
            {chatMessages.map((chatMessage) => (
              <article
                className={`chat-message ${chatMessage.sender_id === user.id ? "mine" : ""}`}
                key={chatMessage.id}
              >
                <p>{chatMessage.body}</p>
                <time className="mut">{new Date(chatMessage.created_at).toLocaleString()}</time>
              </article>
            ))}
            {!chatMessages.length && (
              <p className="mut">{t("No transport messages yet. Start the conversation.")}</p>
            )}
          </div>
          <form className="chat-compose" onSubmit={(event) => void sendChatMessage(event)}>
            <label className="form-field">
              {t("Message")}
              <textarea
                required
                maxLength={1000}
                value={chatBody}
                onChange={(event) => setChatBody(event.target.value)}
              />
            </label>
            <button className="btn g" type="submit" disabled={chatBusy}>
              {chatBusy ? t("Please wait…") : t("Send message")}
            </button>
          </form>
        </section>
      )}

      <section className="transport-register">
        <h3>{t("Offer transport services")}</h3>
        {canManage ? (
          <form className="card product-form" onSubmit={(event) => void save(event)}>
            <label className="form-field">
              {t("Display name")}
              <input
                required
                minLength={2}
                maxLength={100}
                value={profile.display_name}
                onChange={(event) =>
                  setProfile({ ...profile, display_name: event.target.value })
                }
              />
            </label>
            <label className="form-field">
              {t("WhatsApp phone number")}
              <input
                required
                type="tel"
                minLength={7}
                maxLength={30}
                value={profile.contact_phone}
                onChange={(event) =>
                  setProfile({ ...profile, contact_phone: event.target.value })
                }
                placeholder="e.g. 0712345678"
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                {t("Vehicle type")}
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={profile.vehicle_type}
                  onChange={(event) =>
                    setProfile({ ...profile, vehicle_type: event.target.value })
                  }
                  placeholder="e.g. pickup, lorry"
                />
              </label>
              <label className="form-field">
                {t("Load capacity (kg)")}
                <input
                  required
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  value={profile.capacity_kg || ""}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      capacity_kg: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              {t("Service counties (comma-separated)")}
              <input
                required
                minLength={2}
                maxLength={500}
                value={profile.service_counties}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    service_counties: event.target.value,
                  })
                }
                placeholder="e.g. Kiambu, Nakuru"
              />
            </label>
            <label className="form-field">
              {t("Additional details")}
              <textarea
                maxLength={1000}
                value={profile.details}
                onChange={(event) =>
                  setProfile({ ...profile, details: event.target.value })
                }
                placeholder="Availability, produce handling, or other useful details"
              />
            </label>
            <label className="form-field">
              <span>
                <input
                  type="checkbox"
                  checked={profile.available}
                  onChange={(event) =>
                    setProfile({ ...profile, available: event.target.checked })
                  }
                />{" "}
                {t("Available for new transport jobs")}
              </span>
            </label>
            <label className="form-field">
              <span>
                <input
                  required={profile.available}
                  type="checkbox"
                  checked={profile.contact_consent}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      contact_consent: event.target.checked,
                    })
                  }
                />{" "}
                {t("I agree to show this phone number to visitors while my listing is")}
                available.
              </span>
            </label>
            <button className="btn g" disabled={saving}>
              {saving ? "Saving…" : t("Save transport profile")}
            </button>
          </form>
        ) : (
          <div className="card">
            <p>
              {t("Sign in with a buyer or farmer account to publish and manage a")}
              transporter listing.
            </p>
            <button className="btn g" onClick={onSignIn}>
              {t("Sign in to list transport")}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
