import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  archiveConversation,
  blockConversation,
  createConversation,
  getConversationMessages,
  getConversations,
  reportConversation,
  sendListingMessage,
  unblockConversation,
} from "../api";
import type {
  AuthUser,
  ConversationMessage,
  FarmConversation,
} from "../api";
import { useTranslation } from "../i18n";

interface Props {
  initialProductId?: number;
  onInitialProductHandled: () => void;
  user: AuthUser;
}

const quickReplies = [
  "Is this available?",
  "What is your price?",
  "Can you deliver to my location?",
];

export default function Chat({
  initialProductId,
  onInitialProductHandled,
  user,
}: Props) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState<FarmConversation[]>([]);
  const [conversationId, setConversationId] = useState<number>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [body, setBody] = useState("");
  const [quantity, setQuantity] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const loadConversations = async () => {
      let phase: "load" | "create" = "load";
      try {
        let available = await getConversations();
        if (initialProductId && user.role === "buyer") {
          let selected = available.find(
            (item) => item.product_id === initialProductId,
          );
          if (!selected) {
            phase = "create";
            selected = await createConversation(initialProductId);
            available = [selected, ...available];
          }
          if (active) {
            setConversationId(selected.id);
            onInitialProductHandled();
          }
        } else if (active && available.length > 0) {
          setConversationId((current) =>
            current && available.some((item) => item.id === current)
              ? current
              : available[0].id,
          );
        }
        if (active) {
          setConversations(available);
          setError("");
        }
      } catch (cause) {
        if (active) {
          setError(
            `${phase === "create" ? "Could not start conversation: " : "Could not load conversations: "}` +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      }
    };
    void loadConversations();
    const interval = window.setInterval(() => void loadConversations(), 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [initialProductId, onInitialProductHandled, user.id, user.role]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let active = true;
    const refresh = () =>
      getConversationMessages(conversationId)
        .then((result) => {
          if (active) {
            setMessages(result);
            setError("");
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(
              "Could not load messages: " +
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
  }, [conversationId]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const activeConversation = conversations.find(
      (item) => item.id === conversationId,
    );
    if (!activeConversation || !body.trim()) return;

    const isFirstBuyerMessage = user.role === "buyer" && messages.length === 0;
    const activeConversationId = activeConversation.id;
    if (isFirstBuyerMessage && (!quantity.trim() || !location.trim())) {
      setError("Enter a quantity and delivery location for your enquiry.");
      return;
    }
    const messageBody = isFirstBuyerMessage
      ? [
          `Quantity: ${quantity.trim()} ${activeConversation.unit}`,
          `Preferred delivery: ${deliveryDate || "Flexible"}`,
          `Delivery location: ${location.trim()}`,
          `Question: ${body.trim()}`,
        ].join("\n")
      : body.trim();

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await sendListingMessage(activeConversationId, messageBody);
      setBody("");
      setQuantity("");
      setDeliveryDate("");
      setLocation("");
      setMessages(await getConversationMessages(activeConversationId));
      if (result.sms_notification === "unavailable") {
        setNotice("Message sent in chat. Farmer SMS alerts are not configured.");
      } else if (result.sms_notification === "failed") {
        setNotice("Message sent in chat, but the farmer SMS alert could not be sent.");
      }
      setConversations(await getConversations());
    } catch (cause) {
      setError(
        "Could not send message: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusy(false);
    }
  };

  const refreshConversations = async () => {
    const updated = await getConversations();
    setConversations(updated);
    return updated;
  };

  const archiveSelected = async () => {
    if (!selectedConversation) return;
    if (!window.confirm("Archive this conversation? You can start a new enquiry from the listing later.")) {
      return;
    }
    try {
      await archiveConversation(selectedConversation.id);
      setConversations(await refreshConversations());
      setNotice("Conversation archived.");
      setError("");
    } catch (cause) {
      setError(
        "Could not archive conversation: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const toggleBlock = async () => {
    if (!selectedConversation) return;
    const blocking = !selectedConversation.blocked_by_me;
    if (
      blocking &&
      !window.confirm("Block this participant? They will not be able to send messages in this conversation.")
    ) {
      return;
    }
    try {
      if (blocking) {
        await blockConversation(selectedConversation.id);
      } else {
        await unblockConversation(selectedConversation.id);
      }
      await refreshConversations();
      setNotice(blocking ? "Participant blocked." : "Participant unblocked.");
      setError("");
    } catch (cause) {
      setError(
        "Could not update block settings: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const reportSelected = async () => {
    if (!selectedConversation) return;
    const reason = window.prompt(
      "Tell us why you are reporting this conversation (at least 8 characters):",
    );
    if (reason === null) return;
    try {
      await reportConversation(selectedConversation.id, reason);
      setNotice("Report submitted. Our team will review this conversation.");
      setError("");
    } catch (cause) {
      setError(
        "Could not submit report: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const selectedConversation = conversations.find(
    (item) => item.id === conversationId,
  );
  const isFirstBuyerMessage =
    user.role === "buyer" && messages.length === 0 && Boolean(selectedConversation);

  return (
    <section>
      <h2>{t("Messages")}</h2>
      <p className="mut">
        Listing-based private chat. Phone numbers are never shown to the other
        participant.
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="conversation-layout">
        <aside className="card conversation-list" aria-label="Conversations">
          <h3>{user.role === "farmer" ? "Buyer enquiries" : "Your enquiries"}</h3>
          {conversations.map((conversation) => (
            <button
              className={`conversation-link${conversation.id === conversationId ? " selected" : ""}`}
              key={conversation.id}
              type="button"
              onClick={() => setConversationId(conversation.id)}
            >
              <strong>{conversation.product_name}</strong>
              <span>
                {user.role === "farmer"
                  ? conversation.buyer_name
                  : conversation.farm_name}
              </span>
              <small>{conversation.county} · KES {conversation.price_kes}/{conversation.unit}</small>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="mut">
              {user.role === "farmer"
                ? "Buyer enquiries about your listings will appear here."
                : "Contact a farmer from a marketplace listing to start a chat. Chat is available only for farms with an active farmer account connected; some sample farms may not be linked yet."}
            </p>
          )}
        </aside>
        {selectedConversation ? (
          <article className="card chat-card" aria-live="polite">
            <h3>{selectedConversation.product_name} · {selectedConversation.farm_name}</h3>
            <p className="mut">
              {user.role === "farmer"
                ? `Enquiry from ${selectedConversation.buyer_name}`
                : selectedConversation.farmer_name}
              {" · "}KES {selectedConversation.price_kes}/{selectedConversation.unit}
              {" · "}{selectedConversation.county}
            </p>
            <div className="conversation-actions">
              <button className="btn" type="button" onClick={() => void reportSelected()}>
                Report conversation
              </button>
              <button className="btn" type="button" onClick={() => void toggleBlock()}>
                {selectedConversation.blocked_by_me ? "Unblock participant" : "Block participant"}
              </button>
              {selectedConversation.status === "active" && (
                <button className="btn" type="button" onClick={() => void archiveSelected()}>
                  Archive conversation
                </button>
              )}
            </div>
            {selectedConversation.status === "archived" && (
              <p className="notice">
                This conversation is archived. It can’t receive new messages.
                Contact the farmer from the listing to start a new enquiry.
              </p>
            )}
            {selectedConversation.blocked_by_me && (
              <p className="notice">
                You blocked this participant. Unblock them to resume messaging.
              </p>
            )}
            <div className="chat-log">
              {messages.length === 0 && (
                <p className="mut">No messages yet. Send an enquiry to start.</p>
              )}
              {messages.map((message) => (
                <div
                  className={`chat-message ${message.sender_id === user.id ? "mine" : ""} ${message.sender_role === "assistant" ? "assistant" : ""}`}
                  key={message.id}
                >
                  <b>{message.sender_name}</b>
                  <p>{message.body}</p>
                  <time className="mut">
                    {new Date(message.created_at).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
            {selectedConversation.status === "active" &&
              !selectedConversation.blocked_by_me && (
            <form className="chat-compose" onSubmit={send}>
              {isFirstBuyerMessage && (
                <div className="enquiry-details">
                  <label className="form-field">
                    Quantity
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Preferred delivery date
                    <input
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={deliveryDate}
                      onChange={(event) => setDeliveryDate(event.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    Delivery location
                    <input
                      required
                      maxLength={100}
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                    />
                  </label>
                </div>
              )}
              {user.role === "buyer" && (
                <div className="chat-templates" aria-label="Quick messages">
                  {quickReplies.map((template) => (
                    <button
                      className="btn"
                      key={template}
                      type="button"
                      onClick={() => setBody(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
              )}
              <label className="form-field">
                {t("Message")}
                <textarea
                  required
                  maxLength={isFirstBuyerMessage ? 700 : 1000}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Ask about price, availability, or delivery…"
                />
              </label>
              <button
                className="btn g"
                disabled={
                  busy ||
                  !body.trim() ||
                  (isFirstBuyerMessage && (!quantity.trim() || !location.trim()))
                }
              >
                {busy ? "Sending…" : t("Send message")}
              </button>
            </form>
              )}
          </article>
        ) : null}
      </div>
    </section>
  );
}
