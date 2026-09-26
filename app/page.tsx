"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight, CarFront, CheckCircle2, Clock3, Gavel, ImagePlus, LogIn, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getDemoVehicles } from "@/lib/demo-data";
import { compressVehiclePhoto, createAuction, firebaseEnabled, getPublicAuctions, placeBid, registerWithFirebase, signInWithFirebase, streamMyBids, streamPublicAuctions, updateAuction } from "@/lib/firebase-rest";
import type { AuctionUser, DamageLevel, Vehicle, VehicleDraft } from "@/lib/types";

type DialogName = "login" | "register" | "publish" | null;
type Notice = { tone: "success" | "error" | "info"; text: string } | null;

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
        execute: (input: unknown) => unknown | Promise<unknown>;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const damageStyle: Record<DamageLevel, string> = {
  Verde: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Amarillo: "border-amber-200 bg-amber-50 text-amber-900",
  Rojo: "border-rose-200 bg-rose-50 text-rose-800",
};
const damageDot: Record<DamageLevel, string> = { Verde: "bg-emerald-500", Amarillo: "bg-amber-400", Rojo: "bg-rose-500" };
const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[0.95rem] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

function makeDraft(vehicle?: Vehicle): VehicleDraft {
  const start = new Date(Date.now() + 30 * 60_000);
  const end = new Date(Date.now() + 24 * 60 * 60_000);
  return { year: vehicle?.year ?? 2021, articleType: vehicle?.articleType ?? "Automóvil", brand: vehicle?.brand ?? "", model: vehicle?.model ?? "", engine: vehicle?.engine ?? "", transmission: vehicle?.transmission ?? "Automática", fuel: vehicle?.fuel ?? "Gasolina", drivetrain: vehicle?.drivetrain ?? "FWD", cylinders: vehicle?.cylinders ?? 4, damage: vehicle?.damage ?? "Verde", basePrice: vehicle?.basePrice ?? 20_000, startsAt: vehicle?.startsAt ?? start.toISOString(), endsAt: vehicle?.endsAt ?? end.toISOString(), photos: [] };
}
function formatQ(amount: number) { return new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ", maximumFractionDigits: 0 }).format(amount); }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-GT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function remainingTime(endsAt: string, now: number) { const total = Math.max(0, new Date(endsAt).getTime() - now); if (total === 0) return "Subasta cerrada"; const hours = Math.floor(total / 3_600_000); const minutes = Math.floor((total % 3_600_000) / 60_000); const seconds = Math.floor((total % 60_000) / 1_000); return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function minimumBid(vehicle: Vehicle) { return vehicle.currentBid > 0 ? Math.ceil(vehicle.currentBid * 1.1) : vehicle.basePrice; }
function active(vehicle: Vehicle, now: number) { return vehicle.status === "ACTIVE" && new Date(vehicle.startsAt).getTime() <= now && new Date(vehicle.endsAt).getTime() > now; }

export default function Home() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [user, setUser] = useState<AuctionUser | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("Todas");
  const [damageFilter, setDamageFilter] = useState<"Todos" | DamageLevel>("Todos");
  const [mineOnly, setMineOnly] = useState(false);
  const [bidValue, setBidValue] = useState("");
  const [leadingId, setLeadingId] = useState<string | null>(null);
  const [myBidStates, setMyBidStates] = useState<Record<string, { amount: number; status: "LEADING" | "OUTBID" }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>(() => makeDraft());
  const [login, setLogin] = useState({ email: "", password: "" });
  const [registration, setRegistration] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const demo = getDemoVehicles();
    setVehicles(demo);
    setSelectedId(demo[0]?.id ?? null);
    if (!firebaseEnabled) return;
    return streamPublicAuctions(
      (liveVehicles) => {
        if (liveVehicles.length === 0) return;
        setVehicles(liveVehicles);
        setSelectedId((current) => liveVehicles.some((vehicle) => vehicle.id === current) ? current : liveVehicles[0]?.id ?? null);
      },
      () => setNotice({ tone: "error", text: "No se pudo sincronizar Firebase. Se mantiene la última información disponible." }),
    );
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!firebaseEnabled || !user?.idToken) {
      setMyBidStates({});
      return;
    }
    return streamMyBids(
      user.uid,
      user.idToken,
      (bids) => setMyBidStates(Object.fromEntries(Object.entries(bids).map(([auctionId, bid]) => {
        const auction = vehicles.find((vehicle) => vehicle.id === auctionId);
        return [auctionId, { amount: bid.amount, status: auction?.currentBid === bid.amount ? "LEADING" : "OUTBID" }];
      }))),
      () => setNotice({ tone: "error", text: "No se pudo actualizar el estado de tus ofertas." }),
    );
  }, [user, vehicles]);
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "search_live_vehicles",
      title: "Buscar vehículos en subasta",
      description: "Busca vehículos visibles por marca, modelo, año o estado de daño. No modifica datos.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const candidate = (input as { query?: unknown }).query;
        if (typeof candidate !== "string") throw new Error("query debe ser texto.");
        const query = candidate.toLowerCase();
        return vehicles.filter((vehicle) => `${vehicle.year} ${vehicle.brand} ${vehicle.model} ${vehicle.damage}`.toLowerCase().includes(query)).map((vehicle) => ({ id: vehicle.id, title: vehicle.title, currentBid: vehicle.currentBid || vehicle.basePrice, damage: vehicle.damage, endsAt: vehicle.endsAt }));
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [vehicles]);

  const brands = useMemo(() => ["Todas", ...Array.from(new Set(vehicles.map((vehicle) => vehicle.brand))).sort()], [vehicles]);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const filtered = vehicles.filter((vehicle) => {
    const haystack = `${vehicle.year} ${vehicle.brand} ${vehicle.model} ${vehicle.articleType} ${vehicle.fuel} ${vehicle.drivetrain}`.toLowerCase();
    return haystack.includes(search.toLowerCase()) && (brandFilter === "Todas" || vehicle.brand === brandFilter) && (damageFilter === "Todos" || vehicle.damage === damageFilter) && (!mineOnly || vehicle.ownerUid === user?.uid);
  });
  const liveCount = vehicles.filter((vehicle) => active(vehicle, now)).length;
  const selectVehicle = (vehicle: Vehicle) => { setSelectedId(vehicle.id); setBidValue(String(minimumBid(vehicle))); setDetailOpen(true); };
  const requireUser = (next: () => void) => { if (!user) { setNotice({ tone: "info", text: "Inicia sesión o crea una cuenta para publicar o hacer una oferta." }); setDialog("login"); return; } next(); };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const signedIn = firebaseEnabled ? await signInWithFirebase(login.email, login.password) : { uid: "demo-buyer", name: "María López", email: login.email || "maria@subastamotor.demo", isDemo: true };
      setUser(signedIn); setDialog(null); setNotice({ tone: "success", text: firebaseEnabled ? `Bienvenida, ${signedIn.name}.` : "Sesión de demostración iniciada. Firebase se conecta al completar tu configuración." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "No fue posible iniciar sesión." }); } finally { setBusy(false); }
  };
  const handleRegistration = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const created = firebaseEnabled ? await registerWithFirebase(registration) : { uid: "demo-buyer", name: `${registration.firstName} ${registration.lastName}`.trim() || "María López", email: registration.email || "maria@subastamotor.demo", phone: registration.phone, isDemo: true };
      setUser(created); setDialog(null); setNotice({ tone: "success", text: firebaseEnabled ? "Tu cuenta fue creada correctamente." : "Cuenta de demostración creada. Sigue la guía para conectar Firebase." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "No fue posible crear la cuenta." }); } finally { setBusy(false); }
  };
  const handleBid = async () => {
    if (!selected) return;
    requireUser(async () => {
      const amount = Number(bidValue); const min = minimumBid(selected);
      if (!Number.isFinite(amount) || amount < min) { setNotice({ tone: "error", text: `La oferta mínima válida es ${formatQ(min)}.` }); return; }
      if (!active(selected, now)) { setNotice({ tone: "error", text: "La subasta ya está cerrada; no se aceptan nuevas ofertas." }); return; }
      setBusy(true);
      try {
        if (firebaseEnabled && user?.idToken) { await placeBid(selected, amount, user.uid, user.idToken); setLeadingId(selected.id); setMyBidStates((current) => ({ ...current, [selected.id]: { amount, status: "LEADING" } })); setNotice({ tone: "success", text: "Tu oferta fue validada por las reglas de Firebase." }); }
        else { setVehicles((current) => current.map((vehicle) => vehicle.id === selected.id ? { ...vehicle, currentBid: amount, bidCount: vehicle.bidCount + 1 } : vehicle)); setLeadingId(selected.id); setBidValue(String(Math.ceil(amount * 1.1))); setNotice({ tone: "success", text: "¡Vas ganando esta subasta! Oferta de demostración registrada." }); }
      } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "La oferta fue rechazada." }); } finally { setBusy(false); }
    });
  };
  const openPublish = (vehicle?: Vehicle) => { requireUser(() => { setEditingId(vehicle?.id ?? null); setDraft(makeDraft(vehicle)); setDialog("publish"); }); };
  const handlePublish = async (event: FormEvent) => {
    event.preventDefault(); if (!user) return;
    if (!editingId && draft.photos.length < 5) { setNotice({ tone: "error", text: "Debes seleccionar al menos 5 fotografías del vehículo." }); return; }
    if (new Date(draft.endsAt) <= new Date(draft.startsAt)) { setNotice({ tone: "error", text: "La fecha de cierre debe ser posterior a la fecha de inicio." }); return; }
    setBusy(true);
    try {
      if (firebaseEnabled && user.idToken) {
        const compressedPhotos = draft.photos.length ? await Promise.all(draft.photos.map(compressVehiclePhoto)) : undefined;
        if (editingId) await updateAuction(editingId, draft, compressedPhotos, user.idToken);
        else await createAuction(draft, compressedPhotos ?? [], user);
        setVehicles(await getPublicAuctions());
      } else if (editingId) { setVehicles((current) => current.map((vehicle) => {
        if (vehicle.id !== editingId) return vehicle;
        const { photos: newPhotos, ...fields } = draft;
        return { ...vehicle, ...fields, photos: newPhotos.length ? newPhotos.map((file) => URL.createObjectURL(file)) : vehicle.photos, title: `${draft.year} ${draft.brand} ${draft.model}` };
      })); }
      else { const id = `demo-${crypto.randomUUID()}`; const created: Vehicle = { id, ownerUid: user.uid, title: `${draft.year} ${draft.brand} ${draft.model}`, ...draft, photos: draft.photos.map((file) => URL.createObjectURL(file)), currentBid: 0, bidCount: 0, status: "ACTIVE" }; setVehicles((current) => [created, ...current]); setSelectedId(id); }
      setDialog(null); setNotice({ tone: "success", text: editingId ? "La publicación fue actualizada." : "Vehículo publicado y listo para recibir ofertas." });
    } catch (error) { setNotice({ tone: "error", text: error instanceof Error ? error.message : "No fue posible guardar la publicación." }); } finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-[#f6f8fc] text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
      <button className="flex items-center gap-3 text-left" onClick={() => { setMineOnly(false); setSearch(""); }} aria-label="Ir al inventario"><span className="grid size-10 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-200"><Gavel className="size-5" /></span><span><span className="block text-lg font-black tracking-tight text-slate-900">Subasta<span className="text-blue-600">Motor</span></span><span className="block text-xs font-medium text-slate-500">vehículos en tiempo real</span></span></button>
      <div className="hidden items-center gap-2 text-sm text-slate-600 md:flex"><span className="size-2 rounded-full bg-emerald-500" /> Actualizaciones activas</div>
      <div className="flex items-center gap-2">{user ? <><Button variant="outline" className="hidden rounded-xl border-slate-200 sm:flex" onClick={() => setMineOnly((value) => !value)}><UserRound /> {mineOnly ? "Ver catálogo" : "Mis vehículos"}</Button><Button className="rounded-xl bg-blue-600 hover:bg-blue-700" onClick={() => openPublish()}><Plus /> <span className="hidden sm:inline">Publicar vehículo</span><span className="sm:hidden">Publicar</span></Button></> : <><Button variant="ghost" className="rounded-xl text-slate-700" onClick={() => setDialog("login")}><LogIn /> <span className="hidden sm:inline">Ingresar</span></Button><Button className="rounded-xl bg-blue-600 hover:bg-blue-700" onClick={() => setDialog("register")}>Crear cuenta</Button></>}</div>
    </div></header>
    <section className="mx-auto max-w-7xl px-4 pb-12 pt-7 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700"><span className="size-2 rounded-full bg-blue-500" /> Inventario en subasta</div><h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Encuentra tu próximo vehículo</h1><p className="mt-2 text-base text-slate-600">Explora, compara y ofrece con información siempre actualizada.</p></div><div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Clock3 className="size-5" /></span><div><p className="text-sm font-bold text-slate-900">{liveCount} subastas activas</p><p className="text-xs text-slate-500">Sin recargar la página</p></div></div></div>
      <div className="mb-7 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><label className="flex h-12 flex-1 items-center gap-3 rounded-xl bg-slate-50 px-4 ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-blue-300"><Search className="size-5 text-slate-400" /><input className="w-full bg-transparent text-base outline-none placeholder:text-slate-400" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por marca, modelo, año o tipo..." /></label><div className="flex flex-wrap gap-2"><span className="flex items-center px-1 text-sm font-semibold text-slate-500"><SlidersHorizontal className="mr-2 size-4" /> Filtrar:</span>{brands.map((brand) => <button key={brand} onClick={() => setBrandFilter(brand)} className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${brandFilter === brand ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{brand}</button>)}{(["Todos", "Verde", "Amarillo", "Rojo"] as const).map((damage) => <button key={damage} onClick={() => setDamageFilter(damage)} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${damageFilter === damage ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{damage === "Todos" ? "Todo daño" : damage}</button>)}</div></div></div>
      {notice && <div className={`mb-6 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : notice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}><span className="flex gap-2"><span className="pt-0.5">{notice.tone === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}</span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Cerrar mensaje"><X className="size-4" /></button></div>}
      <div className="mb-4 flex items-center justify-between"><p className="text-sm font-medium text-slate-500">{filtered.length} vehículos encontrados</p><p className="text-sm text-slate-500"><span className="font-semibold text-slate-700">Oferta mínima:</span> supera la actual en 10%</p></div>
      {filtered.length === 0 ? <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center"><div><CarFront className="mx-auto mb-3 size-9 text-slate-400" /><h2 className="font-bold">No encontramos vehículos con estos filtros</h2><p className="mt-1 text-sm text-slate-500">Prueba a eliminar alguno para volver a ver el inventario.</p></div></div> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((vehicle) => { const isLive = active(vehicle, now); return <article key={vehicle.id} className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/60"><button className="relative block h-52 w-full overflow-hidden bg-slate-100 text-left" onClick={() => selectVehicle(vehicle)} aria-label={`Ver ${vehicle.title}`}><img src={vehicle.photos[0]} alt={vehicle.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm"><span className={`size-2 rounded-full ${isLive ? "bg-emerald-500" : "bg-slate-400"}`} />{isLive ? "EN VIVO" : "CERRADA"}</span><span className="absolute right-3 top-3 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-semibold text-white">{remainingTime(vehicle.endsAt, now)}</span></button><div className="p-4"><div className="mb-3 flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{vehicle.articleType} · {vehicle.year}</p><h2 className="mt-1 text-lg font-extrabold leading-tight text-slate-900">{vehicle.brand} {vehicle.model}</h2></div><Badge variant="outline" className={damageStyle[vehicle.damage]}><span className={`size-1.5 rounded-full ${damageDot[vehicle.damage]}`} />{vehicle.damage}</Badge></div><div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{vehicle.transmission}</span><span>{vehicle.fuel}</span><span>{vehicle.drivetrain}</span><span>{vehicle.cylinders} cil.</span></div><div className="flex items-end justify-between border-t border-slate-100 pt-3"><div><p className="text-xs text-slate-500">Oferta actual</p><p className="text-xl font-black tracking-tight text-slate-900">{formatQ(vehicle.currentBid || vehicle.basePrice)}</p><p className="text-xs text-slate-500">{vehicle.bidCount} ofertas</p></div><Button variant="outline" className="rounded-xl border-slate-200 font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800" onClick={() => selectVehicle(vehicle)}>Ver y ofertar <ArrowUpRight /></Button></div></div></article>; })}</div>}
    </section>
    {selected && <Dialog open={detailOpen} onOpenChange={setDetailOpen}><DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto border-0 bg-[#f6f8fc] p-0 sm:rounded-3xl"><div className="grid lg:grid-cols-[1.25fr_0.75fr]"><div className="min-w-0 p-4 sm:p-6"><Carousel opts={{ loop: true }} className="overflow-hidden rounded-2xl bg-slate-100"><CarouselContent>{selected.photos.map((photo, index) => <CarouselItem key={`${photo}-${index}`}><img src={photo} alt={`${selected.title}, fotografía ${index + 1}`} className="h-72 w-full object-cover sm:h-[28rem]" /></CarouselItem>)}</CarouselContent><CarouselPrevious className="left-3 border-0 bg-white/90 text-slate-800 hover:bg-white" /><CarouselNext className="right-3 border-0 bg-white/90 text-slate-800 hover:bg-white" /></Carousel><div className="mt-5 flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-700">{selected.articleType} · {selected.year}</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{selected.brand} {selected.model}</h2><p className="mt-1 text-slate-600">{selected.engine} · {selected.transmission} · {selected.drivetrain}</p></div><Badge variant="outline" className={`${damageStyle[selected.damage]} mt-1 text-sm`}><span className={`size-2 rounded-full ${damageDot[selected.damage]}`} />Daño {selected.damage}</Badge></div><dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Motor", selected.engine], ["Combustible", selected.fuel], ["Tracción", selected.drivetrain], ["Cilindros", `${selected.cylinders} cilindros`]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 text-sm font-bold text-slate-800">{value}</dd></div>)}</dl>{selected.ownerUid === user?.uid && <Button variant="outline" className="mt-5 rounded-xl border-slate-200" onClick={() => { setDetailOpen(false); openPublish(selected); }}><Pencil /> Editar mi publicación</Button>}</div><aside className="border-t border-slate-200 bg-white p-5 sm:p-6 lg:border-l lg:border-t-0"><div className="flex items-center justify-between"><p className="text-sm font-bold text-slate-600">Estado de la subasta</p><span className={`flex items-center gap-2 text-sm font-bold ${active(selected, now) ? "text-emerald-700" : "text-slate-500"}`}><span className={`size-2 rounded-full ${active(selected, now) ? "bg-emerald-500" : "bg-slate-400"}`} />{active(selected, now) ? "EN VIVO" : "CERRADA"}</span></div><div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-sm text-slate-300">Tiempo restante</p><p className="mt-1 font-mono text-4xl font-bold tracking-tight">{remainingTime(selected.endsAt, now)}</p><p className="mt-3 border-t border-white/15 pt-3 text-xs text-slate-300">Cierre: {formatDate(selected.endsAt)}</p></div><div className="mt-5"><p className="text-sm text-slate-500">Oferta actual</p><p className="text-3xl font-black tracking-tight text-slate-950">{formatQ(selected.currentBid || selected.basePrice)}</p><p className="mt-1 text-sm text-slate-500">Precio base: {formatQ(selected.basePrice)} · {selected.bidCount} ofertas anónimas</p></div>{(firebaseEnabled ? myBidStates[selected.id]?.status === "LEADING" : leadingId === selected.id) && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">¡Vas ganando esta subasta!</div>}{firebaseEnabled && myBidStates[selected.id]?.status === "OUTBID" && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">Tu oferta ha sido superada. Haz una oferta mayor antes de que termine el tiempo.</div>}<div className="mt-5 border-t border-slate-100 pt-5"><label className="text-sm font-bold text-slate-700">Tu oferta (mínimo {formatQ(minimumBid(selected))})</label><div className="mt-2 flex gap-2"><div className="relative flex-1"><span className="absolute left-3 top-3 text-sm font-semibold text-slate-500">Q</span><input className={`${inputClass} pl-7 font-bold`} inputMode="numeric" value={bidValue} onChange={(event) => setBidValue(event.target.value.replace(/[^0-9]/g, ""))} disabled={!active(selected, now)} /></div><Button className="h-11 rounded-xl bg-orange-500 px-5 font-bold text-white hover:bg-orange-600" disabled={!active(selected, now) || busy} onClick={handleBid}><Gavel /> Ofertar</Button></div><p className="mt-3 flex gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck className="size-4 shrink-0 text-blue-600" />Tu identidad no se comparte. El servidor valida monto, incremento y horario antes de aceptar la oferta.</p></div></aside></div></DialogContent></Dialog>}
    <Dialog open={dialog === "login"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-w-md rounded-3xl bg-white p-6"><DialogHeader><DialogTitle className="text-2xl">Ingresa a SubastaMotor</DialogTitle><DialogDescription>Necesitas una cuenta para ofertar o publicar vehículos.</DialogDescription></DialogHeader><form className="mt-2 grid gap-4" onSubmit={handleLogin}><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Correo electrónico<input required type="email" className={inputClass} value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Contraseña<input required type="password" minLength={6} className={inputClass} value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} /></label><Button disabled={busy} className="h-11 rounded-xl bg-blue-600 hover:bg-blue-700" type="submit"><LogIn /> {busy ? "Ingresando..." : "Ingresar"}</Button><button type="button" className="text-sm font-semibold text-blue-700 hover:underline" onClick={() => setDialog("register")}>¿No tienes cuenta? Regístrate</button></form></DialogContent></Dialog>
    <Dialog open={dialog === "register"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-h-[92vh] max-w-md overflow-y-auto rounded-3xl bg-white p-6"><DialogHeader><DialogTitle className="text-2xl">Crea tu cuenta</DialogTitle><DialogDescription>Podrás publicar vehículos y participar en subastas en vivo.</DialogDescription></DialogHeader><form className="mt-2 grid gap-4" onSubmit={handleRegistration}><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Nombre<input required className={inputClass} value={registration.firstName} onChange={(event) => setRegistration({ ...registration, firstName: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Apellido<input required className={inputClass} value={registration.lastName} onChange={(event) => setRegistration({ ...registration, lastName: event.target.value })} /></label></div><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Correo electrónico<input required type="email" className={inputClass} value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Teléfono<input required type="tel" className={inputClass} value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Contraseña segura<input required type="password" minLength={6} className={inputClass} value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })} /></label><Button disabled={busy} className="h-11 rounded-xl bg-blue-600 hover:bg-blue-700" type="submit"><UserRound /> {busy ? "Creando..." : "Crear cuenta"}</Button></form></DialogContent></Dialog>
    <Dialog open={dialog === "publish"} onOpenChange={(open) => !open && setDialog(null)}><DialogContent className="max-h-[94vh] max-w-3xl overflow-y-auto rounded-3xl bg-white p-6"><DialogHeader><DialogTitle className="text-2xl">{editingId ? "Editar publicación" : "Publicar un vehículo"}</DialogTitle><DialogDescription>Completa todos los campos requeridos. La galería requiere un mínimo de cinco fotografías.</DialogDescription></DialogHeader><form className="mt-3 grid gap-5" onSubmit={handlePublish}><div><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">Ficha técnica</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Año<input required type="number" min="1950" max="2030" className={inputClass} value={draft.year} onChange={(event) => setDraft({ ...draft, year: Number(event.target.value) })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Tipo de artículo<select className={inputClass} value={draft.articleType} onChange={(event) => setDraft({ ...draft, articleType: event.target.value })}><option>Automóvil</option><option>SUV</option><option>Pickup</option><option>Motocicleta</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Marca<input required className={inputClass} value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Modelo<input required className={inputClass} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Motor<input required className={inputClass} value={draft.engine} onChange={(event) => setDraft({ ...draft, engine: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Transmisión<select className={inputClass} value={draft.transmission} onChange={(event) => setDraft({ ...draft, transmission: event.target.value })}><option>Automática</option><option>Manual</option><option>CVT</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Combustible<select className={inputClass} value={draft.fuel} onChange={(event) => setDraft({ ...draft, fuel: event.target.value })}><option>Gasolina</option><option>Diésel</option><option>Híbrido</option><option>Eléctrico</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Tren de manejo<select className={inputClass} value={draft.drivetrain} onChange={(event) => setDraft({ ...draft, drivetrain: event.target.value })}><option>FWD</option><option>RWD</option><option>AWD</option><option>4WD</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Cilindros<input required type="number" min="1" max="16" className={inputClass} value={draft.cylinders} onChange={(event) => setDraft({ ...draft, cylinders: Number(event.target.value) })} /></label></div></div><div><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">Daño y galería</h3><div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Estado de daño<select className={inputClass} value={draft.damage} onChange={(event) => setDraft({ ...draft, damage: event.target.value as DamageLevel })}><option>Verde</option><option>Amarillo</option><option>Rojo</option></select><span className="text-xs font-normal text-slate-500">Verde: menor/limpio · Amarillo: reparable · Rojo: severo/salvamento</span></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Fotografías (mínimo 5)<span className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50 px-3 text-sm font-medium text-blue-800"><ImagePlus className="size-5" /><span className="truncate">{draft.photos.length ? `${draft.photos.length} seleccionadas` : editingId ? "Conserva las fotos actuales o selecciona nuevas" : "Selecciona imágenes"}</span><input className="sr-only" type="file" accept="image/*" multiple onChange={(event) => setDraft({ ...draft, photos: Array.from(event.target.files ?? []) })} /></span></label></div></div><div><h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">Parámetros de subasta</h3><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Precio base (Q)<input required type="number" min="1" className={inputClass} value={draft.basePrice} onChange={(event) => setDraft({ ...draft, basePrice: Number(event.target.value) })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Fecha y hora de inicio<input required type="datetime-local" className={inputClass} value={draft.startsAt.slice(0, 16)} onChange={(event) => setDraft({ ...draft, startsAt: new Date(event.target.value).toISOString() })} /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">Fecha y hora de cierre<input required type="datetime-local" className={inputClass} value={draft.endsAt.slice(0, 16)} onChange={(event) => setDraft({ ...draft, endsAt: new Date(event.target.value).toISOString() })} /></label></div></div><div className="flex flex-col-reverse justify-end gap-3 border-t border-slate-100 pt-5 sm:flex-row"><Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" disabled={busy} className="rounded-xl bg-blue-600 hover:bg-blue-700"><Plus /> {busy ? "Guardando..." : editingId ? "Guardar cambios" : "Publicar vehículo"}</Button></div></form></DialogContent></Dialog>
  </main>;
}
