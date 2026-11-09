import { useEffect, useState } from "react";
import {
  assignFarmOwner,
  getAdminAuditLogs,
  getAdminConversationReports,
  getAdminFarmers,
  getAdminFarms,
  getAdminOrders,
  getAdminOverview,
  getAdminPayments,
  getAdminProducts,
  getAdminReports,
  getAdminSettings,
  getAdminTransporters,
  getAdminUsers,
  getAdminFarmVerificationVideo,
  getAdminConversationReportMessages,
  reviewAdminConversationReport,
  reviewAdminReport,
  saveAdminSettings,
  updateAdminFarmStatus,
  updateAdminProductStatus,
  updateAdminTransporterStatus,
  updateAdminUserStatus,
  verifyFarm,
} from "../api";
import type {
  AdminAuditLog,
  AdminConversationReport,
  AdminContentReport,
  AdminOrder,
  AdminOverview,
  AdminPayment,
  AdminProduct,
  AdminTransporter,
  AdminUser,
  MarketplaceOptions,
} from "../api";
import { useTranslation } from "../i18n";

interface AdminFarm {
  id: number;
  name: string;
  county: string;
  size_acres: number;
  status: string;
  owner_id: number | null;
  phone_verified: boolean | null;
  admin_suspended: boolean;
  verification_level: "unverified" | "provisional" | "full";
  farm_boundary: string | null;
  verification_video_latitude: number | null;
  verification_video_longitude: number | null;
  verification_video_accuracy_m: number | null;
  verification_video_recorded_at: string | null;
  verification_submitted_at: string | null;
  successful_deliveries: number;
}

interface FarmerAccount {
  id: number;
  name: string;
  email: string;
}

type AdminSection =
  | "overview"
  | "farms"
  | "verification"
  | "users"
  | "products"
  | "transporters"
  | "reports"
  | "message-reports"
  | "orders"
  | "payments"
  | "audit"
  | "settings";

