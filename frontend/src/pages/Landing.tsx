import { useEffect, useState } from "react";
import { getProducts } from "../api";
import type { Product } from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

interface Props {
  onBrowse: () => void;
  onJoin: (role: "buyer" | "farmer") => void;
  onSignIn: () => void;
  signedIn: boolean;
}

export default function Landing({
  onBrowse,
  onJoin,
  onSignIn,
  signedIn,
}: Props) {
  const { t } = useTranslation();
  const [featured, setFeatured] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProducts()
      .then((products) => setFeatured(products.slice(0, 3)))
      .catch((cause: unknown) => {
        setCatalogError(
          "Current listings could not be loaded. You can still browse the marketplace or create an account.",
        );
        console.error("Could not load landing page listings:", cause);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="landing-page">
      <nav className="landing-nav" aria-label={t("About Mkulima Connect")}>
        <a href="#landing-about">{t("About")}</a>
        <a href="#landing-services">{t("Services")}</a>
        <a href="#landing-how-it-works">{t("How it works")}</a>
        <a href="#landing-contact">{t("Contact us")}</a>
      </nav>
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">{t("Grown locally · Connected directly")}</span>
          <h1>{t("Good food starts with a closer connection.")}</h1>
          <p>
            {t("Discover fresh produce from verified Kenyan farms, learn where it comes from, and connect directly with the people who grow it.")}
          </p>
          <div className="landing-actions">
            <button className="btn g" onClick={onBrowse}>
              {t("Explore the marketplace")}
            </button>
            {!signedIn && (
              <button className="btn" onClick={() => onJoin("buyer")}>
                {t("Create a buyer account")}
              </button>
            )}
          </div>
          {!signedIn && (
            <button className="landing-signin" onClick={onSignIn}>
              {t("Already have an account? Sign in")}
            </button>
          )}
        </div>
        <div className="landing-illustration" aria-hidden="true">
          <div className="landing-sun" />
          <div className="landing-field field-back" />
          <div className="landing-field field-front" />
          <div className="landing-produce produce-one">
            <ProductImage name="avocados" />
          </div>
          <div className="landing-produce produce-two">
            <ProductImage name="tomatoes" />
          </div>
          <div className="landing-produce produce-three">
            <ProductImage name="maize" />
          </div>
          <div className="landing-produce leaf-one">
            <ProductImage name="sukuma wiki" />
          </div>
        </div>
      </section>

      <section
        className="landing-trust"
        id="landing-about"
        aria-labelledby="landing-about-heading"
      >
        <div className="landing-section-heading landing-about-heading">
          <div>
            <span className="landing-eyebrow">{t("Why choose Mkulima Connect?")}</span>
            <h2 id="landing-about-heading">{t("A clearer connection from farm to market")}</h2>
          </div>
        </div>
        <article>
          <span aria-hidden="true">✓</span>
          <div>
            <b>{t("Verified farms")}</b>
            <p>{t("Browse produce from farms reviewed by the marketplace.")}</p>
          </div>
        </article>
        <article>
          <span aria-hidden="true">⌖</span>
          <div>
            <b>{t("Know its origin")}</b>
            <p>{t("Explore farm and harvest details with product traceability.")}</p>
          </div>
        </article>
        <article>
          <span aria-hidden="true">↔</span>
          <div>
            <b>{t("Connect directly")}</b>
            <p>{t("Buyers and farmers can discuss orders and delivery.")}</p>
          </div>
        </article>
      </section>

      <section className="landing-features" id="landing-services">
        <div className="landing-section-heading">
          <div>
            <span className="landing-eyebrow">{t("Built for buyers and farmers")}</span>
            <h2>{t("More ways to connect")}</h2>
          </div>
        </div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card">
            <span aria-hidden="true">🌾</span>
            <div>
              <h3>{t("Reserve future harvests")}</h3>
              <p>
                {t("Buyers can reserve produce marked for pre-order. Farmers set harvest dates, season tiers, and available quantities.")}
              </p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">🏷️</span>
            <div>
              <h3>{t("Save on bulk orders")}</h3>
              <p>
                {t("Get 5% off 10 or more units, or 10% off 50 or more units of a product.")}
              </p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">▦</span>
            <div>
              <h3>{t("Trace farm produce")}</h3>
              <p>
                {t("See listing photos, harvest details, and an approximate farm location. Farmers can share the QR trace code.")}
              </p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">💬</span>
            <div>
              <h3>{t("Message farms")}</h3>
              <p>
                {t("Signed-in buyers and farmers can discuss availability, quantities, and delivery.")}
              </p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">⭐</span>
            <div>
              <h3>{t("Review completed orders")}</h3>
              <p>
                {t("After delivery, buyers can rate product quality and delivery speed in My orders.")}
              </p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">📦</span>
            <div>
              <h3>{t("Manage farm orders")}</h3>
              <p>
                {t("Approved farmers update fulfillment in Farmer tools; buyers follow delivery progress in My orders.")}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section
        className="landing-how"
        id="landing-how-it-works"
        aria-labelledby="landing-how-heading"
      >
        <div className="landing-section-heading">
          <div>
            <span className="landing-eyebrow">{t("Simple steps to get started")}</span>
            <h2 id="landing-how-heading">{t("How the platform works")}</h2>
          </div>
        </div>
        <div className="landing-how-grid">
          <article className="landing-feature-card">
            <span aria-hidden="true">🛒</span>
            <div>
              <h3>{t("For buyers")}</h3>
              <p>{t("Create a buyer account, explore farm listings, choose produce, and track your orders from your dashboard.")}</p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">🌱</span>
            <div>
              <h3>{t("For farmers")}</h3>
              <p>{t("Create a farmer account, verify your phone, submit your farm details for review, then list produce and manage orders.")}</p>
            </div>
          </article>
          <article className="landing-feature-card">
            <span aria-hidden="true">🛡️</span>
            <div>
              <h3>{t("A safer marketplace")}</h3>
              <p>{t("Farm listings are reviewed before they are fully verified. Buyers and farmers get separate dashboards for their work.")}</p>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-featured">
        <div className="landing-section-heading">
          <div>
            <span className="landing-eyebrow">{t("From farm to you")}</span>
            <h2>{t("Explore the marketplace")}</h2>
          </div>
          <button className="btn" onClick={onBrowse}>
            {t("View all produce")}
          </button>
        </div>
        {catalogError && <p className="notice error">{t(catalogError)}</p>}
        {!catalogError && loading && featured.length === 0 && (
          <p className="mut">{t("Loading current farm listings…")}</p>
        )}
        {!catalogError && !loading && featured.length === 0 && (
          <p className="mut">{t("No listings are available right now. Check back soon.")}</p>
        )}
        {featured.length > 0 && (
          <div className="grid landing-product-grid">
            {featured.map((product) => (
              <article className="card landing-product-card" key={product.id}>
                <ProductImage
                  name={product.name}
                  farmName={product.farm}
                  imageUrl={product.image_url}
                />
                <div>
                  <h3>{product.name}</h3>
                  <p className="mut">
                    {product.variety} · {product.farm} · {product.county}
                  </p>
                  <p className="price">
                    {t("KES")} {product.price_kes} / {product.unit}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {!signedIn && (
        <section className="landing-join">
          <div>
            <span className="landing-eyebrow">{t("A marketplace for both sides")}</span>
            <h2>{t("Are you buying or growing?")}</h2>
            <p>{t("Choose an account to get started. It only takes a moment.")}</p>
          </div>
          <div className="landing-join-actions">
            <button className="btn g" onClick={() => onJoin("buyer")}>
              🛒 {t("Join as a buyer")}
            </button>
            <button className="btn" onClick={() => onJoin("farmer")}>
              🌱 {t("Join as a farmer")}
            </button>
          </div>
        </section>
      )}
      {!signedIn && (
        <section className="landing-contact" id="landing-contact">
          <div>
            <span className="landing-eyebrow">{t("Contact us")}</span>
            <h2>{t("Need to ask a farm or transport provider a question?")}</h2>
            <p>
              {t("Sign in to message farmers and transport providers. Their contact details are shown only when they choose to share them.")}
            </p>
          </div>
          <button className="btn g" type="button" onClick={onSignIn}>
            {t("Sign in to contact providers")}
          </button>
        </section>
      )}
    </div>
  );
}
