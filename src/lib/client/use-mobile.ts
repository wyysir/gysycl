"use client";
import { useEffect, useState } from "react";

/** Only controls presentation; editable data stays in the parent document. */
export function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return mobile;
}
