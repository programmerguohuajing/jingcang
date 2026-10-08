# JingCang multi-platform offline production deployment

## Supported targets
- Windows 10/11 + Docker Desktop (Linux containers); Linux + Docker Engine/Compose v2; macOS + Docker Desktop.
- PowerShell 7 (`pwsh`) is required on both build and target computers.
- The offline archive is Docker Engine **OS/architecture-specific**. Produce Linux/amd64 and Linux/arm64 archives separately. The installer refuses a platform mismatch.
- Existing production Compose uses Docker socket and Docker-managed browser containers; validate socket sharing/permissions and Selenium browser image compatibility on the target. iOS Simulator is not included, and Windows does not provide native iOS Simulator.

## Build machine (network or cached images)
1. Build/tag production Control API and browser bundle using the existing scripts; ensure Nginx and Selenium images pinned in `deploy/compose.production.yaml` are cached.
2. From repository root run:

```powershell
pwsh -File scripts/package-offline-production.ps1 -OutputDirectory dist/jingcang-offline-1.3.0
```

3. To include browser image archives from `deploy/browser-images`, use `-IncludeBrowserArchives`. Archives may be very large; by default only the browser-bundle image and pinned core images are included.
4. Transfer the complete directory to the isolated target via approved secure removable media or trusted internal transfer. Do not copy your `.env.production` or other credentials into distributable packages.

## Isolated deployment (Windows, Linux, macOS)
1. Install Docker Engine or Docker Desktop, Docker Compose v2 and PowerShell 7 locally (preinstall these dependencies offline if the machine has no internet).
2. Change into the unpacked package directory. Copy `.env.production.example` to `.env.production` and set **unique strong values** for session secret, viewer secret and initial administrator password. Adjust ports and allow-list settings as needed.
3. Validate SHA-256, engine platform and Docker images, without starting production:

```powershell
pwsh -File ./install-offline-production.ps1
```

4. Start without pulling images or building source:

```powershell
pwsh -File ./install-offline-production.ps1 -Start
```

5. Verify `http://127.0.0.1:8088/health/ready` (or the chosen LAN address), review container logs, and change/rotate credentials as required. Use the existing production rollback and backup instructions for upgrades.

## Safety and limitations
- Installer checks every checksum and the exact Docker OS/architecture **before** importing any image. It refuses missing or placeholder secrets and does not start services unless `-Start` was explicitly passed.
- `--pull never --no-build` prevents Compose pulling/building at startup. The target must already have Docker/Compose installed. Selenium may need additional browser images; use `-IncludeBrowserArchives` or pre-load those image tarballs as appropriate.
- The image tar is built from the current `compose.production.yaml` services. The package does **not** bundle Windows/macOS executable agents, Android SDK, Appium, iOS runtimes or production-grade mobile-agent credentials. Those need separate per-platform distribution and verification.
- Never expose Docker Engine socket to untrusted tenants. Use host firewall restrictions and dedicated service accounts. The default production Compose listens on LAN unless configured otherwise.
- On systems with different platform architectures, create a new bundle on a matching Docker Engine and confirm source images support that architecture.

## Validation notes
- Local test bundle successfully exported four required images and computed SHA256 checksums.
- Installer checksum validation passed; absent `.env.production` correctly blocks import/start; Docker Compose config validation passed.
- This validates the **packaging path**, not a fresh air-gapped installation on each OS. Complete OS-specific offline installation tests remain necessary before announcing production readiness.
