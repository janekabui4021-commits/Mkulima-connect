import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  createOfftakeRequest,
  deactivateCropDemand,
  getFarms,
  getManageableFarms,
  getFarmProducts,
  getMarketplaceOptions,
  getOfftakeRequests,
  getOfftakeContracts,
  getOfftakeMatches,
  getOfftakeQuotes,
  payMpesa,
  proposeOfftakeContract,
  respondToOfftakeQuote,
  respondToOfftakeContract,
  submitOfftakeQuote,
} from "../api";
import type {
  AuthUser,
  Farm,
  FarmProduct,
  OfftakeRequest,
  OfftakeQuote,
  OfftakeContract,
  OfftakeMatch,
} from "../api";
import ProductImage from "../ProductImage";

interface OfftakeProps {
  user: AuthUser;
  onMessageFarmer: (productId: number) => void;
}

export default function Offtake({ user, onMessageFarmer }: OfftakeProps) {
  const [requests, setRequests] = useState<OfftakeRequest[]>([]);
  const [quotes, setQuotes] = useState<OfftakeQuote[]>([]);
  const [verifiedFarms, setVerifiedFarms] = useState<Farm[]>([]);
  const [farmerProducts, setFarmerProducts] = useState<FarmProduct[]>([]);
  const [matches, setMatches] = useState<OfftakeMatch[]>([]);
  const [contracts, setContracts] = useState<OfftakeContract[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError("");
    try {
      const [nextMatches, nextContracts, nextRequests, nextQuotes] = await Promise.all([
        getOfftakeMatches(),
        getOfftakeContracts(),
        getOfftakeRequests(),
        getOfftakeQuotes(),
      ]);
      setMatches(nextMatches);
      setContracts(nextContracts);
      setRequests(nextRequests);
      setQuotes(nextQuotes);
      if (user.role === "buyer") {
        const [options, farms] = await Promise.all([
          getMarketplaceOptions(),
          getFarms(),
        ]);
        setCounties(options.counties);
        setVerifiedFarms(farms);
      } else {
        const [managedFarms, publicFarms] = await Promise.all([
          getManageableFarms(),
          getFarms(),
        ]);
        const farms = managedFarms.filter((farm) => farm.status === "verified");
        setVerifiedFarms(publicFarms);
        const products = await Promise.all(
          farms.map((farm) => getFarmProducts(farm.id)),
        );
        setFarmerProducts(products.flat());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load harvest matches.");
    }
  };

  useEffect(() => {
    void load();
  }, [user.role]);

  const perform = async (operation: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      await load();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await perform(
      () =>
        createOfftakeRequest({
          crop_name: String(data.get("crop_name") ?? "").trim(),
          variety: String(data.get("variety") ?? "").trim(),
          county: String(data.get("county") ?? ""),
          min_quantity: Number(data.get("min_quantity")),
          unit: String(data.get("unit") ?? "").trim(),
          request_type: String(data.get("request_type") ?? "bulk") as "bulk" | "preorder",
          recurrence: String(data.get("recurrence") ?? "one_off") as OfftakeRequest["recurrence"],
          needed_by: String(data.get("needed_by") ?? "") || null,
          delivery_location: String(data.get("delivery_location") ?? "").trim(),
          delivery_method: String(data.get("delivery_method") ?? "delivery") as OfftakeRequest["delivery_method"],
          quality_notes: String(data.get("quality_notes") ?? "").trim(),
          buyer_name: String(data.get("buyer_name") ?? "").trim(),
          business_name: String(data.get("business_name") ?? "").trim(),
          buyer_phone: String(data.get("buyer_phone") ?? "").trim(),
          buyer_email: String(data.get("buyer_email") ?? "").trim(),
          farm_id: data.get("farm_id") ? Number(data.get("farm_id")) : null,
          harvest_from: null,
          harvest_to: null,
          max_price_kes: data.get("max_price_kes")
            ? Number(data.get("max_price_kes"))
            : null,
        }),
      "Your request is active. Matching verified farms have been notified.",
    );
    if (saved) form.reset();
  };

  const submitQuote = async (
    event: FormEvent<HTMLFormElement>,
    request: OfftakeRequest,
    previousQuoteId?: number,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const product = farmerProducts.find(
      (item) => item.id === Number(data.get("product_id")),
    );
    if (!product) {
      setError("Choose one of your active matching farm listings.");
      return;
    }
    await perform(
      () =>
        submitOfftakeQuote(request.id, {
          farm_id: product.farm_id,
          product_id: product.id,
          quantity: Number(data.get("quantity")),
          unit_price_kes: Number(data.get("unit_price_kes")),
          quality_notes: String(data.get("quality_notes") ?? "").trim(),
          delivery_location: String(data.get("delivery_location") ?? "").trim(),
          ...(previousQuoteId ? { supersedes_quote_id: previousQuoteId } : {}),
        }),
      previousQuoteId
        ? "Your counter-offer was sent to the buyer."
        : "Your quote was sent to the buyer.",
    );
  };

  const matchingProducts = (request: OfftakeRequest) =>
    farmerProducts.filter((product) => {
      const farm = product.farm_id;
      return (
        product.stock > 0 &&
        product.name.trim().toLocaleLowerCase() === request.crop_name.trim().toLocaleLowerCase() &&
        product.unit.trim().toLocaleLowerCase() === request.unit.trim().toLocaleLowerCase() &&
        (!request.variety ||
          product.variety.trim().toLocaleLowerCase() === request.variety.trim().toLocaleLowerCase()) &&
        (request.farm_id === null || request.farm_id === farm) &&
        (request.farm_id !== null ||
          verifiedFarms.find((item) => item.id === farm)?.county.toLocaleLowerCase() ===
            request.county.toLocaleLowerCase())
      );
    });

  const submitProposal = async (
    event: FormEvent<HTMLFormElement>,
    match: OfftakeMatch,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await perform(
      () =>
        proposeOfftakeContract({
          demand_id: match.demand_id,
          product_id: match.product_id,
          quantity: Number(data.get("quantity")),
          unit_price_kes: Number(data.get("unit_price_kes")),
          delivery_location: String(data.get("delivery_location") ?? "").trim(),
        }),
      "Proposal sent to the farmer. It reserves this quantity for up to 7 days.",
    );
  };

  return (
    <section className="page-section offtake-page">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Plan before harvest</p>
          <h1>Farm-to-buyer matching</h1>
          <p>
            Request wholesale produce, compare quotes from verified farms, and
            agree on quantity, quality, price and delivery before checkout.
          </p>
        </div>
      </header>

      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}

      {user.role === "buyer" && (
        <>
          <section className="card">
            <h2>Request a bulk order or pre-order</h2>
            <p>
              Compare quotes from verified farms, accept partial quantities from
              several farms, and pay accepted quotes through M-Pesa.
            </p>
            <form className="form-grid" onSubmit={submitRequest}>
              <label className="form-field">
                Request type
                <select name="request_type" required defaultValue="bulk">
                  <option value="bulk">Bulk order · needed now</option>
                  <option value="preorder">Pre-order · future harvest</option>
                </select>
              </label>
              <label className="form-field">
                Produce
                <input name="crop_name" required minLength={2} maxLength={100} />
              </label>
              <label className="form-field">
                Variety
                <input name="variety" maxLength={100} placeholder="Roma, optional" />
              </label>
              <label className="form-field">
                Delivery county
                <select name="county" required defaultValue="">
                  <option value="" disabled>Select county</option>
                  {counties.map((county) => <option key={county}>{county}</option>)}
                </select>
              </label>
              <label className="form-field">
                Total quantity needed
                <input name="min_quantity" type="number" min="0.01" step="any" required />
              </label>
              <label className="form-field">
                Unit
                <input name="unit" list="bulk-units" required maxLength={20} placeholder="kg" />
                <datalist id="bulk-units">
                  <option value="kg" />
                  <option value="bags" />
                  <option value="crates" />
                  <option value="tonnes" />
                </datalist>
              </label>
              <label className="form-field">
                Needed by
                <input
                  name="needed_by"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  required
                />
              </label>
              <label className="form-field">
                Frequency (recurring orders are not auto-scheduled)
                <select name="recurrence" defaultValue="one_off">
                  <option value="one_off">One-off</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="form-field">
                Delivery town / location
                <input name="delivery_location" required maxLength={200} placeholder="Town or drop-off location" />
              </label>
              <label className="form-field">
                Fulfillment
                <select name="delivery_method" defaultValue="delivery">
                  <option value="delivery">Delivery</option>
                  <option value="pickup">Farm pickup</option>
                </select>
              </label>
              <label className="form-field">
                Farm preference
                <select name="farm_id" defaultValue="">
                  <option value="">Open to any verified farm</option>
                  {verifiedFarms.map((farm) => (
                    <option key={farm.id} value={farm.id}>{farm.name} · {farm.county}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Target price per unit (KES, optional)
                <input name="max_price_kes" type="number" min="0.01" step="any" />
              </label>
              <label className="form-field">
                Grade, packaging, organic, or other quality notes
                <textarea name="quality_notes" rows={3} maxLength={1000} />
              </label>
              <label className="form-field">
                Contact name
                <input name="buyer_name" required maxLength={120} defaultValue={user.name} />
              </label>
              <label className="form-field">
                Business name
                <input name="business_name" maxLength={160} placeholder="Restaurant, school, hotel, trader…" />
              </label>
              <label className="form-field">
                Phone for quote notifications
                <input name="buyer_phone" type="tel" required maxLength={30} autoComplete="tel" />
                <small className="mut">Quote alerts are sent by SMS when configured and are always available in your account.</small>
              </label>
              <label className="form-field">
                Email
                <input name="buyer_email" type="email" maxLength={254} defaultValue={user.email} autoComplete="email" />
              </label>
              <div className="form-field">
                <button className="btn g" type="submit" disabled={busy}>Submit bulk request</button>
              </div>
            </form>
          </section>

          <section className="offtake-section">
            <h2>Your requests and quotes</h2>
            {requests.length === 0 ? <p className="mut">You have not submitted a bulk request or pre-order yet.</p> : (
              <div className="grid">
                {requests.map((request) => (
                  <article className="card" key={request.id}>
                    <div className="offtake-request-heading">
                      <h3>{request.crop_name}{request.variety ? ` · ${request.variety}` : ""}</h3>
                      <span className={`offtake-status ${request.status}`}>{request.status}</span>
                    </div>
                    <p>
                      {request.request_type === "bulk" ? "Bulk order" : "Pre-order"} ·
                      {" "}{request.min_quantity} {request.unit} · {request.recurrence.replace("_", " ")}
                    </p>
                    <p>{request.county} · {request.delivery_location} · {request.delivery_method}</p>
                    <p>Needed by {request.needed_by || "Date not set"} · Farm: {request.target_farm_name || "any verified farm"}</p>
                    <p>
                      Allocated: {request.accepted_quantity}/{request.min_quantity} {request.unit}
                      {" · "}paid: {request.paid_quantity}/{request.min_quantity}
                      {" · "}fulfilled: {request.fulfilled_quantity}/{request.min_quantity}
                    </p>
                    {request.quality_notes && <p>Quality: {request.quality_notes}</p>}
                    {request.max_price_kes != null && <p>Target: KES {request.max_price_kes}/{request.unit}</p>}
                    <p className="mut">
                      {request.open_quote_count} active quote{request.open_quote_count === 1 ? "" : "s"}
                      {request.business_name ? ` · ${request.business_name}` : ""}
                    </p>
                    {request.active && (
                      <button
                        className="btn"
                        disabled={busy}
                        type="button"
                        onClick={() => void perform(
                          () => deactivateCropDemand(request.id),
                          "Request cancelled.",
                        )}
                      >
                        Cancel request
                      </button>
                    )}
                    {quotes.filter((quote) => quote.demand_id === request.id).map((quote) => (
                      <article className="offtake-quote-card" key={quote.id}>
                        <div className="offtake-request-heading">
                          <strong>{quote.farm_name} · {quote.status}</strong>
                          <span>{quote.quantity} {quote.unit}</span>
                        </div>
                        <p>KES {quote.unit_price_kes}/{quote.unit} · {quote.delivery_location}</p>
                        {quote.quality_notes && <p>Quality offered: {quote.quality_notes}</p>}
                        {quote.status === "quoted" && (
                          <div className="button-row">
                            <button
                              className="btn g"
                              disabled={busy}
                              type="button"
                              onClick={() => void perform(
                                () => respondToOfftakeQuote(quote.id, "accept"),
                                "Quote accepted. A full-amount M-Pesa order is ready for payment.",
                              )}
                            >
                              Accept quote
                            </button>
                            <button
                              className="btn"
                              disabled={busy}
                              type="button"
                              onClick={() => void perform(
                                () => respondToOfftakeQuote(quote.id, "decline"),
                                "Quote declined.",
                              )}
                            >
                              Decline
                            </button>
                          </div>
                        )}
                        {quote.status === "accepted" && quote.order_id && (
                          <div>
                            <p className="mut">
                              Order #{quote.order_id} · Payment: {quote.payment_status || "not started"}
                            </p>
                            <button className="btn" type="button" onClick={() => void load()}>
                              Refresh payment status
                            </button>
                            {quote.order_status !== "paid" && quote.order_status !== "delivered" && (
                              <div className="button-row">
                                {quote.payment_status !== "initiated" && (
                                  <button
                                    className="btn g"
                                    disabled={busy || !request.buyer_phone}
                                    type="button"
                                    onClick={() => void perform(
                                      () => payMpesa(quote.order_id!, request.buyer_phone),
                                      "M-Pesa prompt sent. Approve it on your phone to pay the quote.",
                                    )}
                                  >
                                    Pay full quote by M-Pesa
                                  </button>
                                )}
                                {quote.payment_status !== "initiated" && (
                                  <button
                                    className="btn"
                                    disabled={busy}
                                    type="button"
                                    onClick={() => void perform(
                                      () => respondToOfftakeQuote(quote.id, "cancel"),
                                      "Unpaid order cancelled and farm stock released.",
                                    )}
                                  >
                                    Cancel unpaid order
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {quote.status === "paid" && (
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() => void perform(
                              () => respondToOfftakeQuote(quote.id, "fulfill"),
                              "Delivery confirmed; the quote is fulfilled.",
                            )}
                          >
                            Confirm delivery received
                          </button>
                        )}
                      </article>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="offtake-section">
            <h2>Matching future harvests</h2>
            {matches.length === 0 ? <p className="mut">Matching verified pre-order listings will appear here.</p> : (
              <div className="grid">
                {matches.map((match, index) => (
                  <article className="card offtake-match" key={`${match.demand_id}-${match.product_id}-${index}`}>
                    <ProductImage name={match.product_name} imageUrl={match.image_url} />
                    <h3>{match.product_name}{match.variety ? ` · ${match.variety}` : ""}</h3>
                    <p>{match.farm_name} · {match.county}</p>
                    <p>Grade {match.grade}; harvest {match.harvest_date}</p>
                    <p>{match.stock} {match.unit} available · KES {match.price_kes} per {match.unit}</p>
                    <p className="mut">
                      Indicative listing range in this county:{" "}
                      {match.price_range_min_kes == null
                        ? "not enough comparable listings"
                        : `KES ${match.price_range_min_kes}–${match.price_range_max_kes} per ${match.unit}`}
                      . This is not a guaranteed fair price.
                    </p>
                    <button
                      className="btn g"
                      type="button"
                      onClick={() => onMessageFarmer(match.product_id)}
                    >
                      Message Farmer
                    </button>
                    <form onSubmit={(event) => void submitProposal(event, match)}>
                      <label className="form-field">
                        Quantity ({match.unit})
                        <input
                          name="quantity"
                          type="number"
                          min={match.min_quantity}
                          max={match.stock}
                          step="any"
                          defaultValue={match.min_quantity}
                          required
                        />
                      </label>
                      <label className="form-field">
                        Proposed price (KES per {match.unit})
                        <input
                          name="unit_price_kes"
                          type="number"
                          min="0.01"
                          max={match.max_price_kes ?? undefined}
                          step="any"
                          defaultValue={match.price_kes}
                          required
                        />
                      </label>
                      <label className="form-field">
                        Delivery location
                        <input name="delivery_location" required minLength={2} defaultValue={match.county} />
                      </label>
                      <button className="btn" type="submit" disabled={busy}>Send purchase proposal</button>
                    </form>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {user.role === "farmer" && (
        <>
          <section className="offtake-section">
            <h2>Incoming bulk and pre-order requests</h2>
            <p className="mut">Quote for all or part of a request; buyers can combine offers from multiple verified farms.</p>
            {requests.length === 0 ? <p className="mut">No matching buyer requests are open right now.</p> : (
              <div className="grid">
                {requests.map((request) => {
                  const products = matchingProducts(request);
                  return (
                    <article className="card" key={request.id}>
                      <div className="offtake-request-heading">
                        <h3>{request.crop_name}{request.variety ? ` · ${request.variety}` : ""}</h3>
                        <span className={`offtake-status ${request.status}`}>{request.status}</span>
                      </div>
                      <p>
                        {request.request_type === "bulk" ? "Bulk order" : "Pre-order"} ·
                        {" "}{request.min_quantity} {request.unit} requested · {request.recurrence.replace("_", " ")}
                      </p>
                      <p>Needed by {request.needed_by || "Date not set"} · {request.county} · {request.delivery_location}</p>
                      <p>{request.delivery_method === "pickup" ? "Farm pickup" : "Delivery requested"} · Farm: {request.target_farm_name || "open to any verified farm"}</p>
                      {request.business_name && <p>Business: {request.business_name}</p>}
                      {request.buyer_name && <p>Contact: {request.buyer_name}</p>}
                      {request.buyer_phone && <p>Phone: <a href={`tel:${request.buyer_phone}`}>{request.buyer_phone}</a></p>}
                      {request.buyer_email && <p>Email: <a href={`mailto:${request.buyer_email}`}>{request.buyer_email}</a></p>}
                      {request.max_price_kes != null && <p>Target price: KES {request.max_price_kes}/{request.unit}</p>}
                      {request.quality_notes && <p>Quality requirements: {request.quality_notes}</p>}
                      <p>
                        Already allocated: {request.accepted_quantity}/{request.min_quantity} {request.unit}
                      </p>
                      {products.length === 0 ? (
                        <p className="notice">
                          Add an active matching product listing to quote this request.
                        </p>
                      ) : (
                        <form className="offtake-quote-form" onSubmit={(event) => void submitQuote(event, request)}>
                          <label className="form-field">
                            Your farm / produce listing
                            <select name="product_id" required defaultValue={products[0].id}>
                              {products.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {verifiedFarms.find((farm) => farm.id === product.farm_id)?.name}
                                  {" · "}{product.variety} · {product.stock} {product.unit} available
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            Quantity you can supply ({request.unit})
                            <input
                              name="quantity"
                              type="number"
                              min="0.01"
                              max={request.min_quantity}
                              step="any"
                              defaultValue={Math.min(request.min_quantity, products[0].stock)}
                              required
                            />
                          </label>
                          <label className="form-field">
                            Your price (KES per {request.unit})
                            <input name="unit_price_kes" type="number" min="0.01" step="any" required />
                          </label>
                          <label className="form-field">
                            Quality / packaging offered
                            <textarea name="quality_notes" rows={2} maxLength={1000} defaultValue={products[0].grade} />
                          </label>
                          <label className="form-field">
                            Delivery location
                            <input name="delivery_location" required maxLength={200} defaultValue={request.delivery_location} />
                          </label>
                          <button className="btn g" type="submit" disabled={busy}>Send quote</button>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section className="offtake-section">
            <h2>Your quotes and confirmed bulk orders</h2>
            {quotes.filter((quote) => quote.farmer_id === user.id).length === 0 ? (
              <p className="mut">Your quotes will appear here after you respond to a buyer request.</p>
            ) : (
              <div className="grid">
                {quotes.filter((quote) => quote.farmer_id === user.id).map((quote) => {
                  const request = requests.find((item) => item.id === quote.demand_id);
                  const products = request ? matchingProducts(request) : farmerProducts.filter((item) => item.farm_id === quote.farm_id);
                  return (
                    <article className="card" key={quote.id}>
                      <div className="offtake-request-heading">
                        <h3>{quote.crop_name}{quote.variety ? ` · ${quote.variety}` : ""}</h3>
                        <span className={`offtake-status ${quote.status}`}>{quote.status}</span>
                      </div>
                      <p>{quote.farm_name} · {quote.quantity} {quote.unit} at KES {quote.unit_price_kes}/{quote.unit}</p>
                      {quote.order_id && <p>Order #{quote.order_id} · Payment: {quote.payment_status || "not started"}</p>}
                      {quote.status === "quoted" && request && products.length > 0 && (
                        <details>
                          <summary>Send a counter-offer</summary>
                          <form className="offtake-quote-form" onSubmit={(event) => void submitQuote(event, request, quote.id)}>
                            <label className="form-field">
                              Farm / listing
                              <select name="product_id" defaultValue={quote.product_id} required>
                                {products.map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {verifiedFarms.find((farm) => farm.id === product.farm_id)?.name}
                                    {" · "}{product.variety} · {product.stock} {product.unit} available
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="form-field">
                              Quantity
                              <input name="quantity" type="number" min="0.01" max={request.min_quantity} step="any" defaultValue={quote.quantity} required />
                            </label>
                            <label className="form-field">
                              Counter price (KES per {quote.unit})
                              <input name="unit_price_kes" type="number" min="0.01" step="any" defaultValue={quote.unit_price_kes} required />
                            </label>
                            <label className="form-field">
                              Quality / packaging
                              <textarea name="quality_notes" rows={2} maxLength={1000} defaultValue={quote.quality_notes} />
                            </label>
                            <label className="form-field">
                              Delivery location
                              <input name="delivery_location" required defaultValue={quote.delivery_location} />
                            </label>
                            <button className="btn" type="submit" disabled={busy}>Send counter-offer</button>
                          </form>
                        </details>
                      )}
                      {quote.status === "quoted" && (
                        <button
                          className="btn"
                          type="button"
                          disabled={busy}
                          onClick={() => void perform(
                            () => respondToOfftakeQuote(quote.id, "withdraw"),
                            "Quote withdrawn.",
                          )}
                        >
                          Withdraw quote
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section className="offtake-section">
            <h2>Buyer demand matching your future harvests</h2>
            {matches.length === 0 ? <p className="mut">No matching future listings yet.</p> : (
              <div className="grid">
                {matches.map((match, index) => (
                  <article className="card offtake-match" key={`${match.demand_id}-${match.product_id}-${index}`}>
                    <h3>{match.crop_name} · {match.county}</h3>
                    {match.buyer_name && <p>Buyer: {match.buyer_name}</p>}
                    <p>Buyer demand: at least {match.min_quantity} {match.demand_unit}</p>
                    <p>Listing: {match.product_name} · {match.grade} · harvest {match.harvest_date}</p>
                    <p>Available: {match.stock} {match.unit} · listed at KES {match.price_kes} per {match.unit}</p>
                    {match.max_price_kes != null && <p>Buyer maximum: KES {match.max_price_kes} per {match.demand_unit}</p>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="offtake-section">
        <h2>Purchase agreements</h2>
        {contracts.length === 0 ? <p className="mut">No agreements yet.</p> : (
          <div className="grid">
            {contracts.map((contract) => (
              <article className="card" key={contract.id}>
                <h3>{contract.product_name} · {contract.status}</h3>
                <p>{contract.quantity} {contract.unit} at KES {contract.unit_price_kes} per {contract.unit}</p>
                <p>{contract.farm_name}, {contract.county} · grade {contract.grade}</p>
                <p>Harvest: {contract.harvest_date} · delivery: {contract.delivery_location}</p>
                {contract.status === "proposed" && user.role === "farmer" && (
                  <div className="button-row">
                    <button className="btn" disabled={busy} onClick={() => void perform(
                      () => respondToOfftakeContract(contract.id, "accept"),
                      "Proposal accepted. The agreed quantity is now reserved.",
                    )}>Accept</button>
                    <button className="btn g" disabled={busy} onClick={() => void perform(
                      () => respondToOfftakeContract(contract.id, "decline"),
                      "Proposal declined.",
                    )}>Decline</button>
                  </div>
                )}
                {contract.status === "proposed" && user.role === "buyer" && (
                  <button className="btn g" disabled={busy} onClick={() => void perform(
                    () => respondToOfftakeContract(contract.id, "cancel"),
                    "Proposal cancelled and its reservation released.",
                  )}>Cancel proposal</button>
                )}
                {contract.status === "confirmed" && user.role === "buyer" && (
                  <button className="btn" disabled={busy} onClick={() => void perform(
                    () => respondToOfftakeContract(contract.id, "confirm_delivery"),
                    "Delivery confirmed and the agreed listing quantity deducted.",
                  )}>Confirm delivery received</button>
                )}
                {contract.status === "proposed" && (
                  <p className="mut">Respond before {new Date(contract.expires_at).toLocaleString()}.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="mut offtake-disclaimer">
        Accepted bulk quotes create a regular order that can be paid in full through M-Pesa. Deposits,
        balance installments, and automated recurring orders are not currently supported, and
        Mkulima Connect does not hold funds in escrow. Indicative price ranges use current comparable
        marketplace asking prices.
      </p>
    </section>
  );
}
