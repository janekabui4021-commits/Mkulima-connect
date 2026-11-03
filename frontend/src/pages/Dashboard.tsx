import { useEffect, useState } from "react";
import {
  getBuyerOrders,
  getBuyerAnalytics,
  getBuyerFavorites,
  getFarmerOrders,
  getFarmIncome,
  getFarmerSalesAnalytics,
  getFarmProducts,
  getManageableFarms,
  getOfftakeQuotes,
  getOfftakeRequests,
  getProducts,
  compareProduct,
} from "../api";
import type {
  AuthUser,
  BuyerAnalytics,
  FarmIncome,
  FarmProduct,
  FarmerSalesAnalytics,
  ManagedFarm,
  OfftakeQuote,
  OfftakeRequest,
  OrderItem,
  Product,
} from "../api";
import { useTranslation } from "../i18n";

type DashboardTab =
  | "market"
  | "farms"
  | "transport"
  | "groups"
  | "assistant"
  | "orders"
  | "messages"
  | "offtake"
  | "farmer"
  | "favorites"
  | "profile"
  | "crop-health"
  | "forecast";

interface Props {
  user: AuthUser;
  onNavigate: (tab: DashboardTab) => void;
}

interface DashboardAction {
  title: string;
  description: string;
  tab: DashboardTab;
}

function ActionCards({
  actions,
  onNavigate,
}: {
  actions: DashboardAction[];
  onNavigate: Props["onNavigate"];
}) {
  const { t } = useTranslation();

  return (
    <div className="dashboard-actions">
      {actions.map((action) => (
        <button
          className="card dashboard-action"
          key={`${action.tab}-${action.title}`}
          type="button"
          onClick={() => onNavigate(action.tab)}
        >
          <b>{t(action.title)}</b>
          <span className="mut">{t(action.description)}</span>
        </button>
      ))}
    </div>
  );
}

