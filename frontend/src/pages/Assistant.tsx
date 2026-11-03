import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  analyzeFreshness,
  getFarmProducts,
  getManageableFarms,
  getProducts,
  getUrgentProducts,
} from "../api";
import type {
  AuthUser,
  FarmProduct,
  FreshnessAnalysis,
  ManagedFarm,
  Product,
  UrgentProduct,
} from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

interface Message {
  role: "assistant" | "user";
  text: string;
}

interface FarmerUrgency {
  farm: ManagedFarm;
  product: FarmProduct;
  freshness: FreshnessAnalysis;
}

interface Props {
  user: AuthUser | null;
  onAddToCart: (product: Product) => void;
  onOpenFarmerTools: () => void;
}

const BUYER_SUGGESTIONS = [
  "What produce is available?",
  "Find the cheapest tomatoes",
  "Which produce needs to sell fast?",
  "How do pre-orders work?",
  "How can I trace a product?",
];

const COUNTIES = [
  "Kiambu",
  "Nakuru",
  "Meru",
  "Kisii",
  "Uasin Gishu",
  "Nyandarua",
  "Kirinyaga",
];

const answerMarketplaceQuestion = (
  question: string,
  products: Product[],
): string => {
  const query = question.trim().toLowerCase();
  if (!query) return "Ask me about produce, farms, prices, pre-orders, or using the marketplace.";

  const namedProducts = products
    .map((product) => product.name)
    .filter((name, index, names) => names.indexOf(name) === index)
    .filter((name) => query.includes(name.toLowerCase()))
    .sort((left, right) => right.length - left.length);
  const county = COUNTIES.find((name) => query.includes(name.toLowerCase()));
  const farmNames = products
    .map((product) => product.farm)
    .filter((name, index, names) => names.indexOf(name) === index);
  const farm = farmNames.find((name) => query.includes(name.toLowerCase()));
  const wantsCatalog =
    namedProducts.length > 0 ||
    Boolean(county || farm) ||
    /produce|products|listings|available|cheapest|cheap|affordable|price|cost|recommend/i.test(
      query,
    );
  const wantsAvailablePreorders =
    /pre.?order/i.test(query) && /available|which|show|list|what/i.test(query);

  if (
    namedProducts.length > 0 ||
    county ||
    farm ||
    wantsCatalog ||
    wantsAvailablePreorders
  ) {
    let matches = products.filter((product) => {
      const matchesProduct =
        namedProducts.length === 0 ||
        namedProducts.some(
          (name) => product.name.toLowerCase() === name.toLowerCase(),
        );
      return (
        matchesProduct &&
        (!county || product.county.toLowerCase() === county.toLowerCase()) &&
        (!farm || product.farm.toLowerCase() === farm.toLowerCase()) &&
        (!wantsAvailablePreorders || product.preorder_enabled)
      );
    });

    if (matches.length === 0) {
      return "I couldn't find a matching listing in the current marketplace. Try another produce name or county.";
    }

    if (/cheap|lowest|affordable|price|cost/i.test(query)) {
      matches = [...matches].sort((a, b) => a.price_kes - b.price_kes);
    } else if (/rating|rated|best|recommend/i.test(query)) {
      matches = [...matches].sort((a, b) => b.rating - a.rating);
    }

    const listingDetails = matches.slice(0, 5).map((product) => {
      const preorder = product.preorder_enabled
        ? ` · Pre-order available${product.harvest_date ? ` for ${product.harvest_date}` : ""}`
        : "";
      return `• ${product.name} — KES ${product.price_kes}/${product.unit} at ${product.farm} (${product.county}); ${product.stock} ${product.unit} available${preorder}`;
    });
    const extra =
      matches.length > 5
        ? `\n…and ${matches.length - 5} more matching listing${matches.length - 5 === 1 ? "" : "s"}.`
        : "";
    return `Here are the current matching listings:\n${listingDetails.join("\n")}${extra}\n\nSign in as a buyer to add produce to your cart.`;
  }

  if (/pre.?order/i.test(query)) {
    return "A pre-order reserves produce from a future harvest. In the Marketplace, look for a listing marked “Pre-order,” check its expected harvest date, then add it to your cart. Only listings that a farmer has enabled for pre-orders can be reserved.";
  }
  if (/qr|trace|origin|where.*from/i.test(query)) {
    return "Open a Marketplace listing and choose “Trace product” to see its farm and harvest details. Farmers can also show or share the listing’s QR code from Farmer tools. Scanning it opens the public trace record.";
  }
  if (/message|contact|talk to|farmer/i.test(query)) {
    return "Sign in as a buyer, open a listing’s details, and select “Message this farmer.” Buyers and farmers can also use the Messages tab after signing in.";
  }
  if (/sell|list.*produce|farmer account|register.*farm/i.test(query)) {
    return "Create an account with the Farmer role, then open Farmer tools to apply for a farm. An administrator must approve and assign the farm before you can publish produce listings.";
  }
  if (/order|buy|cart|checkout|payment/i.test(query)) {
    return "To buy produce, sign in as a buyer, add a listing to your cart, and complete checkout. You can follow order progress in My orders. Payment options depend on the app’s payment setup.";
  }
  if (/deliver|shipping|delivery/i.test(query)) {
    return "Each listing shows an estimated delivery time. After ordering, check My orders for progress; the associated farm updates fulfillment status.";
  }
  if (/fresh|spoil|storage/i.test(query)) {
    return "Farmer tools include a freshness estimate for listings with a harvest date. It is a rule-based estimate—not a language-model AI or food-safety assessment.";
  }
  if (/^(hi|hello|hey)\b/.test(query)) {
    return "Hello! I can look up current produce and prices or explain pre-orders, traceability, messaging, and ordering. What would you like to know?";
  }
  return "I can look up produce, farms, counties, prices, and pre-orders from the live marketplace. I can also explain buying, messaging farmers, and product traceability. Try asking “What is the cheapest maize?”";
};

