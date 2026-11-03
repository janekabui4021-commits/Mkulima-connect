import { useState } from "react";
import { useTranslation } from "../i18n";

type Crop = "Tomato" | "Maize" | "Potato" | "Avocado";

interface HealthGuide {
  crop: Crop;
  symptom: string;
  possibleIssue: string;
  signs: string;
  action: string;
  agrovetAdvice: string;
}

const guides: HealthGuide[] = [
  {
    crop: "Tomato",
    symptom: "Dark patches, sometimes with pale growth beneath leaves",
    possibleIssue: "Possible late blight",
    signs: "Look for rapidly spreading, water-soaked leaf patches, especially in cool, wet weather.",
    action: "Avoid overhead watering, remove badly affected material, and avoid moving wet plants between rows.",
    agrovetAdvice: "Ask an agricultural extension officer or agrovet to confirm the cause and identify a locally registered treatment for tomatoes.",
  },
  {
    crop: "Tomato",
    symptom: "Brown spots with rings on older leaves",
    possibleIssue: "Possible early blight",
    signs: "Older leaves may show brown, target-like rings and yellowing around spots.",
    action: "Remove affected lower leaves, keep foliage dry, and clear crop debris after harvest.",
    agrovetAdvice: "Ask an agrovet to confirm the diagnosis and recommend a registered tomato treatment if needed.",
  },
  {
    crop: "Tomato",
    symptom: "Mottled leaves, distorted growth, or stunting",
    possibleIssue: "Possible viral disease",
    signs: "Mosaic-like light and dark patterns or distorted young leaves can have several causes.",
    action: "Separate affected plants where possible, clean tools, and inspect for insect vectors.",
    agrovetAdvice: "There is no general medicine that cures plant viruses. Ask an extension officer to confirm the cause before buying any pesticide.",
  },
  {
    crop: "Maize",
    symptom: "Orange or brown raised spots on leaves",
    possibleIssue: "Possible maize rust",
    signs: "Small orange-brown pustules may appear on leaf surfaces and spread.",
    action: "Check several plants and note how quickly symptoms are spreading; avoid carrying infected leaves to other fields.",
    agrovetAdvice: "Ask an agrovet or extension officer to confirm rust and recommend a registered maize treatment appropriate to the crop stage.",
  },
  {
    crop: "Maize",
    symptom: "Long tan or gray leaf lesions",
    possibleIssue: "Possible leaf blight or gray leaf spot",
    signs: "Long, rectangular lesions can resemble multiple fungal or bacterial problems.",
    action: "Record the affected area and inspect neighboring plants; avoid relying on a single leaf for diagnosis.",
    agrovetAdvice: "Take clear photos or a sample to an extension officer or agrovet before choosing any treatment.",
  },
  {
    crop: "Maize",
    symptom: "Streaks, mottling, and stunted plants",
    possibleIssue: "Possible maize streak virus",
    signs: "Narrow pale streaks on leaves and stunting may also be confused with nutrient stress.",
    action: "Inspect for leafhoppers and remove severely affected plants if an extension officer confirms viral disease.",
    agrovetAdvice: "Ask for diagnosis and vector-control advice; medicines do not cure virus-infected plants.",
  },
  {
    crop: "Potato",
    symptom: "Dark, water-soaked patches or pale growth on leaves",
    possibleIssue: "Possible late blight",
    signs: "Symptoms may spread quickly during cool, wet conditions and can affect stems and tubers.",
    action: "Separate affected plants and seek advice promptly; do not store suspect tubers with healthy harvest.",
    agrovetAdvice: "Ask an agrovet to confirm late blight and identify a registered potato treatment; follow its label and harvest interval.",
  },
  {
    crop: "Potato",
    symptom: "Brown leaf spots with rings",
    possibleIssue: "Possible early blight",
    signs: "Older leaves may develop dry, ringed spots and yellowing.",
    action: "Remove affected debris, rotate crops, and avoid unnecessary wetting of leaves.",
    agrovetAdvice: "Ask an extension officer or agrovet whether a registered potato treatment is appropriate.",
  },
  {
    crop: "Potato",
    symptom: "Yellowing and wilting despite moist soil",
    possibleIssue: "Possible wilt or root problem",
    signs: "Several soil, bacterial, and fungal problems can cause similar wilting symptoms.",
    action: "Avoid moving soil or plant material from affected rows and check roots and stems with an expert.",
    agrovetAdvice: "Get a local diagnosis before buying chemicals; the correct response depends on the cause.",
  },
  {
    crop: "Avocado",
    symptom: "Dark sunken spots on fruit",
    possibleIssue: "Possible anthracnose or fruit damage",
    signs: "Dark spots can appear or worsen as fruit ripens; bruising and other diseases can look similar.",
    action: "Handle fruit carefully, remove rotting fruit, and improve airflow through pruning where appropriate.",
    agrovetAdvice: "Ask an agrovet to confirm the cause and recommend a registered avocado treatment if necessary.",
  },
  {
    crop: "Avocado",
    symptom: "Yellowing and wilting with declining roots",
    possibleIssue: "Possible root rot or water stress",
    signs: "Root damage, drainage problems, and other stresses can produce similar canopy symptoms.",
    action: "Check drainage and avoid waterlogging; do not move soil from affected trees.",
    agrovetAdvice: "Ask an extension officer to inspect the roots and soil before buying a treatment; root problems need cause-specific advice.",
  },
];