const money = (amount: number) =>
  `KES ${Number(amount ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const timestamp = (value: string) => new Date(value).toLocaleString();
const formatFarmBoundary = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch (cause) {
    return `Could not parse GPS boundary (${cause instanceof Error ? cause.message : String(cause)}).\n${value}`;
  }
};

export default function Admin() {
  const { t } = useTranslation();
  const [section, setSection] = useState<AdminSection>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [farms, setFarms] = useState<AdminFarm[]>([]);
  const [farmers, setFarmers] = useState<FarmerAccount[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [transporters, setTransporters] = useState<AdminTransporter[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [reports, setReports] = useState<AdminContentReport[]>([]);
  const [conversationReports, setConversationReports] = useState<AdminConversationReport[]>([]);
  const [reportMessages, setReportMessages] = useState<Record<number, Awaited<ReturnType<typeof getAdminConversationReportMessages>>>>({});
  const [loadingReportId, setLoadingReportId] = useState<number>();
  const [settings, setSettings] = useState<MarketplaceOptions | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [selectedOwners, setSelectedOwners] = useState<Record<number, number>>({});
  const [verificationVideoFarmId, setVerificationVideoFarmId] = useState<number>();
  const [verificationVideoUrl, setVerificationVideoUrl] = useState("");
  const [loadingVideoFarmId, setLoadingVideoFarmId] = useState<number>();
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | "buyer" | "farmer">("all");
  const [verificationFilter, setVerificationFilter] = useState<
    "all" | "attention" | "pending" | "provisional" | "full" | "rejected"
  >("attention");
  const [verificationSearch, setVerificationSearch] = useState("");
  const [error, setError] = useState("");
  const currentUserId = Number(localStorage.getItem("mkulima_offline_user_id"));

  const load = async () => {
    try {
      const [
        overviewData,
        farmList,
        farmerList,
        userList,
        orderList,
        productList,
        transporterList,
        paymentList,
        reportList,
        conversationReportList,
        auditList,
        settingsData,
      ] = await Promise.all([
        getAdminOverview(),
        getAdminFarms(),
        getAdminFarmers(),
        getAdminUsers(),
        getAdminOrders(),
        getAdminProducts(),
        getAdminTransporters(),
        getAdminPayments(),
        getAdminReports(),
        getAdminConversationReports(),
        getAdminAuditLogs(),
        getAdminSettings(),
      ]);
      setOverview(overviewData);
      setFarms(farmList);
      setFarmers(farmerList);
      setUsers(userList);
      setOrders(orderList);
      setProducts(productList);
      setTransporters(transporterList);
      setPayments(paymentList);
      setReports(reportList);
      setConversationReports(conversationReportList);
      setSettings(settingsData);
      setAuditLogs(auditList);
      setSelectedOwners((current) => {
        const next = { ...current };
        for (const farm of farmList) {
          if (farm.owner_id && next[farm.id] === undefined) {
            next[farm.id] = farm.owner_id;
          }
        }
        return next;
      });
      setError("");
    } catch (cause) {
      setError(
        "Could not load admin data: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return () => {
      if (verificationVideoUrl) URL.revokeObjectURL(verificationVideoUrl);
    };
  }, [verificationVideoUrl]);

  const assign = async (farm: AdminFarm) => {
    const ownerId = selectedOwners[farm.id];
    if (!ownerId) return;
    try {
      await assignFarmOwner(farm.id, ownerId);
      await load();
    } catch (cause) {
      setError(
        "Could not assign farm: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const decide = async (id: number, approve: boolean) => {
    try {
      await verifyFarm(id, approve);
      await load();
    } catch (cause) {
      setError(
        "Could not update verification: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const viewVerificationVideo = async (farmId: number) => {
    setError("");
    setLoadingVideoFarmId(farmId);
    try {
      const video = await getAdminFarmVerificationVideo(farmId);
      setVerificationVideoUrl(URL.createObjectURL(video));
      setVerificationVideoFarmId(farmId);
    } catch (cause) {
      setError(
        "Could not load farm verification video: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setLoadingVideoFarmId(undefined);
    }
  };

  const toggleFarmSuspension = async (farm: AdminFarm) => {
    const suspend = !farm.admin_suspended;
    const prompt = suspend
      ? `Suspend ${farm.name}? Its listings will be hidden from the marketplace.`
      : `Reactivate ${farm.name} and show its listings again?`;
    if (!window.confirm(prompt)) return;
    try {
      await updateAdminFarmStatus(farm.id, suspend);
      await load();
    } catch (cause) {
      setError(
        "Could not update farm listing: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const setUserStatus = async (
    user: AdminUser,
    status: AdminUser["account_status"],
  ) => {
    const prompt = status === "active"
      ? `Reactivate ${user.name}'s account?`
      : status === "disabled"
        ? `Remove ${user.name}'s account access? This disables sign-in but preserves order and payment history.`
        : `Set ${user.name}'s account to ${status}? Existing sessions will stop working.`;
    if (!window.confirm(prompt)) {
      await load();
      return;
    }
    try {
      await updateAdminUserStatus(user.id, status);
      await load();
    } catch (cause) {
      setError(
        "Could not update user account: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const reviewReport = async (
    report: AdminContentReport,
    status: "reviewed" | "actioned" | "dismissed",
  ) => {
    const adminNote = window.prompt(
      status === "actioned"
        ? "Add a note explaining the moderation action:"
        : "Add an optional review note:",
      report.admin_note,
    );
    if (adminNote === null) return;
    if (
      status === "actioned" &&
      !window.confirm(
        `Suspend the reported ${report.target_type} #${report.target_id} and record this action?`,
      )
    ) {
      return;
    }
    try {
      await reviewAdminReport(report.id, status, adminNote);
      await load();
    } catch (cause) {
      setError(
        "Could not review report: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const reviewConversationReport = async (
    report: AdminConversationReport,
    status: "reviewed" | "actioned" | "dismissed",
  ) => {
    const adminNote = window.prompt(
      status === "actioned"
        ? "Add a note explaining the moderation action. This will archive the conversation:"
        : "Add an optional review note:",
      report.admin_note,
    );
    if (adminNote === null) return;
    if (
      status === "actioned" &&
      !window.confirm("Archive this reported conversation and record the action?")
    ) {
      return;
    }
    try {
      await reviewAdminConversationReport(report.id, status, adminNote);
      await load();
    } catch (cause) {
      setError(
        "Could not review message report: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const toggleReportMessages = async (reportId: number) => {
    if (reportMessages[reportId]) {
      setReportMessages((current) => {
        const next = { ...current };
        delete next[reportId];
        return next;
      });
      return;
    }
    setLoadingReportId(reportId);
    try {
      const messages = await getAdminConversationReportMessages(reportId);
      setReportMessages((current) => ({ ...current, [reportId]: messages }));
    } catch (cause) {
      setError(
        "Could not load reported conversation: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setLoadingReportId(undefined);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      setSettings(await saveAdminSettings(settings));
      await load();
    } catch (cause) {
      setError(
        "Could not save marketplace settings: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const toggleProductSuspension = async (product: AdminProduct) => {
    const suspended = !product.admin_suspended;
    if (
      !window.confirm(
        suspended
          ? `Hide ${product.name} from the marketplace?`
          : `Restore ${product.name} to the marketplace?`,
      )
    ) {
      return;
    }
    try {
      await updateAdminProductStatus(product.id, suspended);
      await load();
    } catch (cause) {
      setError(
        "Could not update commodity listing: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const toggleTransporterAvailability = async (transporter: AdminTransporter) => {
    const available = !transporter.available;
    if (
      !window.confirm(
        available
          ? `Publish ${transporter.display_name} in the transport directory?`
          : `Remove ${transporter.display_name} from the transport directory?`,
      )
    ) {
      return;
    }
    try {
      await updateAdminTransporterStatus(transporter.id, available);
      await load();
    } catch (cause) {
      setError(
        "Could not update transport listing: " +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  };

  const verificationFarms = farms.filter((farm) => {
    const matchesFilter =
      verificationFilter === "all" ||
      (verificationFilter === "attention" &&
        (farm.status === "pending" ||
          farm.status === "rejected" ||
          (farm.status === "verified" &&
            farm.verification_level === "provisional"))) ||
      (verificationFilter === "pending" && farm.status === "pending") ||
      (verificationFilter === "provisional" &&
        farm.status === "verified" &&
        farm.verification_level === "provisional") ||
      (verificationFilter === "full" &&
        farm.status === "verified" &&
        farm.verification_level === "full") ||
      (verificationFilter === "rejected" && farm.status === "rejected");
    const farmer = farmers.find((item) => item.id === farm.owner_id);
    const searchText =
      `${farm.name} ${farm.county} ${farmer?.name ?? ""} ${farmer?.email ?? ""}`
        .toLocaleLowerCase();
    return (
      matchesFilter &&
      searchText.includes(verificationSearch.trim().toLocaleLowerCase())
    );
  });

  const sections: { id: AdminSection; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "farms", label: "Farm listings" },
    { id: "verification", label: "Farmer verification management" },
    { id: "users", label: "User accounts" },
    { id: "products", label: "Marketplace commodities" },
    { id: "transporters", label: "Transport providers" },
    { id: "reports", label: "Reports" },
    { id: "message-reports", label: "Message reports" },
    { id: "settings", label: "Marketplace settings" },
    { id: "orders", label: "Orders" },
    { id: "payments", label: "Payments · read only" },
    { id: "audit", label: "Audit log" },
  ];

  return (
    <section className="admin-page">
      <header className="admin-heading">
        <div>
          <span className="landing-eyebrow">MARKETPLACE OPERATIONS</span>
          <h2>{t("Admin oversight")}</h2>
          <p className="mut">
            Manage listings and accounts, monitor activity, and review an audit
            trail of administrative changes.
          </p>
        </div>
      </header>
      <div className="admin-menu">
        <button
          className="menu-toggle admin-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close admin menu" : "Open admin menu"}
          aria-expanded={menuOpen}
          aria-controls="admin-sections"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
          <strong>{sections.find((item) => item.id === section)?.label}</strong>
        </button>
        {menuOpen && (
          <nav className="admin-nav" id="admin-sections" aria-label="Admin sections">
            {sections.map((item) => (
              <button
                key={item.id}
                className={section === item.id ? "on" : ""}
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => {
                  setSection(item.id);
                  setMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}

      {section === "overview" && overview && (
        <div className="admin-stat-grid">
          <article className="card admin-stat">
            <span>Accounts</span>
            <strong>{overview.users.total}</strong>
            <small>
              {overview.users.farmers} farmers · {overview.users.buyers} buyers ·{" "}
              {overview.users.admins} admins
            </small>
          </article>
          <article className="card admin-stat">
            <span>Transport providers</span>
            <strong>{overview.transporters.total}</strong>
            <small>Registered directory listings</small>
          </article>
          <article className="card admin-stat">
            <span>Farms</span>
            <strong>{overview.farms.total}</strong>
            <small>
              {overview.farms.pending} pending · {overview.farms.verified} verified
            </small>
          </article>
          <article className="card admin-stat">
            <span>Products</span>
            <strong>{overview.products.total}</strong>
            <small>
              {overview.products.active} active · {overview.products.suspended} suspended
            </small>
          </article>
          <article className="card admin-stat">
            <span>Orders</span>
            <strong>{overview.orders.total}</strong>
            <small>{overview.orders.paid} paid · {money(overview.orders.value_kes)} order value</small>
          </article>
          <article className="card admin-stat">
            <span>Payments</span>
            <strong>{overview.payments.successful} successful</strong>
            <small>
              {overview.payments.failed} failed · {money(overview.payments.successful_kes)}
            </small>
          </article>
        </div>
      )}

      {section === "farms" && (
        <>
          <p className="mut">
            Assign farm owners and manage marketplace listing availability.
            Verification reviews are managed separately.
          </p>
          {farms.length === 0 && <p className="mut">No farms are registered.</p>}
          <div className="grid">
            {farms.map((farm) => (
              <article className="card admin-card" key={farm.id}>
                <h3>{farm.name}</h3>
                <p className="mut">
                  {farm.county} · {farm.size_acres ?? "—"} acres · {farm.status}
                  {farm.status === "verified"
                    ? farm.verification_level === "provisional"
                      ? " · Provisionally Verified"
                      : " · Fully Verified"
                    : ""}
                  {farm.admin_suspended ? " · suspended" : ""}
                </p>
                <label className="form-field">
                  Assigned farmer
                  <select
                    value={selectedOwners[farm.id] ?? ""}
                    onChange={(event) =>
                      setSelectedOwners({
                        ...selectedOwners,
                        [farm.id]: Number(event.target.value),
                      })
                    }
                  >
                    <option value="">Select a farmer</option>
                    {farmers.map((farmer) => (
                      <option value={farmer.id} key={farmer.id}>
                        {farmer.name} · {farmer.email}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="admin-actions">
                  <button
                    className="btn"
                    disabled={!selectedOwners[farm.id]}
                    onClick={() => void assign(farm)}
                  >
                    Assign farmer
                  </button>
                  {farm.status === "verified" && (
                    <button
                      className="btn"
                      onClick={() => void toggleFarmSuspension(farm)}
                    >
                      {farm.admin_suspended ? "Reactivate listing" : "Suspend listing"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {section === "verification" && (
        <>
          <div>
            <h3>Farmer verification management</h3>
            <p className="mut">
              Monitor farm verification progress and review submitted GPS and video
              evidence. Phone OTP codes are entered by farmers in Farmer tools and
              are never collected in this admin section.
            </p>
          </div>
          <div className="admin-stat-grid">
            <article className="card admin-stat">
              <span>Awaiting submission</span>
              <strong>{farms.filter((farm) => farm.status === "pending").length}</strong>
              <small>Farm verification has not yet been submitted</small>
          </article>
          <article className="card admin-stat">
              <span>Phone verification needed</span>
              <strong>
                {
                  farms.filter(
                    (farm) => farm.owner_id !== null && !farm.phone_verified,
                  ).length
                }
              </strong>
              <small>Assigned farmers who have not verified their phone</small>
            </article>
            <article className="card admin-stat">
              <span>Evidence to review</span>
              <strong>
                {farms.filter(
                  (farm) =>
                    farm.status === "verified" &&
                    farm.verification_level === "provisional",
                ).length}
              </strong>
              <small>Provisional farms awaiting an admin decision</small>
            </article>
            <article className="card admin-stat">
              <span>Fully verified</span>
              <strong>
                {farms.filter(
                  (farm) =>
                    farm.status === "verified" &&
                    farm.verification_level === "full",
                ).length}
              </strong>
              <small>Verification complete</small>
            </article>
            <article className="card admin-stat">
              <span>Rejected</span>
              <strong>{farms.filter((farm) => farm.status === "rejected").length}</strong>
              <small>Applications that may need follow-up</small>
            </article>
          </div>
          <div className="admin-verification-filters">
            <label className="form-field">
              Search farms or farmers
              <input
                type="search"
                value={verificationSearch}
                onChange={(event) => setVerificationSearch(event.target.value)}
                placeholder="Farm name, county, or farmer"
              />
            </label>
            <label className="form-field">
              Verification status
              <select
                value={verificationFilter}
                onChange={(event) =>
                  setVerificationFilter(
                    event.target.value as typeof verificationFilter,
                  )
                }
              >
                <option value="attention">Needs attention</option>
                <option value="all">All farms</option>
                <option value="pending">Awaiting submission</option>
                <option value="provisional">Evidence to review</option>
                <option value="full">Fully verified</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
          {verificationFarms.length === 0 && (
            <p className="mut">No farms match this verification filter.</p>
          )}
          <div className="grid">
            {verificationFarms.map((farm) => {
              const farmer = farmers.find((item) => item.id === farm.owner_id);
              const needsReview =
                farm.status === "verified" &&
                farm.verification_level === "provisional";
              const fullyVerified =
                farm.status === "verified" && farm.verification_level === "full";
              return (
                <article className="card admin-card" key={farm.id}>
                  <h3>{farm.name}</h3>
                  <p className="mut">
                    {farm.county} · {farmer?.name ?? "Farmer not assigned"}
                    {farmer?.email ? ` · ${farmer.email}` : ""}
                  </p>
                  <p>
                    <strong>Verification status:</strong>{" "}
                    {farm.status === "pending"
                      ? "Awaiting farmer submission"
                      : farm.status === "rejected"
                        ? "Rejected · follow-up may be needed"
                        : needsReview
                          ? "Provisional · evidence review needed"
                          : fullyVerified
                            ? "Fully verified"
                            : farm.verification_level}
                  </p>
                  <p className="mut">
                    <strong>Phone verification:</strong>{" "}
                    {farm.owner_id === null
                      ? "No farmer assigned"
                      : farm.phone_verified
                        ? "Verified"
                        : "Not verified"}
                  </p>
                  {farm.status === "pending" && (
                    <p className="mut">
                      No verification evidence submission is recorded yet.
                      The farmer can complete the GPS boundary and video steps in
                      Farmer tools.
                    </p>
                  )}
                  {needsReview && (
                    <p className="mut">
                      Successfully delivered orders: {farm.successful_deliveries}
                    </p>
                  )}
                  {farm.verification_submitted_at && (
                    <p className="mut">
                      Evidence submitted {timestamp(farm.verification_submitted_at)}
                      {farm.verification_video_recorded_at
                        ? ` · video GPS ±${farm.verification_video_accuracy_m?.toFixed(0)}m ${farm.verification_video_latitude?.toFixed(5)}, ${farm.verification_video_longitude?.toFixed(5)} at ${timestamp(farm.verification_video_recorded_at)}`
                        : " · video GPS metadata unavailable"}
                    </p>
                  )}
                  {farm.farm_boundary && (
                    <details className="farm-boundary-review">
                      <summary>View captured farm GPS boundary</summary>
                      <pre>{formatFarmBoundary(farm.farm_boundary)}</pre>
                    </details>
                  )}
                  {needsReview && (
                    <div className="farm-evidence-review">
                      <button
                        className="btn"
                        type="button"
                        disabled={loadingVideoFarmId === farm.id}
                        onClick={() => void viewVerificationVideo(farm.id)}
                      >
                        {loadingVideoFarmId === farm.id
                          ? "Loading video…"
                          : "Review farm video"}
                      </button>
                      {verificationVideoFarmId === farm.id && verificationVideoUrl && (
                        <video
                          className="farm-verification-video"
                          src={verificationVideoUrl}
                          controls
                          preload="metadata"
                        />
                      )}
                    </div>
                  )}
                  <div className="admin-actions">
                    {farm.status === "pending" && (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void decide(farm.id, false)}
                      >
                        Reject application
                      </button>
                    )}
                    {needsReview && (
                      <>
                        <button
                          className="btn g"
                          type="button"
                          onClick={() => void decide(farm.id, true)}
                        >
                          Upgrade to Fully Verified
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void decide(farm.id, false)}
                        >
                          Reject farm
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {section === "users" && (
        <div className="card admin-table-wrap">
          <h3>User accounts</h3>
          <label className="form-field admin-role-filter">
            Show accounts
            <select
              value={userRoleFilter}
              onChange={(event) => {
                const role = event.target.value;
                if (role === "all" || role === "buyer" || role === "farmer") {
                  setUserRoleFilter(role);
                }
              }}
            >
              <option value="all">All roles</option>
              <option value="farmer">Farmers</option>
              <option value="buyer">Buyers</option>
            </select>
          </label>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email / phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .filter((user) => userRoleFilter === "all" || user.role === userRoleFilter)
                  .map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}<br /><span className="mut">{user.phone}</span></td>
                    <td>{user.role}</td>
                    <td>{user.account_status}</td>
                    <td>{timestamp(user.created_at)}</td>
                    <td>
                      <select
                        value={user.account_status}
                        disabled={user.id === currentUserId}
                        title={user.id === currentUserId ? "You cannot change your own account status" : undefined}
                        onChange={(event) => {
                          const status = event.target.value;
                          if (
                            status === "active" ||
                            status === "suspended" ||
                            status === "pending" ||
                            status === "disabled"
                          ) {
                            void setUserStatus(user, status);
                          }
                        }}
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="pending">Pending</option>
                        <option value="disabled">Disabled</option>
                      </select>
                      {user.role !== "admin" &&
                        user.account_status !== "disabled" && (
                          <button
                            className="btn"
                            type="button"
                            disabled={user.id === currentUserId}
                            onClick={() => void setUserStatus(user, "disabled")}
                          >
                            Remove access
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mut admin-privacy-note">
            Removing an account disables sign-in without deleting order or
            payment history. Suspending a farmer also suspends their farm listings.
          </p>
        </div>
      )}

      {section === "products" && (
        <div className="card admin-table-wrap">
          <h3>Marketplace commodities</h3>
          <p className="mut">
            Review produce listings and hide or restore commodities without
            deleting their order history.
          </p>
          {products.length === 0 ? (
            <p className="mut">No commodities are listed.</p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Commodity</th><th>Category / variety</th><th>Farm</th>
                    <th>Stock</th><th>Price</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.category} · {product.variety}</td>
                      <td>{product.farm ?? "Unknown farm"}{product.county ? ` · ${product.county}` : ""}</td>
                      <td>{product.stock} {product.unit ?? ""}</td>
                      <td>{money(product.price_kes)}</td>
                      <td>{product.admin_suspended ? "Hidden" : "Listed"}</td>
                      <td>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void toggleProductSuspension(product)}
                        >
                          {product.admin_suspended ? "Restore listing" : "Hide listing"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === "transporters" && (
        <div className="card admin-table-wrap">
          <h3>Transport providers</h3>
          <p className="mut">
            Manage the farmer/buyer transport directory. Publishing requires
            the provider’s public-contact consent.
          </p>
          {transporters.length === 0 ? (
            <p className="mut">No transport provider profiles are registered.</p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Provider</th><th>Account owner</th><th>Vehicle / capacity</th>
                    <th>Service counties</th><th>Contact consent</th><th>Status</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transporters.map((transporter) => (
                    <tr key={transporter.id}>
                      <td>{transporter.display_name}<br /><span className="mut">{transporter.contact_phone}</span></td>
                      <td>{transporter.owner_name}<br /><span className="mut">{transporter.owner_email ?? ""}</span></td>
                      <td>{transporter.vehicle_type} · {transporter.capacity_kg} kg</td>
                      <td>{transporter.service_counties}</td>
                      <td>{transporter.contact_consent ? "Granted" : "Not granted"}</td>
                      <td>{transporter.available ? "Published" : "Hidden"}</td>
                      <td>
                        <button
                          className="btn"
                          type="button"
                          disabled={!transporter.available && !transporter.contact_consent}
                          onClick={() => void toggleTransporterAvailability(transporter)}
                        >
                          {transporter.available ? "Hide listing" : "Publish listing"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === "orders" && (
        <div className="card admin-table-wrap">
          <h3>Recent orders</h3>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr><th>Order</th><th>Buyer</th><th>Goods purchased</th><th>Total</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>#{order.id}</td><td>{order.buyer ?? "Unknown"}</td>
                    <td>
                      {order.goods.length
                        ? order.goods.map((good) =>
                            `${good.product} × ${good.quantity}${good.unit ? ` ${good.unit}` : ""}`,
                          ).join(", ")
                        : "No item details"}
                    </td><td>{money(order.total_kes)}</td>
                    <td>{order.status}</td><td>{timestamp(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "reports" && (
        <div className="admin-report-list">
          <h3>Reported products, accounts, and groups</h3>
          {reports.length === 0 && <p className="mut">No reports have been submitted.</p>}
          {reports.map((report) => (
            <article className="card admin-report" key={report.id}>
              <div className="admin-report-heading">
                <strong>
                  Report #{report.id} · {report.target_type} #{report.target_id}
                </strong>
                <span className={`badge ${report.status === "open" ? "moderate" : ""}`}>
                  {report.status}
                </span>
              </div>
              <p>{report.reason}</p>
              <p className="mut">
                Reported by {report.reporter_name} · {timestamp(report.created_at)}
              </p>
              {report.admin_note && (
                <p className="mut">Review note: {report.admin_note}</p>
              )}
              {report.status === "open" || report.status === "reviewed" ? (
                <div className="admin-actions">
                  <button className="btn g" onClick={() => void reviewReport(report, "actioned")}>
                    Suspend target
                  </button>
                  <button className="btn" onClick={() => void reviewReport(report, "reviewed")}>
                    Mark reviewed
                  </button>
                  <button className="btn" onClick={() => void reviewReport(report, "dismissed")}>
                    Dismiss
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          <p className="mut admin-privacy-note">
            Suspending an item hides it from users. Suspended accounts cannot use
            the platform; farmer accounts also have their listings suspended.
          </p>
        </div>
      )}

      {section === "message-reports" && (
        <div className="admin-report-list">
          <h3>Reported conversations</h3>
          {conversationReports.length === 0 && (
            <p className="mut">No conversations have been reported.</p>
          )}
          {conversationReports.map((report) => (
            <article className="card admin-report" key={report.id}>
              <div className="admin-report-heading">
                <strong>
                  Report #{report.id} · {report.product_name} · {report.farm_name}
                </strong>
                <span className={`badge ${report.status === "open" ? "moderate" : ""}`}>
                  {report.status}
                </span>
              </div>
              <p>{report.reason}</p>
              <p className="mut">
                Reported by {report.reporter_name} · Buyer {report.buyer_name} · Farmer {report.farmer_name}
                {" · "}{timestamp(report.created_at)}
              </p>
              {report.admin_note && (
                <p className="mut">Review note: {report.admin_note}</p>
              )}
              <button
                className="btn"
                type="button"
                disabled={loadingReportId === report.id}
                onClick={() => void toggleReportMessages(report.id)}
              >
                {loadingReportId === report.id
                  ? "Loading conversation…"
                  : reportMessages[report.id]
                    ? "Hide conversation"
                    : "Review conversation"}
              </button>
              {reportMessages[report.id] && (
                <div className="chat-log admin-reported-messages">
                  {reportMessages[report.id].map((message) => (
                    <div className="chat-message" key={message.id}>
                      <b>{message.sender_name} · {message.sent_via.toUpperCase()}</b>
                      <p>{message.body}</p>
                      <time className="mut">{timestamp(message.created_at)}</time>
                    </div>
                  ))}
                </div>
              )}
              {report.status === "open" || report.status === "reviewed" ? (
                <div className="admin-actions">
                  <button className="btn g" onClick={() => void reviewConversationReport(report, "actioned")}>
                    Archive conversation
                  </button>
                  <button className="btn" onClick={() => void reviewConversationReport(report, "reviewed")}>
                    Mark reviewed
                  </button>
                  <button className="btn" onClick={() => void reviewConversationReport(report, "dismissed")}>
                    Dismiss
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          <p className="mut admin-privacy-note">
            Reported chat content is visible only to authorized administrators.
            Taking action archives the conversation and prevents further replies.
          </p>
        </div>
      )}

      {section === "settings" && settings && (
        <div className="card admin-settings">
          <h3>Marketplace configuration</h3>
          <p className="mut">
            These values are used by produce listings, marketplace filters,
            farm applications, and order placement.
          </p>
          <div className="form-grid">
            <label className="form-field">
              Product categories (one per line)
              <textarea
                rows={7}
                value={settings.categories.join("\n")}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    categories: event.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="form-field">
              Supported counties (one per line)
              <textarea
                rows={7}
                value={settings.counties.join("\n")}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    counties: event.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
          <label className="admin-setting-toggle">
            <input
              type="checkbox"
              checked={settings.marketplace_enabled}
              onChange={(event) =>
                setSettings({ ...settings, marketplace_enabled: event.target.checked })
              }
            />
            <span>
              <strong>Marketplace sales enabled</strong>
              <small>When paused, buyers cannot browse listings or submit orders.</small>
            </span>
          </label>
          <label className="admin-setting-toggle">
            <input
              type="checkbox"
              checked={settings.farm_applications_enabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  farm_applications_enabled: event.target.checked,
                })
              }
            />
            <span>
              <strong>New farm applications enabled</strong>
              <small>Existing farm management and reviews are not changed.</small>
            </span>
          </label>
          <button className="btn g" onClick={() => void saveSettings()}>
            Save marketplace settings
          </button>
        </div>
      )}

      {section === "payments" && (
        <div className="card admin-table-wrap">
          <h3>Payment records · read only</h3>
          <p className="mut">
            Payment records cannot be edited from the admin dashboard. Any
            correction must follow a separately authorized, auditable process.
          </p>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr><th>Payment</th><th>Order</th><th>Buyer</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Created</th></tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>#{payment.id}</td><td>#{payment.order_id}</td>
                    <td>{payment.buyer ?? "Unknown"}</td><td>{money(payment.amount)}</td>
                    <td>{payment.status}</td><td>{payment.mpesa_receipt ?? "—"}</td>
                    <td>{timestamp(payment.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "audit" && (
        <div className="card admin-table-wrap">
          <h3>Administrative audit log</h3>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>Details</th></tr>
              </thead>
              <tbody>
                {auditLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{timestamp(entry.created_at)}</td>
                    <td>{entry.admin_name}</td>
                    <td>{entry.action}</td>
                    <td>{entry.entity_type} {entry.entity_id ?? ""}</td>
                    <td><code>{entry.details}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {auditLogs.length === 0 && <p className="mut">No administrative actions recorded yet.</p>}
          <p className="mut admin-privacy-note">
            User impersonation is not available. Audit entries are created for
            account status changes, farm assignment, verification, and
            suspension actions.
          </p>
        </div>
      )}
    </section>
  );
}
