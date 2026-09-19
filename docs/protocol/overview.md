# Endlesss Protocol Overview

Reverse-engineered from LORE (`/refs/OUROVEON/src/r3.endlesss/`), cross-referenced against `r4.toolbox/app/ouro.cpp` for the login flow.

**LORE version at time of writing:** commit `dbfb61f` (latest as of 2026-05-11).  
Post-Hablab-reactivation git log (Aug 2025 onward): 25 commits — all build system, library updates (FLAC decoding speed, Ableton Link, zlib, r8brain, SQLite, MIDI improvements), and macOS port fixes. **No endpoint changes.** The API as documented here appears unchanged under Hablab London Limited's stewardship.

---

## Base URLs and HTTP Clients

Two distinct domains, with different authentication models:

| Domain | Constant | Used for |
|---|---|---|
| `data.endlesss.fm` | `cEndlesssDataDomain` | CouchDB/Couchbase per-jam data |
| `api.endlesss.fm` | `cEndlesssAPIDomain` | Web API (public + user feed actions) |

All connections are HTTPS. LORE uses `cpp-httplib` with a CA bundle (`certBundleRelative` in `endlesss.api.json`).

### User-Agent Modes

LORE distinguishes four connection modes (`enum UserAgent`):

| Mode | Domain | Auth |
|---|---|---|
| `ClientService` | `data.endlesss.fm` | Basic (`token:password`) |
| `Couchbase` | `data.endlesss.fm` | Basic (`token:password`) |
| `WebWithoutAuth` | `api.endlesss.fm` | None |
| `WebWithAuth` | `api.endlesss.fm` | Bearer (`token:password` as a single string) |

Each mode sends a different `User-Agent` string configured externally in `endlesss.api.json`.

All requests include a **load-balancer cookie**: `Cookie: LB=live##` where `##` is a random integer in `01`–`07`. This is required to reach the Endlesss backend; omitting it may result in routing failures.

---

## Authentication Flow

### Step 1 — Login

```
POST https://api.endlesss.fm/auth/login
Content-Type: application/json

{ "username": "<endlesss username or email>", "password": "<endlesss password>" }
```

The `username` field accepts either the canonical Endlesss username or the account email — both work. The response's `user_id` is always the canonical username, so callers should use `user_id` (not the form input) for any subsequent CouchDB path that needs the username. **Verified empirically 2026-05-12 against live servers.**

Success response (subset of what LORE captures):
```json
{
  "token":    "<couchdb-credential-username>",
  "password": "<couchdb-credential-password>",
  "user_id":  "<endlesss username>",
  "expires":  <unix-ms timestamp>
}
```

The `token` and `password` are **not** the user's login credentials — they are a separate CouchDB keypair returned by the Endlesss auth service. They are stored in `endlesss.auth.json` and reused until `expires`.

On failure the response is `{ "message": "..." }`.

### Step 2 — Using the session

- **CouchDB calls**: HTTP Basic auth with `token` as username and `password` as password.
- **Web API calls with auth**: HTTP Bearer token set to the concatenated string `"token:password"`.
- **Public web API calls**: No credentials.

### Token refresh

There is no explicit refresh endpoint visible in LORE. LORE stores `expires` but re-presents the login UI when the token is found to have expired at startup. For the SDK, we should treat the session as expired when `expires` is in the past and prompt re-authentication.

---

## Public vs Authenticated Endpoint Sets

### Authenticated-only (require `token`/`password`)

- All CouchDB endpoints (`data.endlesss.fm/user_appdata$...`) — jam profiles, rifff history, stem documents, subscribed jam list
- Shared rifff feed when accessing private shares (`WebWithAuth`)
- Rifff sharing / rifff copy write actions

### Public (no credentials)

- `GET /api/band/{jamCouchID}/permalink` — jam display name lookup
- `GET /jam/{longJamID}/rifffs?pageNo=...` — public rifff page (also gives current jam name)
- `GET /api/v3/feed/shared_by/{username}?...` — user's public shared rifffs
- `GET /api/v3/feed/shared_rifff/{id}` — single shared rifff
- `GET /marketplace/collectible-jams?...` — NFT/collectible jams