function BuyerDashboard({ user, onNavigate }: Props) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [analytics, setAnalytics] = useState<BuyerAnalytics>();
  const [favoriteCount, setFavoriteCount] = useState<number>();
  const [commodityPeriod, setCommodityPeriod] =
    useState<"week" | "month" | "year">("month");
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [bulkRequests, setBulkRequests] = useState<OfftakeRequest[]>([]);
  const [bulkQuotes, setBulkQuotes] = useState<OfftakeQuote[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [buyerOrders, listings] = await Promise.all([
          getBuyerOrders(),
          getProducts(),
        ]);
        setOrders(buyerOrders);
        setProducts(listings);

        const [spending, favorites] = await Promise.allSettled([
          getBuyerAnalytics(),
          getBuyerFavorites(),
        ]);
        const detailErrors: string[] = [];
        if (spending.status === "fulfilled") {
          setAnalytics(spending.value);
        } else {
          detailErrors.push(
            "Buying analytics: " +
              (spending.reason instanceof Error
                ? spending.reason.message
                : String(spending.reason)),
          );
        }
        if (favorites.status === "fulfilled") {
          setFavoriteCount(favorites.value.length);
        } else {
          detailErrors.push(
            "Saved commodities: " +
              (favorites.reason instanceof Error
                ? favorites.reason.message
                : String(favorites.reason)),
          );
        }
        if (detailErrors.length) {
          setDetailsError(
            "Some dashboard details could not load: " + detailErrors.join("; "),
          );
        }
      } catch (cause: unknown) {
        setError(
          "Could not load your dashboard: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    })();
  }, []);

  useEffect(() => {
    Promise.all([getOfftakeRequests(), getOfftakeQuotes()])
      .then(([nextRequests, nextQuotes]) => {
        setBulkRequests(nextRequests);
        setBulkQuotes(nextQuotes);
      })
      .catch((cause: unknown) => {
        setDetailsError(
          "Bulk request details could not load: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, []);

  const inProgressOrders = orders.filter(
    (order) => order.fulfillment_status !== "delivered",
  ).length;
  const reviewsDue = orders.filter(
    (order) => order.fulfillment_status === "delivered" && !order.review_rating,
  ).length;

  return (
    <section className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <span className="landing-eyebrow">{t("BUYER DASHBOARD")}</span>
          <h1>{t("Welcome back")}, {user.name}</h1>
          <p className="mut">
            {t("Track your orders, discover fresh produce, and connect with farms.")}
          </p>
        </div>
      </header>
      {error && <p className="notice error">{error}</p>}
      {detailsError && <p className="notice">{detailsError}</p>}
      <div className="dashboard-stats">
        <article className="card dashboard-stat">
          <span className="mut">{t("My orders")}</span>
          <b>{orders.length}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Deliveries in progress")}</span>
          <b>{inProgressOrders}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Reviews to write")}</span>
          <b>{reviewsDue}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Available listings")}</span>
          <b>{products.length}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Saved commodities")}</span>
          <b>{favoriteCount ?? "—"}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Spent this week")}</span>
          <b>{analytics ? `KES ${analytics.this_week_spend_kes.toLocaleString()}` : "—"}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Spent this month")}</span>
          <b>{analytics ? `KES ${analytics.this_month_spend_kes.toLocaleString()}` : "—"}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Spent this year")}</span>
          <b>{analytics ? `KES ${analytics.this_year_spend_kes.toLocaleString()}` : "—"}</b>
        </article>
      </div>
      <section className="card dashboard-verification-cta">
        <div>
          <h2>{t("Bulk orders and pre-orders")}</h2>
          <p className="mut">
            {bulkRequests.filter((request) => request.active).length} active requests ·{" "}
            {bulkQuotes.filter((quote) => quote.status === "quoted").length} quotes to review
          </p>
        </div>
        <button className="btn g" type="button" onClick={() => onNavigate("offtake")}>
          {t("Track requests and quotes")}
        </button>
      </section>
      <section className="dashboard-report">
        <h2>{t("Buying analytics")}</h2>
        <p className="mut">{t("Paid purchase totals by commodity; pending and cancelled orders are excluded.")}</p>
        {analytics ? (
          <>
            <label className="form-field dashboard-period-select">
              {t("Show purchases for")}
              <select
                value={commodityPeriod}
                onChange={(event) => {
                  const nextPeriod = event.target.value;
                  if (nextPeriod === "week" || nextPeriod === "month" || nextPeriod === "year") {
                    setCommodityPeriod(nextPeriod);
                  }
                }}
              >
                <option value="week">{t("This week")}</option>
                <option value="month">{t("This month")}</option>
                <option value="year">{t("This year")}</option>
              </select>
            </label>
            {analytics[
          commodityPeriod === "week"
            ? "this_week_commodities"
            : commodityPeriod === "month"
              ? "this_month_commodities"
              : "this_year_commodities"
            ].length ? (
              <div className="dashboard-report-list">
                {analytics[
                  commodityPeriod === "week"
                    ? "this_week_commodities"
                    : commodityPeriod === "month"
                      ? "this_month_commodities"
                      : "this_year_commodities"
                ].map((commodity) => (
                  <article className="card dashboard-report-row" key={`${commodity.product}-${commodity.unit}`}>
                    <b>{commodity.product}</b>
                    <span>{commodity.units_bought.toLocaleString()} {commodity.unit}</span>
                    <b>KES {commodity.amount_kes.toLocaleString()}</b>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mut">{t("No paid purchases to summarize yet.")}</p>
            )}
          </>
        ) : (
          <p className="mut">{t("Buying analytics are unavailable from the current server.")}</p>
        )}
      </section>
      <h2>{t("Your buyer tools")}</h2>
      <ActionCards
        onNavigate={onNavigate}
        actions={[
          {
            title: "Farm-to-buyer harvest matching",
            description: "Request bulk produce, compare farm quotes, and pay accepted orders.",
            tab: "offtake",
          },
          {
            title: "Marketplace and quick add to cart",
            description: "Browse commodities, choose quantities, and add produce to your cart.",
            tab: "market",
          },
          {
            title: "Saved commodities",
            description: "Open your saved produce and compare current listings.",
            tab: "favorites",
          },
          {
            title: "Orders, reviews, and ratings",
            description: "Track deliveries and review completed orders.",
            tab: "orders",
          },
          {
            title: "Explore verified farms",
            description: "Learn about farms and see where produce comes from.",
            tab: "farms",
          },
          {
            title: "Transport suggestions",
            description: "Find transport providers and view their service details.",
            tab: "transport",
          },
          {
            title: "Messages with farmers",
            description: "Continue conversations with farmers.",
            tab: "messages",
          },
          {
            title: "My profile",
            description: "Update your name and email address.",
            tab: "profile",
          },
        ]}
      />
    </section>
  );
}

function FarmerDashboard({ user, onNavigate }: Props) {
  const { t } = useTranslation();
  const [farms, setFarms] = useState<ManagedFarm[]>([]);
  const [products, setProducts] = useState<FarmProduct[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [salesReports, setSalesReports] = useState<
    { farm: ManagedFarm; analytics: FarmerSalesAnalytics; income: FarmIncome }[]
  >([]);
  const [competitorListings, setCompetitorListings] = useState<
    Record<string, Product[]>
  >({});
  const [marketInsightError, setMarketInsightError] = useState("");
  const [error, setError] = useState("");
  const [bulkRequests, setBulkRequests] = useState<OfftakeRequest[]>([]);
  const [bulkQuotes, setBulkQuotes] = useState<OfftakeQuote[]>([]);

  useEffect(() => {
    getManageableFarms()
      .then(async (managedFarms) => {
        const verifiedFarms = managedFarms.filter((farm) => farm.status === "verified");
        const farmData = await Promise.all(
          verifiedFarms.map(async (farm) => {
            const [farmProducts, farmOrders, analytics, income] = await Promise.all([
              getFarmProducts(farm.id),
              getFarmerOrders(farm.id),
              getFarmerSalesAnalytics(farm.id),
              getFarmIncome(farm.id),
            ]);
            return { farm, farmProducts, farmOrders, analytics, income };
          }),
        );
        setFarms(managedFarms);
        setProducts(farmData.flatMap((data) => data.farmProducts));
        setOrders(farmData.flatMap((data) => data.farmOrders));
        setSalesReports(
          farmData.map(({ farm, analytics, income }) => ({ farm, analytics, income })),
        );
        const ownedFarmIds = new Set(verifiedFarms.map((farm) => farm.id));
        const productNames = Array.from(
          new Map(
            farmData
              .flatMap(({ farmProducts }) => farmProducts)
              .filter((product) => product.stock > 0)
              .map((product) => [product.name.trim().toLocaleLowerCase(), product.name]),
          ).values(),
        ).slice(0, 8);
        const comparisons = await Promise.allSettled(
          productNames.map(async (name) => {
            const listings = await compareProduct(name);
            return [
              name.trim().toLocaleLowerCase(),
              listings.filter((listing) => !ownedFarmIds.has(listing.farm_id)),
            ] as const;
          }),
        );
        const nextCompetitors: Record<string, Product[]> = {};
        const comparisonErrors: string[] = [];
        for (const comparison of comparisons) {
          if (comparison.status === "fulfilled") {
            nextCompetitors[comparison.value[0]] = comparison.value[1];
          } else {
            comparisonErrors.push(
              comparison.reason instanceof Error
                ? comparison.reason.message
                : String(comparison.reason),
            );
          }
        }
        setCompetitorListings(nextCompetitors);
        setMarketInsightError(
          comparisonErrors.length
            ? `Some competitor prices could not be loaded: ${comparisonErrors.join("; ")}`
            : "",
        );
      })
      .catch((cause: unknown) => {
        setError(
          "Could not load your dashboard: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, []);

  useEffect(() => {
    Promise.all([getOfftakeRequests(), getOfftakeQuotes()])
      .then(([nextRequests, nextQuotes]) => {
        setBulkRequests(nextRequests);
        setBulkQuotes(nextQuotes);
      })
      .catch((cause: unknown) => {
        setError(
          "Bulk request details could not load: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, []);

  const activeListings = products.filter((product) => product.stock > 0).length;
  const ordersToProcess = orders.filter(
    (order) => order.fulfillment_status === "pending",
  ).length;
  const pendingFarms = farms.filter((farm) => farm.status === "pending").length;
  const verifiedFarms = farms.filter((farm) => farm.status === "verified").length;
  const ownedFarmIds = new Set(farms.map((farm) => farm.id));
  const productsToCompare = products.filter((product) => product.stock > 0);

  return (
    <section className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <span className="landing-eyebrow">{t("FARMER DASHBOARD")}</span>
          <h1>{t("Welcome back")}, {user.name}</h1>
          <p className="mut">
            {t("Manage your farms, listings, and customer orders from here.")}
          </p>
        </div>
      </header>
      {error && <p className="notice error">{error}</p>}
      <div className="dashboard-stats">
        <article className="card dashboard-stat">
          <span className="mut">{t("My farms")}</span>
          <b>{farms.length}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Verified farms")}</span>
          <b>{verifiedFarms}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Active listings")}</span>
          <b>{activeListings}</b>
        </article>
        <article className="card dashboard-stat">
          <span className="mut">{t("Orders to process")}</span>
          <b>{ordersToProcess}</b>
        </article>
      </div>
      <section className="card dashboard-verification-cta">
        <div>
          <h2>{t("Farm verification")}</h2>
          <p className="mut">
            {t(
              pendingFarms > 0
                ? "Your farm verification is in progress. Continue with your phone code and farm evidence in Farmer tools."
                : "Start or review your farm verification. Phone OTP and farm evidence steps are available in Farmer tools.",
            )}
          </p>
        </div>
        <button
          className="btn g"
          type="button"
          onClick={() => onNavigate("farmer")}
        >
          {t(pendingFarms > 0 ? "Continue verification" : "Open verification")}
        </button>
      </section>
      {farms.length === 0 && !error && (
        <p className="notice">
          {t("You have not registered a farm yet. Start an application in Farmer tools.")}
        </p>
      )}
      {pendingFarms > 0 && (
        <p className="notice">
          {t("You have farm applications awaiting review.")}
        </p>
      )}
      <section className="card dashboard-verification-cta">
        <div>
          <h2>{t("Incoming bulk requests")}</h2>
          <p className="mut">
            {bulkRequests.length} matching requests ·{" "}
            {bulkQuotes.filter((quote) => quote.status === "quoted").length} quotes awaiting buyer response
          </p>
        </div>
        <button className="btn g" type="button" onClick={() => onNavigate("offtake")}>
          {t("Open bulk requests")}
        </button>
      </section>
      <section className="dashboard-report">
        <h2>{t("Sales performance")}</h2>
        <p className="mut">{t("Sales include paid orders only. Buyer highlights show repeat purchases, not a credit or trust rating.")}</p>
        {salesReports.length ? salesReports.map(({ farm, analytics, income }) => (
          <article className="card dashboard-sales-report" key={farm.id}>
            <h3>{farm.name} · {farm.county}</h3>
            <div className="dashboard-stats">
              <article className="dashboard-stat">
                <span className="mut">{t("Paid sales")}</span>
                <b>KES {Number(analytics.sales_kes).toLocaleString()}</b>
              </article>
              <article className="dashboard-stat">
                <span className="mut">{t("Units sold")}</span>
                <b>{Number(analytics.units_sold).toLocaleString()}</b>
              </article>
              <article className="dashboard-stat">
                <span className="mut">{t("Paid orders")}</span>
                <b>{analytics.paid_orders}</b>
              </article>
              <article className="dashboard-stat">
                <span className="mut">{t("Estimated profit")}</span>
                <b>KES {Number(income.estimated_profit_kes).toLocaleString()}</b>
              </article>
            </div>
            <h4>{t("Most-sold products")}</h4>
            {analytics.products.length ? (
              <div className="dashboard-report-list">
                {analytics.products.slice(0, 5).map((product) => (
                  <article className="dashboard-report-row" key={product.product_id}>
                    <b>{product.product} · {product.variety}</b>
                    <span>{Number(product.units_sold).toLocaleString()} {product.unit}</span>
                    <b>KES {Number(product.sales_kes).toLocaleString()}</b>
                  </article>
                ))}
              </div>
            ) : <p className="mut">{t("No paid sales yet.")}</p>}
            <h4>{t("Repeat buyers")}</h4>
            <p className="mut">{t(analytics.repeat_buyer_definition)}</p>
            {analytics.repeat_buyers.length ? (
              <div className="dashboard-report-list">
                {analytics.repeat_buyers.map((buyer) => (
                  <article className="dashboard-report-row" key={buyer.buyer_id}>
                    <b>{buyer.buyer_name}</b>
                    <span>{buyer.paid_orders} {t("paid orders")}</span>
                    <b>KES {Number(buyer.sales_kes).toLocaleString()}</b>
                  </article>
                ))}
              </div>
            ) : <p className="mut">{t("No repeat buyers yet.")}</p>}
          </article>
        )) : (
          <p className="mut">{t("Farm sales reports are available after your farm is verified.")}</p>
        )}
      </section>
      <section className="dashboard-report">
        <h2>{t("Market prices and buyer demand")}</h2>
        <p className="mut">
          {t("Compare your asking prices with other in-stock listings. Buyer demand matching future harvests is available in Harvest Matching.")}
        </p>
        {marketInsightError && <p className="notice error">{marketInsightError}</p>}
        {productsToCompare.length === 0 ? (
          <p className="mut">{t("Publish an in-stock listing to monitor comparable marketplace prices.")}</p>
        ) : (
          <div className="dashboard-report-list">
            {productsToCompare.slice(0, 8).map((product) => {
              const competitors =
                (competitorListings[product.name.trim().toLocaleLowerCase()] ?? [])
                  .filter(
                    (listing) =>
                      !ownedFarmIds.has(listing.farm_id) &&
                      listing.unit.trim().toLocaleLowerCase() ===
                        product.unit.trim().toLocaleLowerCase() &&
                      listing.variety.trim().toLocaleLowerCase() ===
                        product.variety.trim().toLocaleLowerCase(),
                  );
              const prices = competitors
                .map((listing) => Number(listing.price_kes))
                .filter(Number.isFinite)
                .sort((left, right) => left - right);
              return (
                <article className="dashboard-report-row" key={product.id}>
                  <b>{product.name} · {product.variety}</b>
                  <span>{t("Your price")}: KES {Number(product.price_kes).toLocaleString()}/{product.unit}</span>
                  <span>
                    {prices.length
                      ? `${t("Competitor range")}: KES ${prices[0].toLocaleString()}–${prices[prices.length - 1].toLocaleString()}/${product.unit} (${competitors.length} ${t("listings")})`
                      : t("No comparable in-stock listings found.")}
                  </span>
                </article>
              );
            })}
          </div>
        )}
        {productsToCompare.length > 8 && (
          <p className="mut">{t("Showing the first 8 in-stock products.")}</p>
        )}
        <button className="btn" type="button" onClick={() => onNavigate("offtake")}>
          {t("View matching buyer demand")}
        </button>
      </section>
      <h2>{t("Your farmer tools")}</h2>
      <ActionCards
        onNavigate={onNavigate}
        actions={[
          {
            title: "Farm-to-buyer harvest matching",
            description: "Review incoming bulk requests and respond with availability, price, or a counter-offer.",
            tab: "offtake",
          },
          {
            title: "Farm profile and verification",
            description: "Apply for a farm, check its status, and complete verification.",
            tab: "farmer",
          },
          {
            title: "Products, sales, and expenses",
            description: "Manage produce listings and review the farm income tracker.",
            tab: "farmer",
          },
          {
            title: "Forecast and weather warnings",
            description: "Check a farm's weather forecast and saved weather warnings.",
            tab: "farmer",
          },
          {
            title: "Freshness assistant",
            description: "Review freshness estimates for your harvest-dated produce.",
            tab: "assistant",
          },
          {
            title: "Crop health guide",
            description: "Check common symptoms and find nearby agrovets.",
            tab: "crop-health",
          },
          {
            title: "Harvest projection",
            description: "Estimate harvest volume and gross revenue from your own assumptions.",
            tab: "forecast",
          },
          {
            title: "Incoming orders",
            description: "Review farm orders and update fulfillment progress.",
            tab: "farmer",
          },
          {
            title: "Farmer groups",
            description: "Share knowledge and coordinate with other farmers.",
            tab: "groups",
          },
          {
            title: "Messages with buyers",
            description: "Reply to conversations with buyers.",
            tab: "messages",
          },
          {
            title: "My profile",
            description: "Update your name and email address.",
            tab: "profile",
          },
        ]}
      />
    </section>
  );
}

export default function Dashboard(props: Props) {
  if (props.user.role === "buyer") return <BuyerDashboard {...props} />;
  if (props.user.role === "farmer") return <FarmerDashboard {...props} />;
  return null;
}
