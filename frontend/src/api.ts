export interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  variety: string;
  grade: string;
  price_kes: number;
  unit: string;
  stock: number;
  harvest_date: string | null;
  image_url: string | null;
  preorder_enabled: boolean;
  season_tier: "early" | "peak" | "late" | "in_season";
  trace_code: string;
  farm_id: number;
  farmer_id?: number | null;
  farm: string;
  county: string;
  verification_level: "provisional" | "full";
  latitude: number | null;
  longitude: number | null;
  rating: number;
  rating_count: number;
  delivery_days: number;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "buyer" | "farmer" | "admin";
}

export interface AccountProfile extends AuthUser {
  phone: string;
}

export interface BuyerCommodity {
  product: string;
  unit: string;
  units_bought: number;
  amount_kes: number;
}

export interface BuyerAnalytics {
  paid_order_count: number;
  total_spend_kes: number;
  this_week_spend_kes: number;
  this_month_spend_kes: number;
  this_year_spend_kes: number;
  commodities: BuyerCommodity[];
  this_week_commodities: BuyerCommodity[];
  this_month_commodities: BuyerCommodity[];
  this_year_commodities: BuyerCommodity[];
}

export interface FarmerSalesAnalytics {
  sales_kes: number;
  units_sold: number;
  paid_orders: number;
  products: {
    product_id: number;
    product: string;
    variety: string;
    unit: string;
    units_sold: number;
    sales_kes: number;
    paid_orders: number;
  }[];
  repeat_buyers: {
    buyer_id: number;
    buyer_name: string;
    paid_orders: number;
    sales_kes: number;
    last_paid_order_at: string;
  }[];
  repeat_buyer_definition: string;
}

export interface AuthSession {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
}

export interface FarmReview {
  id: number;
  order_item_id: number;
  quality_rating: number;
  delivery_speed_rating: number;
  comment: string;
  created_at: string;
  buyer: string;
}

export interface FarmReviews {
  average_rating: number | null;
  review_count: number;
  reviews: FarmReview[];
}

export interface FarmMessage {
  id: number;
  buyer_id: number;
  farm_id: number;
  sender_role: "buyer" | "farmer";
  body: string;
  created_at: string;
}

export interface FarmConversation {
  id: number;
  product_id: number;
  product_name: string;
  unit: string;
  price_kes: number;
  farm_id: number;
  farm_name: string;
  county: string;
  buyer_id: number;
  buyer_name: string;
  farmer_id: number;
  farmer_name: string;
  status: "active" | "archived";
  blocked_by_me: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  sender_name: string;
  sender_role: "buyer" | "farmer" | "assistant";
  body: string;
  sent_via: "app" | "sms" | "bot";
  created_at: string;
}

export interface CropDemand {
  id: number;
  crop_name: string;
  county: string;
  min_quantity: number;
  unit: string;
  harvest_from: string | null;
  harvest_to: string | null;
  max_price_kes: number | null;
  active: boolean;
  created_at: string;
  buyer_name?: string;
}

export interface OfftakeRequest extends CropDemand {
  buyer_id?: number;
  variety: string;
  request_type: "bulk" | "preorder";
  recurrence: "one_off" | "weekly" | "monthly";
  needed_by: string | null;
  delivery_location: string;
  delivery_method: "pickup" | "delivery";
  quality_notes: string;
  buyer_name: string;
  business_name: string;
  buyer_phone: string;
  buyer_email: string;
  farm_id: number | null;
  target_farm_name: string | null;
  accepted_quantity: number;
  paid_quantity: number;
  fulfilled_quantity: number;
  open_quote_count: number;
  status: "submitted" | "quoted" | "accepted" | "paid" | "fulfilled" | "cancelled";
}

