import { useEffect, useState } from "react";
import { getFarms } from "../api";
import type { Farm } from "../api";
import { useTranslation } from "../i18n";

const farmIcons: Record<string, string> = {
  "eldoret maize growers": "🌽",
  "green acres farm": "🥬",
  "highland dairy": "🐄",
  "kinoti farm": "🥑",
  "kisii hills farm": "🍌",
  "meru dairy co-op": "🥛",
  "meru growers": "🫛",
  "mwea rice growers": "🍚",
  "ol kalou potato farm": "🥔",
};

function getFarmIcon(farm: Farm): string {
  const knownFarmIcon = farmIcons[farm.name.trim().toLocaleLowerCase()];
  if (knownFarmIcon) return knownFarmIcon;

  const crops = farm.crops.toLocaleLowerCase();
  if (/\b(dairy|milk|cream|yoghurt|yogurt|mala)\b/.test(crops)) return "🐄";
  if (/\b(maize|corn)\b/.test(crops)) return "🌽";
  if (/\brice\b/.test(crops)) return "🍚";
  if (/\bpotatoes?\b/.test(crops)) return "🥔";
  if (/\bavocados?\b/.test(crops)) return "🥑";
  if (/\bbananas?\b/.test(crops)) return "🍌";
  if (/\bbeans?\b/.test(crops)) return "🫘";
  return "🌱";
}

export default function Farms({
  onSeeProduce,
  canBrowseProduce = true,
}: {
  onSeeProduce: (county: string) => void;
  canBrowseProduce?: boolean;
}) {
  const { t } = useTranslation();
  const [all, setAll] = useState<Farm[]>([]);
  const [county, setCounty] = useState("");
  useEffect(() => {
    getFarms()
      .then(setAll)
      .catch(() => setAll([]));
  }, []);
  const counties = [...new Set(all.map((farm) => farm.county))].sort();
  const list = all.filter((farm) => !county || farm.county === county);

  return (
    <section>
      <h2>{t("Verified farms in Kenya")}</h2>
      <p className="mut">
        {list.length} verified farm{list.length === 1 ? "" : "s"}
        {county
          ? ` in ${county} County`
          : ` across ${counties.length} counties`}
      </p>
      <select value={county} onChange={(event) => setCounty(event.target.value)}>
        <option value="">{t("All counties")}</option>
        {counties.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
      <div className="grid">
        {list.map((farm) => (
          <article className="card" key={farm.id}>
            <h3><span aria-hidden="true">{getFarmIcon(farm)}</span> {farm.name}</h3>
            <p className="mut">
              {farm.county} County · {farm.size_acres} acres
            </p>
            <p className="mut">
              {farm.rating_count
                ? `⭐ ${farm.rating} · ${farm.rating_count} buyer review${farm.rating_count === 1 ? "" : "s"}`
                : "No buyer reviews yet"}
            </p>
            <p className="mut">Grows: {farm.crops}</p>
            <p className="mut">
              Farming methods:{" "}
              {farm.farming_methods || "Not provided by the farm"}
            </p>
            <span className="badge">
              ✔ {farm.verification_level === "provisional"
                ? "Provisionally Verified"
                : "Fully Verified"}{" "}
              {farm.verified_at
                ? new Date(farm.verified_at).toLocaleDateString()
                : ""}
            </span>
            {canBrowseProduce && (
              <p>
                <button
                  className="btn g"
                  onClick={() => onSeeProduce(farm.county)}
                >
                  {t("See produce")}
                </button>
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
