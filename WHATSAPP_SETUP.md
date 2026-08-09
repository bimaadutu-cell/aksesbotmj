# WhatsApp / Baileys 6.7.18

The app now has a real WhatsApp connection flow using `@whiskeysockets/baileys@6.7.18`.

- QR: `connection.update.qr` from the real Baileys/WhatsApp login flow, rendered by `qrcode`.
- Pairing code: Baileys `requestPairingCode()`.
- Auth files: `data/whatsapp-auth`.
- This requires a Node.js server with a persistent filesystem. Do not deploy this part to a purely ephemeral serverless runtime unless you provide persistent storage.
- Use an international phone number without `+`, e.g. `628123456789`.

## Install

```bash
npm install
npm run typecheck
npm run build
npm start
```

## Brat

`/brat` now generates a 512x512 WEBP static sticker. Telegram and WhatsApp both use the WEBP output. The previous implementation sent PNG as `sendSticker`, which can fail because Telegram static stickers use WEBP.

## Important

Telegram-only administration APIs (ban/restrict/pin etc.) cannot be literally identical on WhatsApp because the two platforms expose different APIs. The WhatsApp adapter includes common bot commands and AI, and platform-specific admin operations must be implemented with WhatsApp group APIs separately.