**Recommendation for v1:** Auth-only. The primary use case — hopping through a user's own jams — requires CouchDB access, which requires credentials. Building an unauthenticated fallback mode adds complexity for little v1 benefit.

---

## Endpoint Reference

### CouchDB Endpoints (`data.endlesss.fm`, Basic auth)

#### Jam Profile
```
GET /user_appdata${jamID}/Profile
```
Returns: `{ displayName: string, app_version?: int, bio?: string }`  
LORE source: `api.cpp::JamProfile::fetch`

Observed 2026-09-18: live Profile docs also carry `_id`, `_rev`, `type: "Profile"`
and `created` (unix ms), and **never an image**, not even for jams that have
one in Endlesss (see "Jam Image" below).

---

#### Subscribed Jams
```
GET /user_appdata${username}/_design/membership/_view/getMembership
```
Returns: rows of `{ id: JamCouchID, key: ISO-timestamp-string }` — the jams the user is a member of, with join timestamp.  
Note: hyphens in username must be escaped as `(2d)` for CouchDB.  
LORE source: `api.cpp::SubscribedJams::fetch`

---

#### Current "Join In" Public Jams
```
GET /app_client_config/bands:joinable
```
Uses `ClientService` user-agent (Basic auth, data domain).  
Returns: `{ band_ids: ["band######", ...] }`  
LORE source: `api.cpp::CurrentJoinInJams::fetch`

---

#### Jam Changes (polling / sentinel)
```
POST /user_appdata${jamID}/_changes?descending=true&limit=1
Content-Type: application/json

{ "feed": "normal", "style": "all_docs", "active_only": true }
```
Returns: `{ last_seq: string, pending: int, results: [{ id, seq }] }`  
`last_seq` is the sequence token. Pass it to the `?since=` variant to poll for new changes only.

Also:
```
POST /user_appdata${jamID}/_changes?since={seqToken}
```
LORE source: `api.cpp::JamChanges::fetch` / `fetchSince`

---

#### Latest Rifff in Jam
```
GET /user_appdata${jamID}/_design/types/_view/rifffLoopsByCreateTime?descending=true&limit=1
```
Returns one row: `{ id: RiffCouchID, key: uint64 (unix nanoseconds), value: StemCouchID[] }`  
`value` is the array of all 8 stem CouchIDs (including inactive/empty ones).  
LORE source: `api.cpp::JamLatestState::fetch`

---

#### Full Jam Snapshot (all rifff IDs)
```
GET /user_appdata${jamID}/_design/types/_view/rifffLoopsByCreateTime?descending=true
```
Same shape as above but no limit. Returns all rifffs ordered newest-first.  
`total_rows` is the server-side total, not the length of `rows[]`.  
**Warning:** 50,000+ rifff jams will return huge payloads. Consider streaming or paging if Endlesss ever supports it; for now LORE loads the full snapshot.  
LORE source: `api.cpp::JamFullSnapshot::fetch`

---

#### Rifff Count Only
```
GET /user_appdata${jamID}/_design/types/_view/rifffsByCreateTime
```
Returns only `{ total_rows: int }` — used to check rifff count without fetching IDs.  
LORE source: `api.cpp::JamRiffCount::fetch`

---

#### Riff Document(s)
```
POST /user_appdata${jamID}/_all_docs?include_docs=true
Content-Type: application/json

{ "keys": ["<riffCouchID>"] }
```
Supports batching: multiple IDs in the `keys` array.  
Returns: `ResultRowHeader<ResultDocsHeader<ResultRiffDocument, RiffCouchID>>` — see data shapes below.  
LORE source: `api.cpp::RiffDetails::fetch` / `fetchBatch`

---

