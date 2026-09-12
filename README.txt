Homestead Seasons v1.1 — Map + Wildflower Update

WHAT'S NEW
- Supabase sign-in with your Homestead Seasons account.
- Shared cloud observations between devices.
- Private photo storage in the observation-photos bucket.
- Local browser cache for quick loading and temporary offline use.
- Offline changes are queued and retried when the connection returns.
- Cloud status button in the top-right corner; tap it to Sync Now or Sign Out.
- Existing v0.9 observations can be imported into the cloud.

FIRST TEST ON YOUR PC
1. Extract this ZIP.
2. Open index.html in Chrome or Edge.
3. Sign in with the email/password you created in Supabase.
4. If the app detects local observations, it will offer Import to Cloud.
5. Add one test observation. Close and reopen the app and confirm it is still present.

IMPORTANT IF YOU WANT TO PRESERVE RECORDS STORED IN YOUR CURRENT v0.9 FOLDER
Browser local storage is tied to the page location. The most reliable migration is:
1. Make a backup copy of your existing v0.9 folder first.
2. Keep your existing v0.9 folder in the same place.
3. Replace the files INSIDE that folder with the files from v1.0 (do not move/rename the folder before the first cloud import).
4. Open the same index.html you used before.
5. Sign in and choose Import to Cloud.
6. After the import succeeds, the cloud copy becomes the master record and you can use the hosted version on other devices.

IPHONE / IPAD
To use one shared app on both devices, v1.1 needs to be hosted at an HTTPS web address. After the PC test succeeds, the next step is publishing these static files to a simple web host and adding Homestead Seasons to the Home Screen on each Apple device.

SECURITY
This app contains only your Supabase public/anon client key. It does NOT contain your password or service-role key. Row Level Security in your Supabase project controls access to your records.


v1.1 changes:
- Repositioned Upper Meadow, House & Yard, West Woods, Pond, and South Woods map markers/labels based on the approved screenshot.
- Added Wildflower as a distinct plant category.
- Existing zone names and database records are unchanged; only map presentation coordinates changed.
