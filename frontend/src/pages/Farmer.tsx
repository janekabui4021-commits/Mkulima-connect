import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  getFarmProducts,
  getFarmerOrders,
  getManageableFarms,
  saveFarmProduct,
  updateOrderItemStatus,
  applyForFarm,
  analyzeFreshness,
  addFarmExpense,
  checkFarmWeather,
  getFarmIncome,
  getMarketplaceOptions,
  getFarmerPhoneVerification,
  sendFarmerPhoneOtp,
  confirmFarmerPhoneOtp,
  createFarmVerificationCode,
  submitFarmVerification,
  uploadFarmProductImage,
} from "../api";
import type {
  FarmProduct,
  ManagedFarm,
  OrderItem,
  ProductSubmission,
  FreshnessAnalysis,
  FarmIncome,
  FarmExpense,
  WeatherForecast,
  MarketplaceOptions,
  FarmBoundaryPoint,
} from "../api";
import ProductImage from "../ProductImage";
import FarmBoundaryMap from "../FarmBoundaryMap";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "../i18n";

interface ProductFields {
  name: string;
  description: string;
  category: string;
  variety: string;
  grade: string;
  unit: string;
  price_kes: string;
  stock: string;
  harvest_date: string;
  image_url: string;
  preorder_enabled: boolean;
  season_tier: "early" | "peak" | "late" | "in_season";
}

const emptyFields: ProductFields = {
  name: "",
  description: "",
  category: "Other",
  variety: "",
  grade: "Grade A",
  unit: "kg",
  price_kes: "",
  stock: "",
  harvest_date: "",
  image_url: "",
  preorder_enabled: false,
  season_tier: "in_season",
};

const produceVarietySuggestions: Record<string, string[]> = {
  avocado: ["Hass", "Fuerte", "Pinkerton", "Reed", "Bacon"],
  avocados: ["Hass", "Fuerte", "Pinkerton", "Reed", "Bacon"],
  tomato: ["Roma", "Cherry", "Beefsteak", "Money Maker", "Anna F1"],
  tomatoes: ["Roma", "Cherry", "Beefsteak", "Money Maker", "Anna F1"],
  potato: ["Shangi", "Tigoni", "Dutch Robijn", "Markies", "Unica"],
  potatoes: ["Shangi", "Tigoni", "Dutch Robijn", "Markies", "Unica"],
  maize: ["H614", "H6213", "DK8031", "Local"],
  corn: ["H614", "H6213", "DK8031", "Local"],
  banana: ["Cavendish", "Apple banana", "Matoke", "Lady Finger"],
  bananas: ["Cavendish", "Apple banana", "Matoke", "Lady Finger"],
  mango: ["Apple", "Ngowe", "Kent", "Tommy Atkins", "Keitt"],
  mangos: ["Apple", "Ngowe", "Kent", "Tommy Atkins", "Keitt"],
  mangoes: ["Apple", "Ngowe", "Kent", "Tommy Atkins", "Keitt"],
  onion: ["Red Creole", "Bombay Red", "Texas Grano", "White"],
  onions: ["Red Creole", "Bombay Red", "Texas Grano", "White"],
  bean: ["Rosecoco", "Nyayo", "Wairimu", "Canadian Wonder"],
  beans: ["Rosecoco", "Nyayo", "Wairimu", "Canadian Wonder"],
};

const nextStatus: Record<string, string> = {
  pending: "processing",
  processing: "ready",
  ready: "shipped",
  shipped: "delivered",
};

interface QueuedExpense extends Omit<FarmExpense, "id"> {
  farm_id: number;
  client_id: string;
}

const expenseQueueKey = (farmId: number) =>
  `mkulima_offline_expenses_${localStorage.getItem("mkulima_offline_user_id")}_${farmId}`;

function createClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.random() * 16;
    return (character === "x" ? random : (random % 4) + 8 | 0).toString(16);
  });
}

