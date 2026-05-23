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

export function flag(code) {
  const iso = isoMap[code];
  if (!iso) return null;
  return React.createElement("img", {
    src: `https://flagcdn.com/20x15/${iso}.png`,
    alt: code,
    className: "team-flag",
  });
}
