import { useEffect, useState } from "react";
import { createOrder, getMpesaPaymentStatus, payMpesa } from "../api";
import type { CartLine } from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

interface Props {
  cart: Record<number, CartLine>;
  change: (id: number, delta: number) => void;
  clear: () => void;
  close: () => void;
}

export default function Cart({ cart, change, clear, close }: Props) {
  const { t } = useTranslation();
  const lines = Object.values(cart);
  const discountedUnitPrice = (line: CartLine) =>
    line.product.price_kes *
    (line.qty >= 50 ? 0.9 : line.qty >= 10 ? 0.95 : 1);
  const total = lines.reduce(
    (sum, line) => sum + line.qty * discountedUnitPrice(line),
    0,
  );
  const [phone, setPhone] = useState("254712345678");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<number | null>(null);
  const [paymentOrderId, setPaymentOrderId] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState("");
  const [paymentAttempt, setPaymentAttempt] = useState(0);

  useEffect(() => {
    if (paymentOrderId === null) return;
    let active = true;
    let attempts = 0;
    let timer: number | undefined;

    const checkStatus = async () => {
      try {
        const payment = await getMpesaPaymentStatus(paymentOrderId);
        if (!active) return;
        setPaymentStatus(payment.status);
        setPaymentReceipt(payment.mpesa_receipt ?? "");
        if (payment.status === "success") {
          setMessage(`Payment confirmed for order #${paymentOrderId}.`);
          return;
        }
        if (payment.status === "failed") {
          setMessage("The M-Pesa payment was not completed. You can try again from your orders.");
          return;
        }
        attempts += 1;
        if (attempts < 20) {
          timer = window.setTimeout(() => void checkStatus(), 3000);
        } else {
          setMessage("Payment is still pending. Check My orders for its latest status.");
        }
      } catch (cause) {
        if (!active) return;
        setMessage(
          "Could not check payment status: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    };

    void checkStatus();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [paymentOrderId, paymentAttempt]);

  const placeOrder = async () => {
    setBusy(true);
    setMessage("");
    try {
      const order = createdOrderId
        ? { order_id: createdOrderId }
        : await createOrder(
            lines.map((line) => ({
              product_id: line.product.id,
              qty: line.qty,
            })),
          );
      setCreatedOrderId(order.order_id);
      setOrderPlaced(true);
      setMessage(`Order #${order.order_id} placed. Track delivery and harvest reservations in My orders.`);
      clear();
    } catch (error) {
      setMessage(
        "Order could not be placed: " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setBusy(true);
    setMessage("");
    try {
      const order = createdOrderId
        ? { order_id: createdOrderId }
        : await createOrder(
            lines.map((line) => ({
              product_id: line.product.id,
              qty: line.qty,
            })),
          );
      setCreatedOrderId(order.order_id);
      const payment = await payMpesa(order.order_id, phone);
      setPaymentOrderId(order.order_id);
      setPaymentAttempt((attempt) => attempt + 1);
      setPaymentStatus("initiated");
      setOrderPlaced(true);
      setMessage(
        `Check your phone and enter your M-Pesa PIN to pay KES ${payment.Amount}. Waiting for confirmation…`,
      );
      clear();
    } catch (error) {
      setMessage(
        "Payment could not start: " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  };

  const retryPayment = async () => {
    if (paymentOrderId === null) return;
    setBusy(true);
    setMessage("");
    try {
      const payment = await payMpesa(paymentOrderId, phone);
      setPaymentStatus("initiated");
      setPaymentAttempt((attempt) => attempt + 1);
      setMessage(
        `Check your phone and enter your M-Pesa PIN to pay KES ${payment.Amount}. Waiting for confirmation…`,
      );
    } catch (error) {
      setMessage(
        "Payment could not start: " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={close}>
      <div className="box" onClick={(event) => event.stopPropagation()}>
        <h3>🛒 {t("Your cart")}</h3>
        {lines.length === 0 && !message && (
          <p className="mut">Your cart is empty.</p>
        )}
        {lines.map((line) => (
          <div className="row" key={line.product.id}>
            <ProductImage
              name={line.product.name}
              farmName={line.product.farm}
              compact
            />
            <div>
              <b>{line.product.name}</b>
              <div className="mut">
                {line.product.variety} ·{" "}
                {line.product.farm} · KES{" "}
                {discountedUnitPrice(line).toFixed(2)}/{line.product.unit}
                {line.qty >= 50
                  ? " · 10% bulk discount"
                  : line.qty >= 10
                    ? " · 5% bulk discount"
                    : ""}
                {line.product.preorder_enabled && (
                  <div className="mut">
                    Reserved for {line.product.season_tier.replace("_", " ")} harvest
                    {line.product.harvest_date ? ` · ${line.product.harvest_date}` : ""}
                  </div>
                )}
              </div>
            </div>
            <div className="qty">
              <button onClick={() => change(line.product.id, -1)}>−</button>
              <span>{line.qty}</span>
              <button
                disabled={line.qty >= line.product.stock}
                onClick={() => change(line.product.id, 1)}
              >
                +
              </button>
            </div>
            <b>
              KES{" "}
              {(line.qty * discountedUnitPrice(line)).toLocaleString(
                undefined,
                { minimumFractionDigits: 2, maximumFractionDigits: 2 },
              )}
            </b>
          </div>
        ))}
        {lines.length > 0 && !orderPlaced && (
          <>
            <p className="price">Total: KES {total.toLocaleString()}</p>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="07XXXXXXXX or 2547XXXXXXXX"
              aria-label="M-Pesa phone number"
            />
            <button
              className="btn g"
              style={{ width: "100%", marginTop: 10 }}
              disabled={busy}
              onClick={placeOrder}
            >
              {busy ? "Placing…" : t("Place order (payment pending)")}
            </button>
            <button
              className="btn"
              style={{ width: "100%", marginTop: 10 }}
              disabled={busy}
              onClick={pay}
            >
              {busy ? "Sending…" : t("Place order & pay with M-PESA")}
            </button>
          </>
        )}
        {message && <p className={paymentStatus === "success" ? "notice success" : "mut"}>{message}</p>}
        {paymentOrderId !== null && paymentStatus && (
          <p className="mut">
            Order #{paymentOrderId} · Payment {paymentStatus}
            {paymentReceipt ? ` · M-Pesa receipt ${paymentReceipt}` : ""}
          </p>
        )}
        {paymentStatus === "failed" && (
          <>
            <label className="form-field">
              M-Pesa phone number
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07XXXXXXXX or 2547XXXXXXXX"
              />
            </label>
            <button
              type="button"
              className="btn g"
              style={{ width: "100%", marginTop: 10 }}
              disabled={busy}
              onClick={() => void retryPayment()}
            >
              {busy ? "Sending…" : "Try M-Pesa payment again"}
            </button>
          </>
        )}
        <button
          className="btn"
          style={{ width: "100%", marginTop: 10 }}
          onClick={close}
        >
          {t("Close")}
        </button>
      </div>
    </div>
  );
}
