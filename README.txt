HOMESTEAD SEASONS v1.3 — PWA BUILD

This version is prepared specifically to behave like an installed app on iPhone and iPad.

WHAT'S NEW
- Proper web-app manifest
- 192px, 512px, and Apple touch icons
- Standalone display mode
- iPhone/iPad Home Screen metadata
- Service worker for the app shell and offline startup
- Update-friendly caching so new GitHub Pages deployments are picked up more reliably
- Existing Supabase cloud sync and data remain unchanged

UPLOAD TO GITHUB PAGES
1. Open your homestead-seasons repository on GitHub.
2. Code > Add file > Upload files.
3. Upload ALL contents of this folder, including assets, manifest.json, and service-worker.js.
4. Commit the changes.
5. Wait for GitHub Pages to publish the update.

INSTALL ON IPHONE OR IPAD
1. Open the GitHub Pages URL in Safari.
2. Refresh once after the new version is published.
3. Tap Share.
4. Tap Add to Home Screen.
5. If shown, enable Open as Web App.
6. Tap Add.

IMPORTANT
If you already have an older Home Screen icon, remove that icon and add it again after v1.3 is live. This ensures iOS uses the new PWA metadata and app icon. Removing the Home Screen icon does NOT delete your Supabase cloud data.

Your Supabase database, account, property zones, and observations are not changed by this update.
