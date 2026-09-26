import type { AuctionUser, Vehicle, VehicleDraft } from "@/lib/types";

type FirebaseConfig = {
  apiKey: string;
  databaseUrl: string;
};

type AuctionMetadata = Omit<Vehicle, "currentBid" | "bidCount">;
type AuctionState = { currentBid: number; bidCount: number };
type MyBid = { amount: number; updatedAt: number };
type AuthPayload = Record<string, unknown> & {
  localId: string;
  idToken: string;
  email: string;
  displayName?: string;
};

const config: FirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  databaseUrl: (process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "").replace(/\/$/, ""),
};

export const firebaseEnabled = Boolean(config.apiKey && config.databaseUrl);

function requireFirebase() {
  if (!firebaseEnabled) throw new Error("Firebase todavía no está configurado. Completa el archivo .env.local.");
}

function databaseUrl(path: string, idToken?: string) {
  requireFirebase();
  const token = idToken ? `?auth=${encodeURIComponent(idToken)}` : "";
  return `${config.databaseUrl}/${path}.json${token}`;
}

async function firebaseError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
  const message = typeof data.error === "string" ? data.error : data.error?.message;
  return message?.replaceAll("_", " ") ?? fallback;
}

async function authRequest<T extends Record<string, unknown> = Record<string, unknown>>(path: string, payload: object): Promise<T> {
  requireFirebase();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${config.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message?.replaceAll("_", " ") ?? "No fue posible autenticarte.");
  return data as T;
}

export async function signInWithFirebase(email: string, password: string): Promise<AuctionUser> {
  const data = await authRequest<AuthPayload>("accounts:signInWithPassword", { email, password, returnSecureToken: true });
  const profile = await getProfile(data.localId, data.idToken);
  return { uid: data.localId, name: profile?.name || data.displayName || email.split("@")[0], email: data.email, phone: profile?.phone, idToken: data.idToken };
}

export async function registerWithFirebase(input: { firstName: string; lastName: string; email: string; phone: string; password: string }): Promise<AuctionUser> {
  const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  const data = await authRequest<AuthPayload>("accounts:signUp", { email: input.email, password: input.password, returnSecureToken: true });
  await authRequest("accounts:update", { idToken: data.idToken, displayName: name, returnSecureToken: true });
  await putJson(`profiles/${data.localId}`, { name, phone: input.phone, email: input.email }, data.idToken);
  return { uid: data.localId, name, email: input.email, phone: input.phone, idToken: data.idToken };
}

async function getProfile(uid: string, idToken: string) {
  const response = await fetch(databaseUrl(`profiles/${uid}`, idToken));
  if (!response.ok) return null;
  return (await response.json()) as { name?: string; phone?: string } | null;
}

async function putJson(path: string, value: unknown, idToken: string, etag?: string) {
  const response = await fetch(databaseUrl(path, idToken), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(etag ? { "if-match": etag } : {}) },
    body: JSON.stringify(value),
  });
  return response;
}

async function getWithEtag<T>(path: string, idToken: string) {
  const response = await fetch(databaseUrl(path, idToken), { headers: { "X-Firebase-ETag": "true" } });
  if (!response.ok) throw new Error(await firebaseError(response, "No fue posible consultar Firebase."));
  return { value: (await response.json()) as T, etag: response.headers.get("etag") };
}

export async function getPublicAuctions(): Promise<Vehicle[]> {
  requireFirebase();
  const [metadataResponse, stateResponse] = await Promise.all([
    fetch(databaseUrl("auctions")),
    fetch(databaseUrl("auctionStates")),
  ]);
  if (!metadataResponse.ok || !stateResponse.ok) throw new Error("No fue posible cargar el inventario.");
  const metadata = (await metadataResponse.json()) as Record<string, AuctionMetadata> | null;
  const states = (await stateResponse.json()) as Record<string, AuctionState> | null;
  return Object.entries(metadata ?? {}).map(([id, vehicle]) => ({
    ...vehicle,
    id,
    currentBid: states?.[id]?.currentBid ?? 0,
    bidCount: states?.[id]?.bidCount ?? 0,
  }));
}

export function streamPublicAuctions(onUpdate: (vehicles: Vehicle[]) => void, onError: () => void) {
  requireFirebase();
  let refreshTimer: number | undefined;
  const refresh = async () => {
    try { onUpdate(await getPublicAuctions()); } catch { onError(); }
  };
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 150);
  };
  const streams = ["auctions", "auctionStates"].map((path) => {
    const events = new EventSource(databaseUrl(path));
    events.addEventListener("put", scheduleRefresh);
    events.addEventListener("patch", scheduleRefresh);
    events.onerror = onError;
    return events;
  });
  void refresh();
  return () => {
    window.clearTimeout(refreshTimer);
    streams.forEach((events) => events.close());
  };
}