#### Stem Document(s)
```
POST /user_appdata${jamID}/_all_docs?include_docs=true
Content-Type: application/json

{ "keys": ["<stemCouchID>", ...] }
```
Same pattern as riff documents. Returns full stem metadata including CDN URLs for OGG and/or FLAC audio.  
LORE source: `api.cpp::StemDetails::fetchBatch`

---

### Web API Endpoints (`api.endlesss.fm`)

#### Jam Permalink (name + long ID)
```
GET /api/band/{jamCouchID}/permalink
```
No auth. Returns:
```json
{
  "result": "ok",
  "data": {
    "url":       "https://endlesss.fm/jam/<longID>/join",
    "path":      "/jam/<longID>/join",
    "band_id":   "<jamCouchID>",
    "band_name": "<display name at creation time>"
  },
  "errors": []
}
```
The `longID` (64-char hex) is extracted via regex `jam/([^/]+)/join`.  
LORE source: `api.cpp::BandPermalinkMeta::fetch`

---

#### Current Jam Name (from long ID)
```
GET /jam/{longJamID}/rifffs?pageNo=0&pageSize=1
```
No auth. Returns: `{ ok, data: { legacy_id, name }, message? }`  
`name` is the current jam name (may differ from `band_name` above if renamed).  
LORE source: `api.cpp::BandNameFromExtendedID::fetch`

Observed 2026-09-18: `data` also carries `id` (the long ID), `bio`, `owner`,
`members`, `rifffs`, and `image`: the jam's cover image (see below).

---

#### Rifff Structure Page (public jams)
```
GET /jam/{longJamID}/rifffs?pageNo={n}&pageSize={n}
```
No auth. Returns paginated rifff list with full state and stem documents embedded.  
LORE source: `api.cpp::RiffStructureValidation::fetch`

---

#### User's Shared Rifffs
```
GET /api/v3/feed/shared_by/{username}?size={count}&from={offset}
```
Auth optional (Bearer for private shares visible, no-auth for public only).  
Returns: `{ data: [SharedRiff, ...] }` — see data shapes below.  
LORE source: `api.cpp::SharedRiffsByUser::fetch`

---

#### Single Shared Rifff
```
GET /api/v3/feed/shared_rifff/{sharedRiffID}
```
Auth optional.  
LORE source: `api.cpp::SharedRiffsByUser::fetchSpecific`

---

#### Jam Image (cover art)
```
GET https://endlesss.ams3.cdn.digitaloceanspaces.com/attachments/avatars/{jamCouchID}
```
No auth, and not an API call: it's a file on the CDN (Cloudflare in front of
DigitalOcean Spaces). The public rifffs API above reports this URL as `image`,
and it's always this path keyed by the jam's couch ID, so we build it without a
request (`jamImageUrl` in the SDK). A jam with an image answers `200 image/jpeg`
(250–650 KB seen) with `cache-control: max-age=3600` and an ETag. A jam
without one answers **403** `application/xml` (a Spaces "not found"), not 404.
The owner can change it, so the URL isn't immutable like stems are.
LORE doesn't use jam images. Found 2026-09-18 by probing the rifffs API.

---

#### Collectible Jams
```
GET /marketplace/collectible-jams?pageSize=4&pageNo={n}
```
No auth. Paginated; page size 4 matches what the Endlesss website uses. Note: this endpoint is documented in LORE as notoriously slow.  
LORE source: `api.cpp::CurrentCollectibleJams::fetch`

---

#### Share Rifff on Feed (write)
```
POST /rifff-feed/share
Authorization: Bearer token:password
Content-Type: application/json

{
  "jamId":    "<longJamID>",
  "private":  true,
  "rifffId":  "<riffCouchID>",
  "shareId":  "<new UUID>",
  "title":    "<share name>"
}
```
Returns: `{ ok, data: { id: "<shareId>" }, message? }`  
Requires: first resolve the long jam ID via `BandPermalinkMeta`.  
LORE source: `api.cpp::push::ShareRiffOnFeed::action`

---

