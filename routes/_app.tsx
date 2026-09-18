import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#183e2a" />
        <meta name="apple-mobile-web-app-title" content="Fakturomat" />
        <link rel="icon" href="/favicon.ico?v=2" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
        <link
          rel="apple-touch-icon"
          href="/apple-touch-icon.png"
          sizes="180x180"
        />
        <link
          rel="mask-icon"
          href="/safari-pinned-tab.svg"
          {...{ color: "#183e2a" }}
        />
        <link rel="manifest" href="/site.webmanifest" />
        <title>Fakturomat</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
