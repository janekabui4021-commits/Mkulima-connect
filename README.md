# Mkulima Connect

A farm produce marketplace built with React, TypeScript, Vite, FastAPI, SQLite for local development, and M-Pesa Daraja STK Push.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer
- PostgreSQL is optional; the local app uses SQLite and needs no database server or password.

## Setup

On Windows, double-click `Start Mkulima Connect.cmd` in the project folder to start both local servers and open the site at `http://localhost:5173`. Keep the API and web terminal windows open while using the app. When you return another day, run the launcher again; saved SQLite data stays in `backend/mkulima.db` even while the servers are stopped.

1. Configure and start the API:

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```

   The optional `backend/.env` can configure a local SQLite file. By default, the API stores its database at `backend/mkulima.db`, regardless of which directory you launch it from. It creates the database and loads sample farms and products on first start; later starts preserve saved data and only add missing sample rows.

2. In a separate terminal, install and start the web app:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   Open the URL printed by Vite (usually `http://localhost:5173`).
   If the API uses a different port, set `VITE_API_PROXY_TARGET` to its URL before starting Vite.

### Staged PostgreSQL migration

Keep `DATABASE_URL` pointed at SQLite while preparing and testing PostgreSQL. Do not run these steps against a production or non-empty PostgreSQL database.

1. Stop the API and make a fresh copy of `backend/mkulima.db`. Put the connection string for a **separate, empty staging database** in the ignored local `backend/.env` as `POSTGRES_MIGRATION_URL`. Do not commit or share the connection string.
2. From the project root, initialize the empty PostgreSQL database:

   ```powershell
   .\backend\.venv\Scripts\python.exe .\db\initialize_postgres.py
   ```

   The initializer applies `db/schema.sql` and all migrations in order, in one transaction. It refuses to modify a database that already contains public tables.
3. Copy the existing SQLite data and verify it:

   ```powershell
   .\backend\.venv\Scripts\python.exe .\db\copy_sqlite_to_postgres.py .\backend\mkulima.db
   ```

   The importer checks SQLite integrity, requires matching tables and columns, refuses a non-empty PostgreSQL target, copies transactionally, compares every table's row count, and resets serial ID sequences. For a fresh install without existing data, run `db/seed.sql` instead; do not seed before importing the SQLite database.
4. Test the API against staging without changing the saved SQLite setting. In a separate PowerShell window:

   ```powershell
   cd backend
   $setting = Get-Content .env | Where-Object { $_ -match '^POSTGRES_MIGRATION_URL=' } | Select-Object -First 1
   if (-not $setting) { throw 'Set POSTGRES_MIGRATION_URL in backend/.env first.' }
   $env:DATABASE_URL = $setting.Substring('POSTGRES_MIGRATION_URL='.Length).Trim().Trim('"').Trim("'")
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001
   ```

   Run the sign-up/sign-in, farmer verification, product create/edit, buyer search/compare, checkout, M-Pesa callback, buyer/farmer/admin dashboard, and date/price checks on the staging API. Use the Daraja sandbox or a mocked callback; do not trigger live payments during validation. Close that window to return to the saved SQLite configuration.
5. Only after the staging checks pass, stop both APIs, set `DATABASE_URL` in `backend/.env` to the verified PostgreSQL URL, and restart the app. Keep the SQLite backup and the `main` branch until the new setup has been used successfully.

To enable M-Pesa, create a Daraja app and put its credentials in `backend/.env`: set `DARAJA_ENVIRONMENT=sandbox`, `DARAJA_KEY`, `DARAJA_SECRET`, your sandbox `SHORTCODE` and `PASSKEY`, a long random `DARAJA_CALLBACK_SECRET`, and a publicly reachable HTTPS `CALLBACK_URL` ending in `/api/payments/mpesa/callback`. Generate the callback secret locally with `python -c "import secrets; print(secrets.token_urlsafe(32))"`; the backend adds it as a callback query token and never exposes it to the browser. The callback cannot use `localhost`; use an HTTPS tunnel for local testing and keep the API running while testing. Do not put credentials in the frontend or share them in chat. Start with Safaricom sandbox test numbers. For live payments, switch to `DARAJA_ENVIRONMENT=production` only after Safaricom has issued production credentials and enabled the shortcode/product. Checkout requests use the server-calculated order total, rounded to the nearest whole KES as required by STK Push. The app updates the order to paid only after a matching successful callback with the expected amount and receipt, and shows the payment status and receipt in checkout.

## Keeping local data