const urgencyLabel = (risk: FreshnessAnalysis["risk_level"]) =>
  risk === "Critical"
    ? "Sell first"
    : risk === "Moderate"
      ? "Sell soon"
      : "On track";

const dateLabel = (date: string | null) =>
  date
    ? new Date(`${date}T00:00:00`).toLocaleDateString()
    : "date not recorded";

export default function Assistant({
  user,
  onAddToCart,
  onOpenFarmerTools,
}: Props) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [urgentProducts, setUrgentProducts] = useState<UrgentProduct[]>([]);
  const [urgentLoading, setUrgentLoading] = useState(true);
  const [urgentError, setUrgentError] = useState("");
  const [farmerUrgency, setFarmerUrgency] = useState<FarmerUrgency[]>([]);
  const [farmerLoading, setFarmerLoading] = useState(false);
  const [farmerError, setFarmerError] = useState("");
  const [farmerNotice, setFarmerNotice] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi! I can help buyers find produce that may need selling soon, and help farmers prioritize their own harvest-dated stock. Freshness and discounts are estimates; suggested discounts are not applied automatically.",
    },
  ]);
  const [question, setQuestion] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getProducts()
      .then((catalog) => {
        if (active) setProducts(catalog);
      })
      .catch((cause: unknown) => {
        if (active) {
          setCatalogError(
            "Could not load the marketplace catalog: " +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    getUrgentProducts()
      .then((urgent) => {
        if (active) setUrgentProducts(urgent);
      })
      .catch((cause: unknown) => {
        if (active) {
          setUrgentError(
            "Could not load current harvest urgency: " +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      })
      .finally(() => {
        if (active) setUrgentLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user?.role !== "farmer") {
      setFarmerUrgency([]);
      setFarmerError("");
      setFarmerNotice("");
      setFarmerLoading(false);
      return;
    }

    let active = true;
    setFarmerLoading(true);
    setFarmerError("");
    setFarmerNotice("");
    getManageableFarms()
      .then(async (farms) => {
        const verifiedFarms = farms.filter((farm) => farm.status === "verified");
        if (verifiedFarms.length === 0) {
          if (active) {
            setFarmerUrgency([]);
            setFarmerNotice(
              farms.some((farm) => farm.status === "pending")
                ? "Your farm application is awaiting approval. Harvest insights will appear after your farm is verified."
                : "No verified farm is assigned to this account yet. Apply for a farm or ask an administrator to assign one.",
            );
          }
          return;
        }

        const productsByFarm = await Promise.all(
          verifiedFarms.map(async (farm) => ({
            farm,
            products: await getFarmProducts(farm.id),
          })),
        );
        const today = new Date().toISOString().slice(0, 10);
        const datedListings = productsByFarm.flatMap(({ farm, products }) =>
          products
            .filter(
              (product) =>
                product.stock > 0 &&
                product.harvest_date !== null &&
                product.harvest_date <= today,
            )
            .map((product) => ({ farm, product })),
        );
        const analyzed = await Promise.all(
          datedListings.map(async ({ farm, product }) => ({
            farm,
            product,
            freshness: await analyzeFreshness(
              product.id,
              "not provided",
            ),
          })),
        );

        if (active) {
          setFarmerUrgency(
            analyzed.sort((left, right) => {
              const riskRank = { Critical: 0, Moderate: 1, Fresh: 2 };
              return (
                riskRank[left.freshness.risk_level] -
                  riskRank[right.freshness.risk_level] ||
                right.freshness.age_in_days - left.freshness.age_in_days
              );
            }),
          );
          if (datedListings.length === 0) {
            setFarmerNotice(
              "Add a harvest date to in-stock listings to get sell-urgency estimates. Future pre-orders are not treated as harvested produce.",
            );
          }
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setFarmerError(
            "Could not analyze your farm's produce: " +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      })
      .finally(() => {
        if (active) setFarmerLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const asksUrgency =
      /sell fast|sell first|urgent|perishable|spoil|discount|freshness|markdown|clearance/i.test(
        trimmed,
      );
    let reply: string;
    if (asksUrgency && user?.role === "farmer") {
      if (farmerLoading) {
        reply = "I’m checking harvest-dated stock from your verified farm now.";
      } else if (farmerError) {
        reply = farmerError;
      } else if (farmerUrgency.length === 0) {
        reply =
          farmerNotice ||
          "I could not find harvest-dated, in-stock listings on your verified farms yet.";
      } else {
        const priorities = farmerUrgency.slice(0, 5).map(
          ({ product, freshness }) =>
            `• ${product.name}: ${urgencyLabel(freshness.risk_level)} — harvested ${freshness.age_in_days} days ago; estimated discount ${freshness.suggested_discount_pct}%.`,
        );
        reply = `Prioritize these listings from your verified farm:\n${priorities.join("\n")}\n\nThese are rule-based estimates, not food-safety checks. Suggested discounts are advisory only; listing prices have not changed.`;
      }
    } else if (asksUrgency) {
      reply = urgentLoading
        ? "I’m checking current harvest-dated listings for urgency."
        : urgentError
          ? urgentError
          : urgentProducts.length === 0
            ? catalogLoading
              ? "I’m checking the marketplace for harvest-dated produce."
              : products.some((product) => product.harvest_date)
                ? "No current listings with harvest dates are flagged as Moderate or Critical. This does not guarantee produce quality or safety."
                : "There are no harvest-dated listings to assess yet. Farmers need to add the actual harvest date in Farmer tools before freshness urgency can be estimated."
            : `I found ${urgentProducts.length} public listing${urgentProducts.length === 1 ? "" : "s"} with an estimated Moderate or Critical freshness risk. Check the urgency cards below. Suggested discounts are advisory; the listed prices have not been changed.`;
    } else {
      reply = catalogError
        ? "I can’t check current produce listings because the catalog failed to load. Please reload the page and try again."
        : answerMarketplaceQuestion(trimmed, products);
    }
    setMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      { role: "assistant", text: reply },
    ]);
    setQuestion("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(question);
  };

  const suggestions =
    user?.role === "farmer"
      ? ["Which of my produce should I sell fast?", "How much discount should I offer?"]
      : BUYER_SUGGESTIONS;

  return (
    <section className="assistant-page">
      <h2>{t("Mkulima assistant")}</h2>
      <p className="mut">
        Get harvest urgency estimates, prioritize produce to sell, and see an
        advisory discount suggestion.
      </p>
      <p className="notice">
        Uses harvest dates and rule-based shelf-life estimates, not an external
        AI model or food-safety assessment. Suggested discounts never change
        listing prices automatically.
      </p>
      {catalogError && <p className="notice error">{catalogError}</p>}
      {user?.role === "farmer" && (
        <section className="assistant-urgency-section">
          <div className="assistant-section-heading">
            <div>
              <span className="landing-eyebrow">Private farm insights</span>
              <h3>Your produce to prioritize</h3>
            </div>
            <button className="btn" onClick={onOpenFarmerTools} type="button">
              Open Farmer tools
            </button>
          </div>
          {farmerLoading && (
            <p className="mut">Checking your harvest-dated listings…</p>
          )}
          {farmerError && <p className="notice error">{farmerError}</p>}
          {farmerNotice && <p className="notice">{farmerNotice}</p>}
          {!farmerLoading && !farmerError && farmerUrgency.length > 0 && (
            <div className="assistant-urgency-grid">
              {farmerUrgency.map(({ farm, product, freshness }) => (
                <article className="card assistant-urgency-card" key={product.id}>
                  <div className="assistant-urgency-header">
                    <span
                      className={`badge ${freshness.risk_level.toLowerCase()}`}
                    >
                      {urgencyLabel(freshness.risk_level)}
                    </span>
                    <span className="mut">{farm.name}</span>
                  </div>
                  <h4>{product.name}</h4>
                  <p className="mut">
                    Harvested {freshness.age_in_days} day
                    {freshness.age_in_days === 1 ? "" : "s"} ago ·{" "}
                    {product.stock} {product.unit} in stock
                  </p>
                  <p className="mut">
                    Harvest date: {dateLabel(product.harvest_date)}
                  </p>
                  <p>
                    Suggested discount:{" "}
                    <b>{freshness.suggested_discount_pct}%</b>
                    {freshness.suggested_discount_pct > 0 &&
                      ` · Example price KES ${(product.price_kes * (1 - freshness.suggested_discount_pct / 100)).toFixed(2)}/${product.unit}`}
                  </p>
                  <p className="mut">{freshness.storage_note}</p>
                  <small>Suggestion only. Your listing price is unchanged.</small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {user?.role !== "farmer" && (
        <section className="assistant-urgency-section">
          <div className="assistant-section-heading">
            <div>
              <span className="landing-eyebrow">Harvest-dated listings</span>
              <h3>Produce that may need selling soon</h3>
            </div>
          </div>
          {urgentLoading && (
            <p className="mut">Checking current harvest dates…</p>
          )}
          {urgentError && <p className="notice error">{urgentError}</p>}
          {!urgentLoading && !urgentError && urgentProducts.length === 0 && (
            <p className="mut">
              {catalogLoading
                ? "Checking listings…"
                : products.some((product) => product.harvest_date)
                  ? "No current listings with harvest dates are flagged as Moderate or Critical."
                  : "No harvest-dated listings are available to assess yet. Farmers need to add actual harvest dates in Farmer tools."}
            </p>
          )}
          {!urgentError && urgentProducts.length > 0 && (
            <div className="assistant-urgency-grid">
              {urgentProducts.map((product) => (
                <article className="card assistant-urgency-card" key={product.id}>
                  <ProductImage
                    name={product.name}
                    farmName={product.farm}
                    imageUrl={product.image_url}
                  />
                  <div className="assistant-urgency-header">
                    <span
                      className={`badge ${product.freshness.risk_level.toLowerCase()}`}
                    >
                      {urgencyLabel(product.freshness.risk_level)}
                    </span>
                    <span className="mut">{product.county}</span>
                  </div>
                  <h4>{product.name}</h4>
                  <p className="mut">
                    {product.farm} · Harvested{" "}
                    {product.freshness.age_in_days} days ago
                  </p>
                  <p>
                    Current price:{" "}
                    <b>KES {product.price_kes}/{product.unit}</b>
                  </p>
                  <p className="mut">
                    Advisory discount: {product.freshness.suggested_discount_pct}%
                    {product.freshness.suggested_discount_pct > 0 &&
                      ` (example KES ${(product.price_kes * (1 - product.freshness.suggested_discount_pct / 100)).toFixed(2)}/${product.unit})`}
                  </p>
                  <small>
                    A suggested markdown only. The farm has not changed its
                    listed price.
                  </small>
                  {user?.role === "buyer" ? (
                    <button
                      className="btn g"
                      onClick={() => onAddToCart(product)}
                      type="button"
                    >
                      Add at listed price
                    </button>
                  ) : !user ? (
                    <button
                      className="btn g"
                      onClick={() => onAddToCart(product)}
                      type="button"
                    >
                      Sign in to add to cart
                    </button>
                  ) : (
                    <p className="mut">
                      Sign in with a buyer account to add produce to your cart.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      <article className="card assistant-card">
        <div className="assistant-log" aria-live="polite" ref={logRef}>
          {messages.map((message, index) => (
            <div
              className={`assistant-message ${message.role === "user" ? "mine" : ""}`}
              key={`${index}-${message.role}`}
            >
              <b>{message.role === "user" ? "You" : "Assistant"}</b>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        <div className="assistant-suggestions" aria-label="Suggested questions">
          {suggestions.map((suggestion) => (
            <button
              className="btn"
              key={suggestion}
              onClick={() => ask(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form className="assistant-compose" onSubmit={submit}>
          <label className="form-field">
            Your question
            <textarea
              maxLength={500}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("e.g. Which farm has the cheapest potatoes?")}
            />
          </label>
          <button className="btn g" disabled={!question.trim()}>
            Ask
          </button>
        </form>
      </article>
    </section>
  );
}