export function streamMyBids(uid: string, idToken: string, onUpdate: (bids: Record<string, MyBid>) => void, onError: () => void) {
  const url = databaseUrl(`myBids/${uid}`, idToken);
  let refreshTimer: number | undefined;
  const refresh = async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("No fue posible consultar tus ofertas.");
      onUpdate(((await response.json()) ?? {}) as Record<string, MyBid>);
    } catch { onError(); }
  };
  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 150);
  };
  const events = new EventSource(url);
  events.addEventListener("put", scheduleRefresh);
  events.addEventListener("patch", scheduleRefresh);
  events.onerror = onError;
  void refresh();
  return () => {
    window.clearTimeout(refreshTimer);
    events.close();
  };
}

export async function placeBid(auction: Vehicle, amount: number, uid: string, idToken: string) {
  const minimum = auction.currentBid > 0 ? Math.ceil(auction.currentBid * 1.1) : auction.basePrice;
  if (amount < minimum) throw new Error(`La oferta mínima es Q ${minimum}.`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { value: state, etag } = await getWithEtag<AuctionState>(`auctionStates/${auction.id}`, idToken);
    if (!state || !etag) throw new Error("La subasta no está disponible.");
    const currentMinimum = state.currentBid > 0 ? Math.ceil(state.currentBid * 1.1) : auction.basePrice;
    if (amount < currentMinimum) throw new Error(`Otra oferta llegó primero. El nuevo mínimo es Q ${currentMinimum}.`);
    const response = await putJson(`auctionStates/${auction.id}`, { currentBid: amount, bidCount: state.bidCount + 1 }, idToken, etag);
    if (response.status === 412) continue;
    if (!response.ok) throw new Error(await firebaseError(response, "Firebase rechazó la oferta por monto, tiempo o permisos."));
    await putJson(`myBids/${uid}/${auction.id}`, { amount, updatedAt: Date.now() }, idToken);
    return { amount, nextMinimum: Math.ceil(amount * 1.1) };
  }
  throw new Error("Hubo varias ofertas al mismo tiempo. Revisa el monto e intenta de nuevo.");
}

export async function compressVehiclePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Solo puedes seleccionar imágenes.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No fue posible leer una fotografía."));
      element.src = url;
    });
    const render = (maxSide: number, quality: number) => {
      const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };
    let dataUrl = render(960, 0.72);
    if (dataUrl.length > 350_000) dataUrl = render(720, 0.6);
    if (dataUrl.length > 500_000) throw new Error("Una fotografía sigue siendo demasiado grande. Elige una imagen de menor tamaño.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createAuction(draft: VehicleDraft, photos: string[], user: AuctionUser) {
  if (!user.idToken) throw new Error("Tu sesión expiró. Ingresa nuevamente.");
  const id = crypto.randomUUID();
  const metadata: AuctionMetadata = {
    id,
    ownerUid: user.uid,
    title: `${draft.year} ${draft.brand} ${draft.model}`,
    year: draft.year,
    articleType: draft.articleType,
    brand: draft.brand,
    model: draft.model,
    engine: draft.engine,
    transmission: draft.transmission,
    fuel: draft.fuel,
    drivetrain: draft.drivetrain,
    cylinders: draft.cylinders,
    damage: draft.damage,
    photos,
    basePrice: draft.basePrice,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    startsAtMs: Date.parse(draft.startsAt),
    endsAtMs: Date.parse(draft.endsAt),
    status: "ACTIVE",
  };
  const metadataResponse = await putJson(`auctions/${id}`, metadata, user.idToken);
  if (!metadataResponse.ok) throw new Error(await firebaseError(metadataResponse, "Firebase rechazó la publicación."));
  const stateResponse = await putJson(`auctionStates/${id}`, { currentBid: 0, bidCount: 0 }, user.idToken);
  if (!stateResponse.ok) throw new Error(await firebaseError(stateResponse, "Firebase no pudo iniciar la subasta."));
  return id;
}

export async function updateAuction(auctionId: string, draft: VehicleDraft, replacementPhotos: string[] | undefined, idToken: string) {
  const { value: current, etag } = await getWithEtag<AuctionMetadata>(`auctions/${auctionId}`, idToken);
  if (!current || !etag) throw new Error("La publicación no existe.");
  const updated: AuctionMetadata = {
    ...current,
    title: `${draft.year} ${draft.brand} ${draft.model}`,
    year: draft.year,
    articleType: draft.articleType,
    brand: draft.brand,
    model: draft.model,
    engine: draft.engine,
    transmission: draft.transmission,
    fuel: draft.fuel,
    drivetrain: draft.drivetrain,
    cylinders: draft.cylinders,
    damage: draft.damage,
    basePrice: draft.basePrice,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    startsAtMs: Date.parse(draft.startsAt),
    endsAtMs: Date.parse(draft.endsAt),
    photos: replacementPhotos ?? current.photos,
  };
  const response = await putJson(`auctions/${auctionId}`, updated, idToken, etag);
  if (!response.ok) throw new Error(await firebaseError(response, "No fue posible guardar los cambios."));
}
