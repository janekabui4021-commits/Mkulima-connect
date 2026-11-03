import { useCallback, useEffect, useState } from "react";
import type { CartLine, Product } from "./api";
import { ApiError, clearOfflineApiCache, getCurrentUser } from "./api";
import type { AuthUser } from "./api";
import Admin from "./pages/Admin";
import Assistant from "./pages/Assistant";
import Auth from "./pages/Auth";
import Cart from "./pages/Cart";
import Chat from "./pages/Chat";
import Dashboard from "./pages/Dashboard";
import CropHealth from "./pages/CropHealth";
import Farms from "./pages/Farms";
import Farmer from "./pages/Farmer";
import HarvestForecast from "./pages/HarvestForecast";
import Landing from "./pages/Landing";
import Market from "./pages/Market";
import Orders from "./pages/Orders";
import Offtake from "./pages/Offtake";
import Profile from "./pages/Profile";
import Traceability from "./pages/Traceability";
import Transport from "./pages/Transport";
import Groups from "./pages/Groups";
import NotificationBell from "./NotificationBell";
import { languageOptions, useTranslation } from "./i18n";

type Tab = "home" | "market" | "favorites" | "farms" | "transport" | "groups" | "assistant" | "orders" | "messages" | "offtake" | "farmer" | "crop-health" | "forecast" | "profile" | "admin" | "auth";

function tabFromNotificationHash(hash: string): Tab | null {
  const tab = hash.slice(1);
  return ["home", "market", "farms", "transport", "orders", "messages", "offtake"].includes(tab)
    ? (tab as Tab)
    : null;
}

