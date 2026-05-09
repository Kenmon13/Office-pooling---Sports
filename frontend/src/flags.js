const countryFlags = {
  MAR: "\u{1F1F2}\u{1F1E6}", // 🇲🇦 Morocco
  PER: "\u{1F1F5}\u{1F1EA}", // 🇵🇪 Peru
  CAN: "\u{1F1E8}\u{1F1E6}", // 🇨🇦 Canada
  AUS: "\u{1F1E6}\u{1F1FA}", // 🇦🇺 Australia
  CMR: "\u{1F1E8}\u{1F1F2}", // 🇨🇲 Cameroon
  IRL: "\u{1F1EE}\u{1F1EA}", // 🇮🇪 Ireland
  POR: "\u{1F1F5}\u{1F1F9}", // 🇵🇹 Portugal
  COL: "\u{1F1E8}\u{1F1F4}", // 🇨🇴 Colombia
  ARG: "\u{1F1E6}\u{1F1F7}", // 🇦🇷 Argentina
  UZB: "\u{1F1FA}\u{1F1FF}", // 🇺🇿 Uzbekistan
  EGY: "\u{1F1EA}\u{1F1EC}", // 🇪🇬 Egypt
  BOL: "\u{1F1E7}\u{1F1F4}", // 🇧🇴 Bolivia
  ITA: "\u{1F1EE}\u{1F1F9}", // 🇮🇹 Italy
  CIV: "\u{1F1E8}\u{1F1EE}", // 🇨🇮 Ivory Coast
  ECU: "\u{1F1EA}\u{1F1E8}", // 🇪🇨 Ecuador
  PUR: "\u{1F1F5}\u{1F1F7}", // 🇵🇷 Puerto Rico
  MEX: "\u{1F1F2}\u{1F1FD}", // 🇲🇽 Mexico
  JPN: "\u{1F1EF}\u{1F1F5}", // 🇯🇵 Japan
  SRB: "\u{1F1F7}\u{1F1F8}", // 🇷🇸 Serbia
  NZL: "\u{1F1F3}\u{1F1FF}", // 🇳🇿 New Zealand
  BRA: "\u{1F1E7}\u{1F1F7}", // 🇧🇷 Brazil
  NGA: "\u{1F1F3}\u{1F1EC}", // 🇳🇬 Nigeria
  TUR: "\u{1F1F9}\u{1F1F7}", // 🇹🇷 Turkey
  KEN: "\u{1F1F0}\u{1F1EA}", // 🇰🇪 Kenya
  FRA: "\u{1F1EB}\u{1F1F7}", // 🇫🇷 France
  PAN: "\u{1F1F5}\u{1F1E6}", // 🇵🇦 Panama
  KOR: "\u{1F1F0}\u{1F1F7}", // 🇰🇷 South Korea
  HON: "\u{1F1ED}\u{1F1F3}", // 🇭🇳 Honduras
  ENG: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England
  SEN: "\u{1F1F8}\u{1F1F3}", // 🇸🇳 Senegal
  CHI: "\u{1F1E8}\u{1F1F1}", // 🇨🇱 Chile
  BHR: "\u{1F1E7}\u{1F1ED}", // 🇧🇭 Bahrain
  ESP: "\u{1F1EA}\u{1F1F8}", // 🇪🇸 Spain
  NED: "\u{1F1F3}\u{1F1F1}", // 🇳🇱 Netherlands
  PAR: "\u{1F1F5}\u{1F1FE}", // 🇵🇾 Paraguay
  ALG: "\u{1F1E9}\u{1F1FF}", // 🇩🇿 Algeria
  GER: "\u{1F1E9}\u{1F1EA}", // 🇩🇪 Germany
  KSA: "\u{1F1F8}\u{1F1E6}", // 🇸🇦 Saudi Arabia
  CRO: "\u{1F1ED}\u{1F1F7}", // 🇭🇷 Croatia
  IRN: "\u{1F1EE}\u{1F1F7}", // 🇮🇷 Iran
  USA: "\u{1F1FA}\u{1F1F8}", // 🇺🇸 USA
  DEN: "\u{1F1E9}\u{1F1F0}", // 🇩🇰 Denmark
  CHN: "\u{1F1E8}\u{1F1F3}", // 🇨🇳 China
  IDN: "\u{1F1EE}\u{1F1E9}", // 🇮🇩 Indonesia
  BEL: "\u{1F1E7}\u{1F1EA}", // 🇧🇪 Belgium
  QAT: "\u{1F1F6}\u{1F1E6}", // 🇶🇦 Qatar
  URU: "\u{1F1FA}\u{1F1FE}", // 🇺🇾 Uruguay
  VEN: "\u{1F1FB}\u{1F1EA}", // 🇻🇪 Venezuela
};

export function flag(code) {
  return countryFlags[code] || "";
}