The local SQLite database at `backend/mkulima.db` stores accounts, farms, listings, orders, messages, and reviews between app restarts. Farm verification videos are stored separately under `backend/private_uploads/farm_verification/`, and uploaded marketplace photos are in `backend/product_images/`. Back up the database and both directories together, and restore them before restarting the API. The database and upload directories are excluded from Git, so copying or downloading the source project alone does not include your local data.

## Accounts and access

- Copy `backend/.env.example` to `backend/.env`. Set `AUTH_SECRET` and `ADMIN_BOOTSTRAP_TOKEN` to long random values before running the API; for example, generate each with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Do not commit `.env` or paste these values into chat. An unset auth secret is generated temporarily for local development, which invalidates sessions on API restart.
- Buyers and farmers register with an email and a password of at least 12 characters, then sign in directly. Passwords are stored as salted scrypt hashes; API sessions are signed bearer tokens that expire after 12 hours. Email verification and password recovery are not available.
- **My profile** lets buyers and farmers update their account name and email. Phone numbers are read-only because changing them requires phone verification.
- Accounts have `active`, `suspended`, `pending`, or `disabled` status. Only active accounts can sign in or continue using an existing session; administrators can review and change a user's status in **Admin**.
- The **Admin** dashboard separates buyer and farmer accounts, reports marketplace activity, displays goods in recent orders, and lets administrators hide or restore commodity and transport listings. Removing account access disables sign-in while preserving order/payment history; it does not permanently erase records.
- The app provides separate **Create buyer/farmer account** and **Sign in** flows, plus **Join as a buyer** and **Join as a farmer** options on the home page. Farmers apply to register their farm after creating an account; an administrator must review and assign a farm before listings can be managed.
- Visitors first see a public landing page explaining why to use Mkulima Connect, buyer and farmer workflows, marketplace services, and how to get in touch with listed providers. Visitors can preview produce before signing in; purchasing, messaging, and personal dashboards require an account.
- The marketplace supports searches for produce, farms, and sellers; county, category, price, and availability filters; price sorting; and paginated listings. Signed-in buyers can save products and set target-price alerts, which appear as in-app notifications.
- The **buyer Marketplace** is for produce discovery, price comparison, quantities, cart checkout, and farmer contact. Farmers manage their own listings, descriptions, uploaded photos, prices, stock, and orders in **Farmer tools**, without using the buyer shopping flow. Their dashboard compares asking prices with other in-stock listings of the same crop variety and unit, and links to matching buyer demand. Product photos can be uploaded as JPEG, PNG, or WebP up to 5 MB; uploaded photos are stored in `backend/product_images/`, served publicly for marketplace display, and excluded from Git.
- Buyers can select **Contact Farmer** on a listing to start a private chat tied to that product. Their first enquiry includes quantity, preferred delivery date, delivery location, and a question; quick-message templates are also available. The rule-based Mkulima Assistant acknowledges every buyer message and answers common price, stock, grade, harvest, delivery, and pre-order questions using the listing's stored details; it is not an external AI service, and negotiations or unlisted facts are left for the farmer. Farmers get an in-app notification and, when Africa's Talking SMS delivery is configured, an SMS asking them to reply in Mkulima Connect. Africa's Talking SMS is used for outbound notifications only; farmers reply in the app. Participants can report a chat, block messaging in that thread, or archive it themselves; administrators can review reported transcripts and archive conversations that require action. Active conversations are automatically archived after 90 days without activity when a participant next opens the messaging area. Returning to the listing can reopen an archived thread unless a participant has blocked it. Chat APIs expose participant display names but never either participant's phone number. Temporary proxy numbers are not enabled. Transport providers remain directly contactable only when they publish their contact details with consent.
- The language selector offers English, Kiswahili, Gĩkũyũ, Dholuo, Kalenjin, Kikamba, Luhya, Ekegusii, and Soomaali, and remembers the visitor's choice. The public introduction and account screens have translations for these languages; buyer, farmer, and admin workspaces still need wider translation coverage. Local-language wording should be reviewed by fluent speakers before a public launch.
- Farmers verify their account phone by SMS, apply for a farm, draw its GPS boundary on an OpenStreetMap map, and submit a 15–30 second video with a freshly generated code. Evidence is stored in the backend's private `backend/private_uploads/farm_verification/` directory, which is not served publicly. To send OTPs and listing-enquiry SMS, set `AFRICASTALKING_USERNAME` and `AFRICASTALKING_API_KEY` in `backend/.env`; `AFRICASTALKING_SENDER_ID` is optional and should be set only to an approved sender ID. Africa's Talking is used for outbound SMS only; farmer replies are handled in Mkulima Connect. SMS codes expire after 10 minutes and allow at most five attempts. Map tiles are requested from OpenStreetMap.
- A complete submission grants **Provisionally Verified** status and allows up to 3 active listings. Admins can review the private video and GPS capture, then upgrade the farm to **Fully Verified** or reject it. Fully verified farms have no listing-count cap. A provisional farm's order value is not capped.
- Farm-video capture requires GPS accuracy of 200 metres or better, a non-degenerate boundary polygon, a video from 15 to 30 seconds, and a capture point within or near the boundary. The app does not expose boundary coordinates or verification videos to marketplace users. Keep the private storage directory on a durable, access-controlled volume in production.
- To create the first administrator for a trial, choose **Admin** on the sign-in screen and then **Create an account**, or choose **Admin** on the account-creation screen. Enter the `ADMIN_BOOTSTRAP_TOKEN` configured in `backend/.env`; this calls the protected one-time `POST /api/auth/bootstrap-admin` endpoint. The token is not saved to browser storage, and bootstrap is disabled after an administrator already exists. The endpoint can also be called from the API docs (`/docs`).
- Order placement, payment initiation, order history, reviews, messages, listing edits, fulfillment updates, farm assignment, and verification require the appropriate authenticated role. Public catalog and farm browsing remain available.
- Notifications are in-app only, with Africa's Talking SMS used for farmer phone OTP and listing-enquiry alerts. Email, browser push, password recovery, and farm-document uploads are not configured or available.
- Use TLS and a managed secret store in production. Apply rate limits at the public reverse proxy as an additional production control.

