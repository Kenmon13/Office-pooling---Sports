import React from "react";

const isoMap = {
  MAR: "ma", PER: "pe", CAN: "ca", AUS: "au",
  CMR: "cm", IRL: "ie", POR: "pt", COL: "co",
  ARG: "ar", UZB: "uz", EGY: "eg", BOL: "bo",
  ITA: "it", CIV: "ci", ECU: "ec", PUR: "pr",
  MEX: "mx", JPN: "jp", SRB: "rs", NZL: "nz",
  BRA: "br", NGA: "ng", TUR: "tr", KEN: "ke",
  FRA: "fr", PAN: "pa", KOR: "kr", HON: "hn",
  ENG: "gb-eng", SEN: "sn", CHI: "cl", BHR: "bh",
  ESP: "es", NED: "nl", PAR: "py", ALG: "dz",
  GER: "de", KSA: "sa", CRO: "hr", IRN: "ir",
  USA: "us", DEN: "dk", CHN: "cn", IDN: "id",
  BEL: "be", QAT: "qa", URU: "uy", VEN: "ve",
  WAL: "gb-wls", POL: "pl", TUN: "tn", CRC: "cr", SUI: "ch", GHA: "gh",
  // WC2026 additions
  RSA: "za", CZE: "cz", BIH: "ba", HAI: "ht", SCO: "gb-sct",
  CUW: "cw", SWE: "se", CPV: "cv", NOR: "no", IRQ: "iq",
  AUT: "at", JOR: "jo", COD: "cd",
};

export function localTzLabel(overrideOffsetHours) {
  if (overrideOffsetHours !== undefined && overrideOffsetHours !== null) {
    const sign = overrideOffsetHours >= 0 ? "+" : "-";
    const abs = Math.abs(overrideOffsetHours);
    const h = Math.floor(abs);
    const m = Math.round((abs % 1) * 60);
    return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  }
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  const sign = off >= 0 ? "+" : "-";
  const offset = `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  return `${name} (${offset})`;
}

export function flag(code) {
  const iso = isoMap[code];
  if (!iso) return null;
  return React.createElement("img", {
    src: `https://flagcdn.com/20x15/${iso}.png`,
    alt: code,
    className: "team-flag",
  });
}

const plCrestMap = {
  ARS: 57, AVL: 58, BOU: 1044, BRE: 402, BHA: 397,
  CHE: 61, COV: 1076, CRY: 354, EVE: 62, FUL: 63,
  HUL: 322, IPS: 349, LEE: 341, LIV: 64, MCI: 65,
  MUN: 66, NEW: 67, NFO: 351, SUN: 71, TOT: 73,
};

export function plCrest(code) {
  const id = plCrestMap[code];
  if (!id) return null;
  return React.createElement("img", {
    src: `https://crests.football-data.org/${id}.png`,
    alt: code,
    className: "team-crest",
  });
}
