# 8. Auth System

## 8.1 What's built

A complete, functional JWT-based authentication system, mounted at `/auth/*`:

| Route | Method | Does |
|---|---|---|
| `/auth/signup` | POST | Create a `User` row (hashed password), return a JWT + user info |
| `/auth/login` | POST | Verify credentials (email or username + password), return a JWT + user info |
| `/auth/me` | GET | Return the current user's info, given a valid bearer token |
| `/auth/logout` | POST | No-op (see [8.4](#4-jwt--what-a-token-actually-contains-how-signing-works-why-stateless-auth-means-logout-is-a-no-op)) |

Backing it: a `User` SQLAlchemy model (`db/models.py`), Pydantic schemas for signup/login/output (`auth/schemas.py`), password hashing + token creation/verification (`auth/security.py`), and a `get_current_user` FastAPI dependency (`auth/dependencies.py`) that any *other* route could use to require authentication. This is real, working code — you can `curl` `/auth/signup` right now and get back a valid token.

## 8.2 Why it's not wired to the frontend

Stated honestly, not spun: this project's research and RAG features were built and shipped first, single-user, with no auth requirement on any of their routes. Auth was added afterward as its own complete subsystem, but retrofitting `Depends(get_current_user)` onto every research/RAG route — and, more consequentially, adding a `user_id` foreign key to `ResearchRun` and `RagSession` so history/sessions could actually be scoped per-user — was scoped out as a deliberate "not now" decision, documented directly in the code:
```python
# backend/db/models.py
# ---------------------------------------------------------------------------
# ResearchRun / RagSession / RagQuery are deliberately NOT linked to User yet
# (portfolio-deadline pivot: research + RAG ship single-user, no auth
# wiring). When auth gets wired in a later step, add
# `user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)`
# to ResearchRun and RagSession.
# ---------------------------------------------------------------------------
```
The reasoning: for a portfolio/demo project, "every AI feature works, end to end, and is visibly good" was judged higher-value to finish first than "every AI feature is also correctly scoped to per-user data." Wiring auth in fully is real, well-understood, mechanical work (add the FK, add the dependency to each route, filter every query by `user_id`, build login/signup UI) — not a hard unknown — which is exactly why it was reasonable to defer rather than skip: the building blocks are already done, what's missing is integration effort. See [8.7](#7-how-to-wire-it-to-the-frontend-if-someone-wants-to) for exactly what that integration work looks like, and [13.6](./13-extending-this-project.md#1336-wiring-the-auth-system-to-the-frontend) for the fuller numbered walkthrough.

## 8.3 Password hashing

**What bcrypt does:** `bcrypt` is a password-hashing algorithm — not encryption (which is reversible with a key), a one-way transformation. Given a password, it produces a fixed-length string that cannot be feasibly reversed back to the original password. Verifying a login means hashing the *submitted* password with the same algorithm and checking whether the result matches the *stored* hash — the plaintext password is never stored anywhere, ever.

```python
# backend/auth/security.py
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
```
This project uses `passlib`'s `CryptContext` as a thin wrapper around the underlying `bcrypt` library — `passlib` isn't strictly required (you could call `bcrypt` directly), but it standardizes hash-scheme handling and future algorithm migration (the `deprecated="auto"` flag is exactly for that: if a stronger scheme were added to `schemes=[...]` later, `passlib` would transparently re-hash old passwords on next successful login).

**Why not SHA256** (or any general-purpose cryptographic hash function): SHA256 is *fast* — that's a virtue for verifying file integrity, and a serious liability for password hashing. An attacker who steals a database of SHA256 password hashes can test billions of guesses per second on modern hardware (especially GPUs). bcrypt is deliberately, tunably **slow** (its "cost factor" controls how many internal rounds it runs) — slow enough that a legitimate login takes an imperceptible fraction of a second, but brute-forcing billions of guesses against a stolen hash becomes computationally expensive rather than trivial. This is the single most important property a password-hashing algorithm needs that a generic hash function doesn't have.

**What a salt is:** a salt is random data mixed into the password before hashing, unique per password, stored alongside the resulting hash (bcrypt embeds it directly in its output string — there's no separate salt column in this schema because bcrypt's own output format already includes it). Its purpose: without a salt, two users with the identical password would produce identical hashes, and an attacker could precompute hashes for common passwords once (a "rainbow table") and instantly crack any matching hash across *every* database that used the same scheme without salting. A unique salt per password means every hash is unique even for identical passwords, and precomputed tables become useless — each password has to be attacked individually. `passlib`'s bcrypt integration generates this automatically; nothing in this codebase manages salts explicitly.

## 8.4 JWT — what a token actually contains, how signing works, why stateless auth means logout is a no-op

**What's actually inside a JWT:** a JWT (JSON Web Token) is three base64-encoded parts joined by dots: a header (algorithm info), a payload (arbitrary claims — in this project, just `{"sub": "<user id>", "exp": <expiry timestamp>}`), and a signature. Critically, the payload is **encoded, not encrypted** — anyone holding the token can decode and read `sub`/`exp` directly (try pasting one into jwt.io) without knowing the signing secret. The signature is what can't be forged without the secret; it's not for hiding the payload's contents.

```python
# backend/auth/security.py
def create_access_token(subject: str | int, expires_minutes: int | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes if expires_minutes is not None else settings.JWT_EXPIRE_MINUTES
    )
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
```
**How signing works, in plain terms:** `jwt.encode()` takes the header + payload and runs them through an HMAC (a keyed hash function) using `JWT_SECRET_KEY` as the key, producing the signature — the third part of the token. `jwt.decode()` (in `decode_access_token()`) does the reverse: recomputes the expected signature from the received header+payload using the *same* secret, and compares it against the signature actually attached to the token. If they match, the token's contents haven't been tampered with since it was issued — because forging a valid signature without knowing the secret is (assuming a strong, sufficiently random secret and a sound algorithm) computationally infeasible. `JWT_ALGORITHM` here is `HS256` — HMAC with SHA-256, a standard, symmetric (same secret used to sign and verify) choice. `python-jose`'s `jwt.decode()` also automatically checks the `exp` claim and raises `JWTError` if the token has expired — this project's `get_current_user` dependency treats that exception as a `401`.

**Why logout is a no-op server-side:**
```python
# backend/auth/router.py
@router.post("/logout")
def logout() -> dict:
    # JWT is stateless, so there's nothing to invalidate server-side — the
    # frontend just drops the token. A real logout would need a token
    # blocklist table (e.g. keyed by a "jti" claim) checked in get_current_user.
    return {"message": "logged out"}
```
The server never stores "which tokens are currently valid" anywhere — a token is valid purely because its signature checks out and it hasn't hit its `exp` time, both of which are verifiable *without* any database lookup or server-side state at all. That's the entire point of "stateless" auth: the server doesn't need to remember anything about issued tokens between requests. The consequence is that there is nothing for a server-side "logout" endpoint to actually *do* to that specific token — it remains cryptographically valid, and would still be accepted by `get_current_user`, until it naturally expires (`JWT_EXPIRE_MINUTES`, default 7 days) or the whole system's signing secret changes (which would invalidate every outstanding token for every user at once, a blunt instrument). "Logging out," in this system, only means the *frontend* discards its copy of the token — the browser stops sending it, but the token itself, if somehow captured beforehand, would keep working until it expires regardless.

## 8.5 The `get_current_user` dependency pattern

```python
# backend/auth/dependencies.py
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(status_code=401, detail="Could not validate credentials", ...)
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise credentials_exception
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise credentials_exception
    return user
```
This is FastAPI's dependency-injection pattern — any route can require an authenticated user just by adding one parameter: `current_user: User = Depends(get_current_user)`. FastAPI handles extracting the bearer token from the `Authorization` header automatically (that's what `OAuth2PasswordBearer` does), calls this function, and either injects the resulting `User` object into the route handler or short-circuits the request with the `401` this function raises. **No route in `research/router.py` or `rag_api/router.py` currently uses this** — it's fully implemented, tested-by-the-`/auth/me`-endpoint, and unused elsewhere. Wiring it up elsewhere is literally adding this one parameter to each route that should require login — see [8.7](#7-how-to-wire-it-to-the-frontend-if-someone-wants-to).

