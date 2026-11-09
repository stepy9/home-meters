# Home Meters (Měřáky)

Personal log of electricity (high/low tariff), gas and water consumption. Each month you enter the meter readings; the app works out the consumption and shows a chart per year, a comparison across years and a month × year table. It runs on GitHub Pages, keeps data in Dropbox and can be added to the iPhone home screen.

Live: https://stepy9.github.io/home-meters/

## Development
```
npm install
npm run dev      # http://localhost:5173 (--host makes it reachable from a phone on the same network)
npm test
npm run build
npm run icons    # regenerate the PNG icons in public/
```

## Dropbox (one-time setup)
1. https://www.dropbox.com/developers/apps → Create app → Scoped access → **App folder**, e.g. `home-meters`.
2. Permissions: `files.metadata.read`, `files.content.read`, `files.content.write` → Submit.
3. Settings → OAuth2 Redirect URIs: `https://stepy9.github.io/home-meters/` and `http://localhost:5173/`.
4. Put the App key into `dropboxAppKey` in `src/cloud.js`.

Data is stored in `Apps/home-meters/readings.json`.

## Data model
One reading per meter and month: the meter state at the end of that month. Consumption is the difference between consecutive readings; skipped months share it evenly (marked `*`). A meter swap stores the old meter's final state and the new meter's start state. Records carry `updatedAt`, so the local copy and Dropbox merge record by record, newest wins.

## Deployment
Repository → Settings → Pages → Source: **GitHub Actions**. Every push to `main` runs the tests, builds and deploys.

## iPhone
Open the page in Safari → Share → Add to Home Screen.
