// Lab calculator "HOAI-Rechner" of /InvestmentPlatform — since phase 81-03 a thin
// shell around the ONE fee calculator (src/components/honorar/HonorarRechner.jsx,
// D-P81-16).
//
// Finding that led here (81-RESEARCH § Offene Punkte, "HOAI-Rechner im Labor",
// high): the former calculator multiplied the construction costs by fixed
// percentages per zone instead of interpolating 79's fee tables — about a factor
// 2,8 too low — subtracted a 15 % "platform fee", offered minimum/maximum rates
// that HOAI 2021 no longer has and carried buttons without a function. All of that
// is gone; the shell renders the same fields, table and totals as /Fees.
//
// In:  nothing. Out: the calculator.

import React from "react";
import HonorarRechner from "@/components/honorar/HonorarRechner.jsx";

export default function HOAIFeeCalculator() {
  return <HonorarRechner />;
}
