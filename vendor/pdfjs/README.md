# PDF.js 6.4.299

Unmodified official Mozilla `pdfjs-dist` distribution, pinned on 2026-10-20.
The `legacy/build/pdf.mjs` and `legacy/build/pdf.worker.mjs` files are included
for browsers without the latest Uint8Array hex helpers. This is the official
compatibility build, not a local fork. License: Apache-2.0, see `LICENSE`.

Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
Upstream: https://github.com/mozilla/pdf.js

The downloaded archive was verified against the npm registry integrity:

```
sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==
```

SHA-256 of the committed files:

```
bc51f4874a66e3853189cb5d50aba4b3096afa83ed433b885d293a3d94583cdc  pdf.mjs
bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf  pdf.worker.mjs
0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594  LICENSE
```

Finora loads these files only when a PDF is selected. Both modules and the worker
must be served from the app origin. No CDN, external CMaps, fonts, document upload,
attachments or PDF JavaScript are used. Eval and XFA are disabled. The loading task
is destroyed in `finally`; PDF.js 6 uses `PDFDocumentLoadingTask.destroy()`.

The bundled Node test runtime should be run with its bundled `node_modules` in
`NODE_PATH`. PDF.js's optional Node canvas support comes from that environment;
it is not a browser runtime dependency and no npm install is needed by the app.