#### Copy Rifff to Another Jam (write)
```
POST /jam/{destLongJamID}/rifffs/import
Authorization: Bearer token:password
Content-Type: application/json

{ "jamId": "<sourceLongJamID>", "message": "", "rifffId": "<riffCouchID>" }
```
LORE source: `api.cpp::push::RiffCopy::action`

---

## Core Data Shapes

### ID Types

| Type | Example | Notes |
|---|---|---|
| `JamCouchID` | `band12345678` | Public/subscribed jams start with `band`. Personal (solo) jams use the username as the ID. |
| `RiffCouchID` | `afa5e840694f11eaa8405fee66bfbe0f` | 32-char hex |
| `StemCouchID` | `1641d000ef9911ed9000d1062b20bdd7` | 32-char hex |
| `SharedRiffCouchID` | UUID | Unique ID for the share object, not the rifff |
| Long jam ID | `296a74e8a64d254c0df007dda8a205d08e63915959ac5e912bdb8dde7077c638` | 64-char hex; needed for web API write calls |

---

### Jam

Minimal metadata — the jam list and name service build on top of this:
```ts
interface Jam {
  couchID:     string;   // JamCouchID, e.g. "band12345678"
  displayName: string;
}
```

---

### Riff (raw from CouchDB)

The full document returned by `_all_docs?include_docs=true`:
```ts
interface RiffDocument {
  _id:          string;    // RiffCouchID
  state: {
    bps:         number;   // beats per second
    barLength:   number;   // length in bars
    playback:    Array<{   // exactly 8 elements
      slot: {
        current: {
          on:          boolean;
          currentLoop: string;   // StemCouchID; empty string if off
          gain:        number;   // 0..1
        }
      }
    }>;
  };
  userName:     string;
  created:      number;   // unix milliseconds
  root:         number;   // 0..11 — see Musical Constants below
  scale:        number;   // 0..17 — see Musical Constants below
  app_version?: number;
  magnitude?:   number;
}
```

Flattened internal representation (`types::Riff`) adds `BPMrnd = ceil(BPS * 60 * 100) / 100` for display.

---

### Stem (raw from CouchDB)

```ts
interface StemDocument {
  _id:    string;   // StemCouchID
  cdn_attachments: {
    oggAudio?: {
      bucket?:   string;   // legacy only; usually empty on modern stems
      endpoint:  string;   // e.g. "ndls-att0.fra1.digitaloceanspaces.com"
      key:       string;   // e.g. "attachments/oggAudio/band######/############"
      url:       string;   // full URL (may be pre-composed or derived)
      length:    number;   // bytes
      mime:      string;   // "audio/ogg" (default)
    };
    flacAudio?: {
      endpoint:  string;   // e.g. "endlesss-dev.fra1.digitaloceanspaces.com"
      key:       string;   // e.g. "attachments/flacAudio/band######/############"
      length:    number;
      url:       string;
      mime:      string;   // "audio/flac"
    };
  };
  bps:              number;
  length16ths:      number;
  originalPitch:    number;
  barLength:        number;
  presetName:       string;
  creatorUserName:  string;
  primaryColour:    string;   // hex colour, e.g. "ff4d9de0"
  sampleRate:       number;   // float — Studio saves with decimal precision
  created:          number;   // unix ms
  isDrum?:          boolean;
  isNote?:          boolean;
  isBass?:          boolean;
  isMic?:           boolean;
}
```

**CDN URL construction**: Use `url` directly from the document. If `url` is missing or empty, construct as:
- No bucket: `https://{endpoint}/{key}`
- With bucket (legacy): `https://{bucket}.{endpoint}/{key}`

FLAC is preferred when present (`length > 0`). Fall back to OGG.

---

### Shared Riff

```ts
interface SharedRiff {
  _id:               string;    // SharedRiffCouchID
  doc_id:            string;
  band?:             string;    // JamCouchID
  action_timestamp:  number;    // unix ms
  title:             string;
  creators?:         string[];
  rifff:             RiffDocument;
  loops:             StemDocument[];
  image_url?:        string;
  image:             boolean;
  private:           boolean;
}
```

