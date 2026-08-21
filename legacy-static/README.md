# SpeedZone Motorsports

A lightweight, mobile-first website for SpeedZone Motorsports in Worcester, Massachusetts.

## What is included

- Responsive dealership homepage focused on calls, directions, and current arrivals
- A Road Trip guide with 16 verified, low-cost family outings across Central Massachusetts and Greater Boston
- Privacy, terms, and custom 404 pages
- Search metadata, sitemap, robots file, and mobile web manifest
- Strict production security headers for Vercel
- A small dependency-free car-care filter and no third-party page embeds
- Automated static validation in GitHub Actions

## Preview locally

From the project directory:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:4173/` for the homepage or `http://127.0.0.1:4173/road-trip` for the Road Trip guide.

Run the repository checks with:

```powershell
npm.cmd test
```

## Deploy with GitHub and Vercel

1. Push the `main` branch to the `PaulinoTech1/Speedzone` GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Leave the framework preset as **Other**. No build command or output directory is required.
4. Deploy, then connect `speedzonems.com` and `www.speedzonems.com` under the project’s domain settings.
5. Make `https://www.speedzonems.com` the primary domain so it matches the canonical links already in the site.

Future pushes to `main` will trigger production deployments through Vercel’s Git integration. The included GitHub check validates the static files independently, and pull requests can use Vercel preview deployments.

## Updating content

Business details and page copy are in `index.html`. Styling is in `assets/styles.v1.css`. Asset filenames include a version suffix because Vercel caches the `/assets/` directory for one year; increment the suffix when replacing an asset and update its references in the HTML.
