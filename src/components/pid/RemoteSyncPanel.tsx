import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Cloud, CloudDownload, CloudUpload, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePid } from "@/lib/pid/store";
import {
  createRemoteDrawing,
  getRemoteSession,
  loadRemoteDrawing,
  loginRemoteApi,
  logoutRemoteApi,
  RemoteApiError,
  saveRemoteDrawing,
  type RemoteSession,
} from "@/lib/pid/remote-api";

function errorMessage(error: unknown): string {
  if (error instanceof RemoteApiError) {
    if (error.status === 401) return "Autentificare expirată sau date de acces incorecte.";
    if (error.status === 409) return "Desenul a fost modificat între timp. Reîncarcă versiunea serverului.";
    if (error.status === 404) return "Desenul nu a fost găsit pe server.";
    return "Eroare API: " + error.message;
  }
  return "Serverul nu este disponibil. Verifică dacă aplicația rulează.";
}

export function RemoteSyncPanel() {
  const scheme = usePid((state) => state.scheme);
  const setScheme = usePid((state) => state.setScheme);
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [drawingId, setDrawingId] = useState("");
  const [revisionNo, setRevisionNo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Proiectul se salvează local în acest browser.");

  useEffect(() => {
    let active = true;
    setChecking(true);
    setSession(null);
    setRevisionNo(null);
    try {
      const savedLink = window.localStorage.getItem("pid-remote-link:" + scheme.id);
      if (!savedLink) {
        setDrawingId("");
      } else {
        try {
          const parsed: unknown = JSON.parse(savedLink);
          if (parsed && typeof parsed === "object" && "drawingId" in parsed &&
              typeof parsed.drawingId === "string") {
            setDrawingId(parsed.drawingId);
            setRevisionNo(typeof parsed.revisionNo === "number" && Number.isSafeInteger(parsed.revisionNo)
              ? parsed.revisionNo : null);
          } else {
            setDrawingId(savedLink);
          }
        } catch {
          setDrawingId(savedLink);
        }
      }
    } catch {
      setDrawingId("");
    }
    void getRemoteSession().then((value) => {
      if (active) setSession(value);
    }).catch(() => {
      if (active) setSession(null);
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [scheme.id]);

  const rememberDrawing = (id: string, revision: number) => {
    setDrawingId(id);
    setRevisionNo(revision);
    try {
      window.localStorage.setItem("pid-remote-link:" + scheme.id, JSON.stringify({ drawingId: id, revisionNo: revision }));
    } catch { /* optional browser convenience */ }
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await loginRemoteApi(email, password);
      setPassword("");
      const current = await getRemoteSession();
      setSession(current);
      setStatus("Sesiune autentificată.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await logoutRemoteApi();
      setSession(null);
      setRevisionNo(null);
      setStatus("Sesiunea a fost închisă.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    const id = drawingId.trim();
    if (!id) { setStatus("Introdu ID-ul desenului de pe server."); return; }
    setBusy(true);
    try {
      const remote = await loadRemoteDrawing(id);
      setScheme({ ...remote.snapshot.scheme, id: scheme.id });
      rememberDrawing(remote.drawingId, remote.revisionNo);
      setStatus("Desen încărcat din PostgreSQL, revizia " + remote.revisionNo + ".");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const id = drawingId.trim();
      let remote;
      if (!id) {
        remote = await createRemoteDrawing(scheme);
      } else {
        // Use the last observed revision so concurrent edits produce a visible 409.
        const baseRevision = revisionNo ?? (await loadRemoteDrawing(id)).revisionNo;
        remote = await saveRemoteDrawing(id, baseRevision, scheme);
      }
      rememberDrawing(remote.drawingId, remote.revisionNo);
      setStatus("Desen sincronizat cu PostgreSQL, revizia " + remote.revisionNo + ".");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" title="Autentificare și sincronizare cu serverul" aria-label="Sincronizare server">
          <Cloud className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <div className="font-semibold">Server P&ID</div>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
        {checking ? <p className="text-xs text-muted-foreground">Se verifică sesiunea…</p> : session ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span>Autentificat ca <b>{session.email}</b></span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={signOut} aria-label="Ieșire"><LogOut className="h-4 w-4" /></Button>
            </div>
            <label className="block space-y-1 text-xs">
              <span>ID desen pe server {revisionNo ? "· revizia " + revisionNo : ""}</span>
              <Input value={drawingId} onChange={(event) => { setDrawingId(event.target.value); setRevisionNo(null); }} placeholder="Gol pentru desen nou" className="h-8 font-mono text-xs" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" disabled={busy || !drawingId.trim()} onClick={load}>
                <CloudDownload className="mr-1.5 h-4 w-4" />Încarcă
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>
                <CloudUpload className="mr-1.5 h-4 w-4" />Salvează pe server
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Sincronizarea este manuală. Persistența locală rămâne activă.</p>
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-2">
            <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email administrator" required className="h-8" />
            <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Parolă administrator" required className="h-8" />
            <Button type="submit" size="sm" disabled={busy} className="w-full"><LogIn className="mr-1.5 h-4 w-4" />Autentificare</Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
