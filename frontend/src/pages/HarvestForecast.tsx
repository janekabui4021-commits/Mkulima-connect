import { useState } from "react";
import { useTranslation } from "../i18n";

const crops = ["Tomato", "Maize", "Potato", "Avocado"] as const;

export default function HarvestForecast() {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<(typeof crops)[number]>("Tomato");
  const [areaAcres, setAreaAcres] = useState("");
  const [expectedYield, setExpectedYield] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const area = Number(areaAcres);
  const yieldPerAcre = Number(expectedYield);
  const price = Number(pricePerUnit);
  const hasEstimate =
    area > 0 &&
    yieldPerAcre > 0 &&
    price > 0 &&
    Number.isFinite(area) &&
    Number.isFinite(yieldPerAcre) &&
    Number.isFinite(price);
  const expectedQuantity = hasEstimate ? area * yieldPerAcre : 0;
  const expectedRevenue = expectedQuantity * price;

  return (
    <section className="crop-health-page">
      <h1>{t("Harvest projection")}</h1>
      <p className="mut">
        {t("Plan a harvest scenario using your own yield and price estimates.")}
      </p>
      <p className="notice">
        {t("This is a calculator, not an AI prediction. Actual harvest and sales depend on weather, pests, crop care, and market conditions.")}
      </p>
      <div className="card crop-health-form">
        <label className="form-field">
          {t("Crop")}
          <select
            value={crop}
            onChange={(event) => {
              const nextCrop = crops.find((name) => name === event.target.value);
              if (nextCrop) setCrop(nextCrop);
            }}
          >
            {crops.map((name) => (
              <option key={name} value={name}>{t(name)}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          {t("Planted area (acres)")}
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={areaAcres}
            onChange={(event) => setAreaAcres(event.target.value)}
          />
        </label>
        <label className="form-field">
          {t("Expected yield per acre (units)")}
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={expectedYield}
            onChange={(event) => setExpectedYield(event.target.value)}
          />
        </label>
        <label className="form-field">
          {t("Expected price per unit (KES)")}
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={pricePerUnit}
            onChange={(event) => setPricePerUnit(event.target.value)}
          />
        </label>
      </div>
      {hasEstimate && (
        <article className="card crop-health-result" aria-live="polite">
          <h2>{t(crop)} · {t("Planning estimate")}</h2>
          <p>
            {t("Estimated harvest")}:{" "}
            <b>{expectedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
          </p>
          <p>
            {t("Estimated gross revenue")}:{" "}
            <b>KES {expectedRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
          </p>
          <p className="mut">
            {t("Gross revenue excludes costs, losses, and price changes.")}
          </p>
        </article>
      )}
    </section>
  );
}
