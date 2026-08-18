"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  OFFLINE_PACKAGES,
  OFFLINE_PACKAGE_STORAGE_KEY,
  buildOfflinePackageTiles,
  downloadOfflinePackage,
  packageContainsPoint,
  parseInstalledOfflinePackages,
  removeOfflinePackage,
} from "../lib/offline-packages";

type Language = "de" | "en";

export default function OfflinePackageManager({ language, fix }: { language: Language; fix: { latitude: number; longitude: number } | null }) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [job, setJob] = useState<{ id: string; completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const de = language === "de";

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let installedIds = parseInstalledOfflinePackages(localStorage.getItem(OFFLINE_PACKAGE_STORAGE_KEY));

    const preloadAll = async () => {
      if (cancelled || running || !navigator.onLine || installedIds.length === OFFLINE_PACKAGES.length) return;
      running = true;
      setError(null);
      try {
        await navigator.storage?.persist?.();
        for (const pack of OFFLINE_PACKAGES) {
          if (cancelled) return;
          if (installedIds.includes(pack.id)) continue;
          const total = buildOfflinePackageTiles(pack).length;
          setJob({ id: pack.id, completed: 0, total });
          await downloadOfflinePackage(pack, (completed, nextTotal) => {
            if (!cancelled) setJob({ id: pack.id, completed, total: nextTotal });
          });
          installedIds = [...installedIds, pack.id];
          localStorage.setItem(OFFLINE_PACKAGE_STORAGE_KEY, JSON.stringify(installedIds));
          if (!cancelled) setInstalled(installedIds);
        }
      } catch {
        if (!cancelled) setError(de ? "Download pausiert. Bei Verbindung wird er fortgesetzt." : "Download paused. It will resume when connected.");
      } finally {
        running = false;
        if (!cancelled) setJob(null);
      }
    };

    const initialTimer = window.setTimeout(() => {
      if (!cancelled) setInstalled(installedIds);
      void preloadAll();
    }, 0);
    window.addEventListener("online", preloadAll);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.removeEventListener("online", preloadAll);
    };
  }, [de]);
  const activePackage = useMemo(() => fix ? OFFLINE_PACKAGES.find((pack) => installed.includes(pack.id) && packageContainsPoint(pack, fix)) : null, [fix, installed]);

  const persist = (ids: string[]) => {
    setInstalled(ids);
    localStorage.setItem(OFFLINE_PACKAGE_STORAGE_KEY, JSON.stringify(ids));
  };

  const download = async (id: string) => {
    const pack = OFFLINE_PACKAGES.find((candidate) => candidate.id === id);
    if (!pack || job) return;
    const total = buildOfflinePackageTiles(pack).length;
    setError(null);
    setJob({ id, completed: 0, total });
    try {
      await navigator.storage?.persist?.();
      await downloadOfflinePackage(pack, (completed, nextTotal) => setJob({ id, completed, total: nextTotal }));
      persist(Array.from(new Set([...installed, id])));
    } catch {
      setError(de ? "Download fehlgeschlagen. Verbindung prüfen und erneut versuchen." : "Download failed. Check the connection and try again.");
    } finally {
      setJob(null);
    }
  };

  const remove = async (id: string) => {
    const pack = OFFLINE_PACKAGES.find((candidate) => candidate.id === id);
    if (!pack || job) return;
    setJob({ id, completed: 0, total: 1 });
    await removeOfflinePackage(pack, installed);
    persist(installed.filter((candidate) => candidate !== id));
    setJob(null);
  };

  return <details className="offline-packages">
    <summary>
      <span><strong>{de ? "Offline-Seekarten" : "Offline charts"}</strong><small>{job ? (de ? "Vollständiger Download läuft" : "Complete download running") : activePackage ? `${de ? "Aktiv" : "Active"}: ${de ? activePackage.nameDe : activePackage.nameEn}` : de ? `${installed.length} Pakete geladen` : `${installed.length} packages downloaded`}</small></span>
      <b>{installed.length}/{OFFLINE_PACKAGES.length}</b>
    </summary>
    <div className="offline-package-body">
      <p>{de ? "Küste, Orte, Routing und alle Tiefenpakete werden automatisch dauerhaft gespeichert." : "Coastline, places, routing, and all depth packages are stored automatically and persistently."}</p>
      <div className="offline-package-list">
        {OFFLINE_PACKAGES.map((pack) => {
          const ready = installed.includes(pack.id);
          const currentJob = job?.id === pack.id ? job : null;
          const percent = currentJob ? Math.round(currentJob.completed / Math.max(1, currentJob.total) * 100) : 0;
          return <article className={`${ready ? "ready" : ""} ${currentJob ? "downloading" : ""}`} key={pack.id}>
            <span className="offline-package-icon" aria-hidden="true">{ready ? "✓" : "⇩"}</span>
            <span><strong>{de ? pack.nameDe : pack.nameEn}</strong><small>{de ? pack.detailDe : pack.detailEn} · {buildOfflinePackageTiles(pack).length} {de ? "Kacheln" : "tiles"}</small></span>
            <button type="button" disabled={Boolean(job)} onClick={() => ready ? void remove(pack.id) : void download(pack.id)}>{currentJob ? `${percent}%` : ready ? (de ? "Löschen" : "Remove") : (de ? "Laden" : "Download")}</button>
            {currentJob && <i style={{ "--offline-progress": `${percent}%` } as CSSProperties} />}
          </article>;
        })}
      </div>
      {error && <p className="offline-package-error" role="alert">{error}</p>}
      <small>{de ? "Vor der Fahrt im WLAN laden. Tiefe bleibt eine Orientierungshilfe." : "Download on Wi-Fi before departure. Depth remains an orientation aid."}</small>
    </div>
  </details>;
}