const crops: Crop[] = ["Tomato", "Maize", "Potato", "Avocado"];

export default function CropHealth() {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<Crop>("Tomato");
  const [symptom, setSymptom] = useState("");
  const [county, setCounty] = useState("");
  const [result, setResult] = useState<HealthGuide>();
  const symptoms = guides.filter((guide) => guide.crop === crop);

  const diagnose = () => {
    setResult(guides.find((guide) => guide.crop === crop && guide.symptom === symptom));
  };

  return (
    <section className="crop-health-page">
      <h1>{t("Crop health guide")}</h1>
      <p className="mut">
        {t("Choose a crop and symptom to see possible causes and safe next steps. This guide cannot confirm a diagnosis.")}
      </p>
      <div className="card crop-health-form">
        <label className="form-field">
          {t("Crop")}
          <select
            value={crop}
            onChange={(event) => {
              const nextCrop = crops.find((name) => name === event.target.value);
              if (nextCrop) {
                setCrop(nextCrop);
                setSymptom("");
                setResult(undefined);
              }
            }}
          >
            {crops.map((name) => <option key={name} value={name}>{t(name)}</option>)}
          </select>
        </label>
        <label className="form-field">
          {t("Observed symptom")}
          <select value={symptom} onChange={(event) => setSymptom(event.target.value)}>
            <option value="">{t("Choose a symptom")}</option>
            {symptoms.map((guide) => (
              <option key={guide.symptom} value={guide.symptom}>
                {t(guide.symptom)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          {t("County for nearby agrovets")}
          <input
            value={county}
            onChange={(event) => setCounty(event.target.value)}
            placeholder={t("e.g. Nakuru")}
            maxLength={80}
          />
        </label>
        <button
          className="btn g"
          type="button"
          disabled={!symptom}
          onClick={diagnose}
        >
          {t("Check symptoms")}
        </button>
      </div>
      {result && (
        <article className="card crop-health-result">
          <h2>{t(result.possibleIssue)}</h2>
          <p><b>{t("Signs to check")}: </b>{t(result.signs)}</p>
          <p><b>{t("Suggested next step")}: </b>{t(result.action)}</p>
          <p><b>{t("Medicine and agrovet guidance")}: </b>{t(result.agrovetAdvice)}</p>
          <p className="notice">
            {t("Do not buy or apply a pesticide based only on this guide. Confirm the diagnosis, use only products registered for the crop and pest, and follow the product label and harvest interval.")}
          </p>
          <a
            className="btn"
            href={`https://www.google.com/maps/search/${encodeURIComponent(`agrovet near ${county.trim() || "me"}, Kenya`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Find nearby agrovets")}
          </a>
        </article>
      )}
    </section>
  );
}