## Catalog, traceability, and orders

- Open **Farmer tools** to publish or update produce listings for your provisionally or fully verified farm, and add its variety/type (for example Hass or Fuerte for avocado), price, stock quantity, harvest date, growing season, and an HTTPS image URL. Common variety suggestions appear as you type; you can also enter other types. Buyers see a grouped produce card, select the exact variety/type, then choose a farm listing and quantity before adding it to the cart.
- Product cards include **Trace product** with the farm, harvest information, and a map. Buyers can use the floating **WhatsApp farmers** button to choose a listed farm and start a direct chat using its farmer's registered phone number. The seeded farm coordinates are approximate county-centre pins, not surveyed farm addresses.
- Each produce listing receives a unique trace code and QR in **Farmer tools**. Scanning the QR opens its public `/trace/<code>` record with farm profile, harvest date, approximate location, and farmer-submitted growing methods. Farmers can add methods when applying to register a farm; existing farms show a clear “not provided” notice until the information is supplied. The QR identifies the listing, not a separately tracked harvest batch.
- Farmers can run a freshness estimate for a listing with a harvest date. The authenticated endpoint uses configurable-in-code shelf-life benchmarks and returns Fresh/Moderate/Critical risk guidance and a suggested discount. It is a transparent rule-based estimate, not an AI model or food-safety assessment; storage type is recorded but does not adjust shelf-life estimates.
- Buyers can place an order from the cart and track each farm's fulfillment status in **My orders**.
- Buyers can save and unsave produce from the marketplace. The buyer dashboard shows paid spending for the current week, month, and year, with commodity quantities and amounts for the selected period.
- Farmer dashboards show paid sales by product and repeat-buyer summaries. Sales and profit use paid orders and recorded expenses; repeat-buyer summaries mean at least two paid orders with the farm, not a credit or trust assessment.
- In **Farmer tools**, move order items through processing, ready, shipped, and delivered.
- **Messages** lets the buyer and selected farmer exchange notes about quantities and delivery; new messages refresh every five seconds.
- **Transport** lists available produce transporters by county, vehicle type, and load capacity. Signed-in buyers and farmers can publish or hide a listing and share a WhatsApp contact number with explicit consent. They can also message transport providers inside the app. Transport listings and conversations do not book or verify transport services.
- The farmer **Crop health guide** offers common symptom matches and links to a map search for nearby agrovets. It is an informational guide, not an AI diagnosis or pesticide prescription; confirm the cause locally and use only registered products according to their labels.
- **Harvest projection** is a planning calculator using farmer-entered acreage, expected yield per acre, and price. It is not an AI forecast or a promise of actual production or revenue.
- **Farmer groups** provide county/topic-based discussions and bulk-order interest posts. They help farmers find others with shared demand; checkout, payments, and fulfilment remain separate.
- **Farm income tracker** calculates sales from paid orders, stores farmer-entered expenses, and estimates profit as paid sales less recorded expenses. This is not accounting or tax advice.
- Buyers can set product price targets and receive in-app alerts when a farmer changes a listing price to the target or lower. Farmer tools check the Open-Meteo forecast for the farm’s approximate coordinates on opening (at most once every six hours per device) and also offer a manual check; severe rain/weather warnings are saved as in-app alerts. Forecasts are advisory, not a guarantee.
- Choose **Kiswahili** or **English** with the language control in the header. Main navigation, common controls, marketplace, and the new feature screens have translations; product descriptions and some less-used screens remain in their original language.
- The app shell, recent marketplace catalog, and the signed-in farmer’s farm list and produce listings are cached on that device for offline use; cached farmer data is cleared when that account signs out. Farm expense records entered offline are stored per account and sync when the connection returns. Income totals, orders, payment, messaging, and other server actions still need internet access.
- The **Assistant** tab is available without signing in. It uses harvest dates and the built-in shelf-life estimate to highlight public listings that may need selling soon. Signed-in farmers see prioritized freshness estimates for in-stock listings on their own verified farms. It suggests markdowns for consideration only: no prices change automatically. Buyers can add highlighted listings to their cart at the seller's current listed price. Estimates are rule-based, not an external language model or food-safety assessment.
- Buyers can rate product quality and delivery speed and leave a comment after an order item is delivered. Farm ratings and reviews appear in farm and product details.
- Farmers can list future harvests for pre-order, set the expected harvest date and season tier, and reserve up to the listed quantity. Bulk orders receive 5% off at 10+ units and 10% off at 50+ units. Pre-orders are held against the stated harvest and cannot move into preparation before that date.
- Buyers can post crop demands by crop, county, quantity, unit, harvest window, and optional maximum price. Matching verified farms with future pre-order listings receive in-app notifications; buyers and farmers can also see live matches in **Harvest matching**. Buyers can send a quantity, price, and delivery proposal, farmers can accept or decline it, and accepted quantities are reserved from normal checkout. Proposals expire after seven days; buyers confirm delivery to complete an agreement and deduct its quantity from the listing. Comparable asking prices are indicative only, not an externally sourced fair-price guarantee.
- Offtake agreements record the parties' proposal and response but do not hold or guarantee payment. Mobile-money escrow, guaranteed settlement, verified institutional-buyer accounts, group volume pooling, and external market-price data are not implemented. Existing M-Pesa checkout remains ordinary order payment, not escrow.

