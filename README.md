# Měřáky · Home Meters

Osobní evidence spotřeby elektřiny (VT/NT), plynu a vody. Každý měsíc zadáš stav měřáků a aplikace spočítá spotřebu, ukáže graf za rok, porovná roky a zobrazí tabulku měsíce × roky. Běží na GitHub Pages, data jsou v Dropboxu a dá se přidat na plochu iPhonu.

## Vývoj
```
npm install
npm run dev      # http://localhost:5173 (s --host i z telefonu ve stejné síti)
npm test
npm run build
```

## Dropbox (jednorázově)
1. https://www.dropbox.com/developers/apps, Create app, Scoped access, **App folder**, název např. `home-meters`.
2. Permissions: `files.metadata.read`, `files.content.read`, `files.content.write` a pak Submit.
3. Settings, OAuth2 Redirect URIs: `https://<github-user>.github.io/home-meters/` a `http://localhost:5173/`.
4. App key vlož do `dropboxAppKey` v `src/cloud.js`.

Data jsou v `Aplikace/home-meters/readings.json`.

## GitHub Pages
Repo, Settings, Pages, Source: **GitHub Actions**. Každý push do `main` aplikaci otestuje, sestaví a nasadí.

## iPhone
Otevři stránku v Safari, zvol Sdílet a pak Přidat na plochu.
