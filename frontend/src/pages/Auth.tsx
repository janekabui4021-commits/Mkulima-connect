import { useState } from "react";
import type { FormEvent } from "react";
import { bootstrapAdminAccount, loginAccount, registerAccount } from "../api";
import type { AuthSession, AuthUser } from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

type Mode = "login" | "register";
type LoginRole = AuthUser["role"];

const loginRoles: {
  value: LoginRole;
  icon: string;
  label: string;
  description: string;
}[] = [
  {
    value: "buyer",
    icon: "🛒",
    label: "Buyer",
    description: "Shop fresh produce",
  },
  {
    value: "farmer",
    icon: "🌾",
    label: "Farmer",
    description: "Manage your farm",
  },
  {
    value: "admin",
    icon: "🛡️",
    label: "Admin",
    description: "Oversee the platform",
  },
];

const signupRoles = loginRoles;

interface Props {
  onAuthenticated: (user: AuthUser, token: string) => void;
  onBack?: () => void;
  initialMode?: Mode;
  initialRole?: "buyer" | "farmer";
}

export default function Auth({
  onAuthenticated,
  onBack,
  initialMode = "login",
  initialRole = "buyer",
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [role, setRole] = useState<LoginRole>(initialRole);
  const [loginRole, setLoginRole] = useState<LoginRole>(initialRole);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = (session: AuthSession) => {
    localStorage.setItem("mkulima_token", session.access_token);
    onAuthenticated(session.user, session.access_token);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        const session = await loginAccount(email, password);
        if (session.user.role !== loginRole) {
          throw new Error(
            `${t("This account is registered as a")} ${t(session.user.role)}. ${t("Select this account type to sign in.")}`,
          );
        }
        finish(session);
      } else {
        const account = { name, email, phone, password };
        finish(
          role === "admin"
            ? await bootstrapAdminAccount({
                ...account,
                bootstrap_token: bootstrapToken,
              })
            : await registerAccount({ ...account, role }),
        );
      }
    } catch (cause) {
      setError(
        `Could not ${mode === "login" ? "sign in" : "create account"}: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-layout">
        <aside className="auth-showcase">
          <div className="auth-brand">
            <span className="auth-brand-mark" aria-hidden="true">🌱</span>
            <span>Mkulima Connect</span>
          </div>
          <div className="auth-showcase-copy">
            <span className="landing-eyebrow">{t("Grown locally · Connected directly")}</span>
            <h1>{t("Good food starts with a closer connection.")}</h1>
            <p>
              {t("Meet the farmers behind your food, discover fresh local produce, and grow your business with a community that connects.")}
            </p>
          </div>
          <div className="auth-produce" aria-hidden="true">
            <ProductImage name="avocados" compact />
            <ProductImage name="tomatoes" compact />
            <ProductImage name="maize" compact />
            <ProductImage name="sukuma wiki" compact />
          </div>
          <p className="auth-showcase-foot">{t("A better connection from farm to table.")}</p>
        </aside>

        <article className="card auth-card">
          {onBack && (
            <button
              className="landing-signin auth-back"
              type="button"
              onClick={onBack}
            >
              ← {t("Back to home")}
            </button>
          )}
          <div className="auth-heading">
            <span className="auth-kicker">
              {t(mode === "login" ? "YOUR FARM-TO-MARKET COMMUNITY" : "JOIN THE COMMUNITY")}
            </span>
            <h2>{t(mode === "login" ? "Welcome back" : "Create your account")}</h2>
            <p className="mut">
              {mode === "login"
                ? t("Choose your account type, then sign in to continue.")
                : role === "admin"
                  ? t("Create the first administrator account for this trial. You will need the bootstrap token configured by the backend.")
                  : role === "buyer"
                  ? t("Create a buyer account to discover produce, place orders, and connect with farms.")
                  : t("Create a farmer account, verify your phone, and submit GPS and video farm evidence to unlock provisional listings.")}
            </p>
          </div>
          {error && <p className="notice error">{error}</p>}
          <form onSubmit={(event) => void submit(event)}>
            {mode === "login" && (
              <fieldset className="auth-role-picker">
                <legend>{t("Sign in as")}</legend>
                {loginRoles.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`auth-role-option${loginRole === option.value ? " selected" : ""}`}
                    aria-pressed={loginRole === option.value}
                    onClick={() => {
                      setLoginRole(option.value);
                      setError("");
                    }}
                  >
                    <span className="auth-role-icon" aria-hidden="true">{option.icon}</span>
                    <span className="auth-role-label">{t(option.label)}</span>
                    <span className="auth-role-description">{t(option.description)}</span>
                  </button>
                ))}
              </fieldset>
            )}
            {mode === "register" && (
              <fieldset className="auth-role-picker register-role-picker">
                <legend>{t("Choose your account type")}</legend>
                {signupRoles.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`auth-role-option${role === option.value ? " selected" : ""}`}
                    aria-pressed={role === option.value}
                    onClick={() => {
                      setRole(option.value);
                      setError("");
                    }}
                  >
                    <span className="auth-role-icon" aria-hidden="true">{option.icon}</span>
                    <span className="auth-role-label">{t(option.label)}</span>
                    <span className="auth-role-description">{t(option.description)}</span>
                  </button>
                ))}
              </fieldset>
            )}
            {mode === "register" && role === "admin" && (
              <label className="form-field">
                {t("Admin bootstrap token")}
                <input
                  required
                  type="password"
                  autoComplete="off"
                  value={bootstrapToken}
                  onChange={(event) => setBootstrapToken(event.target.value)}
                />
                <span className="mut">
                  {t("Enter the ADMIN_BOOTSTRAP_TOKEN set in the backend environment.")}
                </span>
              </label>
            )}
            {mode === "register" && (
              <>
                <label className="form-field">
                  {t("Full name")}
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  {t("Phone")}
                  <input
                    required
                    minLength={7}
                    maxLength={30}
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="form-field">
              {t("Email")}
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="form-field">
              {t("Password (at least 12 characters)")}
              <span className="auth-password-control">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={12}
                  maxLength={128}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  aria-label={t(showPassword ? "Hide password" : "Show password")}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {t(showPassword ? "Hide password" : "Show password")}
                </button>
              </span>
            </label>
            <button type="submit" className="btn g auth-submit" disabled={busy}>
              {busy
                ? t("Please wait…")
                : mode === "login"
                  ? t("Sign in")
                  : t(role === "buyer" ? "Create buyer account" : "Create farmer account")}
            </button>
          </form>
          <p className="auth-signup-prompt">
            {mode === "login" ? (
              <>
                {t("New to Mkulima Connect?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    if (loginRole === "admin") setRole("admin");
                    setMode("register");
                  }}
                >
                  {t("Create an account")}
                </button>
              </>
            ) : (
              <>
                {t("Already have an account?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setMode("login");
                  }}
                >
                  {t("Sign in")}
                </button>
              </>
            )}
          </p>
          <p className="auth-signup-prompt auth-admin-prompt">
            {t("Want to try the admin dashboard?")}{" "}
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoginRole("admin");
                setMode("login");
              }}
            >
              {t("Try admin sign-in")}
            </button>
          </p>
        </article>
      </div>
    </section>
  );
}