export default function Farmer() {
  const { t } = useTranslation();
  const [farms, setFarms] = useState<ManagedFarm[]>([]);
  const [farmId, setFarmId] = useState("");
  const [products, setProducts] = useState<FarmProduct[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [fields, setFields] = useState<ProductFields>(emptyFields);
  const [productPhoto, setProductPhoto] = useState<File | null>(null);
  const [marketplaceOptions, setMarketplaceOptions] =
    useState<MarketplaceOptions | null>(null);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [farmApplication, setFarmApplication] = useState({
    name: "",
    county: "",
    size_acres: "",
    farming_methods: "",
  });
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [confirmingOtp, setConfirmingOtp] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [boundaryPoints, setBoundaryPoints] = useState<FarmBoundaryPoint[]>([]);
  const [verificationCapture, setVerificationCapture] = useState<{
    video: File;
    latitude: number;
    longitude: number;
    accuracy: number;
    recordedAt: string;
    duration: number;
  } | null>(null);
  const [recordingFarmVideo, setRecordingFarmVideo] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const videoPreview = useRef<HTMLVideoElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingStartedAt = useRef(0);
  const recordingTimer = useRef<number>();
  const recordingClock = useRef<number>();
  const [applicationPending, setApplicationPending] = useState(false);
  const [freshness, setFreshness] = useState<Record<number, FreshnessAnalysis>>({});
  const [storageTypes, setStorageTypes] = useState<Record<number, string>>({});
  const [analyzingId, setAnalyzingId] = useState<number>();
  const [income, setIncome] = useState<FarmIncome | null>(null);
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [checkingWeather, setCheckingWeather] = useState(false);
  const [pendingExpenses, setPendingExpenses] = useState<QueuedExpense[]>([]);
  const [expenseFields, setExpenseFields] = useState({
    category: "",
    amount_kes: "",
    expense_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  useEffect(() => {
    return () => {
      if (recordingTimer.current) window.clearTimeout(recordingTimer.current);
      if (recordingClock.current) window.clearInterval(recordingClock.current);
      recordingStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    getFarmerPhoneVerification()
      .then(({ verified }) => setPhoneVerified(verified))
      .catch((cause: unknown) =>
        setError(
          "Could not load phone verification status: " +
            (cause instanceof Error ? cause.message : String(cause)),
        ),
      );
  }, []);

  useEffect(() => {
    getMarketplaceOptions()
      .then(setMarketplaceOptions)
      .catch((cause: unknown) =>
        setError(
          "Could not load marketplace settings: " +
            (cause instanceof Error ? cause.message : String(cause)),
        ),
      );
  }, []);

  useEffect(() => {
    if (
      marketplaceOptions?.categories.length &&
      !marketplaceOptions.categories.includes(fields.category)
    ) {
      setFields((current) => ({
        ...current,
        category: marketplaceOptions.categories[0],
      }));
    }
  }, [fields.category, marketplaceOptions]);

  useEffect(() => {
    getManageableFarms()
      .then((availableFarms) => {
        setFarms(availableFarms);
        const verified = availableFarms.find((farm) => farm.status === "verified");
        if (verified) {
          setFarmId(String(verified.id));
        }
        setApplicationPending(availableFarms.some((farm) => farm.status === "pending"));
      })
      .catch((cause: unknown) => {
        setError(
          "Could not load farms: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, []);

  const reload = async (id: number) => {
    const farmProducts = await getFarmProducts(id);
    setProducts(farmProducts);
    if (!navigator.onLine) {
      setOrders([]);
      return;
    }
    try {
      setOrders(await getFarmerOrders(id));
    } catch (cause) {
      setOrders([]);
      setError(
        "Could not load farm orders: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  useEffect(() => {
    if (!farmId) {
      return;
    }
    setError("");
    reload(Number(farmId)).catch((cause: unknown) => {
      setError(
        "Could not load farm listings and orders: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    });
  }, [farmId]);

  useEffect(() => {
    if (!farmId) return;
    getFarmIncome(Number(farmId))
      .then(setIncome)
      .catch((cause: unknown) => {
        if (navigator.onLine) {
          setError(
            "Could not load farm income: " +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      });
  }, [farmId]);

  useEffect(() => {
    const active = farms.find((farm) => String(farm.id) === farmId);
    if (
      !active ||
      active.latitude == null ||
      active.longitude == null ||
      !navigator.onLine
    ) {
      return;
    }
    const key = `mkulima_weather_checked_${farmId}`;
    try {
      const lastChecked = Number(localStorage.getItem(key) || 0);
      if (Date.now() - lastChecked < 6 * 60 * 60 * 1000) return;
    } catch (cause) {
      setError(
        "Could not read the local weather-check schedule: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
      return;
    }
    checkFarmWeather(Number(farmId))
      .then((forecast) => {
        setWeather(forecast);
        try {
          localStorage.setItem(key, String(Date.now()));
        } catch (cause) {
          setError(
            "Weather loaded, but its local check schedule could not be saved: " +
              (cause instanceof Error ? cause.message : String(cause)),
          );
        }
      })
      .catch((cause: unknown) => {
        setError(
          "Could not automatically check farm weather: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      });
  }, [farmId, farms]);

  useEffect(() => {
    if (!farmId) return;
    const selectedFarmId = Number(farmId);
    const key = expenseQueueKey(selectedFarmId);
    const syncExpenses = async () => {
      let queued: QueuedExpense[];
      try {
        const stored = localStorage.getItem(key);
        queued = stored ? (JSON.parse(stored) as QueuedExpense[]) : [];
      } catch (cause) {
        setError(
          "Could not read saved offline expenses: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
        return;
      }
      if (!queued.length) {
        setPendingExpenses([]);
        return;
      }
      setPendingExpenses(queued);
      if (!navigator.onLine) return;
      try {
        for (const queuedExpense of queued) {
          await addFarmExpense(selectedFarmId, queuedExpense);
        }
        localStorage.removeItem(key);
        setPendingExpenses([]);
        setIncome(await getFarmIncome(selectedFarmId));
        setMessage("Saved offline expenses have synced.");
      } catch (cause) {
        setPendingExpenses(queued);
        setError(
          "Could not sync saved offline expenses. They are still stored on this device. " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    };
    void syncExpenses();
    window.addEventListener("online", syncExpenses);
    return () => window.removeEventListener("online", syncExpenses);
  }, [farmId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!farmId) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const product: ProductSubmission = {
        name: fields.name.trim(),
        description: fields.description.trim(),
        category: fields.category,
        variety: fields.variety.trim(),
        grade: fields.grade.trim(),
        unit: fields.unit.trim(),
        price_kes: Number(fields.price_kes),
        stock: Number(fields.stock),
        harvest_date: fields.harvest_date || null,
        image_url: productPhoto
          ? (await uploadFarmProductImage(Number(farmId), productPhoto)).image_url
          : fields.image_url.trim() || null,
        preorder_enabled: fields.preorder_enabled,
        season_tier: fields.season_tier,
      };
      await saveFarmProduct(Number(farmId), product, editingId);
      setMessage(editingId ? "Product listing updated." : "Product listed.");
      setFields(emptyFields);
      setProductPhoto(null);
      setEditingId(undefined);
      await reload(Number(farmId));
    } catch (cause) {
      setError(
        "Could not save product: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitFarmApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const application = await applyForFarm({
        ...farmApplication,
        size_acres: Number(farmApplication.size_acres),
      });
      setFarms((current) => [
        ...current,
        {
          id: application.id,
          name: farmApplication.name,
          county: farmApplication.county,
          status: "pending",
          latitude: null,
          longitude: null,
          farming_methods: farmApplication.farming_methods,
          verification_level: "unverified",
          verification_submitted_at: null,
        },
      ]);
      setApplicationPending(true);
      setMessage("Farm application sent to an administrator for review.");
    } catch (cause) {
      setError(
        "Could not submit farm: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const requestPhoneCode = async () => {
    setError("");
    setMessage("");
    setSendingOtp(true);
    try {
      const result = await sendFarmerPhoneOtp();
      if (result.verified) {
        setPhoneVerified(true);
        setMessage("Your phone number is already verified.");
      } else {
        setOtpRequested(true);
        setMessage("A one-time code was sent to the phone number on your account.");
      }
    } catch (cause) {
      setError(
        "Could not send phone verification code: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setSendingOtp(false);
    }
  };

  const confirmPhoneCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setConfirmingOtp(true);
    try {
      await confirmFarmerPhoneOtp(otpCode);
      setPhoneVerified(true);
      setOtpRequested(false);
      setOtpCode("");
      setMessage("Phone number verified.");
    } catch (cause) {
      setError(
        "Could not verify phone number: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setConfirmingOtp(false);
    }
  };

  const generateVerificationCode = async (farm: ManagedFarm) => {
    setError("");
    setMessage("");
    try {
      const result = await createFarmVerificationCode(farm.id);
      setVerificationCode(result.code);
    } catch (cause) {
      setError(
        "Could not generate farm video code: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const startFarmVideoRecording = async () => {
    setError("");
    setMessage("");
    if (!verificationCode) {
      setError("Generate the random video code before recording.");
      return;
    }
    if (!navigator.geolocation || !navigator.mediaDevices?.getUserMedia) {
      setError("This device must support GPS and camera recording.");
      return;
    }
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        });
      });
      if (position.coords.accuracy > 200) {
        throw new Error("GPS accuracy must be 200 metres or better. Try again outdoors.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      recordingStream.current = stream;
      if (videoPreview.current) videoPreview.current.srcObject = stream;
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, videoBitsPerSecond: 1_500_000 } : undefined,
      );
      const chunks: BlobPart[] = [];
      const captureLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        recordedAt: new Date().toISOString(),
      };
      recordingStartedAt.current = performance.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Math.min(
          30,
          (performance.now() - recordingStartedAt.current) / 1000,
        );
        stream.getTracks().forEach((track) => track.stop());
        recordingStream.current = null;
        if (recordingTimer.current) window.clearTimeout(recordingTimer.current);
        if (recordingClock.current) window.clearInterval(recordingClock.current);
        setRecordingFarmVideo(false);
        if (duration < 15) {
          setError("Record for at least 15 seconds before submitting.");
          return;
        }
        const type = recorder.mimeType || "video/webm";
        const extension = type.includes("mp4") ? "mp4" : "webm";
        setVerificationCapture({
          video: new File(chunks, `farm-verification.${extension}`, { type }),
          ...captureLocation,
          duration,
        });
      };
      recorder.onerror = () => {
        setError("The camera recording stopped unexpectedly. Please record again.");
      };
      mediaRecorder.current = recorder;
      recorder.start(250);
      setVerificationCapture(null);
      setRecordingSeconds(0);
      setRecordingFarmVideo(true);
      recordingClock.current = window.setInterval(() => {
        setRecordingSeconds(
          Math.floor((performance.now() - recordingStartedAt.current) / 1000),
        );
      }, 250);
      recordingTimer.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 29_500);
    } catch (cause) {
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      recordingStream.current = null;
      setError(
        "Could not start in-app farm video: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const stopFarmVideoRecording = () => {
    if (recordingSeconds < 15) return;
    if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
  };

  const submitVerificationEvidence = async (farm: ManagedFarm) => {
    setError("");
    setMessage("");
    if (boundaryPoints.length < 3) {
      setError("Mark at least 3 points on the map to draw your farm boundary.");
      return;
    }
    if (!verificationCode || !verificationCapture) {
      setError("Generate the verification code and record an in-app farm video first.");
      return;
    }
    setSubmittingVerification(true);
    try {
      if (
        !Number.isFinite(verificationCapture.duration) ||
        verificationCapture.duration < 15 ||
        verificationCapture.duration > 30
      ) {
        throw new Error("The video must be between 15 and 30 seconds long.");
      }
      await submitFarmVerification(farm.id, {
        boundary: boundaryPoints,
        verification_code: verificationCode,
        video: verificationCapture.video,
        video_latitude: verificationCapture.latitude,
        video_longitude: verificationCapture.longitude,
        video_accuracy_m: verificationCapture.accuracy,
        recorded_at: verificationCapture.recordedAt,
        duration_seconds: verificationCapture.duration,
      });
      setFarms((current) =>
        current.map((item) =>
          item.id === farm.id
            ? {
                ...item,
                status: "verified",
                verification_level: "provisional",
                verification_submitted_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      setFarmId(String(farm.id));
      setVerificationCode("");
      setVerificationCapture(null);
      setMessage(
        "Farm evidence submitted. Your farm is Provisionally Verified and can publish up to 3 active listings while an administrator reviews it.",
      );
    } catch (cause) {
      setError(
        "Could not submit farm verification: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setSubmittingVerification(false);
    }
  };

  const edit = (product: FarmProduct) => {
    setEditingId(product.id);
    setProductPhoto(null);
    setFields({
      name: product.name,
      description: product.description,
      category: product.category,
      variety: product.variety,
      grade: product.grade,
      unit: product.unit,
      price_kes: String(product.price_kes),
      stock: String(product.stock),
      harvest_date: product.harvest_date ?? "",
      image_url: product.image_url ?? "",
      preorder_enabled: product.preorder_enabled,
      season_tier: product.season_tier,
    });
    document.getElementById("product-form")?.scrollIntoView({
      behavior: "smooth",
    });
  };

  const advanceOrder = async (order: OrderItem) => {
    const status = nextStatus[order.fulfillment_status];
    if (!status || !farmId) {
      return;
    }
    setError("");
    setMessage("");
    try {
      await updateOrderItemStatus(
        Number(farmId),
        order.order_item_id,
        status,
      );
      setMessage(`Order #${order.order_id} marked ${status}.`);
      await reload(Number(farmId));
    } catch (cause) {
      setError(
        "Could not update order: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const analyzeProduct = async (product: FarmProduct) => {
    setError("");
    setAnalyzingId(product.id);
    try {
      const analysis = await analyzeFreshness(
        product.id,
        storageTypes[product.id] ?? "room temperature",
      );
      setFreshness((current) => ({ ...current, [product.id]: analysis }));
    } catch (cause) {
      setError(
        "Could not analyze freshness: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setAnalyzingId(undefined);
    }
  };

  const recordExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!farmId) return;
    setError("");
    setMessage("");
    const selectedFarmId = Number(farmId);
    const queuedExpense: QueuedExpense = {
      farm_id: selectedFarmId,
      client_id: createClientId(),
      category: expenseFields.category.trim(),
      amount_kes: Number(expenseFields.amount_kes),
      expense_date: expenseFields.expense_date,
      notes: expenseFields.notes.trim(),
    };
    const saveOffline = () => {
      const key = expenseQueueKey(selectedFarmId);
      try {
        const stored = localStorage.getItem(key);
        const queued = stored ? (JSON.parse(stored) as QueuedExpense[]) : [];
        const nextQueue = [...queued, queuedExpense];
        localStorage.setItem(key, JSON.stringify(nextQueue));
        setPendingExpenses(nextQueue);
        setExpenseFields({
          ...expenseFields,
          category: "",
          amount_kes: "",
          notes: "",
        });
        setMessage("Expense saved on this device and will sync when online.");
      } catch (cause) {
        setError(
          "Could not save expense offline: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    };
    if (!navigator.onLine) {
      saveOffline();
      return;
    }
    try {
      await addFarmExpense(selectedFarmId, queuedExpense);
      setExpenseFields({
        ...expenseFields,
        category: "",
        amount_kes: "",
        notes: "",
      });
      setIncome(await getFarmIncome(selectedFarmId));
      setMessage("Farm expense recorded.");
    } catch (cause) {
      if (cause instanceof TypeError && !navigator.onLine) {
        saveOffline();
      } else {
        setError(
          "Could not record farm expense: " +
            (cause instanceof Error ? cause.message : String(cause)),
        );
      }
    }
  };

  const loadWeather = async () => {
    if (!farmId) return;
    setCheckingWeather(true);
    setError("");
    setMessage("");
    try {
      const forecast = await checkFarmWeather(Number(farmId));
      setWeather(forecast);
      setMessage(
        forecast.warning
          ? "Weather warning saved to your notifications."
          : "No severe weather warning in today’s forecast.",
      );
    } catch (cause) {
      setError(
        "Could not check farm weather: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setCheckingWeather(false);
    }
  };

  const activeFarm = farms.find((farm) => String(farm.id) === farmId);

  return (
    <section>
      <h2>{t("Farmer tools")}</h2>
      <p className="mut">
        Verify your phone and farm location to unlock limited provisional listings.
      </p>
      <section className="card farmer-verification-card">
        <h3>1. Verify your phone</h3>
        {phoneVerified ? (
          <p className="notice success">Phone number verified.</p>
        ) : (
          <>
            <p className="mut">
              We’ll send a one-time code by SMS to the phone number on your account.
            </p>
            <button
              className="btn"
              type="button"
              disabled={sendingOtp}
              onClick={() => void requestPhoneCode()}
            >
              {sendingOtp ? "Sending code…" : otpRequested ? "Resend code" : "Send phone code"}
            </button>
            {otpRequested && (
              <form className="phone-otp-form" onSubmit={(event) => void confirmPhoneCode(event)}>
                <label className="form-field">
                  Six-digit code
                  <input
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                  />
                </label>
                <button className="btn g" disabled={confirmingOtp}>
                  {confirmingOtp ? "Verifying…" : "Verify phone"}
                </button>
              </form>
            )}
          </>
        )}
      </section>
      {farms.some((farm) => farm.status === "verified") && (
        <label className="form-field">
          Select farm
          <select
            value={farmId}
            onChange={(event) => {
              setFarmId(event.target.value);
              setEditingId(undefined);
              setFields(emptyFields);
            }}
          >
            {farms.filter((farm) => farm.status === "verified").map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.name} · {farm.county} ({farm.status})
              </option>
            ))}
          </select>
        </label>
      )}
      {farms
        .filter((farm) => farm.status !== "verified")
        .map((farm) => (
          <div
            className={farm.status === "rejected" ? "notice error" : "notice"}
            key={farm.id}
          >
            <strong>{farm.name} · {farm.county}: {farm.status}</strong>
            <p>
              {farm.status === "pending"
                ? "Complete GPS boundary capture and submit a 15–30 second farm video. Provisional listings unlock after submission; an administrator reviews your video before full verification."
                : "This farm application was rejected. Contact an administrator if you need help with the application."}
            </p>
          </div>
        ))}
      {phoneVerified &&
        farms.filter((farm) => farm.status === "pending").map((farm) => (
          <section className="card product-form farmer-verification-card" key={`verify-${farm.id}`}>
            <h3>2–3. Capture your farm and video</h3>
            <p className="mut">
              Draw the farm boundary on the map.               Then record a 15–30 second in-app video
              showing the generated code, your crops, and the farm surroundings.
              GPS and capture time are recorded when the video starts.
            </p>
            <FarmBoundaryMap points={boundaryPoints} onChange={setBoundaryPoints} />
            <button
              className="btn"
              type="button"
              onClick={() => void generateVerificationCode(farm)}
            >
              Generate random video code
            </button>
            {verificationCode && (
              <p className="farm-verification-code" aria-live="polite">
                Write this code clearly on paper and show it in your video:
                <strong>{verificationCode}</strong>
              </p>
            )}
            <video
              className="farm-verification-video"
              ref={videoPreview}
              autoPlay
              muted
              playsInline
              aria-label="Farm video camera preview"
            />
            {recordingFarmVideo ? (
              <div className="admin-actions">
                <span className="notice" role="status">
                  Recording… {recordingSeconds}s / 30s
                </span>
                <button
                  className="btn"
                  type="button"
                  disabled={recordingSeconds < 15}
                  onClick={stopFarmVideoRecording}
                >
                  Stop recording
                </button>
              </div>
            ) : (
              <button
                className="btn"
                type="button"
                disabled={!verificationCode}
                onClick={() => void startFarmVideoRecording()}
              >
                {verificationCapture ? "Record again" : "Start farm video"}
              </button>
            )}
            {verificationCapture && !recordingFarmVideo && (
              <p className="mut">
                Recorded {verificationCapture.duration.toFixed(1)} seconds · GPS
                accuracy ±{verificationCapture.accuracy.toFixed(0)} m
              </p>
            )}
            <button
              className="btn g"
              type="button"
              disabled={submittingVerification || !verificationCode || !verificationCapture || recordingFarmVideo}
              onClick={() => void submitVerificationEvidence(farm)}
            >
              {submittingVerification ? "Uploading evidence…" : "Submit verification"}
            </button>
          </section>
        ))}
      {activeFarm && (
        <p className="mut">
          Product origin is linked to {activeFarm.county}, Kenya. Verification
          level: {activeFarm.verification_level === "provisional" ? "Provisionally Verified" : "Fully Verified"}.
        </p>
      )}
      {activeFarm?.verification_level === "provisional" && (
        <p className="notice">
          Provisional tier: up to 3 active produce listings. An administrator
          will review your video before upgrading your farm.
        </p>
      )}
      {farmId && (
        <section className="income-section">
          <h3>{t("Farm income tracker")}</h3>
          <p className="mut">
            {t("Sales include paid orders only. Estimated profit is paid sales minus expenses you record here; it does not include unrecorded costs.")}
          </p>
          {income ? (
            <div className="income-summary">
              <article className="card">
                <span className="mut">{t("Paid sales")}</span>
                <b>KES {income.sales_kes.toLocaleString()}</b>
              </article>
              <article className="card">
                <span className="mut">{t("Recorded expenses")}</span>
                <b>KES {income.expenses_kes.toLocaleString()}</b>
              </article>
              <article className="card">
                <span className="mut">{t("Estimated profit")}</span>
                <b>KES {income.estimated_profit_kes.toLocaleString()}</b>
              </article>
              <article className="card">
                <span className="mut">{t("Paid orders · units sold")}</span>
                <b>{income.paid_orders} · {income.units_sold.toLocaleString()}</b>
              </article>
            </div>
          ) : (
            <p className="mut">{t("Income totals will load when you are online.")}</p>
          )}
          <form className="card product-form" onSubmit={(event) => void recordExpense(event)}>
            <h4>{t("Record an expense")}</h4>
            <div className="form-grid">
              <label className="form-field">
                {t("Category")}
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={expenseFields.category}
                  onChange={(event) =>
                    setExpenseFields({ ...expenseFields, category: event.target.value })
                  }
                  placeholder="Seeds, labour, transport…"
                />
              </label>
              <label className="form-field">
                {t("Amount (KES)")}
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={expenseFields.amount_kes}
                  onChange={(event) =>
                    setExpenseFields({ ...expenseFields, amount_kes: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                {t("Date")}
                <input
                  required
                  type="date"
                  value={expenseFields.expense_date}
                  onChange={(event) =>
                    setExpenseFields({ ...expenseFields, expense_date: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="form-field">
              {t("Notes")}
              <textarea
                maxLength={1000}
                value={expenseFields.notes}
                onChange={(event) =>
                  setExpenseFields({ ...expenseFields, notes: event.target.value })
                }
              />
            </label>
            <button className="btn g">{t("Save expense")}</button>
          </form>
          <h4>{t("Recent expenses")}</h4>
          {income?.expenses.length ? (
            income.expenses.slice(0, 8).map((expense) => (
              <div className="row" key={expense.id}>
                <span>
                  <b>{expense.category}</b>
                  <small className="mut"> · {expense.expense_date}{expense.notes ? ` · ${expense.notes}` : ""}</small>
                </span>
                <b>KES {Number(expense.amount_kes).toLocaleString()}</b>
              </div>
            ))
          ) : income ? (
            <p className="mut">{t("No expenses recorded yet.")}</p>
          ) : null}
          {pendingExpenses.map((expense) => (
            <div className="row" key={expense.client_id}>
              <span>
                <b>{expense.category}</b>
                <small className="mut"> · {expense.expense_date} · Waiting to sync</small>
              </span>
              <b>KES {Number(expense.amount_kes).toLocaleString()}</b>
            </div>
          ))}
        </section>
      )}
      {farmId && (
        <section className="weather-section">
          <h3>{t("Weather warning")}</h3>
          <p className="mut">
            Check today’s Open-Meteo forecast for the farm’s approximate county
            location. Forecasts are advisory, not a local weather guarantee.
          </p>
          <button
            className="btn"
            type="button"
            disabled={checkingWeather}
            onClick={() => void loadWeather()}
          >
            {checkingWeather ? t("Checking forecast…") : t("Check weather")}
          </button>
          {weather && (
            <p className={weather.warning ? "notice" : "mut"}>
              {weather.farm} · {weather.forecast_date} · Rain probability{" "}
              {weather.rain_probability}% · {weather.message}
            </p>
          )}
        </section>
      )}
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice success">{message}</p>}
      {!farmId &&
        farms.length === 0 &&
        !applicationPending &&
        marketplaceOptions?.farm_applications_enabled === false && (
          <p className="notice">
            New farm applications are temporarily closed by an administrator.
          </p>
        )}
      {!farmId &&
        farms.length === 0 &&
        !applicationPending &&
        marketplaceOptions?.farm_applications_enabled &&
        phoneVerified &&
        marketplaceOptions.counties.length > 0 && (
        <form className="card product-form" onSubmit={(event) => void submitFarmApplication(event)}>
          <h3>Apply to register your farm</h3>
          <label className="form-field">
            Farm name
            <input required minLength={2} maxLength={120} value={farmApplication.name} onChange={(event) => setFarmApplication({ ...farmApplication, name: event.target.value })} />
          </label>
          <label className="form-field">
            Farming methods
            <textarea
              maxLength={2000}
              value={farmApplication.farming_methods}
              onChange={(event) =>
                setFarmApplication({
                  ...farmApplication,
                  farming_methods: event.target.value,
                })
              }
              placeholder="Describe practices such as organic inputs, irrigation, or soil conservation"
            />
          </label>
          <div className="form-grid">
            <label className="form-field">
              County
              <select
                required
                value={farmApplication.county}
                onChange={(event) =>
                  setFarmApplication({ ...farmApplication, county: event.target.value })
                }
              >
                <option value="">Select a county</option>
                {marketplaceOptions.counties.map((county) => (
                  <option key={county}>{county}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Farm size (acres)
              <input required type="number" min="0.1" step="0.1" value={farmApplication.size_acres} onChange={(event) => setFarmApplication({ ...farmApplication, size_acres: event.target.value })} />
            </label>
          </div>
          <button className="btn g">Submit for admin approval</button>
        </form>
      )}
      {farmId && (
        <>
          <form id="product-form" className="card product-form" onSubmit={save}>
            <h3>{editingId ? "Edit produce listing" : "List produce"}</h3>
            <label className="form-field">
              Produce name
              <input
                required
                minLength={2}
                maxLength={100}
                value={fields.name}
                onChange={(event) =>
                  setFields({ ...fields, name: event.target.value })
                }
                placeholder="e.g. Fresh spinach"
              />
            </label>
            <label className="form-field">
              Product description
              <textarea
                maxLength={2000}
                rows={3}
                value={fields.description}
                onChange={(event) =>
                  setFields({ ...fields, description: event.target.value })
                }
                placeholder="Describe freshness, packaging, or other useful details"
              />
            </label>
            <div className="form-grid">
              <label className="form-field">
                Produce variety / type
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  list="produce-variety-suggestions"
                  value={fields.variety}
                  onChange={(event) =>
                    setFields({ ...fields, variety: event.target.value })
                  }
                  placeholder="e.g. Hass, Fuerte, local"
                />
                <datalist id="produce-variety-suggestions">
                  {(produceVarietySuggestions[
                    fields.name.trim().toLocaleLowerCase()
                  ] ?? []).map((variety) => (
                    <option key={variety} value={variety} />
                  ))}
                </datalist>
              </label>
              <label className="form-field">
                Product category
                <select
                  required
                  value={fields.category}
                  onChange={(event) =>
                    setFields({ ...fields, category: event.target.value })
                  }
                >
                  {(marketplaceOptions?.categories ?? ["Other"]).map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Unit
                <input
                  required
                  value={fields.unit}
                  onChange={(event) =>
                    setFields({ ...fields, unit: event.target.value })
                  }
                  placeholder="kg"
                />
              </label>
              <label className="form-field">
                Produce grade
                <input
                  required
                  maxLength={40}
                  value={fields.grade}
                  onChange={(event) =>
                    setFields({ ...fields, grade: event.target.value })
                  }
                  placeholder="Grade A"
                />
              </label>
              <label className="form-field">
                Price (KES per unit)
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={fields.price_kes}
                  onChange={(event) =>
                    setFields({ ...fields, price_kes: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                Quantity available
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={fields.stock}
                  onChange={(event) =>
                    setFields({ ...fields, stock: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                Harvest date
                <input
                  type="date"
                  value={fields.harvest_date}
                  onChange={(event) =>
                    setFields({ ...fields, harvest_date: event.target.value })
                  }
                />
              </label>
              <label className="form-field">
                Season tier
                <select
                  value={fields.season_tier}
                  onChange={(event) =>
                    setFields({
                      ...fields,
                      season_tier: event.target.value as ProductFields["season_tier"],
                    })
                  }
                >
                  <option value="in_season">In season</option>
                  <option value="early">Early harvest</option>
                  <option value="peak">Peak harvest</option>
                  <option value="late">Late harvest</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>
                <input
                  type="checkbox"
                  checked={fields.preorder_enabled}
                  onChange={(event) =>
                    setFields({
                      ...fields,
                      preorder_enabled: event.target.checked,
                    })
                  }
                />{" "}
                Accept pre-orders for this growing produce
              </span>
              <span className="mut">
                Quantity available is the reservation limit. Buyers reserve now;
                preparation starts after the harvest date.
              </span>
            </label>
            <label className="form-field">
              Upload product photo (JPEG, PNG, or WebP; up to 5 MB)
              <input
                key={
                  productPhoto
                    ? `${productPhoto.name}-${productPhoto.lastModified}`
                    : "empty-photo"
                }
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 5 * 1024 * 1024) {
                    setError("Product photos must be 5 MB or smaller.");
                    setProductPhoto(null);
                    event.target.value = "";
                    return;
                  }
                  setError("");
                  setProductPhoto(file);
                }}
              />
            </label>
            <label className="form-field">
              Or use a product photo URL (HTTPS)
              <input
                type="text"
                value={fields.image_url}
                onChange={(event) =>
                  {
                    setProductPhoto(null);
                    setFields({ ...fields, image_url: event.target.value });
                  }
                }
                placeholder="https://example.com/produce.jpg or uploaded photo"
              />
            </label>
            <button className="btn g" disabled={busy}>
              {busy
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "Publish product"}
            </button>{" "}
            {editingId && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEditingId(undefined);
                  setFields(emptyFields);
                  setProductPhoto(null);
                }}
              >
                Cancel edit
              </button>
            )}
          </form>

          <h3>Produce listings</h3>
          {products.length === 0 && (
            <p className="mut">This farm has no product listings yet.</p>
          )}
          <div className="grid">
            {products.map((product) => (
              <article className="card" key={product.id}>
                <ProductImage
                  name={product.name}
                  farmName={activeFarm?.name}
                  imageUrl={product.image_url}
                />
                <h3>{product.name}</h3>
                <p className="mut">
                  Variety: {product.variety} ·{" "}
                  KES {product.price_kes}/{product.unit} · {product.stock}{" "}
                  {product.unit} available
                </p>
                {product.description && <p>{product.description}</p>}
                <span className={`availability-badge${product.stock > 0 ? " available" : ""}`}>
                  {product.stock > 0 ? "In stock" : "Out of stock"}
                </span>
                <p className="mut">
                  {product.preorder_enabled ? "Pre-orders open" : "In-season listing"}
                  {" · "}
                  {product.season_tier.replace("_", " ")} tier
                </p>
                <p className="mut">
                  Harvest: {product.harvest_date || "Not specified"}
                </p>
                <div className="freshness-controls">
                  <label className="form-field">
                    Storage conditions
                    <select
                      value={storageTypes[product.id] ?? "room temperature"}
                      onChange={(event) =>
                        setStorageTypes((current) => ({
                          ...current,
                          [product.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="room temperature">Room temperature</option>
                      <option value="refrigerated">Refrigerated</option>
                      <option value="cool storage">Cool storage</option>
                      <option value="other">Other / unknown</option>
                    </select>
                  </label>
                  <button
                    className="btn"
                    disabled={!product.harvest_date || analyzingId === product.id}
                    onClick={() => void analyzeProduct(product)}
                  >
                    {analyzingId === product.id
                      ? "Checking…"
                      : "Run freshness estimate"}
                  </button>
                </div>
                {freshness[product.id] && (
                  <div
                    className={`freshness-result ${freshness[product.id].risk_level.toLowerCase()}`}
                    role="status"
                  >
                    <b>
                      {freshness[product.id].risk_level} · estimated age{" "}
                      {freshness[product.id].age_in_days} days
                    </b>
                    <p>{freshness[product.id].ai_recommendation}</p>
                    <p>
                      Suggested discount:{" "}
                      {freshness[product.id].suggested_discount_pct}%
                    </p>
                    <p className="mut">{freshness[product.id].storage_note}</p>
                    <small>This is a rule-based estimate, not an AI model or food-safety assessment.</small>
                  </div>
                )}
                <div className="trace-qr">
                  <QRCodeSVG
                    value={`${window.location.origin}/trace/${product.trace_code}`}
                    size={144}
                    level="M"
                    title={`Trace ${product.name} from ${activeFarm?.name ?? "farm"}`}
                  />
                  <div>
                    <b>Trace QR · listing</b>
                    <p className="mut">
                      Scan to view this farm’s harvest, methods, and location.
                    </p>
                    <a href={`/trace/${product.trace_code}`} target="_blank" rel="noreferrer">
                      Open public trace record
                    </a>
                  </div>
                </div>
                <button className="btn" onClick={() => edit(product)}>
                  Edit listing
                </button>
              </article>
            ))}
          </div>

          <h3>Farm orders</h3>
          {orders.length === 0 && (
            <p className="mut">No orders contain this farm’s products yet.</p>
          )}
          <div className="grid">
            {orders.map((order) => {
              const status = nextStatus[order.fulfillment_status];
              return (
                <article className="card" key={order.order_item_id}>
                  <h3>Order #{order.order_id}</h3>
                  <p>
                    {order.qty} {order.unit} · KES{" "}
                    {Number(order.price_kes * order.qty).toLocaleString()}
                  </p>
                  <p className="mut">
                    Placed {new Date(order.created_at).toLocaleString()} ·{" "}
                    {order.order_status}
                  </p>
                  <span className="badge">{order.fulfillment_status}</span>
                  {status && (
                    <p>
                      <button
                        className="btn g"
                        onClick={() => advanceOrder(order)}
                      >
                        Mark {status}
                      </button>
                    </p>
                  )}
                  {order.fulfillment_status === "delivered" && (
                    <p className="mut">Delivery complete.</p>
                  )}
                  {order.fulfillment_status === "cancelled" && (
                    <p className="mut">This order item was cancelled.</p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
