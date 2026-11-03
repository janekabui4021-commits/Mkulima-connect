import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getAccountProfile, updateAccountProfile } from "../api";
import type { AccountProfile } from "../api";
import { useTranslation } from "../i18n";

interface Props {
  onUpdated: (profile: AccountProfile) => void;
}

export default function Profile({ onUpdated }: Props) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<AccountProfile>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAccountProfile()
      .then(setProfile)
      .catch((cause: unknown) =>
        setError(
          "Could not load your profile: " +
            (cause instanceof Error ? cause.message : String(cause)),
        ),
      );
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await updateAccountProfile({
        name: profile.name,
        email: profile.email,
      });
      setProfile(updated);
      onUpdated(updated);
      setMessage(t("Profile saved."));
    } catch (cause) {
      setError(
        "Could not save your profile: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="profile-page">
      <h1>{t("My profile")}</h1>
      <p className="mut">{t("Keep your account contact details up to date.")}</p>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}
      {!profile ? (
        !error && <p className="mut">{t("Loading profile…")}</p>
      ) : (
        <form className="card profile-form" onSubmit={(event) => void save(event)}>
          <label className="form-field">
            {t("Full name")}
            <input
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              value={profile.name}
              onChange={(event) =>
                setProfile({ ...profile, name: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            {t("Email")}
            <input
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              value={profile.email}
              onChange={(event) =>
                setProfile({ ...profile, email: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            {t("Phone")}
            <input type="tel" value={profile.phone} readOnly />
            <span className="mut">
              {t("Phone changes require verification and cannot be edited here.")}
            </span>
          </label>
          <p className="mut">
            {t("Account type")}: {t(profile.role === "buyer" ? "Buyer" : profile.role === "farmer" ? "Farmer" : "Admin")}
          </p>
          <button className="btn g" type="submit" disabled={saving}>
            {saving ? t("Please wait…") : t("Save profile")}
          </button>
        </form>
      )}
    </section>
  );
}
