import { useEffect, useState } from "react";
import { BadgeCheck, Leaf, Milk, Sprout, Star, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getFarms } from "../api";
import type { Farm } from "../api";
import { useTranslation } from "../i18n";

const farmIcons: Record<string, LucideIcon> = {
  "eldoret maize growers": Wheat,
  "green acres farm": Leaf,
  "highland dairy": Milk,
  "kinoti farm": Leaf,
  "kisii hills farm": Leaf,
  "meru dairy co-op": Milk,
  "meru growers": Sprout,
  "mwea rice growers": Wheat,
  "ol kalou potato farm": Sprout,
};

function getFarmIcon(farm: Farm): LucideIcon {
  const knownFarmIcon = farmIcons[farm.name.trim().toLocaleLowerCase()];
  if (knownFarmIcon) return knownFarmIcon;

  const crops = farm.crops.toLocaleLowerCase();
  if (/\b(dairy|milk|cream|yoghurt|yogurt|mala)\b/.test(crops)) return Milk;
  if (/\b(maize|corn|rice|wheat)\b/.test(crops)) return Wheat;
  if (/\bbeans?\b/.test(crops)) return Sprout;
  if (crops) return Leaf;
  return Sprout;
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
        {list.map((farm) => {
          const FarmIcon = getFarmIcon(farm);
          return (
            <article className="card" key={farm.id}>
              <h3>
                <FarmIcon className="farm-card-icon" size={21} strokeWidth={1.8} aria-hidden="true" />
                {farm.name}
              </h3>
              <p className="mut">
                {farm.county} County · {farm.size_acres} acres
              </p>
              <p className="mut farm-card-rating">
                {farm.rating_count ? (
                  <>
                    <Star size={15} strokeWidth={1.8} aria-hidden="true" />
                    {farm.rating} · {farm.rating_count} buyer review
                    {farm.rating_count === 1 ? "" : "s"}
                  </>
                ) : (
                  "No buyer reviews yet"
                )}
              </p>
              <p className="mut">Grows: {farm.crops}</p>
              <p className="mut">
                Farming methods:{" "}
                {farm.farming_methods || "Not provided by the farm"}
              </p>
              <span className="badge farm-card-verification">
                <BadgeCheck size={15} strokeWidth={1.8} aria-hidden="true" />
                {farm.verification_level === "provisional"
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
          );
        })}
      </div>
    </section>
  );
}