export interface OfftakeQuote {
  id: number;
  demand_id: number;
  farmer_id: number;
  farm_id: number;
  product_id: number;
  quantity: number;
  unit: string;
  unit_price_kes: number;
  quality_notes: string;
  delivery_location: string;
  quote_status: "quoted" | "countered" | "accepted" | "declined" | "cancelled" | "fulfilled" | "expired";
  order_id: number | null;
  supersedes_quote_id: number | null;
  expires_at: string;
  created_at: string;
  crop_name: string;
  variety: string;
  request_type: "bulk" | "preorder";
  recurrence: "one_off" | "weekly" | "monthly";
  requested_quantity: number;
  requested_unit: string;
  county: string;
  needed_by: string | null;
  delivery_method: "pickup" | "delivery";
  buyer_name: string;
  business_name: string;
  buyer_phone: string;
  buyer_email: string;
  account_buyer_name: string;
  farmer_name: string;
  farm_name: string;
  product_name: string;
  harvest_date: string | null;
  grade: string;
  order_status: string | null;
  payment_status: string | null;
  status: "quoted" | "countered" | "accepted" | "paid" | "declined" | "cancelled" | "fulfilled" | "expired";
}

export interface OfftakeMatch {
  demand_id: number;
  crop_name: string;
  min_quantity: number;
  demand_unit: string;
  county: string;
  harvest_from: string | null;
  harvest_to: string | null;
  max_price_kes: number | null;
  product_id: number;
  product_name: string;
  variety: string;
  grade: string;
  unit: string;
  stock: number;
  price_kes: number;
  harvest_date: string;
  farm_id: number;
  farm_name: string;
  farmer_id: number;
  farmer_name?: string;
  buyer_name?: string;
  image_url: string | null;
  price_range_min_kes: number | null;
  price_range_max_kes: number | null;
}

