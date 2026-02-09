// Black-Scholes option pricing and delta calculations.
// Pure math module — no dependencies.

/** Cumulative standard normal distribution (rational approximation, ~1e-7 accuracy). */
export function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

function d1(S: number, K: number, T: number, r: number, sigma: number): number {
  return (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
}

function d2(S: number, K: number, T: number, r: number, sigma: number): number {
  return d1(S, K, T, r, sigma) - sigma * Math.sqrt(T);
}

/** Black-Scholes European call price. */
export function bsCallPrice(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  const D1 = d1(S, K, T, r, sigma);
  const D2 = d2(S, K, T, r, sigma);
  return S * cdf(D1) - K * Math.exp(-r * T) * cdf(D2);
}

/** Black-Scholes European put price. */
export function bsPutPrice(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  const D1 = d1(S, K, T, r, sigma);
  const D2 = d2(S, K, T, r, sigma);
  return K * Math.exp(-r * T) * cdf(-D2) - S * cdf(-D1);
}

/** Call delta: N(d1). */
export function bsCallDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  return cdf(d1(S, K, T, r, sigma));
}

/** Put delta: N(d1) - 1. */
export function bsPutDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  return cdf(d1(S, K, T, r, sigma)) - 1;
}

/**
 * Binary search for the strike that produces the target |delta|.
 * For puts, searches below spot; for calls, searches above spot.
 */
export function findStrikeForDelta(
  targetAbsDelta: number,
  spot: number,
  T: number,
  r: number,
  sigma: number,
  type: "put" | "call"
): number {
  let lo: number, hi: number;

  if (type === "put") {
    // Put strikes below spot: deeper OTM = lower |delta|
    lo = spot * 0.5;
    hi = spot;
  } else {
    // Call strikes above spot: deeper OTM = lower |delta|
    lo = spot;
    hi = spot * 1.5;
  }

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const absDelta =
      type === "put"
        ? Math.abs(bsPutDelta(spot, mid, T, r, sigma))
        : Math.abs(bsCallDelta(spot, mid, T, r, sigma));

    if (type === "put") {
      // Higher strike → higher |put delta| (closer to ATM)
      if (absDelta > targetAbsDelta) {
        hi = mid; // strike too high (too close to ATM), move down
      } else {
        lo = mid; // strike too low (too far OTM), move up
      }
    } else {
      // Lower strike → higher |call delta| (closer to ATM)
      if (absDelta > targetAbsDelta) {
        lo = mid; // strike too low (too close to ATM), move up
      } else {
        hi = mid; // strike too high (too far OTM), move down
      }
    }

    if (Math.abs(hi - lo) < 0.01) break;
  }

  return (lo + hi) / 2;
}
