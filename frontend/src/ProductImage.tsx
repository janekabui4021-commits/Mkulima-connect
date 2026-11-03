import { useEffect, useState } from "react";

interface CommonsImage {
  title?: string;
  thumburl?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value?: string };
    LicenseShortName?: { value?: string };
    ObjectName?: { value?: string };
    ImageDescription?: { value?: string };
    Categories?: { value?: string };
  };
}

interface CommonsResponse {
  query?: {
    pages?: Record<string, { index?: number; imageinfo?: CommonsImage[] }>;
  };
}

interface ProductPhoto {
  url: string;
  sourceUrl: string;
  artist: string;
  license: string;
}

const productSearch: Record<string, { terms: string; names: string[] }> = {
  tomatoes: { terms: "tomatoes", names: ["tomato", "tomatoes"] },
  maize: { terms: "maize", names: ["maize", "corn"] },
  potatoes: { terms: "potato", names: ["potato", "potatoes"] },
  "sukuma wiki": {
    terms: "collard greens",
    names: ["sukuma", "collard greens", "kale"],
  },
  "fresh milk": { terms: "milk", names: ["milk"] },
  bananas: { terms: "bananas", names: ["banana", "bananas"] },
  rice: { terms: "rice", names: ["rice"] },
  onions: { terms: "onions", names: ["onion", "onions"] },
  spinach: { terms: "spinach", names: ["spinach"] },
  avocados: { terms: "avocado", names: ["avocado", "avocados"] },
  cabbage: { terms: "cabbage", names: ["cabbage"] },
  wheat: { terms: "wheat", names: ["wheat"] },
  beans: { terms: "beans", names: ["beans", "bean"] },
  yoghurt: { terms: "yogurt", names: ["yogurt", "yoghurt"] },
  "fresh cream": { terms: "cream", names: ["cream"] },
  "green peas": { terms: "peas", names: ["peas", "pea"] },
  mala: { terms: "mala", names: ["mala", "fermented milk"] },
  "passion fruit": {
    terms: "passion fruit",
    names: ["passion fruit"],
  },
  carrots: { terms: "carrots", names: ["carrot", "carrots"] },
  "sweet potatoes": {
    terms: "sweet potato",
    names: ["sweet potato", "sweet potatoes"],
  },
};

const unsuitableImage =
  /\b(cook(?:ed|ing)?|recipe|meal|dish|cuisine|soup|stew|curry|sauce|salad|roast(?:ed)?|fried|baked|boiled|grilled|plant|seedling|sprout|field|farm|cultivat(?:e|ed|ion)|growing|flower|blossom|tree|bush|garden|potted|ornamental|rotten|logo|website|movie|film|comic|expo|panel|screenshot|advert(?:isement)?|cartoon|illustration|drawing|painting|sculpture|mascot|powder(?:ed)?|condensed|evaporated|udder|livestock)\b/i;
const imageRequests = new Map<string, Promise<ProductPhoto | null>>();
const curatedProductPhotos: Record<string, ProductPhoto> = {
  "avocados:meru growers": {
    url: "https://cdn.britannica.com/72/170772-050-D52BF8C2/Avocado-fruits.jpg",
    sourceUrl: "https://cdn.britannica.com/72/170772-050-D52BF8C2/Avocado-fruits.jpg",
    artist: "User-provided image",
    license: "Used with permission",
  },
  "avocados:kinoti farm": {
    url: "https://frootree.com/cdn/shop/files/avocado_a_grade.png?v=1781584567",
    sourceUrl: "https://frootree.com/cdn/shop/files/avocado_a_grade.png?v=1781584567",
    artist: "User-provided image",
    license: "Used with permission",
  },
  spinach: {
    url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQYFec-JqV2t-QVFDdptChFZnKQi5cdexXUNXNDoJ-qvw&s=10",
    sourceUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQYFec-JqV2t-QVFDdptChFZnKQi5cdexXUNXNDoJ-qvw&s=10",
    artist: "User-provided image",
    license: "Used with permission",
  },
  "sukuma wiki": {
    url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTSy1A2readA_0gBoYa16qjRynwEm-EI3nMgSPuO5YDr4NZkUK3awxYxro&s=10",
    sourceUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTSy1A2readA_0gBoYa16qjRynwEm-EI3nMgSPuO5YDr4NZkUK3awxYxro&s=10",
    artist: "User-provided image",
    license: "Used with permission",
  },
  mala: {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/73/Amasi_%283035444146%29.jpg/960px-Amasi_%283035444146%29.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Amasi_(3035444146).jpg",
    artist: "Jeppestown",
    license: "CC BY-SA 2.0",
  },
};

