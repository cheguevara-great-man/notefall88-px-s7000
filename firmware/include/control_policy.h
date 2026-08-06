#pragma once

namespace notefall::security {

constexpr bool automaticAccessPointTrust(bool inAccessPointNetwork,
                                         bool alsoInStationNetwork) {
  return inAccessPointNetwork && !alsoInStationNetwork;
}

constexpr bool controlAuthorized(bool protocolMatches,
                                 bool automaticAccessPoint,
                                 bool credentialSupplied,
                                 bool credentialMatches) {
  return protocolMatches &&
      (automaticAccessPoint || (credentialSupplied && credentialMatches));
}

// Compile-time policy truth table. A future refactor cannot accidentally turn
// protocol compatibility, a wrong password, or an overlapping subnet into an
// authorized control session while the firmware still builds.
static_assert(automaticAccessPointTrust(true, false));
static_assert(!automaticAccessPointTrust(false, false));
static_assert(!automaticAccessPointTrust(true, true));
static_assert(controlAuthorized(true, true, false, false));
static_assert(controlAuthorized(true, false, true, true));
static_assert(!controlAuthorized(false, true, true, true));
static_assert(!controlAuthorized(true, false, false, false));
static_assert(!controlAuthorized(true, false, true, false));

}  // namespace notefall::security
