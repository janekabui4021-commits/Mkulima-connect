import { useEffect, useState } from "react";
import { getBuyerOrders, submitReview } from "../api";
import type { OrderItem } from "../api";
import type { FormEvent } from "react";
import { useTranslation } from "../i18n";

export default function Orders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [error, setError] = useState("");
  const [qualityRatings, setQualityRatings] = useState<Record<number, number>>({});
  const [deliveryRatings, setDeliveryRatings] = useState<Record<number, number>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number>();

  const reload = () =>
    getBuyerOrders()
      .then(setOrders)
      .catch((cause: unknown) => {
        setError(
          "Could not load orders: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });

  useEffect(() => {
    void reload();
  }, []);

  const review = async (event: FormEvent<HTMLFormElement>, item: OrderItem) => {
    event.preventDefault();
    setBusyId(item.order_item_id);
    setError("");
    setMessage("");
    try {
      await submitReview(
        item.order_item_id,
        qualityRatings[item.order_item_id] ?? 5,
        deliveryRatings[item.order_item_id] ?? 5,
        comments[item.order_item_id] ?? "",
      );
      setMessage(`Thanks for reviewing ${item.farm}.`);
      await reload();
    } catch (cause) {
      setError(
        "Could not submit review: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const groupedOrders = orders.reduce<Map<number, OrderItem[]>>(
    (groups, item) => {
      const items = groups.get(item.order_id) ?? [];
      items.push(item);
      groups.set(item.order_id, items);
      return groups;
    },
    new Map(),
  );

  return (
    <section>
      <h2>{t("My orders")}</h2>
      <p className="mut">
        Demo buyer account. Product delivery progress is updated by the
        associated farm. You can review each item after it is delivered.
      </p>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}
      {!error && orders.length === 0 && (
        <p className="mut">No orders yet. Place an order from your cart.</p>
      )}
      {[...groupedOrders.entries()].map(([orderId, items]) => {
        const order = items[0];
        return (
          <article className="card order-card" key={orderId}>
            <h3>Order #{orderId}</h3>
            <p className="mut">
              Placed {new Date(order.created_at).toLocaleString()} · Order{" "}
              {order.order_status} · Payment {order.payment_status ?? "not started"}
              {order.mpesa_receipt ? ` · M-Pesa receipt ${order.mpesa_receipt}` : ""}
            </p>
            {items.map((item) => (
              <div className="row" key={item.order_item_id}>
                <div>
                  <b>{item.product}</b>
                  <div className="mut">
                    {item.variety && `${item.variety} · `}
                    {item.farm} · {item.county} · {item.qty} {item.unit}
                    {item.delivery_days != null &&
                      ` · Estimated farm delivery: ${item.delivery_days} day${item.delivery_days === 1 ? "" : "s"}`}
                    {item.preorder_enabled &&
                      ` · Pre-order (${item.season_tier?.replace("_", " ") ?? "seasonal"})`}
                    {item.harvest_date && ` · Expected harvest ${item.harvest_date}`}
                  </div>
                </div>
                <span className="badge">{item.fulfillment_status}</span>
                <b>
                  KES{" "}
                  {Number(item.price_kes * item.qty).toLocaleString()}
                </b>
                {item.fulfillment_status === "delivered" &&
                  (item.review_rating ? (
                    <span className="badge">Reviewed · ⭐ {item.review_rating}/5</span>
                  ) : (
                    <form
                      className="review-form"
                      onSubmit={(event) => void review(event, item)}
                    >
                      <label>
                        Product quality
                        <select
                          value={qualityRatings[item.order_item_id] ?? 5}
                          onChange={(event) =>
                            setQualityRatings({
                              ...qualityRatings,
                              [item.order_item_id]: Number(event.target.value),
                            })
                          }
                        >
                          {[5, 4, 3, 2, 1].map((rating) => (
                            <option key={rating} value={rating}>
                              {rating} / 5 stars
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Delivery speed
                        <select
                          value={deliveryRatings[item.order_item_id] ?? 5}
                          onChange={(event) =>
                            setDeliveryRatings({
                              ...deliveryRatings,
                              [item.order_item_id]: Number(event.target.value),
                            })
                          }
                        >
                          {[5, 4, 3, 2, 1].map((rating) => (
                            <option key={rating} value={rating}>
                              {rating} / 5 stars
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Comment (optional)
                        <textarea
                          maxLength={1000}
                          value={comments[item.order_item_id] ?? ""}
                          onChange={(event) =>
                            setComments({
                              ...comments,
                              [item.order_item_id]: event.target.value,
                            })
                          }
                          placeholder="Share product quality or delivery feedback"
                        />
                      </label>
                      <button
                        className="btn"
                        disabled={busyId === item.order_item_id}
                      >
                        {busyId === item.order_item_id
                          ? "Submitting…"
                          : "Leave review"}
                      </button>
                    </form>
                  ))}
              </div>
            ))}
            <p className="price">
              Order total: KES {Number(order.total_kes ?? 0).toLocaleString()}
            </p>
          </article>
        );
      })}
    </section>
  );
}