function plainText(markup: string): string {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function mentionsProduct(text: string, names: string[]): boolean {
  return names.some((name) =>
    new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(text),
  );
}

function getProductPhoto(
  productName: string,
  farmName?: string,
  imageUrl?: string | null,
): Promise<ProductPhoto | null> {
  const key = productName.toLowerCase();
  const farmKey = farmName?.toLowerCase();
  const requestKey = `${key}:${farmKey ?? ""}:${imageUrl ?? ""}`;
  const cached = imageRequests.get(requestKey);
  if (cached) {
    return cached;
  }

  if (imageUrl) {
    const parsedUrl = new URL(imageUrl);
    if (parsedUrl.protocol === "https:") {
      const request = Promise.resolve({
        url: parsedUrl.href,
        sourceUrl: parsedUrl.href,
        artist: "Farmer-provided image",
        license: "Farm supplied",
      });
      imageRequests.set(requestKey, request);
      return request;
    }
  }

  const curated =
    (farmKey && curatedProductPhotos[`${key}:${farmKey}`]) ??
    curatedProductPhotos[key];
  if (curated) {
    const request = Promise.resolve(curated);
    imageRequests.set(requestKey, request);
    return request;
  }

  const product = productSearch[key];
  if (!product) {
    return Promise.resolve(null);
  }

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${product.terms}`,
    gsrnamespace: "6",
    gsrlimit: "50",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "800",
    format: "json",
    origin: "*",
  });
  const request = fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Wikimedia image search failed (${response.status})`);
      }
      const data = (await response.json()) as CommonsResponse;
      const images = Object.values(data.query?.pages ?? {})
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .flatMap((page) => page.imageinfo ?? []);

      const candidates: Array<{ image: CommonsImage; score: number }> = [];
      for (const image of images) {
        const metadata = image.extmetadata;
        const title = plainText(image.title ?? "");
        const objectName = plainText(metadata?.ObjectName?.value ?? "");
        const description = plainText(metadata?.ImageDescription?.value ?? "");
        const categories = plainText(metadata?.Categories?.value ?? "");
        const searchableTitle = `${title} ${objectName}`;
        const searchableText = `${searchableTitle} ${description} ${categories}`;
        if (unsuitableImage.test(searchableText)) {
          continue;
        }

        if (!mentionsProduct(searchableTitle, product.names)) {
          continue;
        }

        const license = plainText(metadata?.LicenseShortName?.value ?? "");
        const permitted =
          license === "CC0" ||
          license.startsWith("CC0 ") ||
          /^CC BY(?:-SA)? \d/.test(license) ||
          /^Public domain\b/i.test(license);
        if (!permitted || !image.thumburl || !image.descriptionurl) {
          continue;
        }

        const imageUrl = new URL(image.thumburl);
        const sourceUrl = new URL(image.descriptionurl);
        if (
          imageUrl.protocol !== "https:" ||
          (imageUrl.hostname !== "upload.wikimedia.org" &&
            imageUrl.hostname !== "thumb.wikimedia.org") ||
          sourceUrl.protocol !== "https:" ||
          sourceUrl.hostname !== "commons.wikimedia.org"
        ) {
          continue;
        }

        const artist = plainText(image.extmetadata?.Artist?.value ?? "");
        candidates.push({
          score:
            (mentionsProduct(title, product.names) ? 4 : 0) +
            (/\b(fresh|ripe|raw|whole|harvested)\b/i.test(searchableText)
              ? 2
              : 0) +
            (/\b(food|fruit|vegetable|produce|grain|dairy|legume)\b/i.test(
              categories,
            )
              ? 1
              : 0),
          image: {
            ...image,
            thumburl: imageUrl.href,
            descriptionurl: sourceUrl.href,
            extmetadata: {
              ...metadata,
              Artist: { value: artist.slice(0, 120) },
              LicenseShortName: { value: license },
            },
          },
        });
      }
      candidates.sort((left, right) => right.score - left.score);
      const best = candidates[0]?.image;
      if (!best?.thumburl || !best.descriptionurl) {
        return null;
      }

      return {
        url: best.thumburl,
        sourceUrl: best.descriptionurl,
        artist: plainText(best.extmetadata?.Artist?.value ?? ""),
        license: plainText(best.extmetadata?.LicenseShortName?.value ?? ""),
      };
    });

  imageRequests.set(requestKey, request);
  return request;
}

export default function ProductImage({
  name,
  farmName,
  imageUrl,
  compact = false,
}: {
  name: string;
  farmName?: string;
  imageUrl?: string | null;
  compact?: boolean;
}) {
  const [photo, setPhoto] = useState<ProductPhoto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getProductPhoto(name, farmName, imageUrl)
      .then((result) => {
        if (active) {
          setPhoto(result);
          setFailed(result === null);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [name, farmName, imageUrl]);

  if (!photo) {
    return (
      <div
        className={`product-photo-placeholder${compact ? " compact" : ""}`}
        role="img"
        aria-label={
          failed
            ? `No licensed photo found for ${name}`
            : `Loading ${name} photo`
        }
      >
        {failed ? "Photo unavailable" : "Loading photo…"}
      </div>
    );
  }

  return (
    <figure className={`product-photo${compact ? " compact" : ""}`}>
      <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
        <img
          src={photo.url}
          alt={name}
          loading="lazy"
          onError={() => {
            setPhoto(null);
            setFailed(true);
          }}
        />
      </a>
      {!compact && (
        <figcaption>
          Photo by {photo.artist || "the original creator"} · {photo.license} ·{" "}
          <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
            source
          </a>
        </figcaption>
      )}
    </figure>
  );
}