export default function App() {
  const { language, setLanguage, t } = useTranslation();
  const traceCode = window.location.pathname.match(/^\/trace\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const initialNotificationTab = tabFromNotificationHash(window.location.hash);
  const [tab, setTab] = useState<Tab>(
    initialNotificationTab ?? "home",
  );
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authRole, setAuthRole] = useState<"buyer" | "farmer">("buyer");
  const [authReturnTab, setAuthReturnTab] = useState<Tab>(initialNotificationTab ?? "home");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem("mkulima_token")));
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [pendingCartProduct, setPendingCartProduct] = useState<{
    product: Product;
    quantity: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [county, setCounty] = useState("");
  const [messageProductId, setMessageProductId] = useState<number>();
  const clearMessageProduct = useCallback(
    () => setMessageProductId(undefined),
    [],
  );
  const count = Object.values(cart).reduce((quantity, line) => quantity + line.qty, 0);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!localStorage.getItem("mkulima_token")) {
      setAuthLoading(false);
      return;
    }
    getCurrentUser()
      .then((authenticated) => {
        localStorage.setItem("mkulima_offline_user_id", String(authenticated.id));
        setUser(authenticated);
      })
      .catch((cause: unknown) => {
        if (
          cause instanceof ApiError &&
          (cause.status === 401 || cause.status === 403)
        ) {
          const cachedUserId = Number(localStorage.getItem("mkulima_offline_user_id"));
          if (Number.isSafeInteger(cachedUserId) && cachedUserId > 0) {
            clearOfflineApiCache(cachedUserId);
          }
          localStorage.removeItem("mkulima_token");
          localStorage.removeItem("mkulima_offline_user_id");
        } else if (navigator.onLine) {
          console.error("Could not verify the saved sign-in:", cause);
        }
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  if (traceCode && user) {
    return <Traceability code={traceCode} />;
  }

  const addProductToCart = (product: Product, quantity: number) => {
    if ((cart[product.id]?.qty ?? 0) + quantity > product.stock) {
      return false;
    }
    setCart((current) => ({
      ...current,
      [product.id]: {
        product,
        qty: (current[product.id]?.qty ?? 0) + quantity,
      },
    }));
    return true;
  };

  const add = (product: Product, quantity: number) => {
    if (user?.role === "buyer") {
      return addProductToCart(product, quantity);
    }
    if (!user) {
      setPendingCartProduct({ product, quantity });
      openAuth("login", "buyer");
    }
    return false;
  };

  const change = (id: number, delta: number) =>
    setCart((current) => {
      const qty = (current[id]?.qty ?? 0) + delta;
      const currentLine = current[id];
      if (currentLine && qty > currentLine.product.stock) return current;
      const { [id]: removedLine, ...rest } = current;
      return qty > 0
        ? { ...current, [id]: { ...removedLine, qty } }
        : rest;
    });

  const openAuth = (
    mode: "login" | "register",
    role: "buyer" | "farmer" = "buyer",
    returnTab: Tab = "market",
  ) => {
    setAuthMode(mode);
    setAuthRole(role);
    setAuthReturnTab(returnTab);
    setTab("auth");
  };

  useEffect(() => {
    const handleNotificationNavigation = () => {
      const requestedTab = tabFromNotificationHash(window.location.hash);
      if (!requestedTab) return;
      if (authLoading) return;

      if (requestedTab === "orders" || requestedTab === "messages" || requestedTab === "offtake") {
        if (!user) {
          setAuthReturnTab(requestedTab);
          setAuthRole("buyer");
          setAuthMode("login");
          setTab("auth");
          return;
        }
        setTab(
          requestedTab === "orders" && user.role === "farmer"
            ? "farmer"
            : requestedTab,
        );
        return;
      }

      if (requestedTab === "market" && user?.role === "farmer") {
        setTab("home");
        return;
      }

      setTab(requestedTab);
    };

    window.addEventListener("hashchange", handleNotificationNavigation);
    handleNotificationNavigation();
    return () =>
      window.removeEventListener("hashchange", handleNotificationNavigation);
  }, [authLoading, user]);

  const signOut = () => {
    if (user) clearOfflineApiCache(user.id);
    localStorage.removeItem("mkulima_token");
    localStorage.removeItem("mkulima_offline_user_id");
    setUser(null);
    setTab("home");
    setCart({});
    setMenuOpen(false);
    setProfileMenuOpen(false);
  };

  return (
    <>
      <header className="app-header">
        <b className="logo">🌱 Mkulima Connect</b>
        {user && <nav id="app-navigation" className={`app-nav${menuOpen ? " is-open" : ""}`}>
          {(["home", ...(user?.role === "buyer" ? ["market", "favorites"] : []), "farms", ...(user?.role === "farmer" ? [] : ["transport"]), ...(user?.role === "farmer" ? ["groups", "crop-health", "forecast", "assistant"] : []), ...(user?.role === "buyer" ? ["orders"] : []),
          ...(user?.role === "buyer" || user?.role === "farmer" ? ["messages"] : []),
          ...(user?.role === "buyer" || user?.role === "farmer" ? ["offtake"] : []),
          ...(user?.role === "farmer" ? ["farmer"] : []),
          ...(user?.role === "admin" ? ["admin"] : [])] as Tab[]).map(
            (tabName) => (
              <button
                key={tabName}
                className={tab === tabName ? "on" : ""}
                onClick={() => {
                  setTab(tabName);
                  setMenuOpen(false);
                }}
              >
                {t(tabName === "home"
                  ? "Dashboard"
                  : tabName === "market"
                    ? "Marketplace"
                    : tabName === "favorites"
                      ? "Saved commodities"
                    : tabName === "farms"
                    ? "Verified farms"
                    : tabName === "transport"
                      ? "Transport"
                    : tabName === "groups"
                      ? "Farmer groups"
                    : tabName === "assistant"
                    ? "Assistant"
                  : tabName === "orders"
                      ? "My orders"
                      : tabName === "messages"
                        ? "Messages"
                        : tabName === "offtake"
                          ? "Bulk requests & harvest matching"
                        : tabName === "farmer"
                          ? "Farmer tools"
                          : tabName === "crop-health"
                            ? "Crop health guide"
                            : tabName === "forecast"
                              ? "Harvest projection"
                            : tabName === "admin"
                                ? "Admin oversight"
                                : "Sign in")}
              </button>
            ),
          )}
        </nav>}
        {!authLoading && !user && tab !== "auth" && (
          <div className="account-actions">
            <button
              className="btn"
              type="button"
              onClick={() => openAuth("login", "buyer", "home")}
            >
              {t("Sign in")}
            </button>
            <button
              className="btn g"
              type="button"
              onClick={() => openAuth("register", "buyer", "home")}
            >
              {t("Create an account")}
            </button>
          </div>
        )}
        <select
          className="language-toggle"
          aria-label={t("Language")}
          value={language}
          onChange={(event) => {
            const selectedLanguage = languageOptions.find(
              (option) => option.value === event.target.value,
            );
            if (selectedLanguage) setLanguage(selectedLanguage.value);
          }}
        >
          {languageOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {user && (
          <button
            className="menu-toggle"
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            aria-controls="app-navigation"
            onClick={() => setMenuOpen((isOpen) => !isOpen)}
          >
            <span />
            <span />
            <span />
          </button>
        )}
        {user && <NotificationBell />}
        {user?.role === "buyer" ? (
          <div className="account-actions">
            <span className="badge">{t("Email verified")}</span>
            <button className="btn g" onClick={() => setOpen(true)}>🛒 {t("Cart")} ({count})</button>
          </div>
        ) : null}
        {user && (
          <div className="profile-menu">
            <button
              className="profile-menu-toggle"
              type="button"
              aria-label={t("Open profile menu")}
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
              onClick={() => setProfileMenuOpen((isOpen) => !isOpen)}
            >
              <span className="profile-avatar" aria-hidden="true">
                {user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
              </span>
              <span className="profile-menu-name">{user.name}</span>
              <span aria-hidden="true">⌄</span>
            </button>
            {profileMenuOpen && (
              <div className="profile-menu-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTab("profile");
                    setProfileMenuOpen(false);
                  }}
                >
                  {t("My profile")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={signOut}
                >
                  {t("Sign out")}
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      <main>
        {authLoading && <p className="mut">{t("Checking your sign-in…")}</p>}
        {!authLoading && !user && tab === "home" && (
          <Landing
            onBrowse={() => setTab("market")}
            onJoin={(role) => openAuth("register", role, "home")}
            onSignIn={() => openAuth("login", "buyer", "home")}
            signedIn={false}
          />
        )}
        {!authLoading && !user && tab === "market" && (
          <Market
            onAdd={add}
            county={county}
            setCounty={setCounty}
            canMessage={false}
            canPurchase={false}
            canSignInToMessage
            onMessageProduct={(productId) => {
              setMessageProductId(productId);
              openAuth("login", "buyer", "market");
            }}
          />
        )}
        {!authLoading && !user && tab === "auth" && (
          <Auth
            key={`${authMode}-${authRole}`}
            initialMode={authMode}
            initialRole={authRole}
            onBack={() => setTab("home")}
            onAuthenticated={(authenticated, token) => {
            localStorage.setItem("mkulima_token", token);
            localStorage.setItem("mkulima_offline_user_id", String(authenticated.id));
            setUser(authenticated);
            if (authenticated.role === "buyer" && pendingCartProduct) {
              addProductToCart(
                pendingCartProduct.product,
                pendingCartProduct.quantity,
              );
            }
            setPendingCartProduct(null);
            setTab(
              pendingCartProduct
                ? authenticated.role === "buyer" ? "market" : "home"
                : authenticated.role === "buyer" && messageProductId
                  ? "messages"
                  : authenticated.role === "farmer" && authReturnTab === "market"
                    ? "home"
                    : authReturnTab,
            );
          }} />
        )}
        {!authLoading && user && tab === "home" && (
          user.role === "buyer" || user.role === "farmer" ? (
            <Dashboard user={user} onNavigate={setTab} />
          ) : (
            <Landing
              onBrowse={() => setTab("market")}
              onJoin={(role) => openAuth("register", role)}
              onSignIn={() => openAuth("login")}
              signedIn={Boolean(user)}
            />
          )
        )}
        {!authLoading && user?.role === "buyer" && (tab === "market" || tab === "favorites") && (
          <Market
            onAdd={add}
            county={county}
            setCounty={setCounty}
            canMessage={user.role === "buyer"}
            canPurchase={user.role === "buyer"}
            canSignInToMessage={false}
            favoritesOnly={tab === "favorites"}
            onMessageProduct={(productId) => {
              setMessageProductId(productId);
              setTab(user.role === "buyer" ? "messages" : "auth");
            }}
          />
        )}
        {!authLoading && user && tab === "farms" && (
          <Farms
            canBrowseProduce={user.role === "buyer"}
            onSeeProduce={(farmCounty) => {
              setCounty(farmCounty);
              if (user.role === "buyer") setTab("market");
            }}
          />
        )}
        {!authLoading && user && tab === "transport" && (
          <Transport
            user={user}
            canManage={user?.role === "buyer" || user?.role === "farmer"}
            onSignIn={() => openAuth("login", "buyer", "transport")}
          />
        )}
        {!authLoading && user?.role === "farmer" && tab === "groups" && <Groups />}
        {!authLoading && user?.role === "farmer" && tab === "crop-health" && <CropHealth />}
        {!authLoading && user?.role === "farmer" && tab === "forecast" && <HarvestForecast />}
        {!authLoading && user?.role === "farmer" && tab === "assistant" && (
          <Assistant
            user={user}
            onAddToCart={(product) => {
              add(product, 1);
            }}
            onOpenFarmerTools={() => setTab("farmer")}
          />
        )}
        {!authLoading && user?.role === "buyer" && tab === "orders" && <Orders />}
        {!authLoading && user && (user.role === "buyer" || user.role === "farmer") && tab === "offtake" && (
          <Offtake
            user={user}
            onMessageFarmer={(productId) => {
              setMessageProductId(productId);
              setTab("messages");
            }}
          />
        )}
        {!authLoading && tab === "messages" && user && (
          <Chat
            initialProductId={messageProductId}
            onInitialProductHandled={clearMessageProduct}
            user={user}
          />
        )}
        {!authLoading && tab === "farmer" && user?.role === "farmer" && <Farmer />}
        {!authLoading && tab === "profile" && user && (
          <Profile onUpdated={(profile) => setUser(profile)} />
        )}
        {!authLoading && tab === "admin" && user?.role === "admin" && <Admin />}
      </main>
      <footer className="site-footer">
        © 2026 Mkulima Connect. All rights reserved.
      </footer>
      {open && user?.role === "buyer" && (
        <Cart
          cart={cart}
          change={change}
          clear={() => setCart({})}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