---

### Musical Constants

**Root** (0–11): C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B

**Scale** (0–17):
```
0  Major (Ionian)      9  Suspended Pentatonic
1  Dorian             10  Blues Minor Pentatonic
2  Phrygian           11  Blues Major Pentatonic
3  Lydian             12  Harmonic Minor
4  Mixolydian         13  Melodic Minor
5  Minor (Aeolian)    14  Double Harmonic
6  Locrian            15  Blues
7  Minor Pentatonic   16  Whole Tone
8  Major Pentatonic   17  Chromatic
```

---

## Live Jam Monitoring

LORE does **not** use a WebSocket connection to the Endlesss server for live updates. Instead it polls with a `Sentinel` object:

1. `POST /user_appdata${jamID}/_changes?descending=true&limit=1` to get current `last_seq`
2. Compare `last_seq` against previously seen value
3. On change: call `JamLatestState` to get the newest rifff ID + stem IDs, then fetch full details
4. Poll rate: configurable via `jamSentinelPollRateInSeconds` (default 5 seconds)

A long-poll variant (`/user_appdata${jamID}/_changes?feed=longpoll`) exists in the CouchDB protocol and would be more efficient, but LORE notes it as a "better approach" not yet implemented.

The `toolkit::Exchange` struct is an **outgoing local IPC** shared-memory block that BEAM writes to, letting external tools (visualisers, etc.) read mixer state. It is not a network protocol to Endlesss servers.

---

## Known Quirks and Damaged-Data Handling

These are all documented in LORE source; we must replicate this handling in the SDK.

### 1. `"length"` stored as string
Some Endlesss server versions wrote `"length":"13"` (string) instead of `"length":13` (number).  
**Fix:** regex replace `"length":"([0-9]+)"` → `"length":$1` on the raw response body before parsing.  
LORE source: `api.h::NetConfiguration::m_dataFixRegex_lengthTypeMismatch`

### 2. `"on"` stored as 0/1 instead of bool
At least one jam (noted in code as "Ash's solo jam") has `"on":0` / `"on":1`.  
**Fix (optional mode):** regex replace `"on":0,` → `"on":false,` and `"on":1,` → `"on":true,` before parsing.  
LORE source: `api.cpp::RiffDetails::fetchBatch`, `debugLastMinuteQuirkFixes` flag

### 3. Null `currentLoop` when `on: true`
If `currentLoop` deserializes as empty string while `on` is `true`, force `on = false`.  
LORE source: `api.h::ResultRiffDocument::State::Playback::Slot::Current::serialize`

### 4. Missing OGG `key` field (old stems)
Some early stems lack `cdn_attachments.oggAudio.key`.  
**Fix:** parse `key` from the URL path by stripping the leading `/`.  
LORE source: `core.types.h::ResultStemDocument::CDNAttachments::OGGAudio::serialize`

### 5. `endpoint` starting with `http://` or `https://` (old stems)
Some stems stored the endpoint with a URL prefix.  
**Fix:** extract the hostname by taking the substring after the last `/`.

### 6. `bucket` already prepended to `endpoint` (old stems)
Some stems have the bucket prefix embedded in endpoint.  
**Fix:** if `endpoint` starts with `bucket`, clear `bucket` (endpoint is already correct).

### 7. Deleted / missing stem documents
CouchDB returns a record for deleted documents: `{ "id": "...", "value": { "rev": "...", "deleted": true }, "doc": null }` or `{ "key": "...", "error": "not_found" }`.  
**Handling:** parse with all fields optional; check `error` or `value.deleted` and skip.  
LORE source: `api.h::ResultDocsSafeHeader`

