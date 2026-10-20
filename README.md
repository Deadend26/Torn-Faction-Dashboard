# Torn Faction Dashboard

## Files
- `index.html` — page layout and ranked-war report dialog.
- `styles.css` — dashboard and report/payout styling.
- `script.js` — Torn API v2 requests, rendering, report parsing, and payout calculations.
- `data.json` — example snapshot schema; it is not loaded by the dashboard at runtime.

## Ranked-war report and payout calculator
Click a ranked-war row to request `/v2/faction/{rankedWarId}/rankedwarreport` and open the report dialog.

Default payout ratio: **Faction 20% : Contribution 65% : Participation 15%**.
- **Faction share:** allocated as one payment to the faction's shared vault, not divided among members. The calculator reports this destination; it does not transfer funds.
- **Contribution share:** divided in proportion to each report member's respect/score earned or attack count, selectable in the dialog.
- **Participation share:** divided evenly across all included members in the war report, whether or not they made attacks. Members excluded from the report are not included.
- Ratio values must add up to 100%. The settings are saved in this browser.
- Enter a total payout pool to calculate amounts, then export CSV or copy a text report.

The report response is also available in the dialog's expandable raw-response section to help diagnose future API schema changes. The API key remains in browser local storage as in the existing dashboard; do not publish or share your key.

## Run
Open `index.html` in a browser or deploy the folder to GitHub Pages. The dashboard uses the Chart.js CDN and the Torn API, so internet access is required.
Or use link https://html-preview.github.io/?url=https://github.com/Deadend26/Torn-Faction-Dashboard/blob/main/index.html to run in your browser.

### Excluding members from a ranked-war report

Inside a ranked-war popup, use **Remove** beside a player to exclude them from that report's calculations. The player is removed from the report member table and is excluded from the faction, contribution, and participation payout shares. This is a local report adjustment only; it does not change Torn's data or faction membership. Use **Restore** beside an excluded player, or **Restore all**, to add them back into the calculation.
