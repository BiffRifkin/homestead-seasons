Homestead Seasons v1.6.4 — Property Zone Clarity Patch

New in this version:
- Tap a map marker or zone card to select and highlight a property zone.
- Zone dashboard with observation, species/plant, photo, and milestone counts.
- See most recent activity for the selected zone.
- Browse Life species/plants recorded in the zone and tap one to open its Life profile.
- View a zone-specific photo gallery with tap-to-enlarge images.
- Add Observation Here button pre-fills the selected property zone.
- Recent activity list remains fully editable.

Upload all files in this folder to the root of the existing GitHub repository and commit the changes.


Changes in v1.6.4:
- Renamed Clear to Back to Property.
- Kept Add Observation Here visible for empty zones.
- Added a helper note explaining that the zone is preselected.
- Improved scrolling into empty zone detail views.


v1.6.4: Property zone pages now show prominent Add Observation Here buttons at both the top and bottom of every zone detail view.

Patch v1.6.4: force the selected-zone header control label to 'Back to Property' at runtime, so an older cached HTML shell cannot leave it as 'Clear'.


v1.6.4 authentication hardening: prevents native form reloads, retries Supabase SDK loading from a second CDN, and always displays login errors instead of silently returning to the login form.


v1.7: Expanded Year in Review with species/plant totals, top species and zones, seasonal bookends, bloom/arrival highlights, weather summaries, month-by-month story, photo highlights, and print-optimized PDF export.