### 8. Null elements in `loops` arrays (shared rifffs)
Shared rifff `loops` arrays can contain `null` entries: `"loops": [null, null, {...}]`.  
**Fix (multi-pass):** 
1. Replace `"current":null` → `"current":{"on":false,"gain":0.0}`
2. Remove `"key":null,` type patterns
3. Strip leading `null,` sequences from `"loops":[`
4. Walk the body and blank out `,null` sequences inside `[ ]` scope of `"loops"`  
LORE source: `api.cpp::SharedRiffsByUser::commonRequest` (the big preprocessing closure)

### 9. Old-format stem documents (pre-2020)
Very old stems (~2019) use `_attachments.oggAudio` instead of `cdn_attachments`. These have no `cdn_attachments` block at all and use a different OGG attachment structure.  
**Handling:** Check `app_version == 0` and `_attachments.oggAudio.digest != ""` as a sentinel; extract audio via MD5 digest / old path convention.  
LORE source: `api.h::TypeCheckDocument`

### 10. Personal jam ID escaping
If `jamCouchID` does not start with `band`, it is a personal (solo) jam whose ID is the username. Hyphens must be URL-escaped as `(2d)` for CouchDB paths.  
Example: user `foo-bar` → path `/user_appdata$foo(2d)bar/...`  
LORE source: `api.cpp::NetConfiguration::checkAndSanitizeJamCouchID`

### 11. Stem size mismatches
The `length` in the CDN attachment metadata can differ from actual received bytes for older stems.  
**Behaviour:** `hackAllowStemSizeMismatch` flag; when enabled, mismatch is tolerated. This is required for reliable operation on archives older than ~6 months.

---

## Stem Cache Layout

LORE organises cached stem files on disk (Version 2, from 0.7.7+):
```
<cacheRoot>/
  <jamCouchID>/
    <first-char-of-stemID>/
      <stemCouchID>.<ext>
```

Version 1 (pre-0.7.7) was a single root directory partitioned by first char only, without the jam subdirectory. The SDK should use Version 2.

Stems are stored as-is (no re-encoding). If the stem's `sampleRate` differs from the playback target, LORE resamples at load time (r8brain).

**Two separate things get conflated here — they are not the same fix** (this
note previously implied they were, and cost a wrong diagnosis in July 2026):

1. **Device rate.** LORE resamples a decoded stem to the output device's rate.
   In the browser `decodeAudioData` already resamples to the `AudioContext`
   rate, from the rate the *file* declares in its own header. Measured on 14
   stems (`Stem timing probe` in `packages/sdk/test/integration.test.ts`), the
   stem document's `sampleRate` matched the encoded rate every time, so there
   is nothing extra to do here.

2. **Tempo.** A rifff can reuse a stem recorded at a *different tempo*, and
   that is what actually needs correcting. LORE
   (`src/r3.endlesss/endlesss/live.riff.cpp`):

   ```cpp
   // stems can be used across riffs with changed tempos, we have to scale to cope
   const auto stemTimeScale = theRiff.BPS / stemData.BPS;
   ```

   The scale comes from the stem's own `bps`, not its `sampleRate`, and it is
   applied to the stem's sample count *before* the rifff's length is settled.
   We do the same with `AudioBufferSourceNode.playbackRate`, which is why
   `ResolvedStem` carries `bps` and `length16ths`.

LORE also does not trust `bps`/`barLength` alone for rifff length: it starts
from them, then sets `m_lengthInSec = max(computed, longest time-scaled stem)`
and lets shorter stems repeat inside (`repeats = round(riffLen / stemLen)`).

---

## Phase 0 Decisions

### Auth-only vs public-endpoints mode in v1

**Recommendation: auth-only in v1.**

Public endpoints only give you public jam browsing and shared rifff feed — no access to the user's own private jams or their rifff history. The core use case (record and edit rifff hop sequences from your own jams) requires CouchDB auth for every rifff and stem fetch. Building a public-only mode would be a separate, limited product. Ship auth-only first.

### LORE reference note

The CLAUDE.md refers to this code as `src/r0.endlesss/` but in the actual repository the module is `src/r3.endlesss/`. All source references in `docs/protocol/` use the real path `r3.endlesss`.
