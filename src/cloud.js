import { mergeStates, normalizeState, stateText } from "./data.js";
import { getState, replaceState } from "./store.js";

// The data kept in one file in the user's Dropbox, in the app's own folder, so the phone and the computer show
// the same. Signing in is OAuth with PKCE (as in Garmin tool), as the app has no server: the browser asks Dropbox
// for a code, trades it for a long-lived refresh token kept here, and gets short access tokens from it.
// Each sync reads the file, merges it with what is here record by record, and writes back what changed.

// The app's key from the Dropbox App Console (an "App folder" app); not a secret, as PKCE needs none.
export const dropboxAppKey = "";

const tokenKey = "home-meters-dropbox";
const verifierKey = "home-meters-dropbox-verifier";
const syncedKey = "home-meters-dropbox-synced";
const filePath = "/readings.json";
const redirectUri = () => `${location.origin}${location.pathname}`;

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export const cloudAvailable = () => Boolean(dropboxAppKey);
export const cloudConnected = () => Boolean(read(tokenKey)?.refresh);

const status = { state: "idle", error: null };
const listeners = new Set();
export const cloudStatus = () => ({ ...status, connected: cloudConnected(), at: read(syncedKey) });
export function onCloudStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setStatus(state, error = null) {
  Object.assign(status, { state, error });
  for (const listener of listeners) listener(cloudStatus());
}

const base64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function connectCloud() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  write(verifierKey, verifier);
  const params = new URLSearchParams({
    client_id: dropboxAppKey,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri(),
    token_access_type: "offline",
    scope: "files.metadata.read files.content.read files.content.write",
  });
  location.assign(`https://www.dropbox.com/oauth2/authorize?${params}`);
}

export function disconnectCloud() {
  const token = read(tokenKey);
  write(tokenKey, null);
  write(syncedKey, null);
  setStatus("idle");
  if (token?.access) fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: `Bearer ${token.access}` } }).catch(() => {});
}

async function dropboxError(response) {
  const text = await response.text().catch(() => "");
  let reason = text;
  try {
    const data = JSON.parse(text);
    reason = data.error_summary ?? data.error_description ?? data.error ?? text;
  } catch {}
  return new Error(`Dropbox ${response.status}${reason ? `: ${String(reason).slice(0, 160)}` : ""}`);
}

async function tokenRequest(body) {
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: dropboxAppKey, ...body }) });
  if (!response.ok) throw await dropboxError(response);
  return response.json();
}

async function finishSignIn() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const verifier = read(verifierKey);
  if (!code || !verifier) return false;
  write(verifierKey, null);
  history.replaceState(null, "", redirectUri() + location.hash);
  const data = await tokenRequest({ code, grant_type: "authorization_code", code_verifier: verifier, redirect_uri: redirectUri() });
  write(tokenKey, { refresh: data.refresh_token, access: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  return true;
}

async function accessToken() {
  const token = read(tokenKey);
  if (!token?.refresh) throw new Error("not connected");
  if (token.access && token.expires > Date.now()) return token.access;
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh });
  write(tokenKey, { ...token, access: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

async function download() {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": JSON.stringify({ path: filePath }) },
  });
  if (response.status === 409) return null;
  if (!response.ok) throw await dropboxError(response);
  return response.text();
}

async function upload(text) {
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path: filePath, mode: "overwrite", mute: true }),
    },
    body: text,
  });
  if (!response.ok) throw await dropboxError(response);
}

let running = null;
export function syncNow() {
  if (!cloudConnected()) return Promise.resolve(false);
  running ??= (async () => {
    setStatus("syncing");
    try {
      const remoteText = await download();
      const remote = remoteText == null ? null : normalizeState(JSON.parse(remoteText));
      const local = getState();
      const merged = mergeStates(local, remote);
      const mergedText = stateText(merged);
      if (mergedText !== stateText(local)) replaceState(merged, { silent: true });
      if (!remote || mergedText !== stateText(remote)) await upload(mergedText);
      write(syncedKey, Date.now());
      setStatus("idle");
      return true;
    } catch (error) {
      setStatus("error", error.message === "newer-version" ? "newer-version" : error.message);
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}

let pending = null;
function syncSoon() {
  if (!cloudConnected()) return;
  clearTimeout(pending);
  pending = setTimeout(syncNow, 1500);
}

export async function setupCloud() {
  if (!cloudAvailable()) return;
  try {
    await finishSignIn();
  } catch (error) {
    setStatus("error", error.message);
  }
  window.addEventListener("data-change", (event) => event.detail?.local && syncSoon());
  // Coming back to the app (switching apps on the phone) picks up what another device did meanwhile.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  syncNow();
}
