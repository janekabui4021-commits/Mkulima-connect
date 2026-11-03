import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  addBuyerFavorite,
  getBuyerFavorites,
  getMarketplaceOptions,
  getProducts,
  removeBuyerFavorite,
  savePriceAlert,
} from "../api";
import type { MarketplaceOptions, Product } from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

function categoryIcon(category: string): string {
  const value = category.toLocaleLowerCase();
  if (/fruit/.test(value)) return "🍎";
  if (/vegetable|greens/.test(value)) return "🥬";
  if (/grain|cereal/.test(value)) return "🌾";
  if (/dairy|milk/.test(value)) return "🥛";
  if (/legume|bean|pulse/.test(value)) return "🫘";
  return "🧺";
}

function seasonLabel(season: Product["season_tier"]): string {
  if (season === "in_season") return "In season";
  return `${season.replace("_", " ")} season`;
}

interface Props {
  onAdd: (product: Product, quantity: number) => boolean;
  county: string;
  setCounty: (county: string) => void;
  onMessageProduct: (productId: number) => void;
  canMessage: boolean;
  canPurchase: boolean;
  canSignInToMessage: boolean;
  favoritesOnly?: boolean;
}

export default function Market({
  onAdd,
  county,
  setCounty,
  onMessageProduct,
  canMessage,
  canPurchase,
  canSignInToMessage,
  favoritesOnly = false,
}: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [availability, setAvailability] = useState<"in_stock" | "all">("in_stock");
  const [sortOrder, setSortOrder] = useState<
    "recommended" | "price_low" | "price_high"
  >("recommended");
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<MarketplaceOptions | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number>();
  const [quantity, setQuantity] = useState("1");
  const [toast, setToast] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);

  const invalidPriceRange =
    minimumPrice !== "" &&
    maximumPrice !== "" &&
    Number(minimumPrice) > Number(maximumPrice);
  const filteredItems = items.filter((product) => {
    const matchesSearch =
      !favoritesOnly ||
      `${product.name} ${product.variety} ${product.farm} ${product.county}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase());
    const matchesMinimum =
      minimumPrice === "" || product.price_kes >= Number(minimumPrice);
    const matchesMaximum =
      maximumPrice === "" || product.price_kes <= Number(maximumPrice);
    return matchesSearch && matchesMinimum && matchesMaximum;
  });
  const selectedProduct = items.find((product) => product.id === selectedProductId);
  const productOptions = selectedProduct
    ? filteredItems.filter(
        (product) =>
          product.name.trim().toLocaleLowerCase() ===
            selectedProduct.name.trim().toLocaleLowerCase() &&
          (availability === "all" || product.stock > 0),
      )
    : [];
  const varieties = Array.from(
    new Map(
      productOptions.map((product) => [
        product.variety.trim().toLocaleLowerCase(),
        product.variety.trim(),
      ]),
    ).values(),
  );
  const varietyListings = selectedProduct
    ? productOptions.filter(
        (product) =>
          product.variety.trim().toLocaleLowerCase() ===
          selectedProduct.variety.trim().toLocaleLowerCase(),
      )
    : [];
  const produceGroups = Array.from(
    filteredItems.reduce((groups, product) => {
      const key = product.name.trim().toLocaleLowerCase();
      const group = groups.get(key) ?? [];
      group.push(product);
      groups.set(key, group);
      return groups;
    }, new Map<string, Product[]>()),
  ).map(([, products]) =>
    products.sort((left, right) => {
      if (left.stock > 0 && right.stock === 0) return -1;
      if (left.stock === 0 && right.stock > 0) return 1;
      return left.price_kes - right.price_kes;
    }),
  );
  if (sortOrder !== "recommended") {
    produceGroups.sort((left, right) => {
      const difference = left[0].price_kes - right[0].price_kes;
      return sortOrder === "price_low" ? difference : -difference;
    });
  }
  const pageSize = 12;
  const pageCount = Math.ceil(produceGroups.length / pageSize);
  const pagedProduceGroups = produceGroups.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );

  useEffect(() => {
    setPage(0);
    setSelectedProductId(undefined);
  }, [query, county, category, minimumPrice, maximumPrice, availability, sortOrder]);

  useEffect(() => {
    getMarketplaceOptions()
      .then(setOptions)
      .catch((cause: unknown) =>
        setToast(
          "Could not load marketplace settings: " +
            (cause instanceof Error ? cause.message : String(cause)),
        ),
      );
  }, []);

  useEffect(() => {
    let active = true;
    const loadListings = favoritesOnly
      ? getBuyerFavorites().then((favorites) => {
          if (!active) return;
          setFavoriteIds(favorites.map((product) => product.id));
          setItems(favorites);
        })
      : getProducts(query, county, category, availability).then((products) => {
          if (active) {
            setItems(
              products.map((product) => ({
                ...product,
                variety: product.variety || "Standard",
              })),
            );
          }
        });
    loadListings.catch((cause: unknown) => {
      if (!active) return;
      setItems([]);
      setToast(
        `Could not load ${favoritesOnly ? "saved commodities" : "marketplace listings"}: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    });
    if (canPurchase && !favoritesOnly) {
      getBuyerFavorites()
        .then((favorites) => {
          if (active) setFavoriteIds(favorites.map((product) => product.id));
        })
        .catch((cause: unknown) => {
          if (active) {
            setToast(
              "Could not load saved commodities: " +
                (cause instanceof Error ? cause.message : String(cause)),
            );
          }
        });
    }
    return () => {
      active = false;
    };
  }, [query, county, category, availability, canPurchase, favoritesOnly]);

  const toggleFavorite = async (product: Product) => {
    const isFavorite = favoriteIds.includes(product.id);
    try {
      if (isFavorite) {
        await removeBuyerFavorite(product.id);
        setFavoriteIds((current) => current.filter((id) => id !== product.id));
        if (favoritesOnly) {
          setItems((current) => current.filter((item) => item.id !== product.id));
        }
      } else {
        await addBuyerFavorite(product.id);
        setFavoriteIds((current) => [...current, product.id]);
      }
    } catch (cause) {
      setToast(
        "Could not update saved commodities: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const openOptions = (product: Product) => {
    setSelectedProductId(product.id);
    setQuantity("1");
  };

  const addSelectedProduct = () => {
    if (!selectedProduct) return;
    const requestedQuantity = Number(quantity);
    if (
      !Number.isFinite(requestedQuantity) ||
      requestedQuantity <= 0 ||
      requestedQuantity > selectedProduct.stock
    ) {
      setToast(`Choose a quantity up to ${selectedProduct.stock} ${selectedProduct.unit}.`);
      return;
    }
    if (!onAdd(selectedProduct, requestedQuantity)) {
      setToast(`Only ${Math.max(0, selectedProduct.stock)} ${selectedProduct.unit} are available for this listing.`);
      return;
    }
    setSelectedProductId(undefined);
    setToast(
      `${requestedQuantity} ${selectedProduct.unit} of ${selectedProduct.variety} ${selectedProduct.name} added to cart.`,
    );
    window.setTimeout(() => setToast(""), 2500);
  };

  const discountedUnitPrice = selectedProduct
    ? selectedProduct.price_kes *
      (Number(quantity) >= 50 ? 0.9 : Number(quantity) >= 10 ? 0.95 : 1)
    : 0;
  const total = discountedUnitPrice * Number(quantity || 0);

  const hasFilters =
    query.trim() !== "" ||
    county !== "" ||
    category !== "" ||
    minimumPrice !== "" ||
    maximumPrice !== "" ||
    availability !== "in_stock" ||
    sortOrder !== "recommended";

  const handlePriceAlertSubmit = async (
    event: FormEvent<HTMLFormElement>,
    product: Product,
  ) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const targetPrice = Number(formData.get("targetPrice"));
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      setToast(t("Enter a valid target price greater than zero."));
      return;
    }

    try {
      await savePriceAlert(product.id, targetPrice);
      setToast(t("Price alert saved. You will be notified when the price reaches your target."));
    } catch (cause) {
      setToast(
        `${t("Could not save price alert")}: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  return (
    <section>
      <h2>{t(favoritesOnly ? "Saved commodities" : "Agricultural Marketplace")}</h2>
      {options?.marketplace_enabled === false && (
        <p className="notice">The marketplace is temporarily paused by an administrator.</p>
      )}
      <div className="bar">
        <input
          aria-label={t("Search products, farms or sellers")}
          placeholder={t("Search products, farms or sellers")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="market-filter">
          <span className="sr-only">{t("Search counties")}</span>
          <input
            list="market-counties"
            placeholder={t("All counties")}
            value={county}
            onChange={(event) => setCounty(event.target.value)}
          />
          <datalist id="market-counties">
            {(options?.counties ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <select
          value={category}
          aria-label="Filter by product category"
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">🧺 {t("All categories")}</option>
          {(options?.categories ?? []).map((name) => (
            <option key={name} value={name}>
              {categoryIcon(name)} {name}
            </option>
          ))}
        </select>
        <label className="market-filter">
          <span className="sr-only">{t("Minimum price (KES)")}</span>
          <input
            type="number"
            min="0"
            placeholder={t("Min price (KES)")}
            value={minimumPrice}
            onChange={(event) => setMinimumPrice(event.target.value)}
          />
        </label>
        <label className="market-filter">
          <span className="sr-only">{t("Maximum price (KES)")}</span>
          <input
            type="number"
            min={minimumPrice || "0"}
            placeholder={t("Max price (KES)")}
            value={maximumPrice}
            onChange={(event) => setMaximumPrice(event.target.value)}
          />
        </label>
        <select
          value={availability}
          aria-label={t("Availability")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "in_stock" || value === "all") setAvailability(value);
          }}
        >
          <option value="in_stock">{t("In stock only")}</option>
          <option value="all">{t("All availability")}</option>
        </select>
        <select
          value={sortOrder}
          aria-label={t("Sort listings")}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === "recommended" ||
              value === "price_low" ||
              value === "price_high"
            ) {
              setSortOrder(value);
            }
          }}
        >
          <option value="recommended">{t("Recommended")}</option>
          <option value="price_low">{t("Price: low to high")}</option>
          <option value="price_high">{t("Price: high to low")}</option>
        </select>
        {hasFilters && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              setQuery("");
              setCounty("");
              setCategory("");
              setMinimumPrice("");
              setMaximumPrice("");
              setAvailability("in_stock");
              setSortOrder("recommended");
            }}
          >
            {t("Clear filters")}
          </button>
        )}
      </div>
      {invalidPriceRange && (
        <p className="notice" role="alert">
          {t("Minimum price cannot be greater than maximum price.")}
        </p>
      )}
      <p className="mut market-result-count">
        {produceGroups.length} {t("produce listings")}
      </p>
      <div className="grid market-product-grid">
        {pagedProduceGroups.map((products) => {
          const product = products[0];
          const groupVarieties = Array.from(
            new Map(
              products.map((listing) => [
                listing.variety.trim().toLocaleLowerCase(),
                listing.variety.trim(),
              ]),
            ).values(),
          );
          return (
          <article className="card market-product-card" key={product.name.trim().toLocaleLowerCase()}>
            <ProductImage
              name={product.name}
              farmName={product.farm}
              imageUrl={product.image_url}
            />
            <h3>{product.name}</h3>
            {canPurchase && (
              <button
                type="button"
                className="btn favorite-toggle"
                aria-pressed={favoriteIds.includes(product.id)}
                onClick={() => void toggleFavorite(product)}
              >
                {favoriteIds.includes(product.id)
                  ? `★ ${t("Saved")}`
                  : `☆ ${t("Save commodity")}`}
              </button>
            )}
            <p className="mut">
              {product.category} · {product.farm} · {product.county}
            </p>
            {product.description && <p>{product.description}</p>}
            <span className={`verification-badge${product.verification_level === "provisional" ? " provisional" : ""}`}>
              ✔ {product.verification_level === "provisional"
                ? t("Provisionally Verified")
                : t("Fully Verified")}
            </span>
            <p className="price">
              KES {product.price_kes} / {product.unit}
            </p>
            <p className="mut">
              {products.length} {t("farm listings")}
            </p>
            <span className={`availability-badge${product.stock > 0 ? " available" : ""}`}>
              {product.stock > 0 ? t("In stock") : t("Out of stock")}
            </span>
            <p className="mut">
              {groupVarieties.length === 1 ? "Variety" : "Available varieties"}:{" "}
              {groupVarieties.join(", ")}
            </p>
            <p className="mut">
              {product.preorder_enabled
                ? `${t("Pre-order")} · ${t(seasonLabel(product.season_tier))}`
                : t(seasonLabel(product.season_tier))}
              {product.harvest_date
                ? ` · Harvest ${new Date(`${product.harvest_date}T00:00:00`).toLocaleDateString()}`
                : ""}
            </p>
            <p className="mut">
              {product.rating_count
                ? `⭐ ${product.rating} · ${product.rating_count} buyer review${product.rating_count === 1 ? "" : "s"}`
                : t("No reviews yet")}
            </p>
            <button
              className="btn g"
              style={{ width: "100%", marginTop: 8 }}
              type="button"
              disabled={canPurchase && product.stock <= 0}
              onClick={() => {
                if (canPurchase) openOptions(product);
                else if (canSignInToMessage) onMessageProduct(product.id);
              }}
            >
              {canPurchase
                ? product.stock <= 0
                  ? t("Out of stock")
                  : groupVarieties.length > 1
                    ? t("Choose type & farm")
                    : t("Choose variety & quantity")
                : canSignInToMessage
                  ? t("Sign in to contact seller")
                  : t("Buyer account required")}
            </button>
            {canMessage && (
              product.farmer_id ? (
                <button
                  className="btn market-message-button"
                  type="button"
                  onClick={() => onMessageProduct(product.id)}
                >
                  {t("Contact Farmer")}
                </button>
              ) : (
                <p className="mut">
                  {t("Messaging is unavailable because this farm has no active farmer account linked yet.")}
                </p>
              )
            )}
            {canPurchase && (
              <details className="market-price-alert">
                <summary>{t("Set a price alert")}</summary>
                <form
                  onSubmit={(event) => void handlePriceAlertSubmit(event, product)}
                >
                  <label>
                    {t("Notify me when price is at or below (KES)")}
                    <input
                      name="targetPrice"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder={String(product.price_kes)}
                      required
                    />
                  </label>
                  <button className="btn" type="submit">
                    {t("Save alert")}
                  </button>
                </form>
              </details>
            )}
          </article>
          );
        })}
      </div>
      {produceGroups.length === 0 && !invalidPriceRange && (
        <p className="notice">{t("No listings match your search and filters.")}</p>
      )}
      {pageCount > 1 && (
        <nav className="market-pagination" aria-label={t("Marketplace pages")}>
          <button
            className="btn"
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t("Previous")}
          </button>
          <span className="mut">
            {t("Page")} {page + 1} {t("of")} {pageCount}
          </span>
          <button
            className="btn"
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            {t("Next")}
          </button>
        </nav>
      )}
      {!favoritesOnly && (
        <footer className="market-info-footer">
          <nav aria-label={t("Marketplace information")}>
            <a href="#market-about">{t("About")}</a>
            <a href="#market-contact">{t("Contact")}</a>
            <a href="#market-help">{t("Help")}</a>
            <a href="#market-policies">{t("Marketplace policies")}</a>
          </nav>
          <section id="market-about">
            <h3>{t("About Mkulima Connect")}</h3>
            <p>{t("Connect with verified Kenyan farms and discover available produce.")}</p>
          </section>
          <section id="market-contact">
            <h3>{t("Contact")}</h3>
            <p>{t("Sign in and use Messages to contact a farm. Farmer phone numbers are not shared with buyers.")}</p>
          </section>
          <section id="market-help">
            <h3>{t("Help")}</h3>
            <p>{t("Search for produce, filter listings, and sign in to message farms or place an order.")}</p>
          </section>
          <section id="market-policies">
            <h3>{t("Marketplace policies")}</h3>
            <p>{t("Farm listings are reviewed. Confirm availability, quantity, and delivery with the farm through platform chat before ordering.")}</p>
          </section>
        </footer>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {selectedProduct && (
        <div className="modal" onClick={() => setSelectedProductId(undefined)}>
          <div
            className="box product-options"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="btn"
              type="button"
              onClick={() => setSelectedProductId(undefined)}
            >
              Close
            </button>
            <h3>Choose {selectedProduct.name} options</h3>
            {selectedProduct.description && <p>{selectedProduct.description}</p>}
            <p className="mut">
              Select the variety you want (for example Hass or Fuerte), then
              choose the farm and quantity.
            </p>
            <label className="form-field">
              {t("Produce variety / type")}
              <select
                value={selectedProduct.variety}
                onChange={(event) => {
                  const nextListing = productOptions.find(
                    (product) => product.variety === event.target.value,
                  );
                  if (nextListing) setSelectedProductId(nextListing.id);
                }}
              >
                {varieties.map((variety) => (
                  <option key={variety} value={variety}>{variety}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              {t("Farm and unit")}
              <select
                value={selectedProduct.id}
                onChange={(event) => setSelectedProductId(Number(event.target.value))}
              >
                {varietyListings.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.farm} · {product.county} · KES {product.price_kes}/{product.unit}
                  </option>
                ))}
              </select>
            </label>
            <p className="mut">
              {t("In stock")}: {selectedProduct.stock} {selectedProduct.unit}
              {selectedProduct.preorder_enabled && " · Pre-order available"}
            </p>
            <label className="form-field">
              {t("Quantity")} ({selectedProduct.unit})
              <input
                autoFocus
                type="number"
                min="0.01"
                max={selectedProduct.stock}
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <p className="price">
              {t("Estimated total")}: KES {total.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            <p className="mut">5% off 10+ units · 10% off 50+ units</p>
            {canMessage && (
              <div>
                {selectedProduct.farmer_id ? (
                  <>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        onMessageProduct(selectedProduct.id);
                        setSelectedProductId(undefined);
                      }}
                    >
                      Contact Farmer
                    </button>
                    <p className="mut">
                      Contact the farm through Mkulima Connect chat. The farmer's
                      phone number is not shared with buyers.
                    </p>
                  </>
                ) : (
                  <p className="mut">
                    {t("Messaging is unavailable because this farm has no active farmer account linked yet.")}
                  </p>
                )}
              </div>
            )}{" "}
            <button
              className="btn g"
              type="button"
              onClick={addSelectedProduct}
            >
              {t("Add selection to cart")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
