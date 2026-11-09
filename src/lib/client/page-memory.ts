"use client";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
export function usePageMemory<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window !== "undefined") try { const saved = sessionStorage.getItem("page:" + key); if (saved) return JSON.parse(saved) as T; } catch { /* Storage may be unavailable. */ }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => { try { sessionStorage.setItem("page:" + key, JSON.stringify(value)); } catch { /* Keep page usable without storage. */ } }, [key, value]);
  return [value, setValue];
}
export function useScrollMemory(key: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const storageKey = "scroll:" + key;
    let saved = 0; try { saved = Number(sessionStorage.getItem(storageKey) || 0); } catch {}
    const frame = requestAnimationFrame(() => window.scrollTo(0, saved));
    const remember = () => { try { sessionStorage.setItem(storageKey, String(window.scrollY)); } catch {} };
    window.addEventListener("scroll", remember, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", remember); };
  }, [key, ready]);
}
