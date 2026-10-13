# DealerCenter integration: requirements and status

Status: **blocked on information from DealerCenter.** The CSV import in PR #121 works with any CSV layout, but its default column mapping and any automation depend on the answers below.

## What we need from DealerCenter

1. **A sample inventory export.** A real file covering a few vehicles, in the format the website or custom feed would use (CSV or XML). We use it only to check the mapping in the admin Preview step; it is never committed to the repo.
2. **The column list for that export**, including:
   - The exact header names for VIN, stock number, year, make, model, trim, body style, exterior and interior color, transmission, drivetrain, fuel type, mileage and price. If there are several price columns (internet, selling, retail), which one is the advertised price?
   - **Photos:** a URL list in one column (and which separator), one column per photo, or separate image files. Are the URLs public HTTPS, are they stable, and is there a size or count limit?
   - **Status values:** every value the status field can contain (for example Active, Pending, Sold, Deposit, Wholesale), and whether sold units appear in the feed at all.
   - Any customer, cost or deal columns the export includes by default, and whether they can be turned off at the source. Our importer drops them anyway.
3. **Delivery options and frequency:**
   - HTTPS URL that we pull (preferred), SFTP push, or plain FTP push only. Plain FTP is unencrypted, so we would put an SFTP or HTTPS bridge in front of it. Vercel cannot host FTP.
   - Schedule: how often, at what times, and whether it pushes on every change.
   - Authentication for a URL feed: token, basic auth or IP allowlist.
4. **Full vs advertised inventory.** Does the feed contain every in-stock unit, or only units flagged for online advertising? The importer's "complete inventory" mode marks missing vehicles sold, so it is only safe for a full feed.
5. **Cost on our plan.** Is a custom or website-provider export included, or does it need Online Ad Post Premium or another add-on?
6. **API or partner program.** Is there an inventory API or a website-provider partner program? Is there a CRM lead-import format (for example ADF/XML by email) for pushing website leads back?

## Where to set it up in DealerCenter

**Admin › Dealer Settings › Inventory › Online Marketing › Online Marketing Settings › Activate New Export.** Choose the provider or custom export and enter the receiving account details. Retail and wholesale exports are listed separately. (DealerCenter Support: April 2023 release notes; CarOffer setup article.)

## What's built (PR #121)

- Admin-only CSV/TSV import that requires a passkey: upload → preview diff → apply exactly what was previewed. Limits: 1 MB, 600 rows.
- Configurable column mapping. The default aliases are **to be confirmed**; see `src/lib/integrations/dealercenter/mapping.ts`.
- Matching by VIN, falling back to stock number. In complete-inventory mode, missing vehicles are marked **sold**, never deleted.
- Customer, contact and cost columns are dropped before their values are read. Audit events record counts only.
- See `docs/dealercenter-import.md`.

## Pending

- **Photo import.** Export photo URLs are counted, not imported. The design is still to be done: download over HTTPS from allowlisted hosts with size and type checks, re-encode, store in the inventory Blob store, and dedupe by hash. It depends on how photos are delivered (item 2).
- **Scheduled pull.** A Vercel Cron route authenticated with `CRON_SECRET` would fetch `DEALERCENTER_FEED_URL` (or read from an SFTP bridge) and run the same planner. It would auto-apply only when there are no row errors and the share of vehicles marked sold is under a threshold; otherwise it holds the diff for admin review. This depends on item 3.
- **Lead push-back** to DealerCenter CRM. This depends on item 6.

## Related: Facebook Marketplace

Since **September 13, 2021**, Meta no longer distributes partner inventory catalogs as organic Marketplace listings in the US. Dealers can still list manually and run paid Automotive Inventory Ads, which can appear in Marketplace placements. AutoSweet says it no longer offers organic Marketplace posting as of 2026. So "DealerCenter → Marketplace" automation should not be expected.

## Sources

- DealerCenter: https://www.dealercenter.com/digital-marketing/ ; https://www.dealercenter.com/inventory-management/ ; https://get.dealercenter.com/online-ad-post-premium/
- DealerCenter Support, Release Notes April 2023 (retail/wholesale exports): https://support.dealercenter.net/hc/en-us/articles/14698444089876-Release-Notes-April-2023
- DealerCenter Support, Using CarOffer in DealerCenter (Activate New Export steps): https://support.dealercenter.net/hc/en-us/articles/4416347864212-Using-CarOffer-in-DealerCenter
- Typical export fields (secondary): https://www.autoestimatepro.com/blog/how-to-switch-from-dealercenter-to-a-cloud-dms-in-2026 ; https://www.dealervlo.com/blog/switching-from-dealercenter
- Marketplace change: https://dcnation.dealercenter.com/blog/important-news-about-facebook-marketplace ; https://www.autosweet.com/blog/big-changes-to-facebook-marketplace-for-dealerships/ ; https://www.dealersunited.com/blog/facebook-marketplace-automation-discontinued/
- The FTP push delivery method came from a search summary only and is **unconfirmed** for our account.
