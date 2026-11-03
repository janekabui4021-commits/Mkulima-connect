import { useEffect, useState } from "react";
import { getTraceRecord } from "../api";
import type { TraceRecord } from "../api";
import ProductImage from "../ProductImage";
import { useTranslation } from "../i18n";

export default function Traceability({ code }: { code: string }) {
  const { t } = useTranslation();
  const [record, setRecord] = useState<TraceRecord>();
  const [error, setError] = useState("");

  useEffect(() => {
    getTraceRecord(code)
      .then(setRecord)
      .catch((cause: unknown) => {
        setError(
          "Trace record not found: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, [code]);

  if (error) {
    return (
      <main>
        <p className="notice error">{error}</p>
        <a href="/">{t("Return to Mkulima Connect")}</a>
      </main>
    );
  }
  if (!record) return <main><p className="mut">{t("Loading farm trace record…")}</p></main>;

  return (
    <>
      <header>
        <a className="logo" href="/">🌱 Mkulima Connect · {t("Traceability")}</a>
      </header>
      <main>
        <article className="card trace-card">
          <span className="badge">{t("Verified farm listing")}</span>
          <ProductImage
            name={record.product}
            farmName={record.farm}
            imageUrl={record.image_url}
          />
          <h1>{record.product}</h1>
          <p><b>Variety:</b> {record.variety}</p>
          <p><b>{t("Farm")}:</b> {record.farm}</p>
          <p><b>{t("County")}:</b> {record.county}, Kenya</p>
          {record.size_acres != null && (
            <p><b>{t("Farm size")}:</b> {record.size_acres} acres</p>
          )}
          <p>
            <b>{t("Harvest date")}:</b>{" "}
            {record.harvest_date
              ? new Date(`${record.harvest_date}T00:00:00`).toLocaleDateString()
              : "Not provided"}
          </p>
          <p><b>{t("Season tier")}:</b> {record.season_tier.replace("_", " ")}</p>
          <p>
            <b>{t("Farming methods")}:</b>{" "}
            {record.farming_methods.trim() || "The farm has not provided farming methods yet."}
          </p>
          <p className="mut">Trace listing ID: {record.trace_code}</p>
          {record.latitude != null && record.longitude != null ? (
            <>
              <p className="mut">
                Approximate county-centre pin, not the farm’s exact address.
              </p>
              <iframe
                className="origin-map"
                title={`Approximate location of ${record.farm} in ${record.county}`}
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${record.longitude - 0.06}%2C${record.latitude - 0.06}%2C${record.longitude + 0.06}%2C${record.latitude + 0.06}&marker=${record.latitude}%2C${record.longitude}`}
              />
              <a
                href={`https://www.openstreetmap.org/?mlat=${record.latitude}&mlon=${record.longitude}#map=12/${record.latitude}/${record.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Open approximate farm location
              </a>
            </>
          ) : (
            <p className="mut">Farm location coordinates are not available.</p>
          )}
        </article>
      </main>
    </>
  );
}