export interface OfftakeContract {
  id: number;
  demand_id: number;
  product_id: number;
  buyer_id: number;
  buyer_name: string;
  farmer_id: number;
  farmer_name: string;
  product_name: string;
  farm_name: string;
  county: string;
  quantity: number;
  unit: string;
  unit_price_kes: number;
  grade: string;
  harvest_date: string;
  delivery_location: string;
  status: "proposed" | "confirmed" | "declined" | "cancelled" | "fulfilled" | "expired";
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface ManagedFarm {
  id: number;
  name: string;
  county: string;
  status: "pending" | "verified" | "rejected";
  latitude: number | null;
  longitude: number | null;
  farming_methods: string;
  verification_level: "unverified" | "provisional" | "full";
  verification_submitted_at?: string | null;
}

export interface FarmBoundaryPoint {
  latitude: number;
  longitude: number;
}

export interface TraceRecord {
  trace_code: string;
  product: string;
  variety: string;
  unit: string;
  harvest_date: string | null;
  preorder_enabled: boolean;
  season_tier: "early" | "peak" | "late" | "in_season";
  image_url: string | null;
  farm_id: number;
  farm: string;
  county: string;
  size_acres: number | null;
  latitude: number | null;
  longitude: number | null;
  farming_methods: string;
}

export interface FarmProduct {
  id: number;
  farm_id: number;
  name: string;
  description: string;
  category: string;
  variety: string;
  grade: string;
  unit: string;
  price_kes: number;
  stock: number;
  harvest_date: string | null;
  image_url: string | null;
  preorder_enabled: boolean;
  season_tier: "early" | "peak" | "late" | "in_season";
  trace_code: string;
}

export interface FreshnessAnalysis {
  produce: string;
  age_in_days: number;
  risk_level: "Fresh" | "Moderate" | "Critical";
  suggested_discount_pct: number;
  ai_recommendation: string;
  storage_type: string;
  method: "rule_based_estimate";
  storage_note: string;
}

export interface UrgentProduct extends Product {
  freshness: FreshnessAnalysis;
}

export interface OrderItem {
  order_id: number;
  order_item_id: number;
  total_kes?: number;
  order_status: string;
  payment_status?: "initiated" | "success" | "failed" | null;
  mpesa_receipt?: string | null;
  created_at: string;
  product_id?: number;
  product: string;
  variety?: string;
  unit: string;
  qty: number;
  price_kes: number;
  fulfillment_status: string;
  farm_id?: number;
  farm: string;
  county: string;
  delivery_days?: number;
  harvest_date?: string | null;
  review_rating?: number | null;
  preorder_enabled?: boolean;
  season_tier?: "early" | "peak" | "late" | "in_season";
}

export interface ProductSubmission {
  name: string;
  description: string;
  category: string;
  variety: string;
  grade: string;
  unit: string;
  price_kes: number;
  stock: number;
  harvest_date: string | null;
  image_url: string | null;
  preorder_enabled: boolean;
  season_tier: "early" | "peak" | "late" | "in_season";
}

export interface MarketplaceOptions {
  categories: string[];
  counties: string[];
  marketplace_enabled: boolean;
  farm_applications_enabled: boolean;
}

export interface Farm {
  id: number;
  name: string;
  county: string;
  size_acres: number;
  farming_methods: string;
  rating: number;
  rating_count: number;
  verified_at: string | null;
  crops: string;
  verification_level: "unverified" | "provisional" | "full";
}

export interface TransporterProfile {
  id?: number;
  display_name: string;
  contact_phone: string;
  vehicle_type: string;
  capacity_kg: number;
  service_counties: string;
  details: string;
  available: boolean;
  contact_consent: boolean;
}

export interface TransporterListing {
  id: number;
  display_name: string;
  contact_phone: string;
  vehicle_type: string;
  capacity_kg: number;
  service_counties: string;
  details: string;
}

export interface TransporterMessage {
  id: number;
  requester_id: number;
  sender_id: number;
  body: string;
  created_at: string;
}

export interface TransporterConversation {
  requester_id: number;
  requester_name: string;
  last_message_at: string;
}

export interface AppNotification {
  id: number;
  category: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface FarmExpense {
  id: number;
  category: string;
  amount_kes: number;
  expense_date: string;
  notes: string;
}

export interface FarmIncome {
  sales_kes: number;
  units_sold: number;
  paid_orders: number;
  expenses_kes: number;
  estimated_profit_kes: number;
  expenses: FarmExpense[];
}

export interface FarmerGroup {
  id: number;
  name: string;
  county: string;
  topic: string;
  description: string;
  created_at: string;
  member_count: number;
  is_member: number;
}

export interface FarmerGroupPost {
  id: number;
  author_id: number;
  is_mine: number;
  post_type: "discussion" | "bulk_order";
  body: string;
  produce_name: string | null;
  quantity: number | null;
  created_at: string;
  author: string;
}

export interface WeatherForecast {
  farm: string;
  forecast_date: string;
  weather_code: number;
  rain_probability: number;
  warning: boolean;
  message: string;
}

export interface CartLine {
  product: Product;
  qty: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem("mkulima_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const method = init?.method?.toUpperCase() ?? "GET";
  const offlineCacheKey = getOfflineCacheKey(url, method);
  let response: Response;
  try {
    response = await fetch("/api" + url, { ...init, headers });
  } catch (cause) {
    if (offlineCacheKey && (cause instanceof TypeError || !navigator.onLine)) {
      const cached = readOfflineCache<T>(offlineCacheKey);
      if (cached !== undefined) return cached;
    }
    throw cause;
  }
  if (!response.ok) {
    const responseText = await response.text();
    if (offlineCacheKey && response.status === 503 && !navigator.onLine) {
      const cached = readOfflineCache<T>(offlineCacheKey);
      if (cached !== undefined) return cached;
    }
    throw new ApiError(responseText, response.status);
  }
  const data = (await response.json()) as T;
  if (offlineCacheKey) writeOfflineCache(offlineCacheKey, data);
  return data;
}

function getOfflineCacheKey(url: string, method: string): string | null {
  if (method !== "GET") return null;
  const isOfflineSupportedRead =
    url === "/auth/me" ||
    url === "/farms/manage" ||
    /^\/farms\/\d+\/products$/.test(url);
  if (!isOfflineSupportedRead) return null;
  const userId = localStorage.getItem("mkulima_offline_user_id");
  return userId ? `mkulima_api_cache_${userId}_${url}` : null;
}

function readOfflineCache<T>(key: string): T | undefined {
  try {
    const cached = localStorage.getItem(key);
    return cached === null ? undefined : (JSON.parse(cached) as T);
  } catch (cause) {
    console.warn("Could not read cached offline app data:", cause);
    return undefined;
  }
}

function writeOfflineCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (cause) {
    console.warn("Could not cache app data for offline use:", cause);
  }
}

export function clearOfflineApiCache(userId: number): void {
  const prefix = `mkulima_api_cache_${userId}_`;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const put = (body: unknown): RequestInit => ({
  ...post(body),
  method: "PUT",
});
const patch = (body: unknown): RequestInit => ({
  ...post(body),
  method: "PATCH",
});
const encode = encodeURIComponent;

export const getMarketplaceOptions = () =>
  requestJson<MarketplaceOptions>("/marketplace/options");
export const getProducts = (
  q = "",
  county = "",
  category = "",
  availability: "in_stock" | "all" = "in_stock",
) =>
  requestJson<Product[]>(
    `/products?q=${encode(q)}&county=${encode(county)}&category=${encode(category)}&availability=${availability}`,
  );
export const getUrgentProducts = () =>
  requestJson<UrgentProduct[]>("/products/urgency");
export const getTraceRecord = (traceCode: string) =>
  requestJson<TraceRecord>(`/trace/${encode(traceCode)}`);
export const registerAccount = (account: {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: "buyer" | "farmer";
}) => requestJson<AuthSession>("/auth/register", post(account));
export const bootstrapAdminAccount = (account: {
  name: string;
  email: string;
  phone: string;
  password: string;
  bootstrap_token: string;
}) => requestJson<AuthSession>("/auth/bootstrap-admin", post(account));
export const loginAccount = (email: string, password: string) =>
  requestJson<AuthSession>("/auth/login", post({ email, password }));
export const requestPasswordReset = (email: string) =>
  requestJson<{ ok: boolean; message: string }>(
    "/auth/password-reset/request",
    post({ email }),
  );
export const confirmPasswordReset = (
  email: string,
  code: string,
  new_password: string,
) =>
  requestJson<{ ok: boolean; message: string }>(
    "/auth/password-reset/confirm",
    post({ email, code, new_password }),
  );
export const getCurrentUser = () => requestJson<AuthUser>("/auth/me");
export const getAccountProfile = () =>
  requestJson<AccountProfile>("/auth/profile");
export const updateAccountProfile = (profile: Pick<AccountProfile, "name" | "email">) =>
  requestJson<AccountProfile>("/auth/profile", put(profile));
export const applyForFarm = (farm: {
  name: string;
  county: string;
  size_acres: number;
  farming_methods: string;
}) => requestJson<{ id: number; status: string }>("/farms/apply", post(farm));
export const getFarmerPhoneVerification = () =>
  requestJson<{ verified: boolean }>("/farmer/verification/phone");
export const sendFarmerPhoneOtp = () =>
  requestJson<{ ok: boolean; verified: boolean }>(
    "/farmer/verification/otp/send",
    post({}),
  );
export const confirmFarmerPhoneOtp = (code: string) =>
  requestJson<{ ok: boolean; verified: boolean }>(
    "/farmer/verification/otp/confirm",
    post({ code }),
  );
export const createFarmVerificationCode = (farmId: number) =>
  requestJson<{ code: string }>(
    `/farms/${farmId}/verification/code`,
    post({}),
  );
export const submitFarmVerification = (
  farmId: number,
  submission: {
    boundary: FarmBoundaryPoint[];
    verification_code: string;
    video: File;
    video_latitude: number;
    video_longitude: number;
    video_accuracy_m: number;
    recorded_at: string;
    duration_seconds: number;
  },
) => {
  const form = new FormData();
  form.set("boundary", JSON.stringify({ points: submission.boundary }));
  form.set("verification_code", submission.verification_code);
  form.set("video", submission.video);
  form.set("video_latitude", String(submission.video_latitude));
  form.set("video_longitude", String(submission.video_longitude));
  form.set("video_accuracy_m", String(submission.video_accuracy_m));
  form.set("recorded_at", submission.recorded_at);
  form.set("duration_seconds", String(submission.duration_seconds));
  return requestJson<{ ok: boolean; status: string; verification_level: string }>(
    `/farms/${farmId}/verification`,
    { method: "POST", body: form },
  );
};
export const compareProduct = (name: string) =>
  requestJson<Product[]>(`/products/compare?name=${encode(name)}`);
export const getFarms = (county = "") =>
  requestJson<Farm[]>(`/farms?county=${encode(county)}`);
export const getTransporters = (county = "") =>
  requestJson<TransporterListing[]>(`/transporters?county=${encode(county)}`);
export const getMyTransporterProfile = () =>
  requestJson<TransporterProfile | null>("/transporters/me");
export const saveMyTransporterProfile = (profile: TransporterProfile) =>
  requestJson<{ ok: boolean }>("/transporters/me", put(profile));
export const getTransporterMessages = (transporterId: number, requesterId?: number) =>
  requestJson<TransporterMessage[] | TransporterConversation[]>(
    `/transporters/${transporterId}/messages${
      requesterId ? `?requester_id=${requesterId}` : ""
    }`,
  );
export const sendTransporterMessage = (
  transporterId: number,
  body: string,
  requesterId?: number,
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/transporters/${transporterId}/messages`,
    post({ body, requester_id: requesterId }),
  );
export const getAppNotifications = () =>
  requestJson<AppNotification[]>("/notifications");
export const markAppNotificationRead = (id: number) =>
  requestJson<{ ok: boolean }>(`/notifications/${id}/read`, post({}));
export const savePriceAlert = (productId: number, targetPriceKes: number) =>
  requestJson<{ ok: boolean }>(
    "/price-alerts",
    post({ product_id: productId, target_price_kes: targetPriceKes }),
  );
export const getFarmIncome = (farmId: number) =>
  requestJson<FarmIncome>(`/farmer/income?farm_id=${farmId}`);
export const getFarmerSalesAnalytics = (farmId: number) =>
  requestJson<FarmerSalesAnalytics>(`/farmer/analytics?farm_id=${farmId}`);
export const addFarmExpense = (
  farmId: number,
  expense: Omit<FarmExpense, "id"> & { client_id?: string },
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/farmer/income/expenses?farm_id=${farmId}`,
    post(expense),
  );
export const checkFarmWeather = (farmId: number) =>
  requestJson<WeatherForecast>(
    `/farmer/weather/check?farm_id=${farmId}`,
    post({}),
  );
export const getFarmerGroups = () =>
  requestJson<FarmerGroup[]>("/farmer-groups");
export const createFarmerGroup = (group: {
  name: string;
  county: string;
  topic: string;
  description: string;
}) => requestJson<{ id: number; ok: boolean }>("/farmer-groups", post(group));
export const joinFarmerGroup = (groupId: number) =>
  requestJson<{ ok: boolean }>(`/farmer-groups/${groupId}/join`, post({}));
export const getFarmerGroupPosts = (groupId: number) =>
  requestJson<FarmerGroupPost[]>(`/farmer-groups/${groupId}/posts`);
export const createFarmerGroupPost = (
  groupId: number,
  postData: {
    post_type: "discussion" | "bulk_order";
    body: string;
    produce_name?: string;
    quantity?: number;
  },
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/farmer-groups/${groupId}/posts`,
    post(postData),
  );
export const getManageableFarms = () =>
  requestJson<ManagedFarm[]>("/farms/manage");
export const getFarmProducts = (farmId: number) =>
  requestJson<FarmProduct[]>(`/farms/${farmId}/products`);
export const analyzeFreshness = (productId: number, storageType: string) =>
  requestJson<FreshnessAnalysis>(
    "/ai/analyze-stock",
    post({ product_id: productId, storage_type: storageType }),
  );
export const saveFarmProduct = (
  farmId: number,
  product: ProductSubmission,
  productId?: number,
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/farms/${farmId}/products${productId ? `/${productId}` : ""}`,
    productId ? put(product) : post(product),
  );
export const uploadFarmProductImage = async (
  farmId: number,
  image: File,
): Promise<{ image_url: string }> => {
  const form = new FormData();
  form.set("image", image);
  return requestJson<{ image_url: string }>(
    `/farms/${farmId}/product-images`,
    { method: "POST", body: form },
  );
};
export const getBuyerOrders = () => requestJson<OrderItem[]>("/orders");
export const getBuyerAnalytics = () =>
  requestJson<BuyerAnalytics>("/buyer/analytics");
export const getBuyerFavorites = () =>
  requestJson<Product[]>("/buyer/favorites");
export const addBuyerFavorite = (productId: number) =>
  requestJson<{ ok: boolean }>("/buyer/favorites", post({ product_id: productId }));
export const removeBuyerFavorite = (productId: number) =>
  requestJson<{ ok: boolean }>(`/buyer/favorites/${productId}`, {
    method: "DELETE",
  });
export const getConversation = (farmId: number, buyerId?: number) =>
  requestJson<FarmMessage[]>(
    `/messages?farm_id=${farmId}${buyerId ? `&buyer_id=${buyerId}` : ""}`,
  );
export const sendConversationMessage = (
  farmId: number,
  body: string,
  buyerId?: number,
) =>
  requestJson<{ id: number; ok: boolean }>(
    "/messages",
    post({ farm_id: farmId, buyer_id: buyerId || undefined, body }),
  );
export const getConversations = () =>
  requestJson<FarmConversation[]>("/conversations");
export const createConversation = (productId: number) =>
  requestJson<FarmConversation>(
    "/conversations",
    post({ product_id: productId }),
  );
export const getConversationMessages = (conversationId: number) =>
  requestJson<ConversationMessage[]>(
    `/conversations/${conversationId}/messages`,
  );
export const sendListingMessage = (conversationId: number, body: string) =>
  requestJson<{ ok: boolean; sms_notification: "sent" | "failed" | "unavailable" | null }>(
    `/conversations/${conversationId}/messages`,
    post({ body }),
  );
export const archiveConversation = (conversationId: number) =>
  requestJson<{ ok: boolean }>(
    `/conversations/${conversationId}/archive`,
    post({}),
  );
export const blockConversation = (conversationId: number) =>
  requestJson<{ ok: boolean }>(
    `/conversations/${conversationId}/block`,
    post({}),
  );
export const unblockConversation = (conversationId: number) =>
  requestJson<{ ok: boolean }>(
    `/conversations/${conversationId}/block`,
    { method: "DELETE" },
  );
export const reportConversation = (conversationId: number, reason: string) =>
  requestJson<{ id: number; ok: boolean }>(
    `/conversations/${conversationId}/reports`,
    post({ reason }),
  );
export const getCropDemands = () =>
  requestJson<CropDemand[]>("/offtake/demands");
export const createCropDemand = (
  demand: Omit<CropDemand, "id" | "created_at" | "active">,
) =>
  requestJson<{ id: number; ok: boolean }>("/offtake/demands", post(demand));
export const deactivateCropDemand = (demandId: number) =>
  requestJson<{ ok: boolean }>(`/offtake/demands/${demandId}`, {
    method: "DELETE",
  });
export const getOfftakeRequests = () =>
  requestJson<OfftakeRequest[]>("/offtake/requests");
export const createOfftakeRequest = (
  request: Omit<
    OfftakeRequest,
    | "id"
    | "created_at"
    | "active"
    | "buyer_id"
    | "target_farm_name"
    | "accepted_quantity"
    | "paid_quantity"
    | "fulfilled_quantity"
    | "open_quote_count"
    | "status"
  >,
) => requestJson<{ id: number; ok: boolean }>("/offtake/requests", post(request));
export const getOfftakeQuotes = () =>
  requestJson<OfftakeQuote[]>("/offtake/quotes");
export const submitOfftakeQuote = (
  demandId: number,
  quote: {
    farm_id: number;
    product_id: number;
    quantity: number;
    unit_price_kes: number;
    quality_notes: string;
    delivery_location: string;
    supersedes_quote_id?: number;
  },
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/offtake/requests/${demandId}/quotes`,
    post(quote),
  );
export const respondToOfftakeQuote = (
  quoteId: number,
  action: "accept" | "decline" | "withdraw" | "fulfill" | "cancel",
) =>
  requestJson<{ ok: boolean; order_id: number | null; status: string }>(
    `/offtake/quotes/${quoteId}/${action}`,
    post({}),
  );
export const getOfftakeMatches = () =>
  requestJson<OfftakeMatch[]>("/offtake/matches");
export const getOfftakeContracts = () =>
  requestJson<OfftakeContract[]>("/offtake/contracts");
export const proposeOfftakeContract = (proposal: {
  demand_id: number;
  product_id: number;
  quantity: number;
  unit_price_kes: number;
  delivery_location: string;
}) =>
  requestJson<{ id: number; ok: boolean }>(
    "/offtake/contracts",
    post(proposal),
  );
export const respondToOfftakeContract = (
  contractId: number,
  action: "accept" | "decline" | "cancel" | "confirm_delivery",
) =>
  requestJson<{ ok: boolean; status: OfftakeContract["status"] }>(
    `/offtake/contracts/${contractId}/${action}`,
    post({}),
  );
export const getFarmReviews = (farmId: number) =>
  requestJson<FarmReviews>(`/farms/${farmId}/reviews`);
export const submitReview = (
  orderItemId: number,
  qualityRating: number,
  deliverySpeedRating: number,
  comment: string,
) =>
  requestJson<{ id: number; ok: boolean }>(
    `/order-items/${orderItemId}/review`,
    post({
      quality_rating: qualityRating,
      delivery_speed_rating: deliverySpeedRating,
      comment,
    }),
  );
export const getFarmerOrders = (farmId: number) =>
  requestJson<OrderItem[]>(`/farmer/orders?farm_id=${farmId}`);
export const updateOrderItemStatus = (
  farmId: number,
  orderItemId: number,
  status: string,
) =>
  requestJson<{ ok: boolean; status: string }>(
    `/farmer/orders/${orderItemId}?farm_id=${farmId}`,
    patch({ status }),
  );
export const getPending = () => requestJson<Farm[]>("/admin/farms/pending");
export const getAdminFarms = () =>
  requestJson<
    (Farm & {
      status: string;
      owner_id: number | null;
      phone_verified: boolean | null;
      admin_suspended: boolean;
      farm_boundary: string | null;
      verification_video_latitude: number | null;
      verification_video_longitude: number | null;
      verification_video_accuracy_m: number | null;
      verification_video_recorded_at: string | null;
      verification_submitted_at: string | null;
      successful_deliveries: number;
    })[]
  >(
    "/admin/farms",
  );
export const getAdminFarmers = () =>
  requestJson<{ id: number; name: string; email: string }[]>("/admin/farmers");
export const assignFarmOwner = (farmId: number, ownerId: number) =>
  requestJson<{ ok: boolean }>(
    `/admin/farms/${farmId}/owner`,
    patch({ owner_id: ownerId }),
  );
export const verifyFarm = (id: number, approve: boolean) =>
  requestJson<{ ok: boolean }>(
    `/farms/${id}/verify?approve=${approve}`,
    { method: "POST" },
  );
export const getAdminFarmVerificationVideo = async (farmId: number) => {
  const headers = new Headers();
  const token = localStorage.getItem("mkulima_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/admin/farms/${farmId}/verification-video`, {
    headers,
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return response.blob();
};
export interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: AuthUser["role"];
  account_status: "active" | "suspended" | "pending" | "disabled";
  created_at: string;
}
export interface AdminOverview {
  users: {
    total: number;
    suspended: number;
    buyers: number;
    farmers: number;
    admins: number;
  };
  transporters: { total: number };
  farms: { total: number; pending: number; verified: number; suspended: number };
  products: { total: number; active: number; suspended: number };
  orders: { total: number; paid: number; value_kes: number };
  payments: {
    total: number;
    successful: number;
    failed: number;
    successful_kes: number;
  };
}
export interface AdminOrder {
  id: number;
  total_kes: number;
  status: string;
  created_at: string;
  buyer: string | null;
  item_count: number;
  goods: { product: string; quantity: number; unit: string }[];
}
export interface AdminProduct {
  id: number;
  name: string;
  category: string;
  variety: string;
  price_kes: number;
  stock: number;
  unit: string | null;
  admin_suspended: boolean;
  farm_id: number | null;
  farm: string | null;
  county: string | null;
}
export interface AdminTransporter {
  id: number;
  user_id: number;
  display_name: string;
  contact_phone: string;
  vehicle_type: string;
  capacity_kg: number;
  service_counties: string;
  details: string;
  available: boolean;
  contact_consent: boolean;
  owner_name: string;
  owner_email: string | null;
}
export interface AdminPayment {
  id: number;
  order_id: number;
  amount: number;
  status: string;
  mpesa_receipt: string | null;
  created_at: string;
  buyer: string | null;
}
export interface AdminAuditLog {
  id: number;
  admin_id: number;
  admin_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string;
  created_at: string;
}
export interface AdminContentReport {
  id: number;
  reporter_id: number;
  reporter_name: string;
  target_type: "product" | "user" | "group";
  target_id: number;
  reason: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  admin_note: string;
  created_at: string;
  updated_at: string;
}
export interface AdminConversationReport {
  id: number;
  conversation_id: number;
  reporter_id: number;
  reporter_name: string;
  buyer_id: number;
  buyer_name: string;
  farmer_id: number;
  farmer_name: string;
  product_name: string;
  farm_name: string;
  reason: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  admin_note: string;
  created_at: string;
  updated_at: string;
}
export const getAdminOverview = () =>
  requestJson<AdminOverview>("/admin/overview");
export const getAdminSettings = () =>
  requestJson<MarketplaceOptions>("/admin/settings");
export const saveAdminSettings = (settings: MarketplaceOptions) =>
  requestJson<MarketplaceOptions>("/admin/settings", put(settings));
export const getAdminUsers = () => requestJson<AdminUser[]>("/admin/users");
export const updateAdminUserStatus = (
  userId: number,
  status: AdminUser["account_status"],
) =>
  requestJson<{ ok: boolean; status: AdminUser["account_status"] }>(
    `/admin/users/${userId}/status`,
    patch({ status }),
  );
export const updateAdminFarmStatus = (farmId: number, suspended: boolean) =>
  requestJson<{ ok: boolean; suspended: boolean }>(
    `/admin/farms/${farmId}/status`,
    patch({ suspended }),
  );
export const getAdminOrders = () => requestJson<AdminOrder[]>("/admin/orders");
export const getAdminProducts = () =>
  requestJson<AdminProduct[]>("/admin/products");
export const updateAdminProductStatus = (productId: number, suspended: boolean) =>
  requestJson<{ ok: boolean; suspended: boolean }>(
    `/admin/products/${productId}/status`,
    patch({ suspended }),
  );
export const getAdminTransporters = () =>
  requestJson<AdminTransporter[]>("/admin/transporters");
export const updateAdminTransporterStatus = (
  transporterId: number,
  available: boolean,
) =>
  requestJson<{ ok: boolean; available: boolean }>(
    `/admin/transporters/${transporterId}/status`,
    patch({ available }),
  );
export const getAdminPayments = () =>
  requestJson<AdminPayment[]>("/admin/payments");
export const getAdminAuditLogs = () =>
  requestJson<AdminAuditLog[]>("/admin/audit-logs");
export const getAdminReports = () =>
  requestJson<AdminContentReport[]>("/admin/reports");
export const reviewAdminReport = (
  reportId: number,
  status: "reviewed" | "actioned" | "dismissed",
  adminNote: string,
) =>
  requestJson<{ ok: boolean; status: AdminContentReport["status"] }>(
    `/admin/reports/${reportId}`,
    patch({ status, admin_note: adminNote }),
  );
export const getAdminConversationReports = () =>
  requestJson<AdminConversationReport[]>("/admin/conversation-reports");
export const getAdminConversationReportMessages = (reportId: number) =>
  requestJson<ConversationMessage[]>(
    `/admin/conversation-reports/${reportId}/messages`,
  );
export const reviewAdminConversationReport = (
  reportId: number,
  status: "reviewed" | "actioned" | "dismissed",
  adminNote: string,
) =>
  requestJson<{ ok: boolean; status: AdminConversationReport["status"] }>(
    `/admin/conversation-reports/${reportId}`,
    patch({ status, admin_note: adminNote }),
  );
export const createContentReport = (
  targetType: AdminContentReport["target_type"],
  targetId: number,
  reason: string,
) =>
  requestJson<{ ok: boolean }>(
    "/reports",
    post({ target_type: targetType, target_id: targetId, reason }),
  );
export const createOrder = (items: { product_id: number; qty: number }[]) =>
  requestJson<{ order_id: number; total_kes: number }>(
    "/orders",
    post({ items }),
  );
export interface MpesaPaymentStatus {
  status: "not_started" | "initiated" | "success" | "failed";
  amount: number | null;
  mpesa_receipt: string | null;
}
export const payMpesa = (order_id: number, phone: string) =>
  requestJson<{ CheckoutRequestID: string; Amount: number }>(
    "/payments/mpesa/stk",
    post({ order_id, phone }),
  );
export const getMpesaPaymentStatus = (orderId: number) =>
  requestJson<MpesaPaymentStatus>(`/payments/mpesa/orders/${orderId}`);
