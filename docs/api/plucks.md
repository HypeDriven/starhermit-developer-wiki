# Plucks

Plucks (symbol **PLK**) are StarHermit's currency. Players spend them on access to your game or on
items you sell inside it. You receive **99%** of each sale, and the platform keeps a 1% commission,
rounded up to a whole Pluck: 1 PLK on a sale of 1–100 PLK, 2 PLK on 101–200, and so on. Every
balance starts at zero.

How players buy or earn Plucks has not been decided yet. Until it is, balances change only through
sales and operator grants.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/me/plucks` | JWT | Your balance: `{ balance, currency: "Plucks", symbol: "PLK" }` |
| GET | `/api/v1/me/plucks/transactions` | JWT | Your history, newest first: `?before=&limit=` (≤100) |
| PUT | `/api/v1/me/github-games/{id}/plucks/access-price` | JWT (owner) | `{ price }` (1–1,000,000,000, or `null` for free) |
| GET | `/api/v1/me/github-games/{id}/plucks/items` | JWT (owner) | Your item catalog |
| PUT | `/api/v1/me/github-games/{id}/plucks/items/{key}` | JWT (owner) | Create or update `{ name, price, active }` |
| DELETE | `/api/v1/me/github-games/{id}/plucks/items/{key}` | JWT (owner) | Remove an item → `204` |
| GET | `/api/v1/me/github-games/{id}/plucks/sales` | JWT (owner) | Paid item orders, newest first |
| GET | `/api/v1/games/{slug}/plucks/access` | Launch token or JWT | `{ price, hasAccess, isOwner }` for the caller |
| GET | `/api/v1/games/{slug}/plucks/items` | Anonymous | Your active items |
| POST | `/api/v1/games/{slug}/plucks/orders` | Launch token or JWT | Ask the player to buy `{ itemKey }` |
| GET | `/api/v1/games/{slug}/plucks/orders/{id}` | Launch token or JWT | The player's order and its status |
| GET | `/api/v1/games/{slug}/server/plucks/orders?since=` | Server token | Paid orders to deliver, oldest first |
| POST | `/api/v1/me/plucks/game-access/{gameId}` | JWT, OAuth sign-in | The player buys access: `{ expectedPrice }` |
| POST | `/api/v1/me/plucks/orders/{id}/confirm` | JWT, OAuth sign-in | The player pays for an order |
| POST | `/api/v1/me/plucks/orders/{id}/cancel` | JWT | The player declines an order |

## Every transaction says where its Plucks came from

Each history entry has a `source`:

- `sale.game_access`: a player bought access to a game.
- `sale.game_item`: a player bought an in-game item.
- `grant`: an operator issued Plucks.

Entries also carry `amount` (signed), `balanceAfter`, `fee`, the game, the item key, the order and
the other party. The ledger is append-only: a mistake is corrected with a new transaction, never by
editing an old one.

## Selling access to your game

Set a price, and your game issues launch tokens only to you and to players who bought access. Anyone
else gets `402` with `code: "purchase_required"` and the `price`. Show them a way to buy.

A purchase sends the price the player was shown as `expectedPrice`. If you have changed the price
since, the purchase is refused with `409` (`code: "price_changed"`), so nobody pays a price they did
not see. Access is permanent and survives later price changes. Pricing a game that was free also
gates its existing players.

**Your game's hosted files are not gated yet.** A price withholds the platform features (sign-in,
sessions, saves, achievements), not the download of a browser game's files.

## Selling items

Your game cannot spend a player's Plucks. Your game's own code holds the player's launch token, so a
token that could spend would let any game drain its players. The flow is:

1. **Your game asks.** `POST /api/v1/games/{slug}/plucks/orders` with `{ "itemKey": "sword.gold" }`.
   The order takes the item's current name and price, starts `pending`, and expires after 15
   minutes. A player can have at most 20 orders waiting (`429`, `too_many_pending_orders`).
2. **The player confirms on StarHermit**, never inside your game. The StarHermit client shows the
   item, the price and your game, and posts `/me/plucks/orders/{id}/confirm`. That route needs an
   account signed in with an OAuth provider, which your game never has.
3. **You deliver it.** Poll `GET /api/v1/games/{slug}/plucks/orders/{id}` from your client until
   `status` is `paid` (or `cancelled`, or past `expiresAt`). A container backend can instead read
   `GET /api/v1/games/{slug}/server/plucks/orders?since=<last completedAt>`.

The platform records the sale; applying the item is your game's job. Make delivery idempotent by
order id.

```http
POST /api/v1/games/{slug}/plucks/orders
Authorization: Bearer <launch-token>
Content-Type: application/json

{ "itemKey": "sword.gold" }
```

```json
{ "id": "2b0e…", "gameId": "c115…", "itemKey": "sword.gold", "itemName": "Golden Sword",
  "price": 100, "status": "pending", "expiresAt": "2026-10-28T14:15:00Z" }
```

Item keys are 1–64 characters of `a-z 0-9 . _ -`; names are 1–80 characters; prices are
1–1,000,000,000 PLK. An inactive or deleted item cannot be ordered, and orders already made keep
their snapshot.

## Errors

| Status | `code` | Meaning |
|---|---|---|
| 402 | `insufficient_plucks` | The player's balance is below the price |
| 402 | `purchase_required` | A launch token for a priced game the player has not bought |
| 409 | `price_changed` | `expectedPrice` is no longer the price |
| 409 | `order_cancelled` | Confirming an order the player cancelled |
| 410 | `order_expired` | Confirming after `expiresAt` |
| 429 | `too_many_pending_orders` | Too many orders awaiting confirmation |

An owner buying from their own game gets `409`.

## Your revenue

`GET /api/v1/me/github-games/{id}/analytics/sales` and `…/analytics/monetization` report units,
gross, the platform's commission and your net per day, paying players, conversion and per-item
totals. They report totals only and never name a buyer. Your own history at
`/me/plucks/transactions` lists each sale.
