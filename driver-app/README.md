# Nyago Cargo Driver Portal

Standalone driver pickup portal located in this folder.

## Features
- Driver sign-in and self-registration through Supabase Auth.
- Lists shipments assigned to the signed-in driver.
- Shows pickup address, instructions, sender phone, package details, and a Google Maps navigation link.
- Confirms pickup through the Supabase RPC `driver_confirm_pickup`; the database function records the pickup and changes the shipment status to `Picked`.

## Required environment variables
Set these in the Vercel project and in GitHub Actions repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never put the Supabase service-role key in this client app.

## Deploy as a separate Vercel project
1. Import this repository into Vercel as a new project.
2. Set **Root Directory** to `driver-app`.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add the two environment variables above for Production and Preview.
5. Deploy and test with a dedicated driver account.

## Driver onboarding
1. Driver opens the portal and creates an account.
2. If Supabase email confirmation is enabled, the driver confirms the email and signs in.
3. On first sign-in, the app creates the driver's own `pickup_drivers` profile using the authenticated user's ID.
4. An administrator assigns a shipment in the admin app's **Shipments → Assign pickup driver** section.
5. Driver opens the assignment, navigates to pickup, and taps **Confirm Pickup** only after physically collecting the shipment.

## Android test APK
The `.github/workflows/driver-apk.yml` workflow builds a debug APK. It requires the same two GitHub repository secrets. After the workflow succeeds, download the `nyago-cargo-driver-apk` artifact from the Actions run and extract `app-debug.apk`. This is for testing, not a signed Play Store release.

## Operational notes
- Pickup address and optional GPS coordinates come from the shipment fields `pickup_address`, `pickup_latitude`, and `pickup_longitude`.
- Database migrations for `shipment_pickup_assignments`, `pickup_drivers`, and `driver_confirm_pickup` must be applied to the linked Supabase project.
- Check Supabase Auth email confirmation and Row Level Security policies before production use.
- The customer timeline's `Picked` milestone is submitted separately in the customer repository PR.