### Feature and migration map

The home page includes a **More ways to connect** section describing pre-orders, bulk savings, QR traceability, messaging, reviews, and farmer order tools. In the app, buyers browse through **Marketplace**, find farm profiles in **Verified farms**, review completed purchases in **My orders**, and message a farm from a product’s details or the **Messages** tab. Buyers and farmers use **Harvest matching** to post or find demand, negotiate pre-harvest purchase proposals, and record delivery completion. Farmers access pre-orders, QR codes, freshness estimates, listings, income, and farm orders through **Farmer tools** after their farm is approved. **Farmer groups** requires a verified farmer account. The **Assistant** tab is available without signing in.

The SQL files under `db/migrations/` update PostgreSQL databases; they are database changes, not separate screens. Local SQLite uses the equivalent schema and startup upgrades in `backend/app/sqlite_schema.sql` and `backend/app/main.py`. Migrations `001`–`010` are retained as historical upgrade steps. New PostgreSQL deployments should use `db/schema.sql`; existing deployments must apply `001`–`010` in order, followed by `011_remove_optional_integrations.sql`, `012_farmer_verification.sql`, `013_buyer_farmer_tools.sql`, `014_listing_conversations.sql`, `015_harvest_offtake.sql`, `016_buyer_message_assistant.sql`, and `017_product_listing_descriptions.sql`.

The sample farm coordinates and sample listings must be replaced with verified farm data before production.

When upgrading an existing PostgreSQL database, apply migrations `001_catalog_traceability_fulfillment.sql`, `002_messaging_ratings.sql`, `003_preorders_bulk_tiers.sql`, `004_traceability_qr.sql`, `005_transport_directory.sql`, `006_community_income_notifications.sql`, `007_verification_resend_cooldown.sql`, `008_password_recovery.sql`, `009_sms_web_push.sql`, `010_private_farm_documents.sql`, `011_remove_optional_integrations.sql`, `012_farmer_verification.sql`, `013_buyer_farmer_tools.sql`, `014_listing_conversations.sql`, `015_harvest_offtake.sql`, `016_buyer_message_assistant.sql`, and `017_product_listing_descriptions.sql` in order after the original schema. SQLite applies legacy schema upgrades and removes the obsolete integration tables and user columns automatically at API startup.

## Not implemented

Email verification, password recovery, browser push, external farm-video storage, and legal-identity verification are not available. In-app notifications remain enabled.