## 8.6 Security notes

**What's done right:**
- Passwords hashed with bcrypt, never stored or logged in plaintext.
- `JWT_SECRET_KEY` has no default and fails loudly at startup if unset ([4.2](./04-backend-walkthrough.md#42-configpy)) — no risk of accidentally running with a blank/guessable signing key.
- The signup TOCTOU race (two signups for the same email landing between the pre-check and the commit) is closed with a `try/except IntegrityError` fallback, not just the friendlier-but-racy upfront check alone ([4.15](./04-backend-walkthrough.md#415-auth)).
- Token expiry (`exp` claim) is enforced automatically by the JWT library on every decode.

**What would need to change for production:**
- **Refresh tokens** — today, a single `access_token` is issued at login with a 7-day expiry (`JWT_EXPIRE_MINUTES = 60 * 24 * 7`) and nothing else. A production system typically issues a short-lived access token (minutes) plus a longer-lived refresh token, so a stolen access token has a much smaller window of usefulness, without forcing the user to re-enter a password every few minutes.
- **Rate limiting** — `/auth/login` has no attempt limiting; nothing in this codebase stops an unlimited number of password guesses against a given account. A production deployment needs this at the application or infrastructure layer.
- **A token blocklist** — as described in [8.4](#4-jwt--what-a-token-actually-contains-how-signing-works-why-stateless-auth-means-logout-is-a-no-op), there's currently no way to invalidate a specific token before its natural expiry (a genuine "log out this device now," or "this token was stolen, kill it") without adding a `jti` (JWT ID) claim per token and a lookup table `get_current_user` checks against — trading away some of statelessness's simplicity for that capability.
- **HTTPS-only cookies (or equivalent token-transport hardening)** — this project's frontend would need to decide *where* the token lives client-side (currently unimplemented — see [8.7](#7-how-to-wire-it-to-the-frontend-if-someone-wants-to)). `localStorage` is simple but exposed to any XSS on the page; an `HttpOnly`, `Secure`, `SameSite` cookie is the more defensible production pattern, at the cost of needing CSRF protection instead.
- **Account verification / password reset flows** — neither exists. `signup` immediately trusts and activates any syntactically-valid email address.

## 8.7 How to wire it to the frontend if someone wants to

1. **Add a `user_id` foreign key** to `ResearchRun` and `RagSession` in `db/models.py` (per the comment already in that file), nullable initially if you want existing/anonymous data to remain queryable, or with a data migration if not (there's no migration tooling yet — see [13.8](./13-extending-this-project.md#1338-migrating-sqlite--postgres) for the broader schema-change caveat this shares).
2. **Require auth on the relevant routes** — add `current_user: User = Depends(get_current_user)` to `start_run`, `upload_pdf`, and every history/session-listing route in `research/router.py` and `rag_api/router.py`; pass `current_user.id` into `service.create_run()`/`service.create_session()` and filter every `list_runs`/`list_sessions` query by it.
3. **Build login/signup UI** — new frontend pages (following the existing page patterns in `frontend/src/pages/`), calling `POST /auth/signup` / `POST /auth/login` via a new `authApi` object added to `frontend/src/lib/api.js` (mirroring the `researchApi`/`ragApi`/`evalsApi` pattern already there).
4. **Store and attach the token** — decide on a storage mechanism (see the HTTPS-only-cookie note in [8.6](#6-security-notes) for the production-grade option; `localStorage`, following this project's existing `storage.js` pattern, is the simplest option for a demo). Un-comment and complete the placeholder already sitting in `frontend/src/lib/api.js`:
   ```javascript
   // TODO: once auth is wired up, attach the bearer token here, e.g.
   // const token = localStorage.getItem('researchmind:token');
   // if (token) headers.Authorization = `Bearer ${token}`;
   ```
5. **Handle 401s globally** — `apiFetch()`'s existing error-normalization path (`frontend/src/lib/api.js`) already surfaces a non-2xx response's `detail` as `err.message`; add a check for `err.status === 401` at the call sites (or centrally, if you introduce a shared API-error handler) to redirect to login rather than showing a raw error banner.
6. **Add a route guard** — a wrapper component or a check in `App.jsx`'s route definitions that redirects to `/login` if there's no valid token, for any page that should require auth.

None of this requires touching `auth/router.py`, `auth/security.py`, or `auth/dependencies.py` at all — that layer is already complete; every step above is about *using* it from the parts of the app that currently don't.

---

**Next:** [09-frontend-walkthrough.md](./09-frontend-walkthrough.md).
